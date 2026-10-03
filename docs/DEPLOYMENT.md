# 部署说明

## SKU 视觉预览

- 访问地址：`https://121.41.24.42/sku-preview/`
- 服务器发布根目录：`/opt/dashboard-sku-preview`
- 当前版本：`/opt/dashboard-sku-preview/releases/20261002-e6df0651`
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
- 当前 API 版本：`/opt/dashboard-sku-api/releases/20261003T012354Z-a9553977`
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
- SKU v2 与资源托管迁移前备份：`/opt/dashboard-sku-api/backups/20261002T0604Z-before-0cf9993f.dump`（SHA-256 `d1e60557a98b1812eee3419aafde0e91e67c45104c92ddbee2d59c1a2e3ad889`）
- 旧 SKU 迁移预览发布前备份：`/opt/dashboard-sku-api/backups/20261002T070248Z-c790f499-dashboard_sku.dump`，配套清单 `.manifest.json`（SHA-256 `4190ea941198c1726c57b391218a39393821555dd10a4a70206ec55b8d9aedf4`，文件与清单权限均为 `0640`）
- 旧 SKU 迁移治理发布前备份：`/opt/dashboard-sku-api/backups/20261002T073431Z-28be2bbf-dashboard_sku.dump`，配套清单 `.manifest.json`（SHA-256 `bfaa793feabff5f2e0fb3ac65308c5624f9b5067585b25368a4ee92383298f6c`，文件与清单权限均为 `0640`）
- 可信身份与职责分离发布前备份：`/opt/dashboard-sku-api/backups/20261002T081633Z-a48a3bbf-dashboard_sku.dump`，配套清单 `.manifest.json`（SHA-256 `3846f3f94c27c04cf375e9a19b665f9f0e2588f5a9f4411e44a269f7bffeb046`，2,112,598 字节，文件与清单权限均为 `0640`）
- 自动发布链路配套备份：`/opt/dashboard-sku-api/backups/20261002T094718Z-96a0cf9f-dashboard_sku.dump`（SHA-256 `96ab3349b1e5e3562f8e5cb273b68053cb0ec4fb4914ed21bf3ec451a1961368`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，当前 0 个资源文件）及 `.manifest.json`（SHA-256 `adbf966268196c769a19ba2602269c476546e11e21acf0b5238c5b8344a7038d`，8,095 字节）；三者属主均为 `dashboard-sku:dashboard-sku`，权限均为 `0640`
- 可观测性与恢复演练发布备份：`/opt/dashboard-sku-api/backups/20261002T101322Z-0b4ee179-dashboard_sku.dump`（SHA-256 `ecebcc38e1eda0f47ff1709ef61237bb4eb3a94d3b872610ab157f4cca6c339c`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `1936622781d1341965c434c8c768a1132beb73ef038bc01110f97a5bab13eac8`，8,381 字节）；三者属主均为 `dashboard-sku:dashboard-sku`，权限均为 `0640`
- 首份带版本来源的每日自动备份：`/opt/dashboard-sku-api/backups/20261002T104114Z-7c0f7bc9-dashboard_sku.dump`（SHA-256 `99d7c4daec391210ca4914fd61ed0dcd503973a5b59881feee70184d912446fd`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `9e9304ec71d36a2361d53e5bbdad7990944ddb8ca088865127ed1e3ca3fdbb2e`，8,407 字节）；清单 `purpose=scheduled`、`releaseRevision=0c1213d60041296be8e8b13e90b2638e2effa009`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 异地备份能力上线后的本机验证备份：`/opt/dashboard-sku-api/backups/20261002T111521Z-14bd7736-dashboard_sku.dump`（SHA-256 `525237654810b39176e1b2e3b22eaf111a8c9a275b18951671194a6551c2a4a3`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `8be1ab4adc41e6fc0c52aa75bfe6a8b6f518cdb0f775ca50fe5d18953209f88b`，8,407 字节）；清单 `purpose=scheduled`、`releaseRevision=f416a4376bcfca74acb314a1aad87cc73665892e`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 每月异地恢复能力发布备份：`/opt/dashboard-sku-api/backups/20261002T113756Z-f3cd63ed-dashboard_sku.dump`（SHA-256 `3bb9bb392125c3116bbf99787f92661084aaa7c11821cde7cb950fb220aefd61`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `255c4c865273950449111fe78c855f562bf73fd49193ff22a94c6be0324a0062`，8,405 字节）；清单 `purpose=release`、`releaseRevision=d463750070b15c99a2935ab84ce3d06d4b798b37`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 旧 SKU 原子迁移发布备份：`/opt/dashboard-sku-api/backups/20261002T122340Z-9e25efbb-dashboard_sku.dump`（SHA-256 `30381646ffb27747a2e211cb9177a26daf08db8cd27b894df82160c7c247a1a5`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `69070d10f2619a129163e5446ce825161a99ba492dcd33575848bbe2f20ff92c`，8,405 字节）；清单 `purpose=release`、`releaseRevision=f097cc8e1304f90906ec9a714f02daf30429cf3f`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 迁移后验收闭环发布备份：`/opt/dashboard-sku-api/backups/20261002T125644Z-b40ff8ff-dashboard_sku.dump`（SHA-256 `91d57a1a16a7ca0c83c0bc71e3be49e774fe9f224d58afe442e7105c55631793`，2,115,796 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `53d411e83862b808ce6df73f7fc9b85bc64eb233f20139e2fbc7650e1d922f12`，8,405 字节）；清单 `purpose=release`、`releaseRevision=1389875483ca3dfa6eb52d8091a2ad2a8a984006`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 首批试运行工作台最终发布备份：`/opt/dashboard-sku-api/backups/20261002T141337Z-8df69caf-dashboard_sku.dump`（SHA-256 `0b4426a5fa3aec2a3d9824c18d6c76e8ea2acf5d70bc09edd116c234c0ffb1f7`，2,116,592 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `6d513efc54008495792a278eeb20e55af9069e688a22f84668a139561547f69a`，8,616 字节）；清单 `purpose=release`、`releaseRevision=9c7016db12aac4469464e399b515c253182d1062`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 询价与报价业务底座发布备份：`/opt/dashboard-sku-api/backups/20261002T203735Z-e75593f0-dashboard_sku.dump`（SHA-256 `802b1d03c51d3191fd9b256b2045a93595d6fa8c0053cff402d47e0b6b202745`，2,116,592 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `8168176acc82043743eed367e2702137e5b2004ce4abf9be8a669be4dbce01a1`，8,815 字节）；清单 `purpose=release`、`releaseRevision=2c53443a45bf262f15879115d0e9d9a24f2476e4`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`
- 客户与供应商主数据发布备份：`/opt/dashboard-sku-api/backups/20261003T012417Z-2a632f1a-dashboard_sku.dump`（SHA-256 `d1d96b89ab90dff179cf4b7dca4d6af949c2c1b677736031b865d70f8b7cd17b`，2,136,793 字节）、同名 `.epc-assets.tar.gz`（SHA-256 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，120 字节，0 个资源文件）及 `.manifest.json`（SHA-256 `7f25cc1918e50125939f46672c7199d6a6c3b65fe04bb6b3b15ea8c0acb4ddac`，9,137 字节）；清单 `purpose=release`、`releaseRevision=a9553977d0a0f8b0e8cc8d39d2b3b1ecadb2f03c`，三者属主均为 `dashboard-sku:dashboard-sku`、权限均为 `0640`

API 发布使用独立版本目录和 `current` 软链接。数据库迁移在切换服务前以 `dashboard-sku` 用户运行：

```bash
cd /opt/dashboard-sku-api/releases/<version>
sudo -u dashboard-sku env PGDATABASE=dashboard_sku PGUSER=dashboard-sku npm run migrate
```

正式 API 发布统一从仓库根目录执行自动发布工具：

```bash
API_DEPLOY_ALLOW_INSECURE_TLS=1 ./deploy/release-api.sh origin/main
```

当前预览站使用 IP 地址证书，因此示例显式允许本次浏览器冒烟忽略证书校验；切换到匹配域名的正式证书后应去掉该变量。工具只接受受保护的 `origin/main` 当前提交，使用 UTC 时间与 Git SHA 创建不可变 release，并依次完成：

1. 检查当前服务与 readiness；
2. 记录关键业务表数量；
3. 安装依赖并在服务器运行 API 测试；
4. 生成并校验 PostgreSQL 备份及配套 EPC 资源快照；
5. 执行校验式数据库迁移；
6. 原子切换 `current` 并等待包含目标 Git SHA 的 readiness；
7. 对比关键数据数量并运行线上只读浏览器冒烟。

任何切换后检查失败都会自动恢复上一 API release 并重启服务；数据库迁移遵循只前进原则，不随应用回滚降级。只有经过审核、明确会改变业务行数的迁移才可以设置 `API_DEPLOY_ALLOW_DATA_CHANGE=1`。`API_DEPLOY_DRY_RUN=1` 仅输出发布计划，不连接服务器或修改状态。

外部 EPC 连接器为可选服务端配置。生产凭据应通过 systemd `EnvironmentFile` 或等效密钥设施注入，不能写入 release 目录：

```text
CATALOG_EPC_CONNECTOR_URL=https://connector.example/internal/catalog/collect
CATALOG_EPC_CONNECTOR_TOKEN=<secret>
CATALOG_EPC_CONNECTOR_NAME=品牌 EPC
CATALOG_EPC_CONNECTOR_TIMEOUT_MS=15000
```

未配置时 `/api/v2/catalog/epc-connectors` 返回 `needs_configuration`，手工 EPC 采集仍可用。启用前应先用非生产 VIN 验证合同版本、超时、上游错误、图组引用和“只生成预览、不直接写 SKU”的边界。

迁移 `025_catalog_epc_connector_runs.sql` 增加外部采集运行账本。发布后应验证失败请求能在 `/api/v2/catalog/epc-connector-runs` 留痕，重试产生带 `retryOf` 的新记录，且 JSON 审计导出包含 `epcConnectorRuns` 计数。

目录资源托管是可选的独立持久化目录，必须放在 release 目录之外并由 `dashboard-sku` 用户独占写入。来源域名白名单使用逗号分隔的主域名；子域名会被允许。

仓库中的 `deploy/dashboard-sku-api.service` 已声明资源目录、12 MiB 单文件上限和 15 秒下载超时，并使用 `UMask=0027` 限制新文件权限。生产环境只需在确认真实 EPC 服务域名后，通过受保护的 EnvironmentFile 增加 `CATALOG_EPC_ASSET_ALLOWED_HOSTS`，不要为了临时联调写入虚构白名单。

```text
CATALOG_EPC_ASSET_DIR=/opt/dashboard-sku-api/data/epc-assets
CATALOG_EPC_ASSET_ALLOWED_HOSTS=assets.provider.example,cdn.provider.example
CATALOG_EPC_ASSET_MAX_BYTES=12582912
CATALOG_EPC_ASSET_TIMEOUT_MS=15000
```

```bash
sudo install -d -o dashboard-sku -g dashboard-sku -m 0750 /opt/dashboard-sku-api/data/epc-assets
sudo -u dashboard-sku env PGDATABASE=dashboard_sku PGUSER=dashboard-sku \
  CATALOG_EPC_ASSET_DIR=/opt/dashboard-sku-api/data/epc-assets npm run assets:verify
