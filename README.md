# Dashboard

React + TypeScript + Vite 网站基础骨架。代码托管于 [A-Kuan/Dashboard](https://github.com/A-Kuan/Dashboard)。

当前只提供工程基础，不包含自定义样式、UI 组件库、演示数据或业务功能。首页与 404 页面使用浏览器默认样式。

## 快速开始

使用 Node.js 24.16.0 和 npm 11.x。

```bash
git clone https://github.com/A-Kuan/Dashboard.git
cd Dashboard
npm ci
npm run dev
```

本地访问：http://127.0.0.1:4179。

## 已具备的基础

- React + TypeScript 严格模式、Vite 开发与构建。
- React Router 基础路由、共享布局入口、首页与 404。
- 环境变量样例、精确依赖、依赖锁文件、统一格式与 lint。
- GitHub Actions：Linux / Windows 安装、格式、lint、类型和构建检查。
- 多环境协作说明，以及全局文档随相关改动同步更新的规则。

当前没有后端、登录、权限、数据库或公网网站部署。代码推送到 GitHub 不等于网站已上线。

## 常用命令

```bash
npm run dev          # 本地开发
npm run check        # 格式、lint、类型与构建
npm run format       # 自动统一格式
npm run preview      # 预览构建产物，需先构建
```

## 文档

- [协作规则](AGENTS.md)：涉及全局文档的修改，必须同次更新并提交。
- [开发协作](CONTRIBUTING.md)：分支、提交和换电脑工作流程。
- [架构说明](docs/ARCHITECTURE.md)：目录、路由和扩展约定。
- [开发环境](docs/DEVELOPMENT.md)：环境、命令与配置。
- [部署说明](docs/DEPLOYMENT.md)：构建、静态托管和路由回退。
- [变更记录](CHANGELOG.md)：已完成的变化。
