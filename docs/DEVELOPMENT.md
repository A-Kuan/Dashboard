# 本地开发与多环境协作

## 环境

- Node.js：24.16.0（`.nvmrc`），项目允许 24.16.0 及以上的 24.x。
- npm：11.x，初始锁文件由 npm 11.13.0 生成。
- Git：用于同步源码、配置样例与文档。

macOS / Linux 使用 nvm 时可执行 `nvm install && nvm use`。Windows 可安装对应 Node.js 版本或使用 nvm-windows。具体项目脚本均不依赖 Unix shell 命令。

## 首次启动

```bash
git clone https://github.com/A-Kuan/Dashboard.git
cd Dashboard
npm ci
npm run dev
```

打开 http://127.0.0.1:4179。端口被占用时会明确失败，不会自动切换；临时指定其他端口可使用 `npm run dev -- --port 4181`。

如需手机在同一局域网访问，执行 `npm run dev -- --host 0.0.0.0`，使用终端显示的局域网地址。默认仅监听本机。

## 环境变量

无需 .env 即可启动。如需修改应用名称，将 `.env.example` 复制为 `.env.local`，修改后重新启动。

| 变量          | 默认值    | 用途               |
| ------------- | --------- | ------------------ |
| VITE_APP_NAME | Dashboard | 导航与页面标题名称 |

Vite 的 `VITE_` 变量会进入浏览器构建产物，只用于公开配置。密钥、数据库密码不能放入其中。新变量必须同步更新 `.env.example`、类型与本文档。

## 常用命令

| 命令                 | 用途                        |
| -------------------- | --------------------------- |
| npm ci               | 严格按照锁文件安装依赖      |
| npm run dev          | 开发服务器，4179            |
| npm run typecheck    | TypeScript 类型检查         |
| npm run lint         | Oxlint 检查，警告也视为失败 |
| npm run format       | 统一格式                    |
| npm run format:check | 检查格式                    |
| npm run build        | 类型检查并构建到 dist       |
| npm run preview      | 本机预览构建结果，4180      |
| npm run check        | 格式、lint、类型和构建检查  |

当前没有业务逻辑测试套件。`npm run check` 不等于业务功能或浏览器端到端测试；新增业务功能时按风险补充测试。

## 换电脑与同步

第一次使用新电脑，克隆仓库并安装相同 Node/npm 版本，执行 npm ci。以后开始工作先检查并处理未提交改动，再使用 `git pull --ff-only` 同步当前分支。依赖锁文件发生变化后重新执行 npm ci。

main 保存整合后的版本，日常使用功能分支。操作流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。同时在两台电脑修改同一个文件仍可能产生冲突，需要逐项确认合并；Git 不会自动同步尚未提交的改动。

## 依赖更新

package.json 使用精确版本，package-lock.json 必须提交。新增或升级依赖使用 npm install，同步提交两个文件并运行 npm run check。不要提交 node_modules 或手工编辑锁文件。
