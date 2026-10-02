# 询价与报价业务 API（v0）

这组接口用于支撑「客户询价 → 多供应商比价 → 对客报价 → 跟进 → 成交/丢单」闭环。当前版本先建立稳定的数据和权限边界，前端工作台将在视觉方案确认后接入。

## 核心原则

- 询价单保存客户、车型/VIN、需求明细、负责人和下一步动作。
- 每个需求明细可以保存多条供应商报价，并明确被选中的报价。
- 对客报价必须覆盖询价单的全部需求明细，避免漏项。
- 发送报价和状态流转使用版本号防止多人操作互相覆盖。
- 关键操作写入不可覆盖的事件记录，保留操作人、前后状态和当时快照。
- 业务数据已纳入数据库备份、恢复演练和发布前后数量校验。

## 权限

| 角色 | 查看 | 建询价/录供应商价/跟进 | 生成及发送报价 |
| --- | --- | --- | --- |
| 只读查看 | 是 | 否 | 否 |
| 资料录入 | 是 | 是 | 是 |
| 资料审核 | 是 | 否 | 否 |
| 资料管理员 | 是 | 是 | 是 |

生产环境的匿名访问只允许查看，所有写操作仍要求可信身份代理提供操作人身份。

## 接口

### 查询询价列表

`GET /api/v2/business/inquiries?q=&status=&page=1&pageSize=30`

支持按询价号、客户、车型、VIN、需求名称和 OE 号搜索。返回分页结果、各状态数量与报价金额汇总。

### 新建询价

`POST /api/v2/business/inquiries`

最小请求：

```json
{
  "customerName": "王师傅汽修",
  "vehicleLabel": "Porsche Cayenne (95B)",
  "vin": "WP1AA29P39LA12345",
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

### 查看询价详情

`GET /api/v2/business/inquiries/:id`

返回询价主信息、需求明细、每项供应商报价、历次对客报价及完整事件记录。

### 录入供应商报价

`POST /api/v2/business/inquiries/:id/items/:itemId/offers`

```json
{
  "supplierName": "华东供应商",
  "brandLabel": "Porsche",
  "unitPrice": 600,
  "freightAmount": 0,
  "availability": "in_stock",
  "leadTimeDays": 1,
  "selected": true
}
```

`selected: true` 会把同一需求项的其他供应商报价取消选中，但不会删除历史报价。

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

## 后续接入

- 客户和供应商目前以业务快照名称保存，后续主数据模块上线后再增加可选关联 ID，不覆盖历史文本。
- 询价需求可以关联现有 `catalog_sku`，但不会因 SKU 资料变化而改写已发送报价。
- 下一阶段前端优先实现业务列表、需求/比价主区、客户/车型/下一步侧栏，不在 v0 内生成采购单或订单。