```

迁移 `026_catalog_epc_assets.sql` 增加资源登记和追加式操作账本。数据库备份只包含资源元数据，不包含二进制文件；每次数据库备份后必须同步快照 `/opt/dashboard-sku-api/data/epc-assets`，记录对应数据库备份名，并在恢复演练后运行 `npm run assets:verify`。不得只恢复其中一侧，也不得把资源目录放在会被版本回滚替换的 `releases/<version>` 下。

迁移器使用 `schema_migration` 账本和 SHA-256 校验：已执行且内容一致的脚本会跳过；缺失脚本会按文件名顺序执行；任何已执行脚本被修改都会以 `MIGRATION_CHECKSUM_MISMATCH` 终止。已发布迁移只能新增后续脚本，禁止原地改写。

清空演示数据前必须先备份：

```bash
sudo -u postgres pg_dump -p 5432 -Fc dashboard_sku > /opt/dashboard-sku-api/backups/<timestamp>.dump
sudo -u postgres psql -p 5432 -d dashboard_sku -c 'TRUNCATE TABLE sku CASCADE;'
```

### 可校验数据库备份

API 工程提供带清单的 PostgreSQL 自定义格式备份。清单记录文件大小、SHA-256、关键业务表行数、PostgreSQL 工具版本和归档可读性检查结果；配置 `CATALOG_EPC_ASSET_DIR` 时会同时生成 `.epc-assets.tar.gz` 资源快照，并把大小、SHA-256 与文件数量写入同一清单。数据库归档、资源快照与清单必须成套保存。

备份脚本会读取数据库服务端主版本，并优先使用同主版本的 `/usr/lib/postgresql/<major>/bin/pg_dump` 与 `pg_restore`，避免多版本服务器上的 `pg_wrapper` 为导出和校验选择不同版本；非标准安装可通过 `PG_DUMP_BIN`、`PG_RESTORE_BIN` 显式指定。备份文件与清单最终权限统一为 `0640`。

```bash
cd /opt/dashboard-sku-api/current
sudo -u dashboard-sku env \
  PGDATABASE=dashboard_sku \
  PGUSER=dashboard-sku \
  CATALOG_BACKUP_DIR=/opt/dashboard-sku-api/backups \
  RELEASE_REVISION=<git-sha> \
  npm run backup

