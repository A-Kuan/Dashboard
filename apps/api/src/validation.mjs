const allowedStatuses = new Set(['草稿', '在售', '停产', '待复核'])
const latinCodePattern = /^[A-Za-z0-9][A-Za-z0-9 ._/#()+-]*$/

function clean(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

export function normalizeSkuInput(input = {}) {
  const sku = {
    skuCode: clean(input.skuCode),
    chineseName: clean(input.chineseName),
    brand: clean(input.brand),
    category: clean(input.category),
    subcategory: clean(input.subcategory),
    manufacturerPartNumber: clean(input.manufacturerPartNumber),
    primaryOe: clean(input.primaryOe),
    unit: clean(input.unit, '件'),
    lifecycleStatus: allowedStatuses.has(input.lifecycleStatus) ? input.lifecycleStatus : '草稿',
    barcode: clean(input.barcode),
    imageUrl: clean(input.imageUrl),
    dataSource: clean(input.dataSource),
    sourceEvidence: input.sourceEvidence && typeof input.sourceEvidence === 'object' ? input.sourceEvidence : null,
    conflictResolution: input.conflictResolution && typeof input.conflictResolution === 'object' ? input.conflictResolution : null,
    oeRelations: Array.isArray(input.oeRelations) ? input.oeRelations.map((row, index) => ({
      type: clean(row.type, '替代号'),
      oeNumber: clean(row.oeNumber || row.oe),
      brand: clean(row.brand),
      relation: clean(row.relation),
      source: clean(row.source),
      confidence: clean(row.confidence, '待核验'),
      sortOrder: index,
    })).filter((row) => row.oeNumber) : [],
    fitments: Array.isArray(input.fitments) ? input.fitments.map((row, index) => ({
      vehicle: clean(row.vehicle),
      years: clean(row.years),
      engine: clean(row.engine),
      body: clean(row.body),
      condition: clean(row.condition),
      source: clean(row.source),
      verificationStatus: clean(row.verificationStatus, '待验证'),
      sortOrder: index,
    })).filter((row) => row.vehicle) : [],
  }

  const required = [
    ['skuCode', 'SKU 编码'], ['chineseName', '中文名称'], ['brand', '品牌'],
    ['category', '零件大类'], ['subcategory', '零件小类'],
    ['manufacturerPartNumber', '制造商零件号'], ['primaryOe', '主 OE 号'],
  ]
  const missing = required.filter(([key]) => !sku[key]).map(([, label]) => label)
  if (missing.length) {
    const error = new Error(`缺少必填字段：${missing.join('、')}`)
    error.statusCode = 400
    throw error
  }
  const invalidCodes = [
    ['skuCode', 'SKU 编码'],
    ['manufacturerPartNumber', '制造商零件号'],
    ['primaryOe', '主 OE 号'],
  ].filter(([key]) => !latinCodePattern.test(sku[key])).map(([, label]) => label)
  if (invalidCodes.length) {
    const error = new Error(`${invalidCodes.join('、')}仅支持英文字母、数字、空格及常用零件号符号`)
    error.statusCode = 400
    throw error
  }
  return sku
}
