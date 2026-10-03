# 询价、报价与订单业务 API（v1）

这组接口用于支撑「客户询价 → 多供应商比价 → 对客报价 → 跟进 → 成交 → 销售订单 → 采购 → 到货 → 交付」闭环。当前版本先建立稳定的数据和权限边界，前端工作台将在视觉方案确认后接入。

## 核心原则

- 询价单保存客户、车型/VIN、需求明细、负责人和下一步动作。
- 客户车辆可以绑定已启用的车型平台和车型版本；快速报价不会只依赖自由文本车型。
- 快速报价只接受已审核 SKU，并固化 SKU 版本、主编号和当时已核验的适配范围。
- 每个需求明细可以保存多条供应商报价，并明确被选中的报价。
- 对客报价必须覆盖询价单的全部需求明细，避免漏项。
- 发送报价和状态流转使用版本号防止多人操作互相覆盖。
- 报价按可配置最低毛利率和账期客户信用额度自动判断风险；命中规则时必须由非制单人独立审批。
- 发送报价和成交转订单都会重新计算风险指纹，额度、欠款、金额或规则变化会使旧审批失效。
- 关键操作写入不可覆盖的事件记录，保留操作人、前后状态和当时快照。
- 成交询价只能生成一张销售订单；重复转换返回已有订单，不会重复采购。
- 销售订单按报价中选定的供应商自动拆分采购单，并保存客户、车型、供应商和价格快照。
- 采购到货支持分批登记、超收拦截与乐观锁；全部采购到货后销售订单自动进入履约交付。
- 成交转单同时生成应收单，支持账期、分次收款、防重复、并发尾款与超收拦截；已有收款的订单不能绕过退款或冲销直接取消。
- 业务数据已纳入数据库备份、恢复演练和发布前后数量校验。

## 权限

| 角色 | 查看 | 建询价/录供应商价/跟进 | 生成及发送报价 | 独立报价审批 | 修改风控规则 | 转订单/采购/到货/交付 | 登记收款 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 只读查看 | 是 | 否 | 否 | 否 | 否 | 否 | 否 |
| 资料录入 | 是 | 是 | 是 | 否 | 否 | 是 | 是 |
| 资料审核 | 是 | 否 | 否 | 是 | 否 | 否 | 否 |
| 资料管理员 | 是 | 是 | 是 | 是（仍禁止自审） | 是 | 是 | 是 |

生产环境的匿名访问只允许查看，所有写操作仍要求可信身份代理提供操作人身份。

## 接口

### 客户与供应商主数据

`GET /api/v2/business/partners?q=&type=&status=&page=1&pageSize=30`

合作方类型支持 `customer`、`supplier`、`both`。搜索覆盖编号、名称、简称、电话、税号、联系人、VIN、车牌和车辆名称。

`POST /api/v2/business/partners` 新建客户、门店或供应商，可以同时提交联系人和客户车辆；纯供应商不能登记客户车辆。

`GET /api/v2/business/partners/:id` 返回主信息、联系人、客户车辆和审计事件。

`GET /api/v2/business/partners/:id/360?pageSize=30&cursor=` 返回客户 360 聚合视图：客户与车辆主档、询价/报价/销售订单/采购待到货/成交额/发货统计、仍需跟进的下一步动作，以及统一时间线。时间线按客户资料、询价、报价、销售与采购订单、收货、发货归一化，使用不透明游标向前翻页；同一事务内同时产生的事件也不会因时间相同而漏项或重复。该接口只读，不复制或改写业务表。

### 业务跟进中枢

`GET /api/v2/business/operations-center?q=&kind=&urgency=&assignedTo=&page=1&pageSize=30`

该只读接口把散落在询价、待审批报价、销售订单、采购订单、应收、应付、客户售后和供应商退货中的未完成事项归并为统一工作队列。每项返回来源单号、当前状态、客户或供应商、负责人、下一步动作、需要的权限、目标路径、到期时间、紧急程度、金额和来源快照；已经成交、完成、拒绝、取消或结清的事项不会继续出现在队列中。