npm run backup:verify -- /opt/dashboard-sku-api/backups/<backup>.manifest.json
```

每次数据库迁移、批量导入和正式数据清理前都必须生成新备份。发布工具使用共享文件锁，避免发布备份和每日备份同时占用 PostgreSQL 与磁盘；清单先写临时文件并原子改名，巡检不会读到半份清单。

### 每日备份与保留策略

`dashboard-sku-backup.timer` 每天 03:20（服务器本地时间，附加最多 15 分钟随机延迟）生成并立即验证数据库归档、EPC 快照和清单。保留程序只管理清单明确标记为 `purpose=scheduled`、三件文件齐全且名称相互匹配的每日备份；发布备份、手工备份、旧格式备份、不完整文件和孤立文件永不自动删除。

默认保留最近 14 份每日备份，以及最近 8 个 ISO 周各一份备份；创建不足 24 小时的备份始终保留，单次最多删除 30 组。`backup:prune` 默认为只读预览，只有明确传入 `--apply` 才会逐个删除已列入计划的普通文件：

```bash
cd /opt/dashboard-sku-api/current
sudo -u dashboard-sku env CATALOG_BACKUP_DIR=/opt/dashboard-sku-api/backups npm run backup:prune

# 回到受保护主分支的仓库根目录安装 systemd 单元
cd <Dashboard 仓库目录>
sudo install -m 0644 deploy/dashboard-sku-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard-sku-backup.timer
sudo systemctl start dashboard-sku-backup.service
systemctl status dashboard-sku-backup.service dashboard-sku-backup.timer
```

首次启用必须手动运行一次 service，确认输出 `status=ok`、新清单 `purpose=scheduled`、配套文件校验通过且 `deletedSets=0`。不得用通配符或独立的系统清理任务删除备份目录。

### OSS 异地副本与主动告警

每日备份可以在本机校验通过后复制到阿里云 OSS。上传固定采用“数据库归档、EPC 资源、清单”顺序，只有前三个对象逐一通过远端元数据校验后才原子写入本机 `.offsite.json` 完成凭据；清单在最后上传，因此远端存在清单即表示整组对象已提交。对象启用服务端 AES256 加密并禁止同名覆盖，重试时只接受校验值完全相同的既有对象。程序不具备远端删除逻辑。

OSS Bucket 必须启用版本控制，并使用独立、最小权限的 RAM 身份，只授予目标前缀的 PutObject、HeadObject/GetObject 权限，不授予 DeleteObject、Bucket 管理或其他业务 Bucket 权限。生产首选把该 RAM 角色绑定到 ECS，设置 `OSS_ECS_RAM_ROLE` 后由官方凭据组件通过 IMDSv2 获取短期 STS 凭据；不在服务器落长期 AccessKey。静态密钥只作为兼容回退，两种凭据来源不能同时启用。建议使用不同地域的专用 Bucket，并在 OSS 侧配置生命周期；仓库和 journal 中不得保存或输出访问密钥。

先从 `deploy/backup-offsite.env.example` 创建只允许 root 读取的配置。首次启用时保留 `OFFSITE_BACKUP_REQUIRED=0` 与 `OFFSITE_RESTORE_DRILL_ENABLED=0`，手动生成一份每日备份并确认 `offsite.status=complete`、三项对象和本机 receipt 均存在；再设为 `1`。设为 required 后，每五分钟巡检会把“最新每日备份缺少完整异地凭据”视为故障。

```bash
sudo install -d -o root -g root -m 0750 /etc/dashboard-sku
sudo install -o root -g root -m 0600 deploy/backup-offsite.env.example /etc/dashboard-sku/backup-offsite.env
sudo install -o root -g root -m 0600 deploy/notifications.env.example /etc/dashboard-sku/notifications.env
# 使用 root 编辑上面两个文件并填入真实值；不要把结果复制回仓库。

