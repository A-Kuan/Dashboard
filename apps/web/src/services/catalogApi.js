const apiBase = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '')
const operatorRoleKey = 'hushanxing.catalog.role'

export function getStoredCatalogRole() {
  return window.localStorage.getItem(operatorRoleKey) || 'catalog_admin'
}

export function setStoredCatalogRole(role) {
  window.localStorage.setItem(operatorRoleKey, role)
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-operator-name': 'hushanxing-workbench', 'x-operator-role': getStoredCatalogRole(), ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.message || `请求失败（${response.status}）`)
    error.code = body.error
    error.details = body.details
    error.status = response.status
    throw error
  }
  return body
}

export function getCatalogSession() {
  return request('/api/v2/catalog/session')
}

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function statusLabel(status) {
  return { verified: '已核验', review: '待核验', draft: '草稿', discontinued: '已停用' }[status] || status
}

function confidenceLabel(value) {
  return { verified: '高', high: '高', medium: '中', low: '低', pending: '待核验' }[value] || '待核验'
}

export function mapCatalogSku(item) {
  const identity = item.identity || {}
  const evidence = item.evidence?.[0] || {}
  const primary = item.identifiers?.find((identifier) => identifier.isPrimary)
  return {
    id: item.id,
    code: identity.skuCode || '保存后自动生成',
    name: identity.nameZh || '未命名零件',
    englishName: identity.nameEn || '',
    primaryOe: primary?.rawValue || item.primaryIdentifier || '—',
    brand: identity.brandLabel || identity.brandCode || '待补充',
    category: identity.categoryLabel || identity.categoryCode || '待补充',
    unit: identity.unitLabel || '件',
    status: item.lifecycleStatus || 'draft',
    statusLabel: statusLabel(item.lifecycleStatus || 'draft'),
    fitmentCount: item.fitmentCount ?? item.fitments?.length ?? 0,
    completeness: item.completenessScore ?? 0,
    source: item.sourceSystem || evidence.sourceSystem || '手工录入',
    updated: displayTime(item.updatedAt),
    identifiers: (item.identifiers || []).map((identifier) => ({
      id: identifier.id, type: identifier.isPrimary ? '主 OE' : identifier.type || '其他编号', value: identifier.rawValue, relation: identifier.isPrimary ? '当前号' : '参考编号', isPrimary: identifier.isPrimary,
    })),
    fitments: (item.fitments || []).map((fitment) => ({
      id: fitment.id, vehicle: fitment.vehicleLabel, years: fitment.years, condition: fitment.includeConditions?.note || fitment.position || '适配条件待补充',
    })),
    evidence: {
      system: evidence.sourceSystem || '手工录入', catalog: evidence.catalogPath || '—', figure: evidence.figurePosition || '—',
      originalName: evidence.originalName || '—', syncedAt: displayTime(evidence.capturedAt), confidence: confidenceLabel(evidence.confidence),
      sourceType: evidence.sourceType || 'manual', sourceRecordId: evidence.sourceRecordId || '', vin: evidence.vinContext || '—', rawPayload: evidence.rawPayload || {},
    },
    inventory: { available: '—', locked: '—', inbound: '—' },
    price: { oemReference: '—', purchase: '—', sale: '—' },
    changes: item.changes || [],
    reviewEvents: item.reviewEvents || [],
    reviewAssignee: item.reviewAssignee || '',
    reviewNote: item.reviewNote || '',
    reviewSubmittedAt: item.reviewSubmittedAt || '',
    reviewDueAt: item.reviewDueAt || '',
    discontinuedReason: item.discontinuedReason || '',
    qualityIssues: item.qualityIssues || [],
    version: item.version,
    dataOrigin: 'live',
    aggregate: item,
  }
}

export async function listCatalogSkus({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (query.trim()) params.set('q', query.trim())
  if (status && status !== 'all') params.set('status', status)
  const result = await request(`/api/v2/catalog/skus?${params}`)
  return { ...result, records: result.items.map((item) => ({ ...mapCatalogSku(item), aggregate: null })) }
}

export async function getCatalogSku(id) {
  return mapCatalogSku(await request(`/api/v2/catalog/skus/${encodeURIComponent(id)}`))
}

export async function restoreCatalogSkuVersion(record, sourceVersion, reason) {
  return mapCatalogSku(await request(`/api/v2/catalog/skus/${encodeURIComponent(record.id)}/restore`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: record.version, sourceVersion, reason }),
  }))
}

