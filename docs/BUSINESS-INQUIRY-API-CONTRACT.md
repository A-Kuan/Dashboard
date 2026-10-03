# 询价、报价与订单业务 API（v1）

这组接口用于支撑「客户询价 → 多供应商比价 → 对客报价 → 跟进 → 成交 → 销售订单 → 采购 → 到货 → 交付」闭环。当前版本先建立稳定的数据和权限边界，前端工作台将在视觉方案确认后接入。

## 核心原则

- 询价单保存客户、车型/VIN、需求明细、负责人和下一步动作。
- 每个需求明细可以保存多条供应商报价，并明确被选中的报价。
- 对客报价必须覆盖询价单的全部需求明细，避免漏项。
- 发送报价和状态流转使用版本号防止多人操作互相覆盖。
- 关键操作写入不可覆盖的事件记录，保留操作人、前后状态和当时快照。
- 成交询价只能生成一张销售订单；重复转换返回已有订单，不会重复采购。
- 销售订单按报价中选定的供应商自动拆分采购单，并保存客户、车型、供应商和价格快照。
- 采购到货支持分批登记、超收拦截与乐观锁；全部采购到货后销售订单自动进入履约交付。
- 业务数据已纳入数据库备份、恢复演练和发布前后数量校验。

## 权限

| 角色 | 查看 | 建询价/录供应商价/跟进 | 生成及发送报价 | 转订单/采购/到货/交付 |
| --- | --- | --- | --- | --- |
| 只读查看 | 是 | 否 | 否 | 否 |
| 资料录入 | 是 | 是 | 是 | 是 |
| 资料审核 | 是 | 否 | 否 | 否 |
| 资料管理员 | 是 | 是 | 是 | 是 |

生产环境的匿名访问只允许查看，所有写操作仍要求可信身份代理提供操作人身份。

## 接口

### 客户与供应商主数据

`GET /api/v2/business/partners?q=&type=&status=&page=1&pageSize=30`

合作方类型支持 `customer`、`supplier`、`both`。搜索覆盖编号、名称、简称、电话、税号、联系人、VIN、车牌和车辆名称。

`POST /api/v2/business/partners` 新建客户、门店或供应商，可以同时提交联系人和客户车辆；纯供应商不能登记客户车辆。

`GET /api/v2/business/partners/:id` 返回主信息、联系人、客户车辆和审计事件。

`PATCH /api/v2/business/partners/:id` 更新名称、联系方式、状态、账期、信用额度等主信息，必须提交 `expectedVersion`。

联系人接口：

- `POST /api/v2/business/partners/:id/contacts`
- `PATCH /api/v2/business/partners/:id/contacts/:contactId`

客户车辆接口：

- `POST /api/v2/business/partners/:id/vehicles`
- `PATCH /api/v2/business/partners/:id/vehicles/:vehicleId`

联系人和车辆写入同时校验合作方版本与子记录版本；VIN 在客户车辆中全局唯一。合作方不提供物理删除接口，停止合作使用 `inactive` 或 `blocked`，避免历史询价和报价失去来源。

### 查询询价列表

`GET /api/v2/business/inquiries?q=&status=&page=1&pageSize=30`

支持按询价号、客户、车型、VIN、需求名称和 OE 号搜索。返回分页结果、各状态数量与报价金额汇总。

### 新建询价

`POST /api/v2/business/inquiries`

最小请求：

```json
{
  "customerPartnerId": "客户主数据 ID",
  "customerVehicleId": "客户车辆 ID",
  "items": [
    {
      "requirementText": "前刹车片",
      "oeNumber": "95B 698 151 H",
      "requestedQuantity": 2,
      "unit": "套"
    }
  ]
}
```

也可以仅传 `customerName`、`vehicleLabel` 和 `vin` 处理尚未建档的临时询价。关联主数据时，服务端会保存当时的客户名称、主联系人和车辆快照；后续主数据改名不会改写历史报价。

### 查看询价详情

`GET /api/v2/business/inquiries/:id`

返回询价主信息、需求明细、每项供应商报价、历次对客报价及完整事件记录。

### 录入供应商报价

`POST /api/v2/business/inquiries/:id/items/:itemId/offers`