`kind` 支持询价跟进、`quote_approval` 报价审批、销售履约、采购到货、客户收款、供应商付款、售后审核/退货入库/客户退款、供应商退货审核/退供出库/供应商退款。`urgency` 支持 `overdue`、`today`、`upcoming`、`normal` 和 `unscheduled`，日期边界固定使用中国时区。返回的 `summary` 同时提供各紧急程度、各工作类型的数量和分币种金额，并分别汇总应收、应付、客户待退款与供应商待退款敞口。该接口不复制任务状态，源单一旦流转或结清，工作队列会立即随业务事实变化。

### 报价风控规则

- `GET /api/v2/business/controls` 查看当前规则、版本和最近变更事件；
- `PATCH /api/v2/business/controls` 管理员使用 `expectedVersion` 更新 `marginControlEnabled`、`minimumMarginRate` 和 `creditControlEnabled`。

信用额度只约束 `paymentTermsDays > 0` 的账期客户。预计信用敞口为同币种未结应收加本次报价总额；非 CNY 的账期报价要求人工审批，避免把不同币种直接相加。规则变更保留前后快照、操作人和版本，不追改历史报价。

`PATCH /api/v2/business/partners/:id` 更新名称、联系方式、状态、账期、信用额度等主信息，必须提交 `expectedVersion`。

联系人接口：

- `POST /api/v2/business/partners/:id/contacts`
- `PATCH /api/v2/business/partners/:id/contacts/:contactId`

客户车辆接口：

- `POST /api/v2/business/partners/:id/vehicles`
- `PATCH /api/v2/business/partners/:id/vehicles/:vehicleId`

车辆可以提交 `platformMasterId` 和 `variantMasterId` 关联车型库；服务端会校验车型状态、平台归属和年款边界，并保存标准平台编码。联系人和车辆写入同时校验合作方版本与子记录版本；VIN 在客户车辆中全局唯一。合作方不提供物理删除接口，停止合作使用 `inactive` 或 `blocked`，避免历史询价和报价失去来源。

### 首次快速报价建档

`POST /api/v2/business/quick-quote/customer-onboarding`

首次来询客户提交 `requestKey`、客户名称与联系电话，以及已经选择标准车型平台或版本的车辆资料。服务端在一个事务中完成重复识别和建档：优先按 VIN、其次按车牌识别既有车辆；未命中车辆时按规范化联系电话识别客户。唯一命中会复用原客户或车辆，多个客户使用同一联系电话时返回 `409 QUICK_QUOTE_CUSTOMER_MATCH_AMBIGUOUS`，不会自动合并；VIN 或车牌已存在但标准车型不一致时返回 `409 CUSTOMER_VEHICLE_MASTER_CONFLICT`，要求人工复核。

首次成功返回 `201`，包括 `customer`、`vehicle`、`createdPartner`、`createdVehicle` 和 `matchedBy`。相同 `requestKey` 重试返回原结果和 `200`，不会重复建客户或车辆。建档成功后把返回的客户与车辆 ID 直接用于快速报价。

### 快速报价上下文

`GET /api/v2/business/quick-quote/context`

查询参数支持 `customerQuery`、`vehicleQuery`、`skuQuery`、`customerId`、`customerVehicleId`、`platformId` 和 `variantId`。返回：

- 可选客户及客户车辆；
- 可用供应商；
- 已启用仓库；
- 已启用的车型版本；
- 已完成独立审核的 SKU；
- SKU 对当前客户车辆的适配结果；
- 当前库存、锁定库存和可用库存数量。
- SKU 在各仓库的在库、锁定和可用数量。

未审核 SKU 不进入快速报价候选，避免把草稿资料直接用于对客承诺。

### 一步生成快速报价

`POST /api/v2/business/quick-quotes`

```json
{
  "requestKey": "quick-quote-20261003-0001",
  "customerPartnerId": "客户 ID",
  "customerVehicleId": "客户车辆 ID",
  "validUntil": "2026-10-31",
  "items": [
    {
      "catalogSkuId": "已审核 SKU ID",
      "quantity": 2,
      "saleUnitPrice": 888,
      "costUnitPrice": 600,
      "fulfillmentSource": "purchase",
      "supplierPartnerId": "供应商 ID",
      "leadTimeDays": 2
    }
  ]
}
```

