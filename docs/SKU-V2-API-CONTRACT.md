# SKU 资料库 v2 接口约定

## 边界

新工作台只接入 `/api/v2/catalog/*`。旧 `/api/v1/skus/*` 暂时保留用于兼容和数据迁移，不作为新功能的依赖。

v2 使用独立的 `catalog_*` 数据表。录入批次、来源证据、零件编号、互换关系、车型适配和变更快照分别存储，避免继续扩展旧 SKU 大表。

服务探针分为 `GET /api/health`（进程存活）和 `GET /api/ready`（数据库与迁移账本就绪）。部署切流必须使用后者；账本缺迁移或已执行脚本校验值变化时返回 503。

## 资料状态

- `draft`：允许不完整，适合人工录入、EPC/VIN 识别结果暂存。
- `verified`：名称、品牌分类、主编号、适配车型和可追溯来源全部满足后才能进入。
- `discontinued`：预留给后续停用流程。

完整度由五项组成，每项 20 分：名称、品牌与分类、主编号、车型适配、来源证据。完整度是提示，不等同于核验状态。

## 接口

### 操作者与权限

- `GET /api/v2/catalog/session`：返回当前操作者、角色和能力列表。

角色分为只读查看、资料录入、资料审核和资料管理员。开发环境默认使用资料管理员，并允许通过工作台角色菜单切换以验收权限；这不等同于正式登录。生产环境默认只读，只有在身份代理已经完成认证并设置 `TRUST_PROXY_IDENTITY=1` 时，服务端才接受代理传入的操作者与角色头。所有 v2 写接口都在服务端校验能力，前端禁用按钮仅用于交互提示。

### 导入批次

- `POST /api/v2/catalog/intakes`：保存 EPC、VIN/EPC、OE 查询、品牌目录、供应商、手工或批量导入的原始上下文。
- `GET /api/v2/catalog/intakes/:id`：读取原始批次。

来源类型：`epc`、`vin_epc`、`oe_lookup`、`brand_catalog`、`supplier`、`manual`、`import`。

### EPC / VIN 写入前预览

- `GET /api/v2/catalog/epc-connectors`：返回连接器标识、显示名、能力、合同版本和 `ready` / `needs_configuration` 状态；服务地址和令牌永不返回前端。
- `POST /api/v2/catalog/epc-connectors/:id/collect`：按 `hushanxing-epc-connector-v1` 合同采集 VIN、图组、零件与资源引用，校验后创建普通 EPC 预览；连接器不得绕过人工决定直接写入 SKU。
- `POST /api/v2/catalog/epc-previews`：提交 VIN、来源系统、目录路径与最多 100 条 EPC 零件记录；服务端保存不可变原始批次，并返回 OE、车型平台和车型版本的匹配解释。该接口不写入 SKU。
- `GET /api/v2/catalog/epc-previews?state=&page=&pageSize=`：读取预览批次历史。每个摘要包含 `progress.total`、`progress.pending` 和 `progress.processed`，供列表直接显示完成度。
- `GET /api/v2/catalog/epc-previews/:id`：读取逐条候选、来源快照、已执行决定和结果 SKU。
- `POST /api/v2/catalog/epc-previews/:id/commit`：提交 `expectedVersion` 和明确的逐条 `create_sku`、`attach_evidence` 或 `skip` 决定。未选择行保持待处理；附加证据不会覆盖现有人工名称、分类、编号或价格；新资料只生成草稿，适配默认为待核验。

同一规范 OE 唯一命中时返回 `exact`，无命中返回 `new`，多条命中返回 `ambiguous`。前端不得把 `ambiguous` 自动写入任意候选；所有决定写入追加式审计表。提交可以只包含部分待处理行：已处理行保持只读，批次进入 `partial`，后续按最新 `version` 继续提交剩余行；当 `pending` 为 0 时进入 `completed`。

### SKU 资料

