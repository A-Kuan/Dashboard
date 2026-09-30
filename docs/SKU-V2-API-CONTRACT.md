# SKU 资料库 v2 接口约定

## 边界

新工作台只接入 `/api/v2/catalog/*`。旧 `/api/v1/skus/*` 暂时保留用于兼容和数据迁移，不作为新功能的依赖。

v2 使用独立的 `catalog_*` 数据表。录入批次、来源证据、零件编号、互换关系、车型适配和变更快照分别存储，避免继续扩展旧 SKU 大表。

## 资料状态

- `draft`：允许不完整，适合人工录入、EPC/VIN 识别结果暂存。
- `verified`：名称、品牌分类、主编号、适配车型和可追溯来源全部满足后才能进入。
- `discontinued`：预留给后续停用流程。

完整度由五项组成，每项 20 分：名称、品牌与分类、主编号、车型适配、来源证据。完整度是提示，不等同于核验状态。

## 接口

### 导入批次

- `POST /api/v2/catalog/intakes`：保存 EPC、VIN/EPC、OE 查询、品牌目录、供应商、手工或批量导入的原始上下文。
- `GET /api/v2/catalog/intakes/:id`：读取原始批次。

来源类型：`epc`、`vin_epc`、`oe_lookup`、`brand_catalog`、`supplier`、`manual`、`import`。

### SKU 资料

- `GET /api/v2/catalog/skus?q=&status=&page=&pageSize=`：分页检索。
- `GET /api/v2/catalog/skus/:id`：读取完整聚合资料和变更记录。
- `POST /api/v2/catalog/skus`：创建草稿；允许空草稿，未传编码时由服务端生成。
- `PATCH /api/v2/catalog/skus/:id`：保存完整或局部资料，必须提交 `expectedVersion`。
- `POST /api/v2/catalog/skus/:id/verify`：核验，必须提交 `expectedVersion`。
- `GET /api/v2/catalog/skus/:id/changes`：读取变更历史及当时的完整快照。

版本过期返回 `409 CATALOG_VERSION_CONFLICT`，响应的 `details.currentVersion` 指明当前版本。资料不完整返回 `422 SKU_NOT_VERIFIABLE`，`details.issues` 包含缺失项。

## 创建示例

```json
{
  "identity": {
    "nameZh": "前刹车片",
    "brandCode": "POR",
    "brandLabel": "Porsche",
    "categoryCode": "BRAKE",
    "categoryLabel": "制动系统"
  },
  "evidence": [{
    "clientKey": "epc-1",
    "sourceType": "vin_epc",
    "sourceSystem": "Porsche EPC",
    "sourceRecordId": "601-05-01",
    "catalogPath": "前桥/制动器"
  }],
  "identifiers": [{
    "clientKey": "oe-1",
    "type": "oe",
    "rawValue": "95B 698 151 H",
    "isPrimary": true,
    "evidenceKey": "epc-1"
  }],
  "fitments": [{
    "vehicleLabel": "Porsche Macan (95B)",
    "years": "2014-2018",
    "engineCodes": ["CYP"],
    "evidenceKey": "epc-1"
  }]
}
```

编号同时保存原始值与规范化值；前端展示原始值，搜索和去重使用规范化值。来源证据通过 `clientKey` 在同一次保存中关联编号与适配记录。