sudo install -m 0644 deploy/dashboard-sku-alert@.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-operations-check.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-offsite-restore-drill.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-offsite-restore-drill.timer /etc/systemd/system/
sudo install -d -o root -g dashboard-sku -m 0750 /opt/dashboard-sku-api/offsite-restore-drills
sudo install -d -o dashboard-sku -g dashboard-sku -m 0750 /opt/dashboard-sku-api/restore-drills
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard-sku-offsite-restore-drill.timer
sudo systemctl start dashboard-sku-backup.service
sudo systemctl start dashboard-sku-alert@manual-test.service
journalctl -u dashboard-sku-backup.service -u dashboard-sku-alert@manual-test.service --since '-10 minutes' --no-pager
```

备份或五分钟巡检失败时，systemd 会调用统一通知单元。通知支持钉钉签名机器人、企业微信机器人和普通 JSON webhook；内容只包含来源、主机、时间和故障提示，不包含密钥、数据库内容或请求头。同一来源默认 30 分钟只通知一次，防止持续故障造成消息风暴；通知发送失败不会递归触发自身。

恢复不能直接覆盖生产库。仓库内的恢复演练工具默认只接受 `/opt/dashboard-sku-api/backups` 根目录中的清单，自动创建名称受限的一次性数据库，依次校验归档、恢复前后关键表数量、迁移账本、EPC 资源解压和隔离 API 冒烟，并在退出时删除验证库与临时资源。它不会连接或覆盖 `dashboard_sku`：

```bash
cd /opt/dashboard-sku-api/current
sudo ./scripts/run-api-restore-drill.sh \
  /opt/dashboard-sku-api/backups/<backup>.manifest.json
```

自动发布会把受保护主分支中的恢复演练脚本一并安装到 release。演练成功输出单行 JSON 证据；任何步骤失败都返回非零状态。只有恢复验证、关键表数量、接口测试和人工抽查均通过后，才能安排生产切换。

每月异地恢复 timer 在每月第一个星期日 04:10 后随机 30 分钟内运行。任务只识别目标前缀下形如 `<备份名>/<备份名>.manifest.json` 的完整提交，分页查找最新清单，在独立 `download.*` 目录下载三件对象并核对远端元数据、文件大小与 SHA-256，再调用同一套隔离数据库恢复演练。该受控入口是恢复脚本唯一允许的第二种备份根目录；无论成功失败，下载目录、一次性数据库和恢复资源都会清理，不复制回本机长期备份区，也不修改或删除 OSS 对象。真实 OSS 尚未启用时任务返回 `status=disabled`；首次真实手动演练通过后才能把 `OFFSITE_RESTORE_DRILL_ENABLED` 设为 `1`，失败由统一告警单元通知。

页面“导出资料”生成的 JSON/CSV 用于业务交接和人工核对，不替代数据库备份。JSON 审计包包含架构版本、计数与内容校验值；CSV 是便于 Excel 阅读的扁平视图。

## 发布结构

```text
/opt/dashboard-sku-preview/
├── current -> releases/20260930-bf4e19b
└── releases/
    ├── 20260930-f364123/
    ├── 20260930-8ba701f/  # 上一前端版，可回滚
    ├── 20260930-5f8e5b6/  # 上一前端版，可回滚
    ├── 20260930-40b8bbb/  # 上一前端版，可回滚
    └── 20260930-bf4e19b/
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
curl https://121.41.24.42/sku-preview/api/ready
curl https://121.41.24.42/sku-preview/api/v1/skus
```

`/api/health` 只证明进程存活；`/api/ready` 还会核对数据库连接、迁移数量、最新迁移和脚本校验值。两者都返回 `releaseRevision`：本地无 release 元数据时为 `development`，正式 release 必须是受保护主分支的 40 位 Git SHA。发布切流前必须以 `/api/ready` 返回 `200`、`status=ready` 且版本等于目标提交为准。

每个响应都带 `X-Request-Id`。调用方提供的编号仅在字符集和长度校验通过时沿用，否则服务端生成 UUID；错误响应同时返回 `requestId`，便于与 systemd JSON 日志关联。日志会隐藏授权、Cookie 和可信身份头。
`GET /api/metrics` 提供 Prometheus 文本格式的请求量、状态码、耗时、进程内存、版本和数据库连接池指标。该入口默认只允许 API 主机本机访问；远程运维采集必须配置 `API_OPERATIONS_TOKEN` 并使用 Bearer 令牌，不能通过 Nginx 公开匿名访问。

仓库中的 `dashboard-sku-operations-check.service` 与 `.timer` 每五分钟核对 readiness 与 release、指标、数据库连接池排队、最近备份完整性、备份年龄和磁盘余量。默认要求备份不超过 26 小时、可用空间不少于 1 GiB；失败会让 oneshot 单元进入失败状态并写入 journal。安装后验证：

```bash
sudo install -m 0644 deploy/dashboard-sku-operations-check.service /etc/systemd/system/
sudo install -m 0644 deploy/dashboard-sku-operations-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard-sku-operations-check.timer
sudo systemctl start dashboard-sku-operations-check.service
systemctl status dashboard-sku-operations-check.service dashboard-sku-operations-check.timer
```

该定时检查同时核对可选的异地备份凭据；失败会通过 `dashboard-sku-alert@.service` 发送站外通知。真实 webhook 与签名密钥只能保存在 `/etc/dashboard-sku/notifications.env`，不能写入仓库。

完整浏览器回归会建立和修改验收数据，只能用于本地或一次性数据库，不得直接指向生产。生产环境使用只读冒烟脚本：

```bash
PLAYWRIGHT_BASE_URL=https://121.41.24.42/sku-preview/ npm run test:production-smoke
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

`20260928-5b53ec9` 前端发布后已在线验证：新建车型调整为来源优先流程，支持从 VIN、EPC 数据或已有车型模板开始建档，并在写入前确认差异、常用配件和保养套餐。该版本只切换前端静态文件，未迁移数据库、未重启 API，也未自动写入示例车型；线上已有 5 条 SKU 保持不变，浏览器控制台无报错。

`20260930-f364123` 前端发布后已在线验证方案 3 的 SKU 主从工作区：1920×1080 下 SKU 列表与详情持续并排显示且各自滚动，页面本身无纵向溢出；SKU 编码和详情正文均为 16px，列表/表格切换和多图片拖入能力保留。线上首页、静态资源及 API 均返回 200，浏览器控制台无错误。发布前后数据库及 API 均为 17 条用户 SKU，本次未运行迁移、未修改业务数据，上一前端版 `20260928-5b53ec9` 保留用于回滚。

