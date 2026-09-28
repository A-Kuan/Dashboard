export const defaultDictionaries = {
  version: 1,
  dictionaries: {
    sku_brand: {
      label: '品牌',
      items: [
        { value: '__all__', label: '全部', sort: 0, enabled: true },
        { value: 'Porsche', label: 'Porsche', sort: 10, enabled: true },
        { value: 'BMW', label: 'BMW', sort: 20, enabled: true },
        { value: 'Mercedes', label: 'Mercedes', sort: 30, enabled: true },
      ],
    },
    part_category: {
      label: '零件大类',
      items: [
        { value: '__all__', label: '全部', sort: 0, enabled: true },
        { value: '车身及内饰', label: '车身及内饰', sort: 10, enabled: true },
        { value: '制动系统', label: '制动系统', sort: 20, enabled: true },
        { value: '底盘系统', label: '底盘系统', sort: 30, enabled: true },
        { value: '转向系统', label: '转向系统', sort: 40, enabled: true },
        { value: '发动机系统', label: '发动机系统', sort: 50, enabled: true },
      ],
    },
    unit: {
      label: '计量单位',
      items: [
        { value: '件', label: '件', sort: 0, enabled: true },
        { value: '套', label: '套', sort: 10, enabled: true },
        { value: '盒', label: '盒', sort: 20, enabled: true },
        { value: '支', label: '支', sort: 30, enabled: true },
      ],
    },
    sku_status: {
      label: '状态',
      items: [
        { value: '__all__', label: '全部', sort: 0, enabled: true },
        { value: '草稿', label: '草稿', sort: 10, enabled: true },
        { value: '待复核', label: '待复核', sort: 20, enabled: true },
        { value: '在售', label: '在售', sort: 30, enabled: true },
        { value: '停产', label: '停产', sort: 40, enabled: true },
      ],
    },
  },
}
