# 可配置字典

SKU 管理页面的品牌、零件大类和 SKU 状态统一使用共享字典，不在页面组件中硬编码选项。

## 当前字典

| 字典编码 | 用途 |
| --- | --- |
| `sku_brand` | 品牌筛选与品牌选择 |
| `part_category` | 零件大类筛选与分类选择 |
| `sku_status` | SKU 状态筛选；生命周期状态由系统流程维护，不允许在编辑器直接修改 |

生产和本地开发默认读取 `/api/v1/dictionaries`，仅当接口不可用时回退到 `apps/web/public/config/dictionaries.json`。每个字典项包含：

- `value`：系统生成并提交给接口、用于数据筛选的稳定编码；创建后不可编辑。表示“不限”的通用选项固定使用 `__all__`，展示文案仍由 `label` 配置。
- `label`：界面展示名称。
- `sort`：升序排列值。
- `enabled`：设为 `false` 后不在下拉框中展示。

## 页面配置入口

在 SKU 管理页点击“新建 SKU”右侧的更多按钮，然后选择“字典管理”，系统会进入独立的 `/dictionaries` 模块。该模块支持：

- 新增和删除选项；新增时自动生成唯一系统编码。
- 修改显示名称；系统编码只读，已有编码保持不变。
- 启用或停用选项。
- 调整显示顺序。
- 恢复随版本发布的系统默认值。

字典修改保存在 PostgreSQL `app_configuration` 表中，不再使用浏览器 `localStorage`。不同浏览器和设备读取同一份服务端配置，每次保存递增配置版本。

前端为新选项生成带字典前缀的唯一编码，例如 `SKU_BRAND_...`，服务端校验编码非空且在字典内唯一。创建后编码不可在界面修改。

页面筛选统一使用可搜索的 `DictionarySelect`，支持当前项高亮、无结果提示、点击外部关闭和 `Esc` 关闭。

在 1920 × 1080 桌面环境中，应用会按 1680 × 945 基准等比例放大，使字号、控件高度和间距同步提升，避免仅放大文字造成表格与弹层错位。

## 字典服务

默认使用同源接口；如需切换独立字典服务，可设置 `VITE_DICTIONARY_ENDPOINT`：

```bash
VITE_DICTIONARY_ENDPOINT=https://api.example.com/api/v1/dictionaries npm run build
```

接口响应应保持以下结构：

```json
{
  "version": 1,
  "dictionaries": {
    "sku_brand": {
      "label": "品牌",
      "items": [
        { "value": "Porsche", "label": "Porsche", "sort": 10, "enabled": true }
      ]
    }
  }
}
```

字典加载、校验和排序由 `src/services/dictionaryService.js` 统一处理；界面使用 `DictionarySelect` 公共组件。新增选择项时应优先复用字典编码，不应在业务页面新增选项数组。

写入接口：

- `PUT /api/v1/dictionaries`：保存整套字典并递增版本。
- `POST /api/v1/dictionaries/reset`：恢复系统默认字典。