服务端在同一个事务中生成询价、询价明细、报价和报价明细，并计算小计、优惠、运费、总额与毛利。每个明细都会保存 SKU 编码、名称、品牌、版本、适配快照和履约来源。`fulfillmentSource` 必须明确为 `stock`（现货）或 `purchase`（采购）：现货会检查当前可用库存，采购必须选择有效供应商并在同一事务中固化供应商报价来源。SKU 与客户车辆没有已核验适配时默认阻断；确需人工放行时必须填写明确的 `fitmentOverrideReason`，原因随报价永久保存。

报价创建时同时返回 `marginRate`、`approvalStatus`、`riskReasons` 和 `riskSnapshot`。命中最低毛利率或信用额度规则时状态为 `pending`，并进入业务跟进中枢的报价审批队列。

`requestKey` 用于防止网络重试产生重复报价。首次成功返回 `201` 和 `created: true`；重复请求返回原报价、`200` 和 `created: false`，不会采用重试请求中变化的价格。

现货来源必须同时提交 `fulfillmentWarehouseId`。系统只使用所选仓库的可用量判断是否能够按现货报价，不会把多个仓库的零散库存合并成一条承诺；成交转订单前还会在事务中重新核对该仓库库存，若期间已被占用则返回 `ORDER_STOCK_CHANGED`，要求重新选择来源或调整数量。

复核通过后，销售订单、现货库存预留、先进先出批次分配和库存流水会在同一个数据库事务内生成；任一步失败则整单回滚，不会留下“订单已生成但现货未锁定”的中间状态。一个销售单可以在不同仓库分别建立有效预留，同仓库后续补充采购到货明细时会扩展已有预留。取消尚未出库的销售订单会自动释放所有有效预留；已有出库记录时禁止直接取消。

报价成交转订单时，销售订单明细继续保留 `fulfillmentSource`；只有 `purchase` 明细会按供应商拆分采购单，`stock` 明细不会产生无意义的采购单，后续直接进入库存预留和出库流程。

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

只有当前血缘中的最新草稿版本可以发送；版本不一致返回 `409 QUOTE_VERSION_CONFLICT`。已过 `validUntil` 的草稿会被标记为 `expired` 并返回 `409 QUOTE_EXPIRED`。发送前会重新计算风险：缺少有效审批时返回 `409 QUOTE_APPROVAL_REQUIRED`，并保留最新风险快照。新报价发送成功后，同一询价此前仍为 `sent` 的报价自动进入 `superseded`，避免客户同时确认多个有效报价。

### 修订报价

`POST /api/v2/business/quotes/:id/revisions`

```json
{
  "expectedRevision": 3,
  "reason": "客户要求调整成交价格",
  "validUntil": "2026-10-08",
  "discountAmount": 50,
  "items": [
    {
      "sourceQuoteItemId": "quote-item-id",
      "quantity": 2,
      "saleUnitPrice": 850,
      "costUnitPrice": 600
    }
  ]
}
```

修订不会覆盖原报价，而是生成同一 `lineageId` 下递增的 `versionNo`。原版本进入 `superseded`，新版本回到 `draft` 并重新计算金额、毛利、信用风险与审批要求。`revision` 仍只用于并发控制，`versionNo` 才是客户报价的商业版本。只有血缘中的最新版本可以继续修订或发送；审批不会跨版本继承。

询价详情同时返回 `quoteRevisionEvents`，包含前后快照、修订原因与变更行，供后续界面展示版本对比和审计历史。

### 审批报价

`POST /api/v2/business/quotes/:id/approval`

```json
{
  "expectedRevision": 1,
  "decision": "approved",
  "note": "已复核客户额度与本单毛利"
}
```

审批结论支持 `approved` 和 `rejected`。只有待审批报价可以审核；制单人即使拥有管理员权限也不能审批自己的报价。审批会增加并发控制号 `revision` 并写入不可覆盖的审批事件，但不会改变客户可见的商业版本号 `versionNo`。

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

允许报价后直接成交或丢单，也允许丢单重新进入跟进。成交或丢单时可传 `quoteId`；服务端只接受当前最新、仍在有效期内且状态为 `sent` 的报价。旧报价返回 `409 QUOTE_NOT_LATEST`，过期报价返回 `409 QUOTE_EXPIRED`。无效流转与旧版本写入均返回 `409`。

### 成交转订单

`POST /api/v2/business/inquiries/:id/convert-order`

