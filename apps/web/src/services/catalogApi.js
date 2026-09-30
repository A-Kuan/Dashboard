const apiBase = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-operator-name': 'hushanxing-workbench', ...options.headers },
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
    primaryOe: primary?.rawValue || '—',
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
    version: item.version,
    dataOrigin: 'live',
    aggregate: item,
  }
}

export async function listCatalogSkus() {
  const result = await request('/api/v2/catalog/skus?pageSize=100')
  const details = await Promise.all(result.items.map((item) => request(`/api/v2/catalog/skus/${item.id}`)))
  return { records: details.map(mapCatalogSku), total: result.total }
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

export async function verifyCatalogSku(record) {
  const result = await request(`/api/v2/catalog/skus/${record.id}/verify`, { method: 'POST', body: JSON.stringify({ expectedVersion: record.version }) })
  return mapCatalogSku(result)
}
