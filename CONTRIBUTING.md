# 开发协作

请先阅读 [AGENTS.md](AGENTS.md)。项目采用一个 GitHub 仓库、多台电脑分别克隆的方式协作。

1. 开始前查看 `git status`。有未提交改动时先妥善提交或暂存，再切换分支。
2. 在干净的工作目录中切到 main，执行 `git pull --ff-only`，然后创建功能分支。
3. 执行 `npm ci`，根据需要配置本地环境变量。
4. 完成功能，并在同次提交中更新受影响的全局文档。
   业务控件使用项目共享样式与组件；不要让系统原生下拉菜单、复选框、数字微调按钮或日期弹窗出现在界面。交付前检查鼠标、键盘、焦点和弹窗内的展开状态。
5. 运行 `npm run check`，检查 `git diff`，提交到功能分支。
6. 推送分支并创建 PR，检查 CI 结果，再合并。
7. 换电脑继续同一个任务时，先推送当前分支，再在另一台电脑拉取该分支。

推荐分支名：`feat/功能名`、`fix/问题名`、`docs/文档主题`。提交消息说明具体改动及目的。

```bash
git switch main
git pull --ff-only
git switch -c feat/example
npm ci
# 修改代码和对应文档
npm run check
git add <本次涉及的文件>
git commit -m "feat: 描述本次改动"
git push -u origin feat/example
```

真实环境配置保留在每台电脑自己的 `.env.local` 中。Git 同步代码与文档，不会同步数据库、上传附件或未提交文件。

GitHub Actions 在 main 推送及 PR 时执行 Linux / Windows 检查。分支保护规则尚未配置，CI 失败目前不会自动禁止直接推送 main。