- `GET /api/v2/catalog/skus?q=&status=&page=&pageSize=`：服务端分页检索；响应包含 `statusCounts`，编号搜索会忽略空格和常用分隔符。
- `GET /api/v2/catalog/duplicates?identifier=&exceptId=`：按规范化编号检查潜在重复资料，用于保存前预警，不自动合并或阻止合法的品牌件/替代件。
- `GET /api/v2/catalog/skus/:id`：读取完整聚合资料和变更记录。
- `POST /api/v2/catalog/skus`：创建草稿；允许空草稿，未传编码时由服务端生成。
- `PATCH /api/v2/catalog/skus/:id`：保存完整或局部资料，必须提交 `expectedVersion`。
- `POST /api/v2/catalog/skus/:id/verify`：核验，必须提交 `expectedVersion`。
- `GET /api/v2/catalog/skus/:id/changes`：读取变更历史及当时的完整快照。
- `POST /api/v2/catalog/skus/:id/restore`：提交 `expectedVersion`、`sourceVersion` 和必填的 `reason`，把历史快照中的业务资料恢复为一个新的草稿版本。
- `GET /api/v2/catalog/quality`：读取数据质量与审核队列，可按 `issue`、`status`、`assignee` 筛选。
- `GET /api/v2/catalog/fitments/review`：读取适配专项审核队列，可按 `state` 与关键词筛选，并返回平台、年款、条件、证据和阻断风险。
- `POST /api/v2/catalog/fitments/:id/review`：资料审核员提交 `expectedSkuVersion`、`expectedReviewVersion`、必填结论和 `approve/reject/conflict` 决定。
- `GET /api/v2/catalog/vehicle-platforms?q=&status=`：读取独立于旧车型业务的车型平台主数据、适配使用数和越界风险数。
- `GET /api/v2/catalog/vehicle-platforms/:id`：读取平台完整资料及不可覆盖的版本历史。
- `POST /api/v2/catalog/vehicle-platforms` / `PATCH /api/v2/catalog/vehicle-platforms/:id`：资料管理员建立或按 `expectedVersion` 更新平台；启用前必须有年款边界和来源依据。
- `GET /api/v2/catalog/vehicle-variants?platformId=&q=&status=`：读取平台下的车型版本，可按平台、状态、版本/发动机/PR 关键词筛选。
- `GET /api/v2/catalog/vehicle-variants/:id`：读取车型版本和不可覆盖的版本历史。
- `POST /api/v2/catalog/vehicle-variants` / `PATCH /api/v2/catalog/vehicle-variants/:id`：资料管理员建立或按 `expectedVersion` 更新车型版本；启用前必须有年款、发动机代码和来源依据，且不能超出平台边界。
- `GET /api/v2/catalog/fitment-conflicts?state=&q=&skuId=`：实时扫描未识别/未启用平台、版本平台不符、未启用版本、年款/版本字段越界、结构化条件矛盾、同 SKU 范围重叠和同 OE 多资料冲突。
- `POST /api/v2/catalog/fitment-conflicts/resolve`：审核员对成对冲突提交版本锁、必填依据和 `accepted_overlap`、`same_application` 或 `correction_required` 结论。
- `GET /api/v2/catalog/conflicts`：读取有效 SKU 之间的规范化编号冲突及已有处理结论。
- `POST /api/v2/catalog/conflicts/resolve`：对一组 SKU 与编号写入带版本锁的人工判断和依据。
- `POST /api/v2/catalog/conflicts/merge-preview`：在不写入数据的前提下，预览主 SKU、停用 SKU、迁移内容、去重数量及不会自动覆盖的主资料差异。
- `POST /api/v2/catalog/conflicts/merge`：仅资料管理员可执行；提交两条资料的期望版本和必填依据，原子完成安全合并。
- `POST /api/v2/catalog/skus/:id/transition`：执行带版本锁的审核状态流转。
- `POST /api/v2/catalog/skus/bulk-transition`：最多对 100 条资料执行批量提交审核、分配审核人或停用；每条记录单独执行完整性、编号冲突、状态和版本检查。

### 审核状态流转

`transition` 支持以下动作：

- `submit_review`：草稿提交审核，完整性和重复编号检查必须通过，可指定 `assignee` 与 `dueAt`。
- `assign_review`：重新分配等待审核的资料。
- `approve_review`：审核通过，资料进入 `verified`。
- `reject_review`：填写原因后退回草稿。
- `discontinue`：填写原因后停用已核验资料。
- `reopen`：填写原因后将停用资料恢复为草稿。

所有动作必须携带 `expectedVersion`，并写入 `catalog_review_event` 与 `catalog_change_log`。对待审核或已核验资料进行内容编辑时，系统会自动退回草稿并清除核验状态；已停用资料必须先恢复后才能编辑。

历史版本恢复同样使用版本锁。它不会覆盖或删除现有变更记录，也不会让资料直接回到过去的审核状态；系统复制所选版本的身份、编号、适配、互换关系与来源证据，创建新的 `restore_version` 草稿版本，并在摘要中保留来源版本和恢复原因。

批量状态操作返回 `succeeded`、`failed`、`results` 和 `failures`。部分失败不会撤销已经成功的记录，也不会跳过单条资料原有的审核事件与变更快照；调用方需要明确展示失败原因并允许重新选择处理。

