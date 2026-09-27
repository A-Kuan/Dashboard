# Dashboard

汽配行业 ERP 管理系统，采用前后端分离架构。

当前正在实现 SKU 管理界面，前端应用位于 [`apps/web`](./apps/web)。

## 本地运行

```bash
cd apps/web
npm install
npm run dev
```

## 服务器预览构建

部署到服务器的 `/sku-preview/` 路径时执行：

```bash
cd apps/web
npm run build:server
```

部署结构和回滚说明见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。