`20260930-8ba701f` 前端修复版发布后已在线验证：SKU 详情中的计量单位通过共享字典显示为“片”等名称，不再泄漏 `UNIT_` 编码。线上 17 条 SKU 保持不变，页面无纵向溢出，浏览器控制台无错误；上一版 `20260930-f364123` 保留用于回滚。

`20260930-5f8e5b6` 前端发布后已在线验证方案 2 的表格优先 SKU 工作区：默认显示完整 SKU 表格，右侧约 480px 检查器常驻且可收起恢复；1920×1080 下表格和检查器各自滚动，页面本身无纵向溢出，数据行正文为 16px。首页、静态资源、Nginx 配置与 API 健康检查均正常，浏览器控制台无错误或警告；线上 17 条用户 SKU 完整保留，本次未运行数据库迁移、未重启 API，上一前端版 `20260930-8ba701f` 保留用于回滚。

`20260930-40b8bbb` 前端发布后已在线验证虎山行汽配个人工作台：首页、构建资源、`/skus` 与 `/vehicles` 路由均返回 200，页面标题为“虎山行 · 汽配个人工作台”，API 健康检查正常；线上 17 条用户 SKU 完整保留。本次仅创建并原子切换前端静态 release，未运行数据库迁移、未重启 API 或 Nginx，上一版 `20260930-5f8e5b6` 保留用于回滚。

`20260930-bf4e19b` 前端清理版发布后已在线验证：`apps/web` 仅保留虎山行工作台入口、组件、样式与专属资产，旧 SKU、车型库、字典管理前端模块、服务层和视觉资产均已移除；`/skus`、`/vehicles` 与 `/dictionaries` 不再暴露旧业务页面，统一显示工作台。旧静态零件资产返回 404，生产 bundle 不包含旧业务页面文案。API 服务和线上 17 条 SKU 数据按约定保留但不再由当前前端调用；本次未迁移数据库、未重启 API 或 Nginx，上一版 `20260930-40b8bbb` 保留用于回滚。

`20261002-0cf9993f` API 与 `20261002-0caffeee` 前端联合发布后已在线验证：数据库从 7 个旧迁移升级到带校验账本的 26 个迁移，旧表中的 17 条 SKU、46 条 OE 关系和 1 条适配保持不变；新 `catalog_sku` 与 EPC 资源表保持空状态，未自动搬运旧数据。API `ready`、资源存储巡检、Nginx、静态资源和 systemd 服务均正常；资源目录位于 release 外部并使用 `dashboard-sku:dashboard-sku 750` 权限。生产身份默认只读，写请求返回 403；浏览器请求使用 `/sku-preview/api/`，显示“只读访客 / 只读查看”，不会用演示 SKU 代替真实空库，控制台无错误。回滚点为前端 `20260930-bf4e19b`、API `20260928-adb6d54`，迁移前数据库备份见上方清单。

`20261002-fb938da5` API 与前端联合发布后已在线验证旧 SKU 受控迁移预览：迁移 `027_catalog_legacy_sku_migration.sql` 已执行，预览读取旧表 17 条 SKU、46 条 OE 关系与 1 条适配，未自动写入新资料库；`catalog_sku` 与三张迁移账本均保持 0 条。生产只读身份可查看映射、风险与来源变化，但迁移写请求仍返回 403。API `ready` 报告 27 个迁移，Nginx、静态入口与生产只读冒烟均通过。备份脚本同时修复多 PostgreSQL 版本环境下导出/校验工具错配，并以配套清单验证了本次迁移前备份。回滚点为前端 `20261002-0caffeee`、API `20261002-0cf9993f`；数据库不随应用回滚自动降级。

`20261002-4f106413` API 与前端联合发布后已在线验证旧 SKU 迁移治理：资料员可在方案内修正品牌、分类和单位，并对排除记录填写原因；方案必须经过审核角色批准，管理员才可正式执行，旧的直接迁移接口不再允许绕过审批。迁移 `028`、`029` 新增方案账本、版本校验与单次执行占用保护。独立测试库走通提交、批准和执行，并发执行只产生一个批次；生产只读冒烟读取 17 条旧 SKU，默认 0 条选择，提交按钮和全选均不可用，控制台无错误。生产未创建方案、未执行迁移，17 条旧 SKU、46 条 OE、1 条适配保持不变，`catalog_sku`、迁移批次、方案与方案明细均为 0。API `ready` 报告 29 个迁移；回滚点为前端与 API `20261002-fb938da5`，数据库不随应用回滚自动降级。

`20261002-70d21e32` API 与前端联合发布后已在线验证可信身份与迁移职责分离：生产未配置身份网关时保持 `anonymous-readonly`，直接伪造管理员请求头仍是只读会话；迁移方案和旧 `/api/v1/skus` 写入均返回 403。迁移 `030` 增加稳定用户 ID、角色与方案审计事件，独立数据库验证了禁止自审、审核员不可执行、管理员执行及 4 条完整事件轨迹。生产只读浏览器冒烟、Nginx 和 API `ready` 均通过，控制台无错误。发布前后 17 条旧 SKU、46 条 OE、1 条适配保持不变，`catalog_sku`、迁移批次、方案、方案明细与身份审计事件均为 0。API `ready` 报告 30 个迁移；前端与 API 回滚点为 `20261002-4f106413`，数据库不随应用回滚自动降级。

`20261002-1c69b5b` 仅发布 API 的 PostgreSQL 连接兼容性修复：同一个事务连接上的旧 SKU 子记录与导入批次子记录改为顺序读取，避免 `pg` 下一大版本移除并发 `client.query()` 兼容行为后发生故障。发布前回归在旧实现上稳定复现两个并发点，修复后 API 59 项与隔离浏览器 22 项通过且不再出现弃用告警。生产未执行新迁移、未改前端；发布前后 17 条旧 SKU、46 条 OE、1 条适配保持不变，`catalog_sku`、迁移批次、方案、方案明细与身份审计事件均为 0。匿名及伪造管理员身份仍为只读，线上浏览器冒烟和服务日志检查通过；API 回滚点为 `20261002-70d21e32`。

