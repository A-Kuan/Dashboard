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
      id: fitment.id, vehicle: fitment.vehicleLabel, platformId: fitment.vehiclePlatformId || '', variantMasterId: fitment.variantMasterId || '',
      variantCode: fitment.variantCode || '', variantLabel: fitment.variantLabel || '', years: fitment.years,
      yearFrom: fitment.yearFrom, yearTo: fitment.yearTo, engineCodes: fitment.engineCodes || [], transmissionCodes: fitment.transmissionCodes || [], marketCodes: fitment.marketCodes || [],
      prCodes: fitment.prCodes || [], bodyStyles: fitment.bodyStyles || [], driveTypes: fitment.driveTypes || [], position: fitment.position || '',
      condition: fitment.includeConditions?.note || '', exclusion: fitment.excludeConditions?.note || '',
      includeRules: fitment.includeConditions?.rules || [], excludeRules: fitment.excludeConditions?.rules || [],
      evidenceId: fitment.evidenceId || '', verificationStatus: fitment.verificationStatus || 'pending',
      reviewNote: fitment.reviewNote || '', reviewedBy: fitment.reviewedBy || '', reviewedAt: fitment.reviewedAt || '',
      reviewVersion: fitment.reviewVersion || 1,
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

export function listCatalogFitmentReview({ state = 'pending', query = '', page = 1, pageSize = 100 } = {}) {
  const params = new URLSearchParams({ state, page: String(page), pageSize: String(pageSize) })
  if (query.trim()) params.set('q', query.trim())
  return request(`/api/v2/catalog/fitments/review?${params}`)
}

export function reviewCatalogFitment(item, decision, note) {
  return request(`/api/v2/catalog/fitments/${encodeURIComponent(item.id)}/review`, {
    method: 'POST', body: JSON.stringify({
      expectedSkuVersion: item.skuVersion, expectedReviewVersion: item.fitment.reviewVersion, decision, note,
    }),
  })
}

export function listCatalogVehiclePlatforms({ query = '', status = '' } = {}) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  if (status) params.set('status', status)
  return request(`/api/v2/catalog/vehicle-platforms?${params}`)
}

export function getCatalogVehiclePlatform(id) {
  return request(`/api/v2/catalog/vehicle-platforms/${encodeURIComponent(id)}`)
}

export function createCatalogEpcPreview(input) {
  return request('/api/v2/catalog/epc-previews', { method: 'POST', body: JSON.stringify(input) })
}

export function listCatalogEpcConnectors() {
  return request('/api/v2/catalog/epc-connectors')
}

export function collectCatalogEpcConnector(id, input) {
  return request(`/api/v2/catalog/epc-connectors/${encodeURIComponent(id)}/collect`, { method: 'POST', body: JSON.stringify(input) })
}

export function listCatalogEpcPreviews({ state = '', page = 1, pageSize = 50 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (state) params.set('state', state)
  return request(`/api/v2/catalog/epc-previews?${params}`)
}

export function getCatalogEpcPreview(id) {
  return request(`/api/v2/catalog/epc-previews/${encodeURIComponent(id)}`)
}

export function commitCatalogEpcPreview(preview, decisions) {
  return request(`/api/v2/catalog/epc-previews/${encodeURIComponent(preview.id)}/commit`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: preview.version, decisions }),
  })
}

export function saveCatalogVehiclePlatform(platform) {
  const path = platform.id ? `/api/v2/catalog/vehicle-platforms/${encodeURIComponent(platform.id)}` : '/api/v2/catalog/vehicle-platforms'
  return request(path, { method: platform.id ? 'PATCH' : 'POST', body: JSON.stringify(platform) })
}

export function listCatalogVehicleVariants({ platformId = '', query = '', status = '' } = {}) {
  const params = new URLSearchParams()
  if (platformId) params.set('platformId', platformId)
  if (query.trim()) params.set('q', query.trim())
  if (status) params.set('status', status)
  return request(`/api/v2/catalog/vehicle-variants?${params}`)
}

export function getCatalogVehicleVariant(id) {
  return request(`/api/v2/catalog/vehicle-variants/${encodeURIComponent(id)}`)
}

export function saveCatalogVehicleVariant(variant) {
  const path = variant.id ? `/api/v2/catalog/vehicle-variants/${encodeURIComponent(variant.id)}` : '/api/v2/catalog/vehicle-variants'
  return request(path, { method: variant.id ? 'PATCH' : 'POST', body: JSON.stringify(variant) })
}

