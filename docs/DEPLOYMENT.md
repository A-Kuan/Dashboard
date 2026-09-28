# 部署说明

## SKU 视觉预览

- 访问地址：`https://121.41.24.42/sku-preview/`
- 服务器发布根目录：`/opt/dashboard-sku-preview`
- 当前版本：`/opt/dashboard-sku-preview/releases/20260928-adb6d54`
- 当前版本指针：`/opt/dashboard-sku-preview/current`
- Nginx 站点：`/etc/nginx/sites-enabled/dashboard-https`
- 原配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-8c1fb19`
- 前端路由配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-2a4f52a-routing`
- 数据库 API 路由配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-8ee1c87-api`
- 静态资源路由修复备份：`/etc/nginx/backups/dashboard-https.bak-20260928-vehicle-static-routing`

该预览使用独立版本目录和 `/sku-preview/` 路径，不替换 HTTPS 根路径上的既有 Dashboard 服务。

## 构建

```bash
cd apps/web
npm ci
npm run build:server
```

服务器发布内容来自 `apps/web/dist/client`。发布前必须完成：

```bash
npm run test:e2e
npm run test:sites
```

## SKU 数据库与 API

- API 服务目录：`/opt/dashboard-sku-api`
- systemd 服务：`dashboard-sku-api.service`
- 监听地址：`127.0.0.1:4183`
- PostgreSQL 数据库：`dashboard_sku`
- PostgreSQL / 系统用户：`dashboard-sku`
- 外部接口前缀：`/sku-preview/api/`
- 当前 API 版本：`/opt/dashboard-sku-api/releases/20260928-adb6d54`
- 空库备份：`/opt/dashboard-sku-api/backups/20260927-pre-smoke-empty.dump`
- 本次迁移前备份：`/opt/dashboard-sku-api/backups/20260928-before-b885538.dump`
- 版本锁迁移前备份：`/opt/dashboard-sku-api/backups/20260928-before-3de9223.dump`
- 生命周期发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-be0cb0b.dump`
- 可选字段发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-cb56e84.dump`
- 计量单位字典发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-b965002.dump`
- OE 与适配字典发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-783f797.dump`
- 空值回退修复发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-7b947fd.dump`
- 车型库发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-069643d.dump`
- 车型库与多图片联合发布前备份：`/opt/dashboard-sku-api/backups/20260928-before-adb6d54.dump`

API 发布使用独立版本目录和 `current` 软链接。数据库迁移在切换服务前以 `dashboard-sku` 用户运行：

```bash
cd /opt/dashboard-sku-api/releases/<version>
sudo -u dashboard-sku env PGDATABASE=dashboard_sku PGUSER=dashboard-sku npm run migrate
```

清空演示数据前必须先备份：

```bash
sudo -u postgres pg_dump -p 5432 -Fc dashboard_sku > /opt/dashboard-sku-api/backups/<timestamp>.dump
sudo -u postgres psql -p 5432 -d dashboard_sku -c 'TRUNCATE TABLE sku CASCADE;'
```

## 发布结构

```text
/opt/dashboard-sku-preview/
├── current -> releases/20260928-adb6d54
└── releases/
    ├── 20260928-069643d/  # 上一车型库版，可回滚
    └── 20260928-adb6d54/
        ├── index.html
        ├── assets/
        └── config/dictionaries.json
