# 部署说明

当前交付是源码托管和本地运行，尚未部署到公网。GitHub 仓库地址不是网站访问地址。

## 构建

```bash
npm ci
npm run check
```

将生成的 `dist/` 目录上传到支持静态文件的网站托管服务。`npm run preview` 只用于本地预览构建结果，不用作生产服务器。

## 浏览器路由回退

当前使用 BrowserRouter，托管服务需将未匹配到真实文件的页面请求重写到 `/index.html`。否则直接访问或刷新 未来新增的子路径 时可能得到服务器 404。

Nginx 根路径部署示例：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

当前默认部署在域名根路径。部署到 `/Dashboard/` 这类子路径时，需要同时配置 Vite base 与 BrowserRouter basename，并重新验证资源地址和刷新行为；不能直接把当前根路径构建当作 GitHub Pages 子路径站点使用。

## 公开配置

VITE_APP_NAME 在构建时写入静态文件。生产环境修改后需要重新构建。真实后端密钥由未来的服务端管理。

## 后续上线检查

确定托管平台、域名与部署路径后，再加入平台配置和自动发布流程。届时确认 HTTPS、SPA 路由回退、缓存策略、真实登录与权限需求，并同步更新本文档。现有 GitHub Actions 仅做代码检查和构建，不会发布网站。
