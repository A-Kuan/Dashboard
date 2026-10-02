# 虎山行工作台前端规则

运行本地服务并在可用浏览器中打开预览；可以直接验证时，不要求用户自行启动。

`apps/web` 是独立的虎山行个人工作台前端，不再承载旧 Dashboard 的 SKU、车型库、字典管理或旧业务路由。不要重新引入已删除的组件、服务层、样式或视觉资产；侧栏和快捷入口在新模块开发前保持为明确的未接入状态。

用户提供的 `docs/references/workbench/home-reference.png` 是首页布局、图像、密度、间距、颜色、排版、可见内容和层级的视觉基准。桌面端优先复现 1672×941 参考图，正文保持清晰、高对比，不用缩小字体换取无滚动布局。

可复用结构、字典和未来接口应从新工作台业务模型出发设计，不依赖旧前端实现。首页当前模拟数据只用于视觉与交互原型，不得写入服务器数据库，也不得伪装为真实库存、价格或订单。

保留 `.openai/hosting.json`、`worker/index.js`、`scripts/prepare-sites-build.mjs` 和 `tests/sites-worker.test.mjs`。交付前运行 `npm run build`、`npm run test:sites` 和 `npm run test:e2e`；浏览器回归会自动创建一次性 PostgreSQL 数据库并在结束后删除，不得改回连接长期开发库。服务器发布使用 `npm run build:server`。