export function listCatalogFitmentConflicts({ state = 'open', query = '' } = {}) {
  const params = new URLSearchParams({ state })
  if (query.trim()) params.set('q', query.trim())
  return request(`/api/v2/catalog/fitment-conflicts?${params}`)
}

export function resolveCatalogFitmentConflict(conflict, resolutionType, note) {
  return request('/api/v2/catalog/fitment-conflicts/resolve', {
    method: 'POST', body: JSON.stringify({
      conflictKey: conflict.key, resolutionType, note,
      expectedVersionA: conflict.left.skuVersion,
      expectedVersionB: conflict.right?.skuVersion,
    }),
  })
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

export function getCatalogDictionaryConfig() {
  return request('/api/v1/dictionaries')
}

export const catalogImportFieldDefinitions = [
  { key: 'nameZh', label: '中文名称', required: 'one_of_name', aliases: ['nameZh', '中文名称', '零件名称', '配件名称', '产品名称', '商品名称', '品名', '供应商品名'] },
  { key: 'nameEn', label: '英文名称', required: 'one_of_name', aliases: ['nameEn', '英文名称', '英文品名', 'English Name', 'Part Name'] },
  { key: 'brand', label: '品牌', recommended: true, aliases: ['brand', '品牌', '厂牌', '制造商', '品牌名称'] },
  { key: 'category', label: '分类', recommended: true, aliases: ['category', '分类', '零件分类', '产品分类', '商品分类'] },
  { key: 'unit', label: '单位', aliases: ['unit', '单位', '计量单位'] },
  { key: 'primaryOe', label: '主 OE', required: true, aliases: ['primaryOe', '主OE', '主 OE', 'OE', 'OE号', 'OE 号', 'OE编号', '原厂号', '原厂编号', 'OEM号', 'OEM编号', '零件号', '原厂编码'] },
  { key: 'vehicle', label: '车型', recommended: true, aliases: ['vehicle', '车型', '适配车型', '适用车型', '适用车系', '车系'] },
  { key: 'years', label: '年款范围', recommended: true, aliases: ['years', '年款', '年款范围', '适用年款', '生产年份'] },
  { key: 'condition', label: '适配条件', recommended: true, aliases: ['condition', '适配条件', '安装位置', '限制条件', 'PR码', 'PR 码'] },
  { key: 'sourceSystem', label: '来源系统', recommended: true, aliases: ['sourceSystem', '来源系统', '数据来源', '来源', '供应商来源'] },
  { key: 'sourceRecordId', label: '来源记录ID', recommended: true, aliases: ['sourceRecordId', '来源记录', '来源记录ID', '记录ID', '图号', '行ID'] },
]

function normalizeImportHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-./\\()（）]+/g, '')
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

export function inspectCatalogCsv(text) {
  const parsed = parseCsvRows(String(text || ''))
  if (parsed.length < 2) throw new Error('CSV 至少需要表头和一行数据')
  const headers = parsed[0].map((header) => String(header).replace(/^\uFEFF/, '').trim())
  if (!headers.some(Boolean)) throw new Error('CSV 表头不能为空')
  const dataRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell).trim()))
  if (!dataRows.length) throw new Error('CSV 没有可处理的数据行')
  const counts = new Map()
  const columns = headers.map((label, index) => {
    const displayLabel = label || `未命名列 ${index + 1}`
    const count = (counts.get(displayLabel) || 0) + 1
    counts.set(displayLabel, count)
    const sample = dataRows.map((row) => String(row[index] || '').trim()).find(Boolean) || '—'
    return { index, label: displayLabel, sourceKey: count === 1 ? displayLabel : `${displayLabel} #${count}`, sample }
  })
  const used = new Set()
  const suggestedMapping = Object.fromEntries(catalogImportFieldDefinitions.map((field) => {
    const aliases = new Set(field.aliases.map(normalizeImportHeader))
    const column = columns.find((item) => !used.has(item.index) && aliases.has(normalizeImportHeader(item.label)))
    if (column) used.add(column.index)
    return [field.key, column?.index ?? -1]
  }))
  const canonicalHeaders = new Set(catalogImportFieldDefinitions.map((field) => field.label))
  const requiredReady = (suggestedMapping.nameZh >= 0 || suggestedMapping.nameEn >= 0) && suggestedMapping.primaryOe >= 0
  return {
    headers, columns, dataRows, suggestedMapping,
    isStandardTemplate: requiredReady && headers.every((header) => canonicalHeaders.has(header)),
  }
}

