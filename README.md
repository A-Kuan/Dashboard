# Dashboard

SKU 主数据编辑模块的字段、组件和后端接口准备见 [docs/SKU-MASTER-DATA.md](docs/SKU-MASTER-DATA.md)。

汽配行业 ERP 管理系统，采用前后端分离架构。

当前正在实现 SKU 管理界面，前端应用位于 [`apps/web`](./apps/web)。
SKU 持久化 API 位于 [`apps/api`](./apps/api)，使用 Node.js、Fastify 和 PostgreSQL。

## 本地运行

```bash
cd apps/web
npm install
npm run dev
```

API 本地启动：

```bash
cd apps/api
npm install
npm run migrate
npm run dev
```

## 服务器预览构建

部署到服务器的 `/sku-preview/` 路径时执行：

```bash
cd apps/web
npm run build:server
```

部署结构和回滚说明见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

品牌、零件大类、SKU 状态等选择项使用共享可配置字典，配置与接口约定见 [docs/DICTIONARIES.md](./docs/DICTIONARIES.md)。
