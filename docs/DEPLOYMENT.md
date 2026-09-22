# 部署说明

当前部署在 `121.41.24.42`。新项目入口为 `https://121.41.24.42/`；同一 IP 的 HTTP 80 端口仍提供旧站，不要将其重定向到新站。两套服务分别使用独立进程、代码和数据目录。

## 构建与本机预览

Node.js 24.16+ 的 24.x，执行 npm ci 和 npm run check。Node 同时提供 dist、SPA 回退与 /api，不能只上传静态文件。
本机预览时在 .env.local 设置 APP_ORIGIN=http://127.0.0.1:4182，执行 npm start，访问该地址。切回开发时恢复来源为 http://127.0.0.1:4179。Vite preview 仅预览静态资源。

## 现有公网部署

Ubuntu 24.04 使用 `/opt/dashboard/runtime/node-v24.16.0-linux-x64`，代码在 `/opt/dashboard/app`，数据库在 `/var/lib/dashboard`，`dashboard` 系统用户运行 `dashboard.service`，Node 仅监听 `127.0.0.1:4182`。Nginx 443 端口按 [dashboard-https.conf](../deploy/dashboard-https.conf) 转发到 Node；HTTP 80 端口继续属于旧站，只增加 `/.well-known/acme-challenge/` 的证书校验路径。服务单元见 [dashboard.service](../deploy/dashboard.service)。生产环境设置 `NODE_ENV=production`、`APP_ORIGIN=https://121.41.24.42`，登录 Cookie 使用 Secure、HttpOnly、SameSite=Strict。

服务器 IP 使用 Let's Encrypt 短期 IP 证书，约六天有效。Certbot 5.4+ 通过 webroot `/var/www/dashboard-acme` 验证 IP；[续期服务](../deploy/dashboard-certbot-renew.service)和[定时器](../deploy/dashboard-certbot-renew.timer)每天两次检查，并在证书更新后重载 Nginx。Ubuntu 自带的旧版 `certbot.timer` 已停用，避免用不支持 IP 证书的客户端续期。检查 `systemctl status dashboard-certbot-renew.timer` 与 `certbot certificates`，续期异常需在证书过期前修复。无备案的动态域名曾被云服务商拦截，故当前直接使用 IP 证书。

发布新版本：先在本地通过 `npm run check` 并推送 GitHub，再在服务器 `/opt/dashboard/app` 执行 `git pull --ff-only`、用 Node 24 对应的 npm 执行 `npm ci` 和 `npm run build`，最后 `systemctl restart dashboard`。先备份 `/var/lib/dashboard`，再发布；`systemctl status dashboard` 和 HTTPS 下 `/api/auth/session` 用于验收。代码更新不会覆盖数据库。不得公开 Node 端口、开发服务、SQLite 数据文件或私钥。

当前数据库从本地通过 SQLite 一致性快照首次迁入，包含旧站迁移的 SKU、字典、管理员账号与报价模板。后续服务器数据为准，不要再用本地旧快照覆盖线上编辑。首次管理员若未初始化，一次性码位于数据目录的 `setup-token.txt`；目前没有自助找回密码。当前是单实例方案。登录按 Node 连接 IP 限流，反向代理下所有访问可能共用额度，上线后应继续完善可信代理策略。

## 备份与恢复

第一版采用停机备份：正常停止 Node 后复制整个 DATA_DIR（包括可能存在的 WAL 文件），保存到受保护位置。恢复时停止服务，恢复目录后启动并验证账号与业务记录。不要在运行中只复制 dashboard.sqlite。备份含账号、客户价格和报价模板等业务资料，不可公开下载。
VITE_APP_NAME 为构建时公开配置，密钥不可用 VITE_ 前缀。CI 仅检查与构建，不发布网站。