`20261002T094700Z-c2f05bae` 使用仓库内 `deploy/release-api.sh` 完成首次完整自动发布：工具只接受受保护 `origin/main`，服务器 API 62 项通过，30 个迁移校验为 unchanged，发布前数据库归档、EPC 资源快照和清单成套生成并复核，随后原子切换并验证 readiness 中的完整 Git SHA、关键业务表数据指纹及线上只读浏览器冒烟。首次自举运行发现旧 `current` 还没有资源快照能力，工具随即改为从待发布 release 执行备份并强制 `assetArchive` 存在；修复后的第二次发布已证明缺口封闭。发布前后 17 条旧 SKU、46 条 OE、1 条适配保持不变，`catalog_sku` 及迁移账本均为 0，服务日志无错误或并发查询告警；API 回滚点为 `20261002T094004Z-3f801b59`。

`20261002T101303Z-cf3f46c8` API 发布后已在线验证可观测性与灾难恢复：每个响应返回受校验的请求编号，结构化日志隐藏凭据，Prometheus 指标在本机可读而外部匿名访问返回 404。新备份清单同时记录旧资料表，发布前后保持 17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录，新 `catalog_sku` 与迁移方案均为 0。配套备份已真实恢复到一次性数据库，30 个迁移账本、全部清单表计数、EPC 资源解压、隔离 API readiness、旧 SKU 与 v2 列表及指标均通过；演练结束后验证库与临时目录均为 0。五分钟运维检查 timer 已启用，首轮校验显示连接池排队 0、备份完整、约 31.3 GB 可用空间，API 服务日志错误数为 0；API 回滚点为 `20261002T094700Z-c2f05bae`。

`20261002T104035Z-0c1213d6` API 发布后已在线验证每日自动备份与安全保留：发布备份标记为 `purpose=release`，不进入自动清理；每日 timer 已启用并安排在次日 03:20 后随机 15 分钟内运行。手动触发生成了带完整 release SHA 的 `purpose=scheduled` 配套备份，归档、EPC 快照、关键表数量和校验值均通过；策略识别 2 组每日备份、保留 2 组、删除 0，历史、发布与不完整文件均未接管。该定时备份又完成一次隔离恢复，30 个迁移与 API 冒烟通过，随后验证数据库和临时目录均清零。发布前后保持 17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录，新 `catalog_sku` 为 0，systemd 无失败单元；API 回滚点为 `20261002T103305Z-c503953f`。

`20261002T111303Z-f416a437` API 发布后已在线验证 OSS 异地副本与主动告警基础设施：受保护主分支、服务器 79 项 API 测试、隔离浏览器回归和线上只读冒烟均通过；API readiness 返回完整提交 `f416a4376bcfca74acb314a1aad87cc73665892e`。每日备份与五分钟巡检已接入统一 OnFailure 通知单元，配置目录权限为 `0750 root:root`，两个私有配置均为 `0600 root:root`；手动通知测试在未配置 webhook 时安全返回 disabled。手动每日备份生成并复核归档、EPC 快照与清单，输出 `offsite.status=disabled`、保留 3 组、删除 0；巡检明确返回 `offsite.status=not-required`。OSS 上传和外部通知保持显式关闭，等待专用 Bucket/RAM 角色与真实接收渠道后再启用，不使用虚构凭据。发布前后保持 17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录，新 `catalog_sku` 为 0；API、两项 timer 均 active，systemd 无失败单元，API 回滚点为 `20261002T104035Z-0c1213d6`。

`20261002T113721Z-d4637500` API 发布后已在线验证每月异地恢复演练基础设施：服务器 81 项 API 测试、受保护主分支、隔离浏览器回归和线上只读冒烟通过；月度 timer 已启用，首次计划在 2026-10-04 04:20:51 CST 运行。未配置 OSS 时手动启动安全返回 `status=disabled`，`offsite-restore-drills` 不留下载目录、恢复数据库计数为 0。扩展后的本机恢复入口又使用本次发布备份完成真实隔离恢复，30 个迁移、API readiness、旧 SKU、v2 资料、指标与 EPC 解压全部通过，随后一次性数据库及两类临时目录均清零。OSS 上传、远端下载和外部通知继续显式关闭，等待真实 Bucket、RAM 角色与 webhook 后再进行第一次远端恢复。发布前后保持 17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录，新 `catalog_sku` 为 0；API、三项 timer 均 active，systemd 无失败单元，API 回滚点为 `20261002T111303Z-f416a437`。

`20261002T122316Z-f097cc8e` API 与 `20261002-f097cc8e` 前端联合发布后，旧 SKU 迁移方案新增批准前及执行前实时复核，来源版本、编号冲突、重复迁移与失效字典映射都会在写入前阻断；批准方案使用单个数据库事务执行，任何一条失败都会整批回滚，方案详情持久显示批次与逐条结果。PR 与受保护主分支检查、服务器 81 项 API 测试、隔离浏览器 23 项回归、线上只读浏览器冒烟和五分钟运维检查均通过，API 与前端生产依赖审计为 0 个已知漏洞。发布没有创建真实迁移方案，17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录保持不变，`catalog_sku`、迁移批次、方案、方案明细和身份事件仍为 0；API、每日备份、运维检查和月度异地恢复 timer 均 active，systemd 无失败单元，恢复临时目录与一次性数据库均为 0。前端回滚点为 `20261002-70d21e32`，API 回滚点为 `20261002T113721Z-d4637500`。

`20261002T125620Z-13898754` API 与 `20261002-13898754` 前端联合发布后，已执行迁移方案新增逐条动态验收报告：目标 SKU 的完整度、来源证据、主编号、适配专项审核、SKU 审核、当前编号冲突和车型平台边界会在验收时重新检查；执行人不能自验，整改和验收结论写入身份审计事件，通过时保存目标 SKU 版本快照，后续变化会显示漂移。PR #46、受保护主分支、服务器 81 项 API 测试、隔离浏览器 23 项回归、线上只读浏览器冒烟、Nginx 和运维巡检均通过，API 与前端生产依赖审计为 0 个已知漏洞。迁移 `031` 只增加验收字段和事件类型；发布没有创建真实迁移方案，17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录保持不变，`catalog_sku`、迁移批次、方案、方案明细和事件仍为 0。API、每日备份、运维检查和月度异地恢复 timer 均 active，systemd 无失败单元，恢复临时目录与一次性数据库均为 0。前端回滚点为 `20261002-f097cc8e`，API 回滚点为 `20261002T122316Z-f097cc8e`；数据库迁移只前进，不随应用回滚自动降级。

