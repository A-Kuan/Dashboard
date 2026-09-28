# 车型库与快速选品

车型库用于从车型角度维护常用配件、SKU 候选和保养套餐，为后续报价流程提供可追溯的选品数据。前端路由为 `/vehicles`。

当前范围包含第一期和第二期：

- 结构化车型版本：品牌、车系、平台、年款、发动机、变速箱、市场及 VIN 样本。
- 常用配件矩阵：标准项目、位置、用量、零件号类型、适配条件、来源和验证状态。
- 批量维护：可从 Excel 按“配件项目、零件号、位置、分类”四列直接粘贴，缺少零件号的行也会保留。
- SKU 候选：一个配件需求可关联首选和备选 SKU，并支持按规范化 OE 号自动匹配。
- 保养与维修套餐：套餐只组织配件需求及数量，不复制价格。
- 快速选品：按套餐或自选配件生成待报价商品集合，明确显示缺失零件号或未关联 SKU 的项目。

本模块不创建正式报价单，不生成报价编号，不保存客户成交价。库存、采购价和销售价应由后续对应业务模块实时提供，车型库不保存过期价格副本。

## 数据模型

- `vehicle_variant`：车型版本主数据。
- `vehicle_part_requirement`：车型的配件需求。
- `vehicle_part_candidate`：零件号及 SKU 首选/备选关系。
- `vehicle_service_package`：保养或维修套餐。
- `vehicle_service_package_item`：套餐内的配件需求及用量。
- `vehicle_change_log`：车型资料版本和操作记录。

## API

- `GET /api/v1/vehicles?q=`：按 VIN、车型、平台、发动机或零件号搜索。
- `GET /api/v1/vehicles/:id`：读取车型、配件、候选 SKU、套餐及变更记录。
- `POST /api/v1/vehicles`：创建车型草稿。
- `PUT /api/v1/vehicles/:id`：根据数据版本更新聚合资料。
- `POST /api/v1/vehicles/:id/publish`：发布至少包含一条常用配件的车型资料。
- `POST /api/v1/vehicles/:id/auto-match`：按规范化零件号关联已有 SKU。

车型更新和发布使用乐观锁；客户端提交的 `version` 过期时返回 `409 VEHICLE_VERSION_CONFLICT`，避免多人编辑相互覆盖。