仅允许转换 `won` 状态且存在已接受报价的询价。已接受报价必须仍是血缘最新版本且未过有效期，否则拒绝转单。转单前会再次核对毛利、信用额度与未结应收；风险指纹变化时返回 `409 ORDER_QUOTE_APPROVAL_REQUIRED`，需要按最新快照重新审批。每项报价必须关联供应商报价，服务端在同一事务中完成：

1. 生成一张销售订单及销售明细；
2. 按供应商拆分一张或多张采购订单；
3. 固化客户、车辆、供应商、售价与成本快照；
4. 按客户账期生成应收，按各供应商账期生成应付；
5. 写入询价、订单和财务事件记录。

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

### 应收与收款

- `GET /api/v2/business/receivables?q=&status=&customerPartnerId=&page=1&pageSize=30`
- `GET /api/v2/business/receivables/:id`
- `POST /api/v2/business/receivables/:id/payments`

成交询价转换为销售订单时，会在同一事务内按客户账期自动生成一张应收单；销售订单详情同时返回应收编号、原始金额、退货冲减、调整后应收、已收、已退、净收、未收、待退、状态和到期日。应收状态为 `open`、`partial`、`paid`、`refund_pending` 或 `void`。取消没有收款的销售订单会同步作废应收；一旦已有收款则返回 `409 RECEIVABLE_HAS_PAYMENTS`，必须先走退款或冲销，避免删除财务事实。

收款请求提交全局唯一的 `requestKey`、金额和方式：

```json
{
  "requestKey": "payment-20261003-0001",
  "amount": 1000,
  "paymentMethod": "bank_transfer",
  "paidAt": "2026-10-03T08:30:00.000Z",
  "referenceNo": "BANK-20261003-001",
  "note": "客户首笔转账"
}
```

收款方式支持 `bank_transfer`、`cash`、`wechat`、`alipay`、`card` 和 `other`。首次成功返回 `201`；相同请求键重试返回原收款与 `200`，并发提交也只入账一次。分次收款会将应收更新为 `partial`，结清后更新为 `paid`；超过调整后未收金额返回 `409 PAYMENT_EXCEEDS_OUTSTANDING`。退货冲减造成多收款时进入 `refund_pending` 并暂停继续收款。每次操作保留收款单、操作人和不可覆盖的应收事件，客户 360 同步汇总净收、未收、逾期、冲减和退款动态。

销售订单的 `profitability` 使用实际业务事实计算：净销售额取退货冲减后的应收，实际成本取已出库库存批次成本并扣回客户已退货入库的批次成本，同时返回供应商应付、已付和未付。未出库的采购库存不会提前计入销售成本；因此该字段表达已实现毛利，而不是报价阶段的预计毛利。

### 应付与供应商付款

- `GET /api/v2/business/payables?q=&status=&supplierPartnerId=&page=1&pageSize=30`
- `GET /api/v2/business/payables/:id`
- `POST /api/v2/business/payables/:id/payments`

成交转单时，每一张采购订单都会在同一事务内按供应商账期生成一张应付单。应付状态为 `open`、`partial`、`paid` 或 `void`。采购订单详情同时返回应付编号、原始金额、已付、未付、状态和到期日。

供应商付款同样要求全局唯一的 `requestKey`，支持分次付款和并发安全重试：

```json
{
  "requestKey": "supplier-payment-20261003-0001",
  "amount": 1000,
  "paymentMethod": "bank_transfer",
  "referenceNo": "SUPPLIER-BANK-001",
  "note": "供应商首笔货款"
}
```

采购单确认后才允许付款；超过未付金额返回 `409 SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING`。未付款采购单取消时同步作废应付；已付款采购单返回 `409 PAYABLE_HAS_PAYMENTS`，必须先处理供应商退款或冲销，避免通过取消订单抹掉付款事实。所有付款和状态变化都保留独立单据、操作人和应付事件。

### 供应商退货、应付冲减与退款

- `GET /api/v2/business/supplier-returns?q=&status=&supplierPartnerId=&purchaseOrderId=&page=1&pageSize=30`
- `POST /api/v2/business/supplier-returns`
- `GET /api/v2/business/supplier-returns/:id`
- `POST /api/v2/business/supplier-returns/:id/review`
- `POST /api/v2/business/supplier-returns/:id/shipments`
- `POST /api/v2/business/supplier-returns/:id/refunds`