export async function listCatalogQuality({ issue = '', status = '', assignee = '', page = 1, pageSize = 30 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (issue) params.set('issue', issue)
  if (status) params.set('status', status)
  if (assignee) params.set('assignee', assignee)
  const result = await request(`/api/v2/catalog/quality?${params}`)
  return { ...result, records: result.items.map((item) => ({ ...mapCatalogSku(item), aggregate: null })) }
}

export async function transitionCatalogSku(record, action, { note = '', assignee = '', dueAt = '' } = {}) {
  const result = await request(`/api/v2/catalog/skus/${record.id}/transition`, {
    method: 'POST', body: JSON.stringify({ action, expectedVersion: record.version, note, assignee, dueAt: dueAt || null }),
  })
  return mapCatalogSku(result)
}

export function bulkTransitionCatalogSkus(records, action, { note = '', assignee = '', dueAt = '' } = {}) {
  return request('/api/v2/catalog/skus/bulk-transition', {
    method: 'POST', body: JSON.stringify({
      action, note, assignee, dueAt: dueAt || null,
      items: records.map((record) => ({ id: record.id, expectedVersion: record.version })),
    }),
  })
}

export async function findDuplicateIdentifiers(identifier, exceptId = '') {
  const params = new URLSearchParams({ identifier })
  if (exceptId) params.set('exceptId', exceptId)
  return (await request(`/api/v2/catalog/duplicates?${params}`)).items
}

export async function getCatalogDictionaries() {
  return (await request('/api/v1/dictionaries')).dictionaries || {}
}

const importHeaderAliases = {
  nameZh: ['nameZh', '中文名称', '零件名称'], nameEn: ['nameEn', '英文名称'], brand: ['brand', '品牌'],
  category: ['category', '分类', '零件分类'], unit: ['unit', '单位', '计量单位'], primaryOe: ['primaryOe', '主OE', '主 OE'],
  vehicle: ['vehicle', '车型', '适配车型'], years: ['years', '年款', '年款范围'], condition: ['condition', '适配条件'],
  sourceSystem: ['sourceSystem', '来源系统'], sourceRecordId: ['sourceRecordId', '来源记录', '来源记录ID'],
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1 } else if (character === '"') quoted = false
      else value += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(value); value = '' }
    else if (character === '\n') { row.push(value); rows.push(row); row = []; value = '' }
    else if (character !== '\r') value += character
  }
  row.push(value)
  if (row.some((cell) => cell.length) || rows.length === 0) rows.push(row)
  return rows
}

export function parseCatalogCsv(text) {
  const parsed = parseCsvRows(String(text || ''))
  if (parsed.length < 2) throw new Error('CSV 至少需要表头和一行数据')
  const headers = parsed[0].map((header) => String(header).replace(/^\uFEFF/, '').trim())
  const columnMap = Object.fromEntries(Object.entries(importHeaderAliases).map(([field, aliases]) => [field, headers.findIndex((header) => aliases.includes(header))]))
  if (columnMap.nameZh < 0 && columnMap.nameEn < 0) throw new Error('CSV 缺少“中文名称”或 nameZh 列')
  if (columnMap.primaryOe < 0) throw new Error('CSV 缺少“主 OE”或 primaryOe 列')
  return parsed.slice(1).filter((row) => row.some((cell) => String(cell).trim())).map((row) => Object.fromEntries(
    Object.entries(columnMap).map(([field, index]) => [field, index >= 0 ? String(row[index] || '').trim() : '']),
  ))
}

export function getCatalogImportTemplate() {
  return request('/api/v2/catalog/import-template')
}

export async function downloadCatalogImportTemplate() {
  const response = await fetch(`${apiBase}/api/v2/catalog/import-template?format=csv`, {
    headers: { 'x-operator-name': 'hushanxing-workbench', 'x-operator-role': getStoredCatalogRole() },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `模板下载失败（${response.status}）`)
  }
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'hushanxing-sku-import-template.csv'
  const url = window.URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  return { filename }
}

export function previewCatalogImport(sourceName, rows) {
  return request('/api/v2/catalog/imports', { method: 'POST', body: JSON.stringify({ sourceName, rows }) })
}

export function commitCatalogImport(jobId, expectedVersion, rowIds) {
  return request(`/api/v2/catalog/imports/${jobId}/commit`, { method: 'POST', body: JSON.stringify({ expectedVersion, rowIds }) })
}