```json
{
  "supplierPartnerId": "供应商主数据 ID",
  "brandLabel": "Porsche",
  "unitPrice": 600,
  "freightAmount": 0,
  "availability": "in_stock",
  "leadTimeDays": 1,
  "selected": true
}
```

`selected: true` 会把同一需求项的其他供应商报价取消选中，但不会删除历史报价。
尚未建档的临时供应商仍可只传 `supplierName`；关联供应商主数据时保存当时的供应商名称快照。

### 生成对客报价

`POST /api/v2/business/inquiries/:id/quotes`

请求中的 `items` 必须覆盖询价的全部需求项。服务端计算小计、优惠、运费、总额和毛利，不接受调用方直接写入汇总金额。

### 发送报价

`POST /api/v2/business/quotes/:id/send`

```json
{
  "expectedRevision": 1,
  "nextAction": "明天下午回访客户",
  "nextActionAt": "2026-10-03T06:00:00.000Z",
  "note": "已通过微信发送"
}
```

只有草稿报价可以发送；版本不一致返回 `409 QUOTE_VERSION_CONFLICT`。

### 业务状态流转

`POST /api/v2/business/inquiries/:id/transition`

```json
{
  "expectedVersion": 5,
  "status": "follow_up",
  "nextAction": "确认客户到店时间",
  "note": "客户已读，等待确认"
}
```

主要流转为：

`new → sourcing → quoting → quoted → follow_up → won/lost`

允许报价后直接成交或丢单，也允许丢单重新进入跟进。无效流转与旧版本写入均返回 `409`。

### 成交转订单

`POST /api/v2/business/inquiries/:id/convert-order`

仅允许转换 `won` 状态且存在已接受报价的询价。每项报价必须关联供应商报价，服务端在同一事务中完成：

1. 生成一张销售订单及销售明细；
2. 按供应商拆分一张或多张采购订单；
3. 固化客户、车辆、供应商、售价与成本快照；
4. 写入询价与订单事件记录。

首次转换返回 `201` 和 `created: true`；对同一询价重复调用返回已有订单、`200` 和 `created: false`。

### 销售订单

- `GET /api/v2/business/sales-orders?q=&status=&page=1&pageSize=30`
- `GET /api/v2/business/sales-orders/:id`
- `POST /api/v2/business/sales-orders/:id/transition`

销售订单主要状态为：

`draft → confirmed → fulfilling → completed`

取消使用 `cancelled`。已有到货记录时不能直接取消；全部关联采购单到货前不能进入履约。最后一张采购单全部到货时，已确认的销售订单会自动进入 `fulfilling`。

状态请求必须提交 `expectedVersion`，例如：

```json
{
  "expectedVersion": 1,
  "status": "confirmed",
  "note": "客户订单复核完成"
}
```

### 采购订单与到货

- `GET /api/v2/business/purchase-orders?q=&status=&supplierPartnerId=&page=1&pageSize=30`
- `GET /api/v2/business/purchase-orders/:id`
- `POST /api/v2/business/purchase-orders/:id/transition`
- `POST /api/v2/business/purchase-orders/:id/receive`

采购订单主要状态为：

`draft → submitted → confirmed → partially_received → received`

提交采购单前，关联销售订单必须已经确认。到货请求提交本次增量数量：

```json
{
  "expectedVersion": 3,
  "items": [
    { "itemId": "采购明细 ID", "quantity": 1 }
  ],
  "note": "首批到货"
}
```

服务端累计已到货数量，不允许超过采购数量。并发旧版本返回 `409 PURCHASE_ORDER_VERSION_CONFLICT`，超收返回 `409 RECEIPT_EXCEEDS_ORDERED_QUANTITY`。迁移 `035` 起，新收货还会在同一事务中创建收货单、库存批次、汇总余额和库存流水，完整契约见 [库存与收发货业务 API](./BUSINESS-INVENTORY-API-CONTRACT.md)。

## 后续接入

- 客户、供应商和客户车辆已经支持主数据关联，同时保留业务发生时的名称和车辆快照。
- 询价需求可以关联现有 `catalog_sku`，但不会因 SKU 资料变化而改写已发送报价。
- 服务端已经覆盖销售/采购订单、仓库、采购收货、库存预留、销售出库及流水；前端视觉仍需先确认后接入。