质量队列目前检查标准名称、品牌与分类、主 OE、适配车型、适配专项审核、车型平台/版本/范围冲突、来源证据和跨 SKU 编号冲突。草稿与待审核资料始终进入队列；已核验资料出现新风险时也会重新进入队列。适配关系可以在 SKU 提交审核前后处理，但所有关系必须处于 `verified` 且没有开放的适配冲突，才能批准整条 SKU。录入员不能自行写入已通过状态；新增或实质修改平台、车型版本、年款、发动机、变速箱、市场、车身、驱动、PR 码、位置、包含/排除规则时，关系自动回到 `pending`。

适配审批要求平台编码能够匹配一条已启用平台、年款位于平台边界内，且来源证据齐全。选择车型版本时，还会校验版本归属、状态、年款和发动机/变速箱/市场/车身/驱动/PR 范围；包含与排除规则不能相互矛盾。不满足时返回 `422 FITMENT_REVIEW_BLOCKED`。SKU 最终批准前再次运行跨关系冲突扫描，存在开放冲突时返回 `422 FITMENT_CONFLICT_BLOCKED`。`correction_required` 只记录退回依据，不解除阻断；只有确认条件可区分或同一应用的结论才解除阻断。审核会同时提升适配关系版本和 SKU 版本，写入不可覆盖的 `catalog_fitment_review_event` 及 SKU 变更快照。并发版本不一致分别返回 `CATALOG_VERSION_CONFLICT` 或 `FITMENT_REVIEW_VERSION_CONFLICT`。平台及车型版本管理仅授予资料管理员，适配冲突结论授予资料审核员和资料管理员。

编号冲突支持三种结论：`shared_reference`（合法共用参考号）、`separate_scope`（适用范围不同）和 `merge_required`（确认为重复、待合并）。前两种结论会解除对应 SKU 对之间的质量阻断；`merge_required` 继续保留冲突，防止资料在真正合并前通过审核。每次判断必须填写依据，同时提升两条 SKU 的版本并分别写入 `resolve_identifier_conflict` 变更快照。

真正合并前必须先存在有效的 `merge_required` 结论。合并以用户明确选择的主 SKU 为准：主字段不被自动覆盖，编号、适配、来源证据和互换关系在同一事务中迁移并去重；主 SKU 回到草稿重新审核，另一条 SKU 标记为已停用。系统不物理删除 SKU，并在 `catalog_sku_merge` 中保存合并前双份快照、合并后主快照、操作人、依据与版本，同时分别写入 `merge_absorb` 和 `merge_retire` 变更记录。

### 批量导入

- `GET /api/v2/catalog/import-template?format=json|csv`：读取带版本的导入字段规范，或下载与规范同源的 CSV 模板。
- `POST /api/v2/catalog/imports`：提交 `sourceName` 和最多 500 行结构化数据，创建只读预检查批次。
- `GET /api/v2/catalog/imports?state=&page=&pageSize=`：分页读取历史批次，支持按状态筛选。
- `GET /api/v2/catalog/imports/:id`：读取批次、逐行问题、重复匹配和写入结果。
- `POST /api/v2/catalog/imports/:id/resolve-values`：提交批次版本、方案版本、字典版本和异常值映射，在当前预检批次中学习标准值并原地重新检查；目标值必须来自对应的启用字典，只允许处理当前批次仍未识别的品牌、分类或单位值。
- `POST /api/v2/catalog/imports/:id/commit`：提交 `expectedVersion` 与明确选中的 `rowIds`，只写入 `ready` 或用户主动选择的 `duplicate` 行。
- `POST /api/v2/catalog/imports/:id/retry`：对 `partial` 批次中失败的行重新执行写入；可提交 `rowIds` 进一步缩小范围，并继续使用 `expectedVersion` 防止并发重复操作。
- `GET /api/v2/catalog/import-mappings?q=&active=`：读取供应商字段映射方案及使用次数，支持名称检索和启用状态筛选。
- `POST /api/v2/catalog/import-mappings/match`：根据文件名特征和原始表头匹配方案；返回 `exact`、`drift` 或 `none`，以及新增/缺少字段差异。
- `POST /api/v2/catalog/import-mappings`：创建或按 `expectedVersion` 更新映射方案。方案保存原始字段、标准字段对应关系和表头签名。
- `GET /api/v2/catalog/import-mappings/:id`：读取方案详情、最近使用批次和不可覆盖的变更记录。
- `PATCH /api/v2/catalog/import-mappings/:id`：按 `expectedVersion` 重命名、停用或恢复方案；停用不会删除历史批次。
- `PATCH /api/v2/catalog/import-mappings/:id/rules`：按 `expectedVersion` 更新默认品牌、分类、单位、来源系统，以及全角转换、空白清理和 OE 大写规则；变更写入独立审计记录。
- `PATCH /api/v2/catalog/import-mappings/:id/value-mappings`：按 `expectedVersion` 更新品牌、分类和单位的“供应商写法 → 标准值”映射；每个字段最多保留 200 条去重后的别名规则。
- `GET /api/v2/catalog/dictionary-proposals`：按状态读取标准值申请及其申请、审核信息。
- `POST /api/v2/catalog/dictionary-proposals`：当启用字典没有合适候选时提交标准值申请，并关联来源批次和供应商方案；相同待审值只保留一项。
- `POST /api/v2/catalog/dictionary-proposals/:id/review`：资料管理员按申请版本批准或驳回；批准会将标准值加入或重新启用对应字典并提升字典版本。
- `POST /api/v2/catalog/import-mappings/:id/clone`：复制方案为独立的新版本起点，使用次数从零开始。