export function listCatalogImports({ state = '', page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (state) params.set('state', state)
  return request(`/api/v2/catalog/imports?${params}`)
}

export function getCatalogImport(jobId) {
  return request(`/api/v2/catalog/imports/${jobId}`)
}

export function retryCatalogImport(jobId, expectedVersion, rowIds = []) {
  return request(`/api/v2/catalog/imports/${jobId}/retry`, { method: 'POST', body: JSON.stringify({ expectedVersion, rowIds }) })
}

export function getCatalogMetrics(days = 30) {
  return request(`/api/v2/catalog/metrics?days=${encodeURIComponent(days)}`)
}

export async function downloadCatalogExport(format = 'json', status = '') {
  const params = new URLSearchParams({ format })
  if (status && status !== 'all') params.set('status', status)
  const response = await fetch(`${apiBase}/api/v2/catalog/export?${params}`, {
    headers: { 'x-operator-name': 'hushanxing-workbench', 'x-operator-role': getStoredCatalogRole() },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `导出失败（${response.status}）`)
  }
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `hushanxing-sku.${format}`
  const url = window.URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  return { filename }
}

export function listCatalogConflicts() {
  return request('/api/v2/catalog/conflicts')
}

export function resolveCatalogConflict(conflict, resolutionType, note) {
  return request('/api/v2/catalog/conflicts/resolve', {
    method: 'POST', body: JSON.stringify({
      normalizedValue: conflict.normalizedValue,
      skuIdA: conflict.left.id, skuIdB: conflict.right.id,
      expectedVersionA: conflict.left.version, expectedVersionB: conflict.right.version,
      resolutionType, note,
    }),
  })
}

function catalogMergePayload(conflict, survivorSkuId) {
  const survivor = conflict.left.id === survivorSkuId ? conflict.left : conflict.right
  const retired = conflict.left.id === survivorSkuId ? conflict.right : conflict.left
  return {
    normalizedValue: conflict.normalizedValue,
    survivorSkuId: survivor.id,
    retiredSkuId: retired.id,
    survivorExpectedVersion: survivor.version,
    retiredExpectedVersion: retired.version,
  }
}

export function previewCatalogMerge(conflict, survivorSkuId) {
  return request('/api/v2/catalog/conflicts/merge-preview', {
    method: 'POST', body: JSON.stringify(catalogMergePayload(conflict, survivorSkuId)),
  })
}

export function mergeCatalogSkus(conflict, survivorSkuId, reason) {
  return request('/api/v2/catalog/conflicts/merge', {
    method: 'POST', body: JSON.stringify({ ...catalogMergePayload(conflict, survivorSkuId), reason }),
  })
}

const sourceTypeMap = { epc: 'vin_epc', oe: 'oe_lookup', import: 'import', manual: 'manual' }

export function draftToCatalogPayload(draft, source) {
  const hasEvidence = draft.evidence.sourceSystem && draft.evidence.sourceSystem !== '手工录入'
  const evidence = hasEvidence ? [{
    clientKey: 'source-0', sourceType: draft.evidence.sourceType || sourceTypeMap[source] || 'manual', sourceSystem: draft.evidence.sourceSystem,
    sourceRecordId: draft.evidence.sourceRecordId || '', catalogPath: draft.evidence.catalog === '—' ? '' : draft.evidence.catalog,
    figurePosition: draft.evidence.position || draft.evidence.figure || '', originalName: draft.evidence.originalName === '—' ? '' : draft.evidence.originalName,
    vinContext: draft.evidence.vin === '—' ? '' : draft.evidence.vin, rawPayload: draft.evidence.rawPayload || {}, confidence: 'pending',
  }] : []
  const identifiers = []
  if (draft.primaryOe.trim()) identifiers.push({ clientKey: 'identifier-primary', type: 'oe', rawValue: draft.primaryOe, isPrimary: true, evidenceKey: hasEvidence ? 'source-0' : '' })
  draft.identifiers.filter((item) => item.value.trim()).forEach((item, index) => identifiers.push({
    clientKey: `identifier-${index}`, type: item.type === '条形码' ? 'barcode' : item.type === '内部号' ? 'internal' : 'oe', rawValue: item.value,
    isPrimary: false, evidenceKey: hasEvidence ? 'source-0' : '', verificationStatus: 'pending',
  }))
  return {
    identity: {
      skuCode: draft.code && draft.code !== '保存后自动生成' ? draft.code : '', nameZh: draft.name, nameEn: draft.englishName,
      brandCode: draft.brand, brandLabel: draft.brand, categoryCode: draft.category, categoryLabel: draft.category,
      unitCode: draft.unit === '件' ? 'piece' : draft.unit, unitLabel: draft.unit,
    },
    evidence,
    identifiers,
    fitments: draft.fitments.filter((item) => item.vehicle.trim()).map((item) => ({
      vehicleLabel: item.vehicle, years: item.years, includeConditions: item.condition ? { note: item.condition } : {},
      evidenceKey: hasEvidence ? 'source-0' : '', verificationStatus: 'pending',
    })),
    interchanges: [],
  }
}

export async function saveCatalogDraft(draft, source, existingRecord) {
  const payload = draftToCatalogPayload(draft, source)
  const aggregate = existingRecord?.aggregate
  const result = aggregate
    ? await request(`/api/v2/catalog/skus/${aggregate.id}`, { method: 'PATCH', body: JSON.stringify({ ...payload, expectedVersion: aggregate.version }) })
    : await request('/api/v2/catalog/skus', { method: 'POST', body: JSON.stringify(payload) })
  return mapCatalogSku(result)
}

export async function submitCatalogReview(record) {
  return transitionCatalogSku(record, 'submit_review', { assignee: '资料审核员' })
}
