const maxRows = 500
const maxFileBytes = 2 * 1024 * 1024

export const catalogImportFields = [
  { key: 'nameZh', label: '中文名称', required: 'one_of_name', description: '零件的常用中文名称，与英文名称至少填写一项。', example: '前刹车片' },
  { key: 'nameEn', label: '英文名称', required: 'one_of_name', description: '原厂目录或品牌资料中的英文名称。', example: 'Brake pad set, front' },
  { key: 'brand', label: '品牌', recommended: true, description: '原厂、配套厂或售后品牌名称。', example: 'Porsche OE' },
  { key: 'category', label: '分类', recommended: true, description: '按“总成 / 零件类型”填写，方便后续归类。', example: '制动系统 / 制动片' },
  { key: 'unit', label: '单位', description: '库存与报价使用的计量单位，留空时按“件”处理。', example: '件' },
  { key: 'primaryOe', label: '主 OE', required: true, description: '用于识别与去重的主零件编号，保留原始分隔格式。', example: '95B 698 151 H' },
  { key: 'vehicle', label: '车型', recommended: true, description: '适配车系与平台代号，避免只写品牌。', example: 'Macan (95B)' },
  { key: 'years', label: '年款范围', recommended: true, description: '适配年款或生产区间，无法确认时可留空待审核。', example: '2014-2018' },
  { key: 'condition', label: '适配条件', recommended: true, description: '车轴、底盘号、PR 码、排除项等限制条件。', example: '前轴且排除 PSCB' },
  { key: 'sourceSystem', label: '来源系统', recommended: true, description: '产生该条资料的 EPC、品牌目录或供应商文件。', example: 'Porsche PET' },
  { key: 'sourceRecordId', label: '来源记录ID', recommended: true, description: '原系统记录、图号或可回溯的行标识。', example: '698-05-12' },
]

export const catalogImportTemplateSpec = {
  schemaVersion: 'catalog-import-template-v1',
  maxRows,
  maxFileBytes,
  acceptedExtensions: ['.csv'],
  fields: catalogImportFields,
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function catalogImportTemplateCsv() {
  const headers = catalogImportFields.map((field) => field.label)
  const example = catalogImportFields.map((field) => field.example || '')
  return `\uFEFF${headers.map(csvCell).join(',')}\n${example.map(csvCell).join(',')}\n`
}

export function buildImportPreflightReport(rows = [], totals = {}) {
  if (!rows.length) return null
  const issueMap = new Map()
  for (const row of rows) for (const issue of row.issues || []) {
    const current = issueMap.get(issue.code) || { code: issue.code, severity: issue.severity, message: issue.message, count: 0 }
    current.count += 1
    issueMap.set(issue.code, current)
  }
  const issueSummary = [...issueMap.values()].sort((left, right) => {
    const severity = { error: 0, warning: 1 }
    return (severity[left.severity] ?? 2) - (severity[right.severity] ?? 2) || right.count - left.count || left.code.localeCompare(right.code)
  })
  const coverageDefinitions = [
    ['brand', '品牌', (row) => row.normalized_payload?.identity?.brandLabel],
    ['category', '分类', (row) => row.normalized_payload?.identity?.categoryLabel],
    ['fitment', '适配车型', (row) => row.normalized_payload?.fitments?.length],
    ['sourceSystem', '来源系统', (row) => row.normalized_payload?.evidence?.[0]?.sourceSystem && row.normalized_payload.evidence[0].sourceSystem !== '批量导入'],
    ['sourceRecordId', '来源记录', (row) => row.normalized_payload?.evidence?.[0]?.sourceRecordId],
  ]
  const coverage = coverageDefinitions.map(([field, label, check]) => {
    const present = rows.filter(check).length
    return { field, label, present, total: rows.length, percent: Math.round((present / rows.length) * 100) }
  })
  const invalidRows = Number(totals.invalidRows ?? rows.filter((row) => row.state === 'invalid').length)
  const duplicateRows = Number(totals.duplicateRows ?? rows.filter((row) => row.state === 'duplicate').length)
  const readyRows = Number(totals.readyRows ?? rows.filter((row) => row.state === 'ready').length)
  const warningCount = issueSummary.filter((item) => item.severity === 'warning').reduce((sum, item) => sum + item.count, 0)
  const decision = invalidRows ? 'blocked' : duplicateRows ? 'review_required' : warningCount ? 'ready_with_warnings' : 'ready'
  return {
    schemaVersion: 'catalog-import-preflight-v1',
    decision,
    defaultSelectedRows: readyRows,
    selectableRows: readyRows + duplicateRows,
    blockingRows: invalidRows,
    warningCount,
    duplicateMatches: rows.reduce((sum, row) => sum + (row.duplicate_matches || []).length, 0),
    issueSummary,
    coverage,
  }
}
