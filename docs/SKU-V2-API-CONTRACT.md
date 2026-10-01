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

- `GET /api/v2/catalog/skus?q=&status=&page=&pageSize=`：服务端分页检索；响应包含 `statusCounts`，编号搜索会忽略空格和常用分隔符。
- `GET /api/v2/catalog/duplicates?identifier=&exceptId=`：按规范化编号检查潜在重复资料，用于保存前预警，不自动合并或阻止合法的品牌件/替代件。
- `GET /api/v2/catalog/skus/:id`：读取完整聚合资料和变更记录。
- `POST /api/v2/catalog/skus`：创建草稿；允许空草稿，未传编码时由服务端生成。
- `PATCH /api/v2/catalog/skus/:id`：保存完整或局部资料，必须提交 `expectedVersion`。
- `POST /api/v2/catalog/skus/:id/verify`：核验，必须提交 `expectedVersion`。
- `GET /api/v2/catalog/skus/:id/changes`：读取变更历史及当时的完整快照。
- `GET /api/v2/catalog/quality`：读取数据质量与审核队列，可按 `issue`、`status`、`assignee` 筛选。
- `POST /api/v2/catalog/skus/:id/transition`：执行带版本锁的审核状态流转。

### 审核状态流转

`transition` 支持以下动作：

- `submit_review`：草稿提交审核，完整性和重复编号检查必须通过，可指定 `assignee` 与 `dueAt`。
- `assign_review`：重新分配等待审核的资料。
- `approve_review`：审核通过，资料进入 `verified`。
- `reject_review`：填写原因后退回草稿。
- `discontinue`：填写原因后停用已核验资料。
- `reopen`：填写原因后将停用资料恢复为草稿。

所有动作必须携带 `expectedVersion`，并写入 `catalog_review_event` 与 `catalog_change_log`。对待审核或已核验资料进行内容编辑时，系统会自动退回草稿并清除核验状态；已停用资料必须先恢复后才能编辑。

质量队列目前检查标准名称、品牌与分类、主 OE、适配车型、来源证据和跨 SKU 编号冲突。草稿与待审核资料始终进入队列；已核验资料出现新风险时也会重新进入队列。

### 批量导入

- `POST /api/v2/catalog/imports`：提交 `sourceName` 和最多 500 行结构化数据，创建只读预检查批次。
- `GET /api/v2/catalog/imports?state=&page=&pageSize=`：分页读取历史批次，支持按状态筛选。
- `GET /api/v2/catalog/imports/:id`：读取批次、逐行问题、重复匹配和写入结果。
- `POST /api/v2/catalog/imports/:id/commit`：提交 `expectedVersion` 与明确选中的 `rowIds`，只写入 `ready` 或用户主动选择的 `duplicate` 行。
- `POST /api/v2/catalog/imports/:id/retry`：对 `partial` 批次中失败的行重新执行写入；可提交 `rowIds` 进一步缩小范围，并继续使用 `expectedVersion` 防止并发重复操作。

导入行状态为 `ready`、`duplicate`、`invalid`、`imported`、`skipped` 或 `failed`。疑似重复项默认不选择；不可导入项不能选择。提交采用批次版本锁防止双击重复写入，部分失败会标记为 `partial` 并保留每行错误。原始文件行保存在 `catalog_intake`，生成的来源证据通过 `intake_id` 回溯到导入批次。

首次提交和每次重试都会生成独立的 `catalog_import_attempt` 记录，保留执行类型、操作者、开始与完成时间、选择行数、成功数和失败数。批次汇总数据是所有尝试后的当前结果，执行记录不可被后续重试覆盖。

### 运营指标

- `GET /api/v2/catalog/metrics?days=30`：读取指定统计周期内的真实资料、审核与导入聚合数据，`days` 支持 14、30 或 90。

响应包含资料状态、完整度区间、质量问题、审核提交/通过/退回/平均耗时/逾期数、导入批次与成功率，以及按日汇总的创建、提交、通过和退回趋势。日期边界按 `Asia/Shanghai` 业务日计算；没有数据时返回零值，不生成演示数据。

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

列表接口只返回表格需要的摘要字段，详情由前端在选中行后按需加载，避免资料量增加后出现每页几十次详情请求。品牌、分类和计量单位继续使用共享字典接口 `/api/v1/dictionaries`，新工作台不在组件中固化业务选项。