供应商退货必须逐条引用真实采购收货形成的库存批次，并且只能申请退回该批次尚未锁定的可用数量。申请人与审核人职责分离；审核可以逐项核准退货数量和冲减单价，冲减单价不能超过原采购批次成本。

退货出库支持分批处理和请求键防重。每批出库都会同时减少原库存批次、仓库汇总余额，写入 `supplier_return_out` 库存流水，并冲减对应采购应付。如果已经支付的净货款高于冲减后的应付，应付单与供应商退货单进入 `refund_pending`，此时暂停继续付款，只有实际待收退款金额可以登记为供应商退款。退款完成后，应付以“原额 - 退货冲减”和“累计付款 - 供应商退款”的净额重新结清。

创建供应商退货要求 `business.purchase_return`，独立审核要求 `business.purchase_return.review`，退货出库要求 `business.inventory`，供应商退款入账要求 `business.finance`。创建、出库和退款都使用数据库事务、锁与请求键，在连续或并发重试时不会重复退库存、重复冲减应付或重复登记退款。

### 退货、退款与售后

- `GET /api/v2/business/after-sales?q=&status=&customerPartnerId=&salesOrderId=&page=1&pageSize=30`
- `POST /api/v2/business/after-sales`
- `GET /api/v2/business/after-sales/:id`
- `POST /api/v2/business/after-sales/:id/review`
- `POST /api/v2/business/after-sales/:id/return-receipts`
- `POST /api/v2/business/after-sales/:id/refunds`

售后申请必须逐条引用真实的销售出库明细，而不是只填 SKU 或文字名称；因此系统可以验证尚可退数量，并保留原销售明细、出库单、库存批次、仓库和售价证据。相同出库批次在未拒绝、未取消的售后单中累计申请数量不得超过实际出库数量。

流程为：

`requested → approved → partially_received / refund_pending / completed`

审核也可以进入 `rejected`。审核时提交 `expectedVersion`，可以逐项核准退货数量和退款单价；退款单价不能超过原销售单价。退货入库使用全局唯一 `requestKey`，可以分批入库，每一批都恢复原出库仓、原库存批次与汇总余额，写入 `return_in` 流水，并按核准金额冲减应收。

应收冲减后，如果客户净付款高于调整后应收，售后单和应收单进入 `refund_pending`。退款接口只能退这部分多收金额，不能超过本售后单的累计冲减额：

```json
{
  "requestKey": "refund-20261003-0001",
  "amount": 780,
  "refundMethod": "wechat",
  "referenceNo": "WX-REFUND-001",
  "note": "原路退回客户"
}
```

退货入库要求 `business.inventory`，退款要求 `business.finance`，创建要求 `business.after_sales`，审核要求独立的 `business.after_sales.review`；申请人不能审核自己的售后单。生产匿名身份只有查看权限。创建、入库和退款入口都使用数据库事务和请求键防重，并发重试不会重复建单、重复入库、重复冲减或重复退款。客户 360 和销售订单详情同步返回售后汇总与事件。

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

服务端累计已到货数量，不允许超过采购数量。并发旧版本返回 `409 PURCHASE_ORDER_VERSION_CONFLICT`，超收返回 `409 RECEIPT_EXCEEDS_ORDERED_QUANTITY`。新收货会在同一事务中创建收货单、库存批次、汇总余额和库存流水，并把仍属于该销售订单的到货数量自动锁定；同仓库分批到货扩展既有预留，避免已到货配件被其他订单占用。完整契约见 [库存与收发货业务 API](./BUSINESS-INVENTORY-API-CONTRACT.md)。

## 后续接入

- 客户、供应商和客户车辆已经支持主数据关联，客户车辆可以进一步关联标准车型平台和版本，同时保留业务发生时的名称和车辆快照。
- 询价需求和报价明细都保存 `catalog_sku` 及版本快照，不会因后续 SKU 资料变化而改写历史报价。
- 服务端已经覆盖销售/采购订单、仓库、采购收货、库存预留、销售出库、应收收款、售后退款、应付付款、实际毛利及流水；前端视觉仍需先确认后接入。