```

后续版本应解压到新的 `releases/<版本>` 目录，验证后原子切换 `current` 软链接，不直接覆盖已有 release。

`/sku-preview/` 已配置前端路由回退，直接访问 `/sku-preview/dictionaries` 等模块路径时返回当前版本的 `index.html`；静态资源仍按实际文件路径提供。

## 验证

```bash
nginx -t
curl -I https://121.41.24.42/sku-preview/
curl -I https://121.41.24.42/sku-preview/assets/<构建文件>
curl https://121.41.24.42/sku-preview/api/health
curl https://121.41.24.42/sku-preview/api/v1/skus
```

浏览器验收使用：

```bash
PLAYWRIGHT_BASE_URL=https://121.41.24.42/sku-preview/ npm run test:e2e
```

`20260927-8ee1c87` 发布后已验证：API 健康检查，SKU 创建与修改，API 重启后数据仍可读取，以及线上表单从新建到进入编辑页的完整流程。验证记录已清理，`sku`、`sku_oe_relation`、`sku_fitment` 三张表均为 0 条，页面显示空状态。

`20260928-d4e6c74` 发布后已在线验证 SKU 编码、制造商零件号和主 OE 号的英文输入限制：前端会过滤中文并提示，API 直接提交中文编码返回 400。验收后三张 SKU 业务表仍为 0 条。

`20260928-3d4091b` 发布后已在线验证：共享字典写入 PostgreSQL 并可跨请求读取；新建 SKU 强制进入草稿；缺少主 OE 关系、适配车型或数据来源时发布返回 422；补齐后可发布为在售；SKU 编码和车型关键字都能从数据库搜索；详情页和编辑页读取真实适配数据。验收品牌和 SKU 已精确删除，`sku`、`sku_oe_relation`、`sku_fitment` 均恢复为 0 条。字典内容已恢复，配置版本保留递增记录。

`20260928-3de9223` 发布后已在线验证 SKU 乐观锁与变更记录：同一 v1 数据第一次保存生成 v2，第二次使用过期 v1 保存返回 409 `SKU_VERSION_CONFLICT`，随后使用 v2 发布生成 v3；页面“变更记录”依次显示 v3 发布、v2 保存、v1 创建。验收 SKU 已精确删除，四张 SKU 业务表均恢复为 0 条。

`20260928-be0cb0b` 发布后已在线验证生命周期停产：在售 SKU 编辑页显示“停产 SKU”，确认后状态变为停产、版本递增到 v3、变更记录写入“停产 SKU”，主操作变为“重新发布 SKU”。验收 SKU 已精确删除，SKU 与变更记录表均恢复为 0 条。

`20260928-85a9e5e` 前端发布后已在线验证“更多筛选”弹层、数据来源与适配状态筛选，以及最近更新、SKU 编码、中文名称、状态四种排序入口。筛选结果会同步更新当前详情选择；线上空库状态保持不变。

`20260928-83ec03f` 前端发布后已在线验证字典显示映射：SKU 数据继续保存稳定品牌编码，列表、命令搜索、详情和编辑页摘要统一显示字典名称；使用线上“保时捷原厂”选项检查时，页面文本未出现 `SKU_BRAND_` 编码。

`20260928-cb56e84` 发布后已在线验证：零件小类和制造商零件号不再显示必填标记，两者同时留空时 API 可创建并读回草稿；品牌、零件大类、计量单位和数据来源在新建页均无预选值。验收 SKU 已精确删除，线上 SKU 数量保持为 0。

`20260928-b965002` 发布后已在线验证：共享字典新增 `unit` 计量单位，保留件、套、盒、支四个初始选项；字典管理页可进入该字典，新建 SKU 页从字典读取选项且不预选。原有品牌配置未被覆盖，线上 SKU 数量保持为 0。

`20260928-783f797` 发布后已在线验证：共享字典扩展到 10 个，新增数据来源、OE 类型、OE 替代关系、可信度、车身形式和验证状态；第一条 OE 自动承接主 OE、品牌与数据来源，主 OE 的替代关系保持禁用；OE 与适配当前行未完成时禁止继续新增空行。发布前已有的 1 条用户 SKU 完整保留，验收未写入测试数据。

`20260928-7b947fd` 发布后已在线验证：缺少商品图片时，列表、详情和命令搜索统一显示空状态，不再回退到演示零件图；缺少 EPC 图组、数据来源、验证状态和更新时间时不再虚构内容；页头移除固定用户头像与通知数量，新审计记录在身份系统接入前使用“系统操作员”。发布前数据库已备份，线上原有 1 条用户 SKU 的 ID、数据来源及记录数量均保持不变。

`20260928-19486b5` 前端发布后已在线验证：SKU 编辑页在已有商品图时显示“更换图片”和“删除图片”，删除需确认并在保存 SKU 后持久化；无图时仅显示“上传图片”。本次仅切换前端静态版本，线上 1 条用户 SKU 及其图片均未被修改。

`20260928-a2668db` 前端发布后已在线验证：字典选项超出编辑区高度后，表头保持可见、选项表体独立滚动；连续新增 12 项时会自动滚动并聚焦最后一行，保存配置按钮保持可见。本次未保存验收用临时选项，线上已有 2 条用户 SKU 均未修改。

`20260928-069643d` 发布后已在线验证：新增 6 张车型库相关数据表，车型列表 API 与 `/sku-preview/vehicles` 页面可正常访问；当前车型库保持空状态，未写入示例车型。发布前备份已完成，线上原有 3 条 SKU、3 条 OE 关系保持不变，API 服务、静态资源和 Nginx 配置检查均正常。

`20260928-adb6d54` 联合发布后已在线验证：首页主导航显示“车型库”并可进入 `/sku-preview/vehicles`，SKU 多图片能力与车型库 API 同时可用；Nginx 为 `assets` 和 `config` 增加明确静态资源路由，避免版本切换后旧文件缓存或 SPA 回退返回 HTML。发布前数据库已备份，线上已有 5 条 SKU 保持不变，浏览器控制台无报错。

## 回滚

如需仅回滚前端版本，将 `/opt/dashboard-sku-preview/current` 指向上一版 release，然后执行线上浏览器验证；静态版本切换不需要重载 Nginx。

如需回滚 API，将 `/opt/dashboard-sku-api/current` 指向上一版 API release，然后重启 `dashboard-sku-api.service`；数据库回滚应使用单独审核过的迁移，不随前端或 API 版本自动回滚。

如需完全撤销 `/sku-preview/` 路由，恢复备份的 Nginx 配置，执行 `nginx -t`，检查通过后再重载 Nginx。不要修改或重启既有 Dashboard、PARTS-OS、数据库和 Worker 服务。
