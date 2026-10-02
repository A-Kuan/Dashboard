# SKU v2 数据结构建议

## 聚合边界

```text
CatalogSku
├── SkuIdentity             零件身份与生命周期
├── PartIdentifier[]        OE、历史号、品牌号、条码
├── InterchangeRelation[]   有方向的替代/互换关系
├── Fitment[]               车型适配与精确条件
├── SourceEvidence[]        EPC/VIN/目录/供应商原始证据
├── TechnicalAttribute[]    分类驱动的技术属性
├── MediaAsset[]            图片、图纸、证书与文档
├── SupplierOffer[]         供应商件号、价格、交期
└── InventorySummary        只读的库存聚合视图
```

身份、编号、适配和来源证据属于目录主数据；供应商报价和库存属于独立业务域，通过 `sku_id` 关联。这样资料核验不会被一次报价或某个仓库库存污染。

## 核心实体

### `catalog_sku`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `sku_code` | varchar | 唯一、创建后不可复用 |
| `canonical_name_zh` | varchar | 标准中文名称 |
| `canonical_name_en` | varchar | 可空 |
| `brand_id` | UUID | 引用品牌字典 |
| `category_id` | UUID | 引用叶子分类 |
| `lifecycle_status` | enum | draft/review/verified/discontinued |
| `completeness_score` | smallint | 0–100，派生值 |
| `verification_level` | enum | unverified/assisted/verified |
| `version` | integer | 乐观锁版本 |
| `created_at/updated_at` | timestamptz | 审计时间 |

### `part_identifier`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `sku_id` | UUID | 所属 SKU |
| `identifier_type` | enum | oe/mpn/gtin/internal/legacy |
| `raw_value` | varchar | 来源中的原始格式 |
| `normalized_value` | varchar | 去除空格和分隔符后的搜索值 |
| `manufacturer_id` | UUID | 编号所属品牌/制造商 |
| `is_primary` | boolean | 每种主编号至多一个 |
| `source_evidence_id` | UUID | 指向证明该编号的来源 |
| `verification_status` | enum | pending/verified/rejected |

建议唯一约束：`identifier_type + normalized_value + manufacturer_id`。不能只用名称判断两个 SKU 相同。

### `interchange_relation`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `from_identifier_id` | UUID | 关系起点 |
| `to_identifier_id` | UUID | 关系终点 |
| `relation_type` | enum | superseded_by/replaces/interchangeable/reference_only |
| `direction` | enum | directed/bidirectional |
| `effective_from/to` | date | 可空 |
| `conditions` | jsonb | 市场、车型或配置限制 |
| `source_evidence_id` | UUID | 必填 |

### `fitment`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `sku_id` | UUID | 所属 SKU |
| `vehicle_platform_id` | text | 来源平台编码，保留原始业务键 |
| `platform_master_id` | UUID | 解析后的 `catalog_vehicle_platform` 外键；平台建立后自动回填 |
| `variant_master_id` | UUID | 可空；精确指向 `catalog_vehicle_variant` 车型版本 |
| `year_from/year_to` | smallint | 年款范围 |
| `engine_codes` | text[] | 发动机代码 |
| `transmission_codes` | text[] | 变速箱代码 |
| `market_codes` | text[] | 市场范围 |
| `pr_codes` | text[] | PR/选装代码 |
| `body_styles` | text[] | 车身形式 |
| `drive_types` | text[] | 驱动形式 |
| `position` | enum | 安装位置/左右侧 |
| `include_conditions` | jsonb | `rules[]` 结构化必须满足条件，并兼容旧 `note` |
| `exclude_conditions` | jsonb | `rules[]` 结构化排除条件，并兼容旧 `note` |
| `source_evidence_id` | UUID | 每条适配必须可追溯 |
| `verification_status` | enum | pending/verified/rejected/conflict |
| `review_note` | text | 最近一次审核结论 |
| `reviewed_by/reviewed_at` | text/timestamptz | 最近审核人和时间 |
| `review_version` | integer | 适配关系独立乐观锁版本 |

### `catalog_fitment_review_event`

适配审核事件采用追加写模型，保存 `sku_id`、`fitment_id`、前后状态、`approve/reject/conflict` 动作、必填结论、完整适配快照、当时 SKU 版本、操作人与时间。即使后续编辑重新生成适配子记录，历史判断仍保留在 SKU 审计链中。适配审核会同时写入 `catalog_change_log`，因此版本恢复、导出审计包和变更记录能够解释一条关系为何通过或被退回。

### `catalog_vehicle_platform`

车型平台主数据与旧 `vehicle_variant` 业务聚合完全分离。它保存稳定的平台编码、品牌/车系/代际、生产年款边界、市场、车身形式、别名、来源系统与来源引用；状态为 `draft/active/retired`。只有同时具备起止年款和来源依据的平台可以启用。所有修改使用乐观锁，并向 `catalog_vehicle_platform_change_event` 追加完整快照，不覆盖历史。

### `catalog_vehicle_variant`

车型版本是平台下的第二级主数据，使用平台内唯一的 `variant_code` 表达可以被业务复用的具体配置边界。版本保存起止年款、发动机、变速箱、市场、车身、驱动、PR 代码、来源依据和 `draft/active/retired` 生命周期。启用版本至少需要完整年款、一个发动机代码及来源依据，且年款不能超出所属平台。每次修改使用乐观锁并向 `catalog_vehicle_variant_change_event` 追加完整快照。