`20261002T141315Z-9c7016db` API 与 `20261002-e6df0651` 前端联合发布后，旧 SKU 治理新增“首批试运行”工作台：可以按 5、8、10 条生成可解释候选，展示准备度、分类和品牌覆盖、已有适配复核场景以及预计人工任务；采用候选只填充待核对方案，不会自动提交、审批或写入资料库。生产候选从 17 条旧资料中选出 5 条，覆盖 5 个标准分类和 3 个标准品牌，预计复核 97 分钟；上线核对发现并修正了一个旧分类内部编码显示问题，最终页面统一展示标准字典名称。PR #48、#49、两个受保护主分支检查、服务器 82 项 API 测试、隔离浏览器 23 项回归、线上只读浏览器冒烟、Nginx 和运维巡检均通过。发布没有创建真实迁移方案，17 条旧 SKU、46 条 OE、1 条适配、20 条变更记录保持不变，`catalog_sku`、迁移批次、方案、方案明细和事件仍为 0。API 回滚点为 `20261002T135945Z-e6df0651`，前端回滚点为 `20261002-13898754`。

`20261002T203712Z-2c53443a` API 发布后，系统新增询价、需求项、多供应商报价、对客报价和业务事件六张表，打通从客户需求到比价、报价、跟进及成交/丢单的服务端闭环；询价和报价使用版本校验防止多人覆盖，写操作要求可信业务权限，生产匿名身份只能查看。PR #51 与受保护主分支检查、服务器 85 项 API 测试、隔离浏览器 24 项回归和线上只读浏览器冒烟均通过；线上读取返回空业务列表，匿名新建询价返回 403，六张业务表均为 0，未写入模拟客户或报价。发布前后 17 条旧 SKU、46 条 OE、1 条适配保持不变；API、每日备份、运维检查和月度异地恢复 timer 均 active，systemd 无失败单元。API 回滚点为 `20261002T141315Z-9c7016db`；迁移 `032` 只前进，不随应用回滚自动降级。

`20261003T012354Z-a9553977` API 发布后，系统新增客户、门店和供应商统一主数据、联系人、客户车辆及合作方审计事件；询价可以关联客户和客户车辆，供应商报价可以关联供应商，同时保留业务发生时的名称、联系人和车辆快照。合作方与子记录使用双层版本校验，VIN 与税号提供唯一性保护，停用或拉黑不删除历史数据。PR #53、受保护主分支检查、服务器 87 项 API 测试、隔离浏览器 24 项回归和线上只读浏览器冒烟均通过；线上合作方列表为空，匿名新建合作方返回 403，四张主数据表及六张询价报价表均为 0，未写入模拟客户、供应商、车辆或报价。发布前后 17 条旧 SKU、46 条 OE、1 条适配保持不变；API、每日备份、运维检查和月度异地恢复 timer 均 active，systemd 无失败单元。API 回滚点为 `20261002T203712Z-2c53443a`；迁移 `033` 只前进，不随应用回滚自动降级。

`20261003T014653Z-82d31d99` API 发布后，系统把已成交询价原子转换为一张销售订单，并按报价中选定的供应商自动拆分采购订单；重复转换返回既有订单，不会重复采购。销售确认、采购提交与确认、分批到货、超收拦截、全部到货后自动进入销售履约以及最终交付均使用版本校验并写入不可覆盖的订单事件。PR #55、受保护主分支检查、服务器 89 项 API 测试、隔离浏览器 24 项完整业务回归和线上只读浏览器冒烟均通过；线上销售单和采购单列表为空，匿名转订单返回 403，新增五张订单表均为 0，未写入模拟订单或到货记录。发布前后 17 条旧 SKU、46 条 OE、1 条适配及此前十张业务表的数量保持不变；API、每日备份、运维检查和月度异地恢复 timer 均 active。发布前备份为 `/opt/dashboard-sku-api/backups/20261003T014719Z-0c12743b-dashboard_sku.manifest.json`，数据库归档 SHA-256 为 `f48f36ef883d579b5a65be19adb5aa24d1aee932dcbb71990a193b39efebdc3b`，EPC 资源归档为 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，清单为 `a58423f93944c3ffdfde42dbec69a5bd0f0d5698b11826757dcaafc7be464e5d`。API 回滚点为 `20261003T012354Z-a9553977`；迁移 `034` 只前进，不随应用回滚自动降级，前端视觉未在本次发布中改变。

`20261003T021216Z-87d10dc0` API 发布后，系统新增仓库、采购收货、库存批次、实时库存、销售预留、批次分配、发货及库存流水十一张表，打通采购到货入库、按批次先进先出锁库、释放锁定、分批发货和销售单自动完结。收货与发货使用请求键防重，业务对象使用版本校验，库存流水与实时余额可交叉核对，超收、超发、库存不足和未完成发货时手工完结都会被阻断。PR #57、受保护主分支检查、服务器 91 项 API 测试、隔离浏览器 24 项完整业务回归和线上只读浏览器冒烟均通过；生产新增库存表均为 0，未写入模拟仓库、库存或发货记录，原有 17 条 SKU、46 条 OE 与 1 条适配保持不变。API、每日备份、运维检查和月度异地恢复 timer 均为 active，readiness 报告 35 个迁移且版本为完整提交 `87d10dc09ef1262b9180b1a22f050b39645de197`。发布前备份为 `/opt/dashboard-sku-api/backups/20261003T021243Z-c8ccf8aa-dashboard_sku.manifest.json`，数据库归档 SHA-256 为 `3d8320a58adca8325bbc0f15b5c5526272ae4e7dc138a9f0221d716b21071584`，EPC 资源归档为 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，清单为 `58a5d88d4e5f858c48c32b7a4f59625c8fcde990f3e74eab58740412e3d617cd`。API 回滚点为 `20261003T014653Z-82d31d99`；迁移 `035` 只前进，不随应用回滚自动降级，前端视觉未在本次发布中改变。

