# 部署说明

## SKU 视觉预览

- 访问地址：`https://121.41.24.42/sku-preview/`
- 服务器发布根目录：`/opt/dashboard-sku-preview`
- 当前版本：`/opt/dashboard-sku-preview/releases/20260928-d4e6c74`
- 当前版本指针：`/opt/dashboard-sku-preview/current`
- Nginx 站点：`/etc/nginx/sites-enabled/dashboard-https`
- 原配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-8c1fb19`
- 前端路由配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-2a4f52a-routing`
- 数据库 API 路由配置备份：`/etc/nginx/backups/dashboard-https.bak-20260927-8ee1c87-api`

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
- 当前 API 版本：`/opt/dashboard-sku-api/releases/20260928-d4e6c74`
- 空库备份：`/opt/dashboard-sku-api/backups/20260927-pre-smoke-empty.dump`

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
├── current -> releases/20260928-d4e6c74
└── releases/
    ├── 20260927-8ee1c87/  # 上一版，可回滚
    └── 20260928-d4e6c74/
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

## 回滚

如需仅回滚前端版本，将 `/opt/dashboard-sku-preview/current` 指向上一版 release，然后执行线上浏览器验证；静态版本切换不需要重载 Nginx。

如需回滚 API，将 `/opt/dashboard-sku-api/current` 指向上一版 API release，然后重启 `dashboard-sku-api.service`；数据库回滚应使用单独审核过的迁移，不随前端或 API 版本自动回滚。

如需完全撤销 `/sku-preview/` 路由，恢复备份的 Nginx 配置，执行 `nginx -t`，检查通过后再重载 Nginx。不要修改或重启既有 Dashboard、PARTS-OS、数据库和 Worker 服务。
