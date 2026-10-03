# 库存与收发货业务 API（v1）

这组接口把「采购到货 → 库存入账 → 销售占用 → 分批出库 → 订单完成」接入现有询价、报价和订单闭环。所有数量变化在单个数据库事务内同时更新业务单据、库存批次、汇总余额和不可覆盖流水。

## 核心原则

- 仓库、库存批次、汇总余额、预留和出库均保存稳定 ID，不依赖页面文案。
- 有 SKU 时库存按 `catalog_sku` 聚合；无 SKU 的临时业务按 OE 号或询价明细形成稳定库存键。
- 采购收货按批次入账，保留采购单、采购明细、成本和操作人来源。
- 可用库存等于在库数量减去预留数量；任何事务都不能让在库、预留或可用数量变为负数。
- 预留按先进先出分配到具体批次；释放与出库使用原分配关系，不重新猜测批次。
- 收货和出库要求调用方提供 `requestKey`，相同请求重试只返回原单据，不重复记账。
- 出库数量不能超过预留，收货数量不能超过采购数量；旧版本操作返回 `409`。
- 库存流水只新增不覆盖，汇总余额可以由流水重新核对。

## 权限

| 角色 | 查看仓库、余额、流水 | 收货、预留、释放、出库 | 维护仓库 |
| --- | --- | --- | --- |
| 只读查看 | 是 | 否 | 否 |
| 资料录入 | 是 | 是 | 是 |
| 资料审核 | 是 | 否 | 否 |
| 资料管理员 | 是 | 是 | 是 |

生产环境匿名身份仍然只有 `business.read`，所有库存写入需要可信身份提供 `business.inventory` 权限。

## 仓库

- `GET /api/v2/business/warehouses`
- `POST /api/v2/business/warehouses`
- `GET /api/v2/business/warehouses/:id`
- `PATCH /api/v2/business/warehouses/:id`

新建示例：

```json
{
  "warehouseCode": "HZ-MAIN",
  "name": "杭州主仓",
  "address": "杭州市余杭区",
  "isDefault": true
}
```

系统同一时间只允许一个默认仓。仓库仍有在库或预留数量时不能停用；更新必须提交 `expectedVersion`。

## 采购收货

`POST /api/v2/business/purchase-orders/:id/receipts`

兼容入口 `POST /api/v2/business/purchase-orders/:id/receive` 使用相同库存事务。新接入统一使用复数形式的收货单入口。

```json
{
  "requestKey": "mobile-scan-20261003-0001",
  "warehouseId": "仓库 ID",
  "expectedVersion": 3,
  "items": [
    { "itemId": "采购明细 ID", "quantity": 1 }
  ],
  "note": "首批到货"
}
```

首次成功返回 `201`、`created: true` 和收货单；相同 `requestKey` 重试返回原收货单、`200` 与 `created: false`。服务端在同一事务中：

1. 校验采购单版本和剩余可收数量；
2. 创建收货单及逐项库存批次；
3. 增加库存余额并记录 `receipt` 流水；
4. 把本次到货中仍属于该客户订单的数量自动锁定到同仓库预留，并记录 `reserve` 流水；
5. 累计采购明细到货数量并更新采购单状态；
6. 全部采购单到货时推动销售订单进入履约。

自动锁定只覆盖销售单尚未出库、尚未被其他有效预留占用的数量；同仓库分批到货会扩展既有预留，不会重复占用。`GET /api/v2/business/goods-receipts/:id` 返回收货明细、库存批次、成本快照、`stockReservationIds` 和本张收货单的 `autoReservedQuantity`。

## 库存余额与流水

- `GET /api/v2/business/inventory-balances?warehouseId=&q=&page=1&pageSize=50`
- `GET /api/v2/business/inventory-movements?warehouseId=&stockKey=&page=1&pageSize=50`

余额返回 `onHandQuantity`、`reservedQuantity` 和计算后的 `availableQuantity`。流水类型包括：

- `receipt`：采购收货，在库增加；
- `reserve`：销售预留，预留增加；
- `release`：释放销售预留，预留减少；
- `ship`：销售出库，在库与预留同时减少；
- `return_in`：客户退货按原出库证据回到原仓与原批次，在库增加；
- `supplier_return_out`：按采购批次退回供应商，在库减少并同步冲减应付；
- `adjustment`：为后续经审批的盘点调整预留，当前版本不开放写入口。

## 销售库存预留

`POST /api/v2/business/sales-orders/:id/reservations`

```json
{
  "warehouseId": "仓库 ID",
  "items": [
    { "itemId": "销售明细 ID", "quantity": 2 }
  ],
  "allowPartial": false,
  "note": "锁定客户订单库存"
}
```

默认要求全部满足；库存不足返回 `409 INSUFFICIENT_AVAILABLE_STOCK` 并整笔回滚。明确设置 `allowPartial: true` 时，响应分别记录预留数量与缺货数量。一个销售订单可按仓库分别维护一张生效预留；同仓库后续增加明细或采购分批到货会扩展原预留，重复请求不会重复占用。

- `GET /api/v2/business/reservations/:id`
- `POST /api/v2/business/reservations/:id/release`

释放必须提交 `expectedVersion`。已出库部分不会回补，未出库的批次占用原路释放并写入 `release` 流水。

## 销售出库

`POST /api/v2/business/sales-orders/:id/shipments`

```json
{
  "requestKey": "delivery-20261003-0001",
  "reservationId": "库存预留 ID",
  "expectedReservationVersion": 1,
  "items": [
    { "itemId": "销售明细 ID", "quantity": 1 }
  ],
  "note": "首批交付"
}
```

出库按原预留批次扣减在库与预留数量，并写入 `ship` 流水。首次成功返回 `201`，相同 `requestKey` 重试返回原出库单和 `200`。全部销售明细完成出库后，销售订单自动进入 `completed`；没有完整出库证据时，手工完成订单返回 `409 SALES_ORDER_NOT_FULLY_SHIPPED`。

`GET /api/v2/business/shipments/:id` 返回出库单及逐批次明细。

## 客户退货入库

`POST /api/v2/business/after-sales/:id/return-receipts`

退货先通过售后申请引用实际出库明细并完成审核。入库请求提交售后版本、请求键和本次增量数量；服务端按出库明细找到原仓、原库存批次和库存键，在同一事务内：

1. 校验累计退货不超过核准数量；
2. 新增退货入库单和逐项证据；
3. 恢复原批次和汇总在库数量；
4. 写入 `return_in` 库存流水；
5. 按核准退款单价冲减应收，并决定是否需要退款；
6. 更新售后状态并记录不可覆盖事件。

相同 `requestKey` 的串行或并发重试只产生一张退货入库单。完整售后与退款契约见 [询价、报价与订单业务 API](./BUSINESS-INQUIRY-API-CONTRACT.md)。

## 供应商退货出库

`POST /api/v2/business/supplier-returns/:id/shipments`

供应商退货必须先引用真实采购批次提出申请并通过独立审核。出库只允许使用批次未锁定的可用数量；服务端在同一事务内减少库存批次和仓库汇总余额、写入 `supplier_return_out` 流水，并按核准冲减单价调整采购应付。已支付金额高于调整后应付时进入供应商退款流程。相同请求键的串行或并发重试不会重复扣减库存。

## 后续演进

- 下一阶段增加经审批的盘点、报损与调拨，不允许直接改库存余额。
- 应收应付已经引用销售订单、采购订单、收货、出库与退货批次事实；后续继续补充财务期间与对账治理。
- 前端接入时优先展示异常与待处理动作：缺货、部分到货、待出库、批次差异和版本冲突。
