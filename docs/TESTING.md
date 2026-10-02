# 本地测试与浏览器验收

## 完整浏览器回归

在 `apps/web` 目录运行：

```bash
npm run test:e2e
```

该命令会自动：

1. 创建名称以 `dashboard_sku_e2e_` 开头的一次性 PostgreSQL 数据库；
2. 在临时库执行全部迁移；
3. 使用随机可用端口启动 API 和前端；
4. 串行执行会写入数据的 Playwright 业务回归；
5. 无论成功、失败或收到终止信号，停止临时 API 并删除一次性数据库。

本机需要安装 PostgreSQL 命令行工具，并让当前数据库角色拥有创建、删除测试数据库的权限。默认连接本机 `/tmp` Unix socket；自定义本地实例可以使用 `E2E_PGHOST`、`E2E_PGPORT`、`E2E_PGUSER` 和 `E2E_PGPASSWORD` 覆盖。

非本机数据库地址默认被拒绝。只有专用、可随时销毁的测试集群才可以额外设置 `E2E_ALLOW_REMOTE=1`；禁止把这些变量指向生产数据库实例。

完整回归拒绝在设置 `PLAYWRIGHT_BASE_URL` 时运行，避免把带写入操作的用例误发到已部署环境。已部署环境只运行下方的只读冒烟检查。

## 已部署环境只读冒烟

```bash
PLAYWRIGHT_BASE_URL=https://example.com/sku-preview/ npm run test:production-smoke
```

该检查只读取会话、SKU 资料和迁移预览，并验证匿名权限仍为只读，不创建 SKU 或迁移方案。

## 验收截图

普通 `npm run test:e2e` 的截图写入 Playwright 的临时测试结果，不修改版本库中的 `qa-artifacts`。只有需要更新人工验收留档时才显式执行：

```bash
UPDATE_QA_ARTIFACTS=1 npm run test:e2e
```

提交这类图片前必须人工检查画面，不能把自动生成的变化直接当作视觉验收通过。

## 持续集成

每个合并请求和 `main` 分支更新都会触发 `Quality` 工作流：

- `Unit tests and build` 验证 API、前端单元测试、Sites 包装和生产构建；
- `Isolated browser regression` 启动专用 PostgreSQL 服务，并运行完整的一次性数据库浏览器回归。

两项检查都通过后才应合并业务变更。工作流使用 Node.js 22，与本地和服务器运行时保持一致。

`main` 分支已启用保护规则：所有变更必须经过合并请求，以上两项检查必须基于最新主分支成功；管理员同样不能绕过。仓库按单人维护模式设置为 0 个强制批准，但要求所有评审对话已解决，并禁止强制推送和删除 `main`。