`20261003T023347Z-2ca6baf4` API 发布后，系统优先打通客户资料、车型库、SKU 资料库与快速报价：客户车辆可绑定受治理的车型平台与车型版本；快速报价上下文只提供已核验 SKU、车型适配结果和实时可用库存；一次提交会原子创建询价、需求项、对客报价与报价项，并固化 SKU 版本、名称、品牌及适配快照。无适配时必须填写明确说明，请求键同时防止连续或并发重复报价。PR #59、受保护主分支检查、服务器 91 项 API 测试、隔离浏览器 25 项完整业务回归和线上只读冒烟均通过；线上快速报价上下文返回 0 个客户、0 辆客户车辆和 0 条新资料库 SKU，匿名新建报价返回 403，未写入模拟客户、车型或报价。原有 17 条 SKU、46 条 OE 与 1 条适配保持不变，API 与三个定时保障任务均为 active，readiness 报告 36 个迁移且版本为完整提交 `2ca6baf44e35f9466bb51ec56a9b02deb32de874`。发布前备份为 `/opt/dashboard-sku-api/backups/20261003T023414Z-ac505694-dashboard_sku.manifest.json`，数据库归档 SHA-256 为 `983e9fd93636edf692e2360dfa23c9f1328512335380283c701e8cb413dd04b2`，EPC 资源归档为 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，清单为 `8d569983069b7618b6e5d2c2180ab3065235a643871ed3a57029af064c312a98`。API 回滚点为 `20261003T021216Z-87d10dc0`；迁移 `036` 只前进，不随应用回滚自动降级，前端视觉未在本次发布中改变。

`20261003T025546Z-bd742ffc` API 发布后，快速报价明细必须明确选择现货或采购来源：现货报价会在生成前检查可用库存，库存不足时阻断；采购报价必须选择有效供应商，并在同一事务中固化供应商、采购成本与交期来源。成交转订单时仅采购明细按供应商拆分采购单，现货明细保留在销售单并直接进入后续库存预留与出库流程。PR #61、受保护主分支检查、服务器 91 项 API 测试、隔离浏览器 25 项完整业务回归和线上只读冒烟均通过；回归同时验证了采购报价生成采购单、现货报价不生成采购单、库存不足阻断和快速报价防重。线上上下文返回 0 个客户、0 个供应商和 0 条新资料库 SKU，匿名新建报价返回 403，所有新增业务表保持空状态；原有 17 条 SKU、46 条 OE 与 1 条适配保持不变。API 与三个定时保障任务均为 active，readiness 报告 37 个迁移且版本为完整提交 `bd742ffc81cedf309731751c883dde94ab1b9b15`。发布前备份为 `/opt/dashboard-sku-api/backups/20261003T025614Z-a1238123-dashboard_sku.manifest.json`，数据库归档 SHA-256 为 `335d091c41c3ffafbf9093762237c9ab25ea2a36dd3201a843dd95d06e94b63c`，EPC 资源归档为 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，清单为 `271cd78779765de4021adf585a79c51d7cdcdf274759f42181e4c17587c633d2`。API 回滚点为 `20261003T023347Z-2ca6baf4`；迁移 `037` 只前进，不随应用回滚自动降级，前端视觉未在本次发布中改变。

`20261003T031410Z-6276a97a` API 发布后，现货报价从跨仓合计升级为指定仓库承诺：快速报价上下文返回已启用仓库和 SKU 分仓在库、锁定、可用数量；现货明细必须绑定有效仓库，采购明细禁止混入现货仓库。报价成交转订单前会在同一事务内按仓库和库存键汇总需求并再次锁行核对，若期间库存已被其他订单占用则返回 `ORDER_STOCK_CHANGED`，不会把“曾经显示有货”误当成“已经锁定库存”。PR #63、受保护主分支检查、服务器 91 项 API 测试、隔离浏览器 25 项完整业务回归和线上只读冒烟均通过；回归真实验证了报价时可用、随后被另一订单锁定而阻断转单、释放后再成功转单的过程。线上上下文返回 0 个客户、0 个供应商、0 个仓库和 0 条新资料库 SKU，匿名新建报价返回 403，所有业务表保持空状态；原有 17 条 SKU、46 条 OE 与 1 条适配保持不变。API 与三个定时保障任务均为 active，readiness 报告 38 个迁移且版本为完整提交 `6276a97a9952e32cecd8b73efdbebb1576037cdd`。发布前备份为 `/opt/dashboard-sku-api/backups/20261003T031436Z-d33801b8-dashboard_sku.manifest.json`，数据库归档 SHA-256 为 `44c91281cbd059a39278ccbe9edccbfd6c57e3c361c2b66b33aa6aa82043c1cf`，EPC 资源归档为 `9223e8726502a1e1060b42842bda6debd2d0c54834a481f29b18d578fa2c9ec2`，清单为 `a444db74b75aaf81d5d30ab62dfb5800551effa00882a0024ff1cf3a247fa69c`。API 回滚点为 `20261003T025546Z-bd742ffc`；迁移 `038` 只前进，不随应用回滚自动降级，前端视觉未在本次发布中改变。

## 回滚

如需仅回滚前端版本，将 `/opt/dashboard-sku-preview/current` 指向上一版 release，然后执行线上浏览器验证；静态版本切换不需要重载 Nginx。

如需回滚 API，将 `/opt/dashboard-sku-api/current` 指向上一版 API release，然后重启 `dashboard-sku-api.service`；数据库回滚应使用单独审核过的迁移，不随前端或 API 版本自动回滚。

如需完全撤销 `/sku-preview/` 路由，恢复备份的 Nginx 配置，执行 `nginx -t`，检查通过后再重载 Nginx。不要修改或重启既有 Dashboard、PARTS-OS、数据库和 Worker 服务。
