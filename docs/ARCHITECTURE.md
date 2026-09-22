# 架构说明

## 当前范围

方案 A：React + TypeScript + Vite，使用 React Router 提供浏览器端路由。

当前范围是基础骨架与参考图风格的左侧导航。仅为导航及承载它的基础布局加入样式，主内容保持语义 HTML；没有主题、整套 UI 组件库、演示数据或业务页面。导航图标使用 @tabler/icons-react。后端、登录、权限、数据库与商品管理尚未实现。

技术版本以 package.json 的精确版本和 package-lock.json 为准。

## 目录与职责

```text
src/
  App.tsx                 根组件与路由
  main.tsx                React 启动入口
  config/app.ts           公开应用配置
  config/navigation.ts    导航分区、分组与链接配置
  components/layout/      共享布局入口与承载布局样式
  components/navigation/  导航组件、类型与局部样式
  pages/                  首页与 404 页面
  vite-env.d.ts           环境变量类型
docs/                     全局文档与视觉参考
.github/                  CI 与 PR 模板
```

## 路由

| 地址     | 页面     | 当前行为         |
| -------- | -------- | ---------------- |
| /        | 首页     | 最小骨架就绪提示 |
| 其他地址 | 404 页面 | 返回首页链接     |

共享布局包含 Sidebar 和主内容区域。Sidebar 从 config/navigation.ts 读取配置；现有菜单为“工作台 → 首页”，不会为菜单创建虚假业务页面。应用名称从 VITE_APP_NAME 读取，默认 Dashboard。

导航使用原生 button 折叠分组、NavLink 表达当前页面，并提供移动端菜单。展开状态仅保存在当前组件中，不持久化。样式与交互规范见 [NAVIGATION.md](NAVIGATION.md)。

部署时需配置 SPA 回退，使直接访问未来新增的子路径也能返回 index.html。前端 404 是页面展示，不会改变静态服务器返回的 HTTP 状态码。

## 后续扩展

页面负责组合，公共组件放在 components，业务逻辑在实际需要时建立 features/<模块>。多个页面使用相同选择项时应提取共享字典，避免各页面硬编码。

当前没有 API 请求或业务状态。具体功能确定后再选择服务端、数据库、权限方案与数据请求层，并同步更新本文件。前端隐藏入口不能替代服务端权限校验。
