# 虎山行工作台首页 Design QA

- 视觉基准：`docs/references/workbench/home-reference.png`
- 浏览器实现截图：`apps/web/qa-artifacts/implementation-workbench-home-1680.png`
- 并排对照：`apps/web/qa-artifacts/workbench-home-design-comparison.png`
- 基准图：1672 × 941 px
- 浏览器视口：1680 × 945 CSS px，设备像素比 1

## 最终结论

通过。当前前端为独立的虎山行工作台，不再加载旧 SKU、车型库、字典管理组件或旧前端服务。

## 核对结果

- 页面骨架：208px 左侧导航、顶部品牌横幅、主搜索、五项指标、7:3 业务区和底部三栏与基准图保持一致。
- 字体与色彩：冷灰背景、白色内容层、荧光柠檬黄强调和高对比文字符合视觉要求。
- 业务内容：首页保留业务跟进、核心指标、待办、快捷操作、常用车型和 Pi 助手的模拟状态。
- 交互：主搜索、Ctrl/Cmd+K 命令中心、Esc 关闭和待办勾选正常。
- 独立性：`/skus`、`/vehicles` 和 `/dictionaries` 不再暴露旧页面，统一回到工作台；导航入口明确提示后续接入。
- 稳定性：工作台浏览器测试、生产构建和站点打包测试通过，页面无浏览器错误。

final result: passed