导入行状态为 `ready`、`review`、`duplicate`、`invalid`、`imported`、`skipped` 或 `failed`。未知供应商值进入 `review` 且不能选中写入；操作员只能从对应的启用字典选择标准值，将其写入供应商方案的新版本并重新检查当前批次。字典没有合适候选时先提交标准值申请，管理员批准后才能参与映射。就地处理同时校验批次、方案和字典版本，记录来源值、标准值、方案版本、处理人和时间，且不会改写原始供应商行。字典写入、重置和申请审核只授予 `catalog.configure`。不可导入项不能选择。预检查响应包含 `catalog-import-preflight-v1` 质量报告，汇总阻断项、值映射异常、警告、重复匹配以及品牌、分类、适配和来源字段覆盖率。文件内相同主 OE 会进入人工确认状态；结构化行内容经规范化后生成 SHA-256 指纹，重复上传时返回原批次而不新建任务。提交采用批次版本锁防止双击重复写入，部分失败会标记为 `partial` 并保留每行错误。原始文件行保存在 `catalog_intake`，生成的来源证据通过 `intake_id` 回溯到导入批次。

前端导入中心会对供应商非标准表头做别名匹配，并在预检查前要求操作员确认字段映射。操作员可将确认结果保存为供应商方案；相同表头再次上传时自动套用，文件名属于同一来源但表头发生变化时展示新增/缺少列并要求人工确认。映射方案管理器采用列表与详情检查器，支持检索、重命名、复制、停用、恢复、最近使用、版本历史、供应商级标准化规则和值映射。规则应用前显示首行“原值 → 标准值”对比；默认值只补空字段，文本清理只改变标准字段，`_sourceRow` 始终保留供应商原值。有值映射表的字段会检查未知值，并在映射页和预检查页形成聚合异常队列。方案更新使用版本锁，避免多人同时修改时静默覆盖。服务器会依据冻结的方案版本重新构建标准字段，避免只依赖客户端转换。未映射列不写入 SKU 标准字段，但会作为 `_sourceRow` 保留在原始来源证据中；导入批次同时冻结本次使用的字段映射、默认值、转换规则和值映射，后续调整规则时仍可还原当时依据。

首次提交和每次重试都会生成独立的 `catalog_import_attempt` 记录，保留执行类型、操作者、开始与完成时间、选择行数、成功数和失败数。批次汇总数据是所有尝试后的当前结果，执行记录不可被后续重试覆盖。

### 运营指标

- `GET /api/v2/catalog/metrics?days=30`：读取指定统计周期内的真实资料、审核与导入聚合数据，`days` 支持 14、30 或 90。
- `GET /api/v2/catalog/export?format=json|csv&status=`：仅资料管理员可用。JSON 返回含 SKU/适配版本历史、车型平台与车型版本及其变更快照、EPC 预览/来源行/写入决定、适配冲突结论、编号冲突结论、合并索引、数据计数与 SHA-256 校验值的 `catalog-export-v1` 审计包；CSV 返回便于表格核对的一行一 SKU 视图。单次最多 5000 条。

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
    "vehiclePlatformId": "95B",
    "vehicleLabel": "Porsche Macan (95B)",
    "years": "2014-2018",
    "yearFrom": 2014,
    "yearTo": 2018,
    "engineCodes": ["CYP"],
    "evidenceKey": "epc-1"
  }]
}
```

编号同时保存原始值与规范化值；前端展示原始值，搜索和去重使用规范化值。来源证据通过 `clientKey` 在同一次保存中关联编号与适配记录。

列表接口只返回表格需要的摘要字段，详情由前端在选中行后按需加载，避免资料量增加后出现每页几十次详情请求。品牌、分类和计量单位继续使用共享字典接口 `/api/v1/dictionaries`，新工作台不在组件中固化业务选项。