export function mapCatalogCsvInspection(inspection, mapping = inspection?.suggestedMapping || {}) {
  const selected = Object.entries(mapping).filter(([, index]) => Number(index) >= 0)
  const selectedIndexes = selected.map(([, index]) => Number(index))
  if (new Set(selectedIndexes).size !== selectedIndexes.length) throw new Error('同一原始列不能映射到多个 SKU 字段')
  const isMapped = (value) => Number.isInteger(Number(value)) && Number(value) >= 0
  if (!isMapped(mapping.nameZh) && !isMapped(mapping.nameEn)) throw new Error('请映射“中文名称”或“英文名称”')
  if (!isMapped(mapping.primaryOe)) throw new Error('请映射“主 OE”字段')
  return inspection.dataRows.map((row) => {
    const mapped = Object.fromEntries(catalogImportFieldDefinitions.map((field) => {
      const index = Number(mapping[field.key])
      return [field.key, index >= 0 ? String(row[index] || '').trim() : '']
    }))
    mapped._sourceRow = Object.fromEntries(inspection.columns.map((column) => [column.sourceKey, String(row[column.index] || '').trim()]))
    return mapped
  })
}

function normalizeFullWidthText(value) {
  return String(value || '').replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ')
}

function normalizeValueMappingKey(value) {
  return normalizeFullWidthText(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

export function applyCatalogImportRules(rows = [], profile = {}) {
  const defaults = profile.defaultValues || {}
  const rules = profile.transformRules || {}
  return rows.map((row) => {
    const next = { ...row }
    for (const field of catalogImportFieldDefinitions) {
      let value = String(next[field.key] || '')
      if (rules.normalizeFullWidth !== false) value = normalizeFullWidthText(value)
      if (rules.trimText !== false) value = value.trim()
      if (rules.collapseWhitespace !== false) value = value.replace(/\s+/g, ' ')
      if (field.key === 'primaryOe' && rules.uppercaseOe !== false) value = value.toUpperCase()
      if (!value && defaults[field.key]) value = String(defaults[field.key])
      next[field.key] = value
    }
    const mappingIssues = []
    for (const field of ['brand', 'category', 'unit']) {
      const entries = Array.isArray(profile.valueMappings?.[field]) ? profile.valueMappings[field] : []
      const value = String(next[field] || '')
      if (!value || !entries.length) continue
      const key = normalizeValueMappingKey(value)
      const matched = entries.find((entry) => normalizeValueMappingKey(entry.source) === key || normalizeValueMappingKey(entry.target) === key)
      if (matched) next[field] = String(matched.target || '').trim()
      else mappingIssues.push({ field, value })
    }
    next._valueMappingIssues = mappingIssues
    return next
  })
}

export function parseCatalogCsv(text) {
  const inspection = inspectCatalogCsv(text)
  return mapCatalogCsvInspection(inspection, inspection.suggestedMapping)
}

export function getCatalogImportTemplate() {
  return request('/api/v2/catalog/import-template')
}

export function matchCatalogImportMapping(sourceName, columns) {
  return request('/api/v2/catalog/import-mappings/match', {
    method: 'POST', body: JSON.stringify({ sourceName, columns: columns.map(({ sourceKey, label }) => ({ sourceKey, label })) }),
  })
}

export function saveCatalogImportMapping({ profile, name, sourceName, columns, mapping }) {
  return request('/api/v2/catalog/import-mappings', {
    method: 'POST',
    body: JSON.stringify({
      id: profile?.id || undefined,
      expectedVersion: profile?.version || undefined,
      name,
      sourceName,
      columns: columns.map(({ sourceKey, label }) => ({ sourceKey, label })),
      mapping,
    }),
  })
}

export function listCatalogImportMappings({ query = '', active = 'all' } = {}) {
  const params = new URLSearchParams({ active })
  if (query.trim()) params.set('q', query.trim())
  return request(`/api/v2/catalog/import-mappings?${params}`)
}

export function getCatalogImportMapping(profileId) {
  return request(`/api/v2/catalog/import-mappings/${encodeURIComponent(profileId)}`)
}

export function updateCatalogImportMapping(profile, updates) {
  return request(`/api/v2/catalog/import-mappings/${encodeURIComponent(profile.id)}`, {
    method: 'PATCH', body: JSON.stringify({ expectedVersion: profile.version, ...updates }),
  })
}

export function updateCatalogImportMappingRules(profile, { defaultValues, transformRules }) {
  return request(`/api/v2/catalog/import-mappings/${encodeURIComponent(profile.id)}/rules`, {
    method: 'PATCH', body: JSON.stringify({ expectedVersion: profile.version, defaultValues, transformRules }),
  })
}

export function updateCatalogImportValueMappings(profile, valueMappings) {
  return request(`/api/v2/catalog/import-mappings/${encodeURIComponent(profile.id)}/value-mappings`, {
    method: 'PATCH', body: JSON.stringify({ expectedVersion: profile.version, valueMappings }),
  })
}

export function cloneCatalogImportMapping(profileId, name) {
  return request(`/api/v2/catalog/import-mappings/${encodeURIComponent(profileId)}/clone`, {
    method: 'POST', body: JSON.stringify({ name }),
  })
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

export function previewCatalogImport(sourceName, rows, mappingProfile = null) {
  return request('/api/v2/catalog/imports', { method: 'POST', body: JSON.stringify({ sourceName, rows, mappingProfile }) })
}

export function commitCatalogImport(jobId, expectedVersion, rowIds) {
  return request(`/api/v2/catalog/imports/${jobId}/commit`, { method: 'POST', body: JSON.stringify({ expectedVersion, rowIds }) })
}

export function resolveCatalogImportValues(job, dictionaryVersion, resolutions) {
  return request(`/api/v2/catalog/imports/${job.id}/resolve-values`, {
    method: 'POST',
    body: JSON.stringify({
      expectedVersion: job.version,
      expectedProfileVersion: job.mappingSnapshot?.version,
      expectedDictionaryVersion: dictionaryVersion,
      resolutions,
    }),
  })
}

export function listCatalogDictionaryProposals(state = 'pending') {
  const params = new URLSearchParams()
  if (state) params.set('state', state)
  return request(`/api/v2/catalog/dictionary-proposals?${params}`)
}

export function createCatalogDictionaryProposal(input) {
  return request('/api/v2/catalog/dictionary-proposals', { method: 'POST', body: JSON.stringify(input) })
}

export function reviewCatalogDictionaryProposal(proposal, decision, reviewNote) {
  return request(`/api/v2/catalog/dictionary-proposals/${proposal.id}/review`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: proposal.version, decision, reviewNote }),
  })
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

function parsedYears(value) {
  const matches = String(value || '').match(/(19|20)\d{2}/g) || []
  return { yearFrom: matches[0] ? Number(matches[0]) : null, yearTo: matches[1] ? Number(matches[1]) : matches[0] ? Number(matches[0]) : null }
}

function inferredPlatformId(value) {
  return String(value || '').match(/\(([^)]+)\)/)?.[1]?.trim().toUpperCase() || ''
}