适配可保持平台级，也可关联一个已启用车型版本。关联版本后，年款以及发动机、变速箱、市场、车身、驱动、PR 代码必须落在版本允许范围内。`include_conditions.rules[]` 与 `exclude_conditions.rules[]` 的字段限定为 `engineCode/transmissionCode/marketCode/bodyStyle/driveType/prCode/position`，操作限定为 `in/not_in/equals`；同字段同值同时出现在包含和排除规则中属于阻断性冲突。旧 `note` 继续保留用于无法结构化的补充说明。

### `catalog_fitment_scope_resolution`

适配冲突由当前平台、车型版本和适配关系实时计算，不把容易失真的扫描结果缓存成事实表。成对冲突的人工结论单独追加保存稳定 `conflict_key`、冲突类型、两条适配、两条 SKU、平台、冲突时快照、处理结论、必填依据和操作人。`accepted_overlap` 与 `same_application` 解除当前冲突阻断；`correction_required` 保持阻断，直到适配数据被真正修正。未识别/未启用平台、版本平台不符、未启用版本、年款或版本维度越界，以及单条记录内部自相矛盾都不允许人工忽略。

### `source_evidence`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `source_type` | enum | epc/vin_epc/brand_catalog/supplier/manual |
| `source_system` | varchar | 如 Porsche PET、Audi ETKA |
| `source_record_id` | varchar | 外部记录标识 |
| `catalog_path` | varchar | 目录/图组路径 |
| `figure_position` | varchar | 图例位置 |
| `original_name` | varchar | 来源原始名称 |
| `vin_context` | varchar | 脱敏 VIN 或车辆上下文 |
| `raw_payload` | jsonb | 原始响应快照或其对象存储引用 |
| `captured_at` | timestamptz | 采集时间 |
| `confidence` | enum | low/medium/high |
| `immutable_hash` | varchar | 防止原始证据被静默覆盖 |

### EPC 写入前审阅

`catalog_epc_preview` 关联一条 `catalog_intake`，保存 VIN、来源系统、目录路径、匹配统计、状态和乐观锁版本。`catalog_epc_preview_item` 保存每一条来源 OE、原始名称、图例位置、车型上下文、原始载荷、SKU 候选、平台匹配和带评分原因的车型版本候选。候选是解释性预览，不是已确认适配。

`catalog_epc_publish_decision` 采用追加写模型，逐条保存 `create_sku`、`attach_evidence` 或 `skip` 决定、完整来源快照、写入结果、操作人与时间。同一预览行只能产生一个决定；未选择行保持待处理。附加到现有 SKU 时只新增来源证据并使资料回到待核验状态，不替换人工维护的身份、分类、价格或既有适配。新建结果固定为草稿，来源产生的适配固定为 `pending`。

### 商业域

`supplier_offer` 保存 `supplier_id`、`supplier_part_number`、采购单位、币种、含税价、MOQ、交期、有效期和来源；`inventory_balance` 保存仓库/库位、现有量、锁定量、在途量和快照时间。`oem_reference` 单独作为来源价格类型，只读展示，禁止写入商业价格枚举。

### `catalog_import_mapping_profile`

供应商字段映射方案保存方案名称、文件名特征、稳定的表头签名、原始字段快照、标准字段映射、默认值 `default_values`、转换规则 `transform_rules`、品牌/分类/单位值映射 `value_mappings`、使用次数、启用状态和版本。默认值仅允许品牌、分类、单位和来源系统；转换规则覆盖全角转半角、首尾空白、连续空白和主 OE 大写。完全一致的表头可以自动复用；疑似同一供应商但表头增删时只提供差异提示和可匹配字段，不允许无提示覆盖。`catalog_import_mapping_profile_change` 以 `update_rules`、`update_value_mappings` 和 `resolve_value_mapping` 记录规则版本，`catalog_import_job` 关联方案并冻结包含映射与规则的 `mapping_snapshot`，保证后续方案变更不会改写历史导入依据。无法命中已有值映射的行计入 `review_rows` 并以 `review` 状态保存；就地处理后使用新的方案版本重算当前批次。`catalog_import_value_resolution` 追加保存批次、方案、字段、来源值、标准值、方案版本、处理人和时间。`catalog_dictionary_proposal` 以版本化状态保存字典代码、来源值、建议标准值、申请依据、关联批次与方案、申请人、审核人和审核结论；只有通过审核的值才写入共享字典。标准化仅作用于规范字段，供应商原值继续保存在 `_sourceRow`。

`catalog_import_mapping_profile_change` 以追加记录保存创建、字段更新、重命名、停用、恢复和复制事件。方案不提供物理删除；停用方案不再参与自动匹配，但历史批次、方案快照和变更记录仍可读取。

## API 返回建议

列表接口返回轻量 `SkuListItem`，包含名称、主 OE、品牌分类、适配计数、状态、完整度、主要来源和更新时间。详情接口按 `identity / identifiers / fitments / evidence / commerce_summary / audit` 分区返回，便于右侧核验详情渐进加载。

所有写请求携带 `expected_version`。版本不一致返回 `409 VERSION_CONFLICT`，同时返回当前版本和冲突字段；不得用最后写入覆盖前一位资料员的修改。
