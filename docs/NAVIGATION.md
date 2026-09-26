# 导航组件约定

## 当前视觉来源

全站已完全移除旧版“双层主导航 + 模块二级导航”壳层。普通业务页和客户车辆工作台以 `docs/references/customer-garage-reference.png` 为全局导航真值；SKU 台账以 `docs/references/parts-ledger-reference.png` 为独立顶栏真值。两套界面均使用冷白、纯白、亮蓝和蓝灰，不使用奶油色、米黄色、渐变或重阴影。

## 结构

- `src/components/navigation/TopNavigation.tsx`：唯一顶栏实现；所有业务页常驻同一组模块入口，SKU 路由仅切换品牌、尺寸和搜索语义到 Parts Ledger 模式。
- `src/components/navigation/top-navigation.css`：单层顶栏、路由选中态、搜索、账号菜单和窄屏菜单。
- `src/components/layout/AppLayout.tsx`：组合顶栏与当前路由内容，不再生成旧模块分组或二级导航。
- `src/theme.css`：跨模块色板和基础控件令牌。

旧的 `src/config/navigation.ts` 和导航分组类型已经删除，禁止重新引入双层导航壳。

## 路由与入口

普通顶栏直接提供以下业务入口：

- 车辆工作台：`/customers`；进入具体客户后使用 `/customers/:id/garage`。
- 客户：`/customers`。
- SKU 商品：`/skus`。
- 报价模板：`/quotes/templates`。
- 车辆资料：`/vehicles`。
- 字典资料：`/sku-foundation`。

设置图标进入商品基础字典；管理员可从账号菜单进入账号管理。权限仍由服务端校验，顶栏入口不是安全边界。

## 尺寸与视觉

- 普通业务顶栏在 1920 × 1080 下高 76px，对齐客户车辆工作台参考图；路由以浅蓝底和底部 2px 蓝线表示当前状态。
- 普通业务顶栏的品牌区使用“上海驰骋汽配 / Visual Garage Workbench”两行文字，不显示额外方形图标；模块导航在 1920px 视口从约 323px 处开始，只由路由语义决定单一选中项，客户车辆工作台不会同时高亮“客户”。
- `/skus` 使用高 62px 的 Parts Ledger 专属视觉；品牌标题与业务说明上下排列，保留全局 SKU 搜索、日期、设置和账号入口，同时继续显示车辆工作台、客户、SKU 商品、报价模板、车辆资料和字典资料六个模块入口。
- Parts Ledger 顶栏和工作区使用 `Segoe UI Variable Text / Helvetica Neue / Segoe UI / PingFang SC / Microsoft YaHei UI` 回退链；品牌字标 700，表格主信息与件号 500，正文 400，避免 Windows 微软雅黑粗体合成造成发黑、发硬。
- Parts Ledger 左栏分组标题使用 13px/700 深蓝黑；选中项使用 32px 高、`#dfeaff` 浅蓝底、13px/600 蓝色文字和 Tabler 实心配件箱图标。不要用灰色小标题、线框星标或过浅选中底替代。
- 客户车辆工作台采用约 412px / 弹性主区 / 492px 三栏；左栏直接展示“车主信息 + 车辆”的车辆卡片，中栏展示车型、配件系统和适配 SKU，右栏固定询价/报价上下文。
- SKU 台账采用约 248px / 弹性主表 / 374px 三栏，底部批量操作条贴合主表分页栏上方。
- 所有图标使用 Tabler Icons；车型与配件图片使用项目内资产，不把参考图当页面背景。

## 搜索、账号和窄屏

- 普通顶栏搜索当前业务入口；Parts Ledger 顶栏搜索会把关键词带入 SKU 台账服务端查询。
- 账号菜单显示账号和角色，管理员可进入账号管理，退出操作复用服务端会话注销。
- 1080px 以下全站模块导航统一收进菜单；SKU 台账保持独立工作区并在必要时横向容纳主表。
- 所有入口、搜索框、菜单和按钮保留语义、键盘操作与焦点状态。

## 扩展边界

新增一级业务入口直接加入 `TopNavigation.tsx` 的 `navigationItems`，同步更新路由与架构文档。首页和业务页面只能展示真实接口数据或明确空状态，不能用虚构指标填充视觉。视觉检查记录见仓库根目录 `design-qa.md`。
