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
    data_source: {
      label: '数据来源',
      items: [
        { value: '人工录入', label: '人工录入', sort: 0, enabled: true },
        { value: 'EPC 导入', label: 'EPC 导入', sort: 10, enabled: true },
        { value: '供应商资料', label: '供应商资料', sort: 20, enabled: true },
        { value: '历史系统', label: '历史系统', sort: 30, enabled: true },
      ],
    },
    oe_type: {
      label: 'OE 类型',
      items: [
        { value: '主 OE', label: '主 OE', sort: 0, enabled: true },
        { value: '替代号', label: '替代号', sort: 10, enabled: true },
        { value: '历史号', label: '历史号', sort: 20, enabled: true },
        { value: '参考号', label: '参考号', sort: 30, enabled: true },
      ],
    },
    oe_relation: {
      label: 'OE 替代关系',
      items: [
        { value: '直接替代', label: '直接替代', sort: 0, enabled: true },
        { value: '向前替代', label: '向前替代', sort: 10, enabled: true },
        { value: '向后替代', label: '向后替代', sort: 20, enabled: true },
        { value: '可互换', label: '可互换', sort: 30, enabled: true },
      ],
    },
    confidence_level: {
      label: '可信度',
      items: [
        { value: '待核验', label: '待核验', sort: 0, enabled: true },
        { value: '高', label: '高', sort: 10, enabled: true },
        { value: '中', label: '中', sort: 20, enabled: true },
        { value: '低', label: '低', sort: 30, enabled: true },
      ],
    },
    body_type: {
      label: '车身形式',
      items: [
        { value: 'SUV', label: 'SUV', sort: 0, enabled: true },
        { value: 'Sedan', label: '轿车', sort: 10, enabled: true },
        { value: 'Coupe', label: '轿跑 / Coupe', sort: 20, enabled: true },
        { value: 'Hatchback', label: '掀背车', sort: 30, enabled: true },
        { value: 'Wagon', label: '旅行车', sort: 40, enabled: true },
        { value: 'MPV', label: 'MPV', sort: 50, enabled: true },
        { value: 'Pickup', label: '皮卡', sort: 60, enabled: true },
        { value: 'Van', label: '厢式车', sort: 70, enabled: true },
      ],
    },
    verification_status: {
      label: '验证状态',
      items: [
        { value: '待验证', label: '待验证', sort: 0, enabled: true },
        { value: '已验证', label: '已验证', sort: 10, enabled: true },
        { value: '存疑', label: '存疑', sort: 20, enabled: true },
        { value: '不适用', label: '不适用', sort: 30, enabled: true },
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
