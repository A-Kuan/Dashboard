# 本地开发与协作

## 环境和启动

Node.js 24.16.0 及以上的 24.x，npm 11.x。使用 npm 与 package-lock.json；换环境执行 npm ci。
执行 npm run dev 同时启动 Vite 4179 和 Node API 4182，访问 http://127.0.0.1:4179，默认仅本机。
首次读取 .data/setup-token.txt 的一次性初始化码，在页面自行设置管理员账号和密码（必填，最多 128 位）。初始化后文件移除。后续账号由管理员创建，无公开注册。正式业务数据库初始为空。

## 环境变量

无需配置即可开发；可复制 .env.example 为 .env.local，修改后重启。

| 变量          | 默认                  | 用途                                       |
| ------------- | --------------------- | ------------------------------------------ |
| VITE_APP_NAME | Dashboard             | 公开名称                                   |
| HOST          | 127.0.0.1             | 后端监听地址                               |
| PORT          | 4182                  | 后端端口                                   |
| APP_ORIGIN    | http://127.0.0.1:4179 | 写请求允许的完整来源                       |
| DATA_DIR      | .data                 | 数据目录                                   |
| NODE_ENV      | 未设置                | production 要求 HTTPS 并启用 Secure Cookie |

更改前端端口需同步 APP_ORIGIN，更改后端端口需同步 vite.config.ts 代理。VITE_ 变量进入浏览器，不可保存秘密。

## 命令

| 命令                 | 用途                                          |
| -------------------- | --------------------------------------------- |
| npm run dev          | 同时启动前后端                                |
| npm run dev:frontend | 单独启动 Vite                                 |
| npm run dev:api      | 单独启动 API                                  |
| npm start            | 提供 dist 与 API，先构建并配置对应 APP_ORIGIN |
| npm test             | 隔离数据库集成测试                            |
| npm run typecheck    | TypeScript 检查                               |
| npm run lint         | Oxlint                                        |
| npm run ui:check     | 检查原生下拉与日期控件                        |
| npm run format       | 格式化                                        |
| npm run format:check | 检查格式                                      |
| npm run build        | 类型检查并构建                                |
| npm run check        | 格式、lint、控件规则、集成测试、类型与构建    |
| npm run preview      | 仅静态预览，不用于完整业务                    |

集成测试覆盖未登录和角色权限、来源校验、初始化、数据校验、价格隔离、事务回滚、版本冲突、重启持久化及会话撤销；不是浏览器端到端套件。浏览器验收用独立临时数据库。

## 旧站 SKU 迁移

迁移脚本读取已从旧站只读导出的 NDJSON 文件。名称包含“弃用零件”的 SKU 会被跳过，预检报告给出跳过数量。先运行预检，再执行导入；执行模式会自动备份目标 SQLite 数据库，并在单个事务中写入 SKU、来源、件号和车型。重复执行相同快照会跳过已导入记录。导入后检查记录数与 SQLite 完整性。操作前停止本地 API，完成后重启。

```bash
node scripts/import-legacy-skus.mjs --source=.data/import/old-skus.ndjson --data-dir=.data
node scripts/import-legacy-skus.mjs --source=.data/import/old-skus.ndjson --data-dir=.data --apply
```

预检报告在 `.data/import/migration-report.json`，执行备份在 `.data/backups`。快照、报告、备份含业务数据，不提交到 Git。原始来源字段保存在 `sku_source`；品牌、性质、产地与售价需要人工核对后补全。

## 旧站字典迁移

两处字典来自不同的源表，快照为 `.data/import/old-dictionaries.ndjson`。导入脚本先校验分组、选项和 Logo 数量；执行模式先备份目标数据库，再以单个事务写入。重复运行跳过已存在编码，保留本地后续编辑。

```bash
node scripts/import-legacy-dictionaries.mjs --source=.data/import/old-dictionaries.ndjson --data-dir=.data
node scripts/import-legacy-dictionaries.mjs --source=.data/import/old-dictionaries.ndjson --data-dir=.data --apply
```

预检报告为 `.data/import/dictionary-migration-report.json`，备份位于 `.data/backups`。操作前停止本地 API，完成后重启。原始快照、Logo、报告和备份均包含业务资料，不提交到 Git。

## 协作

先检查 git status，保留未提交修改；同步使用 git pull --ff-only。依赖变化执行 npm ci。新增依赖同步 package.json 与 package-lock.json，运行 npm run check。源码同步不会携带本地数据库，备份见 DEPLOYMENT.md。详细流程见 CONTRIBUTING.md。真实环境文件、数据、账号密钥不得提交。