function valueList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '').split(/[,，/]/).map((item) => item.trim()).filter(Boolean)
}

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
    fitments: draft.fitments.filter((item) => item.vehicle.trim()).map((item) => {
      const range = parsedYears(item.years)
      return {
        id: item.persistedId || '', vehiclePlatformId: item.platformId || inferredPlatformId(item.vehicle), variantMasterId: item.variantMasterId || '', vehicleLabel: item.vehicle,
        years: item.years, yearFrom: item.yearFrom || range.yearFrom, yearTo: item.yearTo || range.yearTo,
        engineCodes: valueList(item.engineCodes), transmissionCodes: valueList(item.transmissionCodes), marketCodes: valueList(item.marketCodes), prCodes: valueList(item.prCodes),
        bodyStyles: valueList(item.bodyStyles), driveTypes: valueList(item.driveTypes), position: item.position || '',
        includeConditions: { ...(item.condition ? { note: item.condition } : {}), ...(item.includeRules?.length ? { rules: item.includeRules } : {}) },
        excludeConditions: { ...(item.exclusion ? { note: item.exclusion } : {}), ...(item.excludeRules?.length ? { rules: item.excludeRules } : {}) },
        evidenceKey: hasEvidence ? 'source-0' : '', verificationStatus: 'pending',
      }
    }),
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
