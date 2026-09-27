# 可配置字典

SKU 管理页面的品牌、零件大类和 SKU 状态统一使用共享字典，不在页面组件中硬编码选项。

## 当前字典

| 字典编码 | 用途 |
| --- | --- |
| `sku_brand` | 品牌筛选与品牌选择 |
| `part_category` | 零件大类筛选与分类选择 |
| `sku_status` | SKU 状态筛选与状态选择 |

开发和静态预览默认读取 `apps/web/public/config/dictionaries.json`。每个字典项包含：

- `value`：提交给接口、用于数据筛选的稳定值；表示“不限”的通用选项固定使用 `__all__`，展示文案仍由 `label` 配置。
- `label`：界面展示名称。
- `sort`：升序排列值。
- `enabled`：设为 `false` 后不在下拉框中展示。

## 对接字典服务

生产环境可设置 `VITE_DICTIONARY_ENDPOINT`，让前端优先读取后端字典接口；接口不可用或响应格式错误时，会回退到随版本发布的本地 JSON：

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

字典加载、有效项过滤和排序由 `src/services/dictionaryService.js` 统一处理；界面使用 `DictionarySelect` 公共组件。新增选择项时应优先复用字典编码，不应在业务页面新增选项数组。
