import { normalizeIdentifierValue } from './catalog-validation.mjs'

function text(value) { return String(value ?? '').trim() }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function list(value) { return Array.isArray(value) ? value : [] }
function codes(value) { return [...new Set(list(value).map(text).filter(Boolean).map((item) => item.toUpperCase()))] }

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'INVALID_EPC_PREVIEW_INPUT'
  throw error
}

function optionalYear(value, field) {
  if (value === '' || value === undefined || value === null) return null
  const year = Number(value)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) invalid(`${field} 必须是有效年份`)
  return year
}

export function normalizeEpcPreviewInput(input = {}) {
  const vin = text(input.vin).toUpperCase()
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) invalid('VIN 必须为 17 位有效字符')
  const sourceSystem = text(input.sourceSystem)
  if (!sourceSystem) invalid('请选择或填写 EPC 来源系统')
  const items = list(input.items).map((item, index) => {
    const rawOe = text(item?.oe)
    const originalName = text(item?.originalName)
    if (!rawOe) invalid(`第 ${index + 1} 行缺少 OE 编号`)
    if (!originalName) invalid(`第 ${index + 1} 行缺少 EPC 原始名称`)
    const yearFrom = optionalYear(item.yearFrom, `items[${index}].yearFrom`)
    const yearTo = optionalYear(item.yearTo, `items[${index}].yearTo`)
    if (yearFrom && yearTo && yearFrom > yearTo) invalid(`第 ${index + 1} 行年款范围无效`)
    return {
      sourceRecordId: text(item.sourceRecordId), rawOe, normalizedOe: normalizeIdentifierValue(rawOe), originalName,
      figurePosition: text(item.figurePosition), platformCode: text(item.platformCode).toUpperCase(), variantCode: text(item.variantCode).toUpperCase(),
      vehicleLabel: text(item.vehicleLabel), yearFrom, yearTo, engineCodes: codes(item.engineCodes), transmissionCodes: codes(item.transmissionCodes),
      marketCodes: codes(item.marketCodes), prCodes: codes(item.prCodes), bodyStyles: codes(item.bodyStyles), driveTypes: codes(item.driveTypes),
      position: text(item.position), rawPayload: object(item.rawPayload),
    }
  })
  if (!items.length) invalid('至少需要一条 EPC 零件记录')
  if (items.length > 100) invalid('一次最多预览 100 条 EPC 零件记录')
  return { vin, sourceSystem, catalogPath: text(input.catalogPath), sourceContext: object(input.sourceContext), items }
}

export function normalizeEpcCommitInput(input = {}) {
  const expectedVersion = Number(input.expectedVersion)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) invalid('expectedVersion 必须是正整数')
  const allowed = new Set(['create_sku', 'attach_evidence', 'skip'])
  const decisions = list(input.decisions).map((decision, index) => {
    const action = text(decision?.action)
    if (!text(decision?.itemId)) invalid(`decisions[${index}].itemId 不能为空`)
    if (!allowed.has(action)) invalid(`decisions[${index}].action 不受支持`)
    if (action === 'attach_evidence' && !text(decision.targetSkuId)) invalid(`decisions[${index}].targetSkuId 不能为空`)
    return { itemId: text(decision.itemId), action, targetSkuId: text(decision.targetSkuId) }
  })
  if (!decisions.length) invalid('至少选择一条处理决定')
  if (new Set(decisions.map((item) => item.itemId)).size !== decisions.length) invalid('同一条记录不能重复处理')
  return { expectedVersion, decisions }
}
