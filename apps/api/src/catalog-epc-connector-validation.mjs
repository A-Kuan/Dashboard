import { normalizeEpcPreviewInput } from './catalog-epc-validation.mjs'

const connectorSchema = 'hushanxing-epc-connector-v1'
const allowedAssetTypes = new Set(['diagram', 'image', 'document'])

function text(value) { return String(value ?? '').trim() }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function list(value) { return Array.isArray(value) ? value : [] }

function invalid(message, errorCode = 'INVALID_EPC_CONNECTOR_INPUT') {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = errorCode
  throw error
}

function safeSourceUrl(value, index) {
  const sourceUrl = text(value)
  if (!sourceUrl) invalid(`assets[${index}].sourceUrl 不能为空`, 'INVALID_EPC_CONNECTOR_RESPONSE')
  let parsed
  try { parsed = new URL(sourceUrl) } catch { invalid(`assets[${index}].sourceUrl 必须是有效 URL`, 'INVALID_EPC_CONNECTOR_RESPONSE') }
  if (!['http:', 'https:'].includes(parsed.protocol)) invalid(`assets[${index}].sourceUrl 仅支持 HTTP 或 HTTPS`, 'INVALID_EPC_CONNECTOR_RESPONSE')
  return parsed.toString()
}

export function normalizeEpcConnectorCollectInput(input = {}) {
  const vin = text(input.vin).toUpperCase()
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) invalid('VIN 必须为 17 位有效字符')
  const catalogPath = text(input.catalogPath)
  const groupCode = text(input.groupCode)
  if (!vin && !catalogPath && !groupCode) invalid('VIN、目录路径或图组编码至少填写一项')
  return { vin, catalogPath, groupCode }
}

export function normalizeEpcConnectorResponse(payload = {}, requestInput = {}, connector = {}) {
  if (text(payload.schemaVersion) !== connectorSchema) invalid(`连接器必须返回 ${connectorSchema}`, 'INVALID_EPC_CONNECTOR_RESPONSE')
  const assets = list(payload.assets).map((asset, index) => {
    const assetType = text(asset?.type).toLowerCase()
    if (!allowedAssetTypes.has(assetType)) invalid(`assets[${index}].type 不受支持`, 'INVALID_EPC_CONNECTOR_RESPONSE')
    return {
      type: assetType,
      sourceUrl: safeSourceUrl(asset?.sourceUrl, index),
      sourceRecordId: text(asset?.sourceRecordId),
      figureCode: text(asset?.figureCode),
      title: text(asset?.title),
      contentType: text(asset?.contentType),
      checksum: text(asset?.checksum),
      metadata: object(asset?.metadata),
    }
  })
  if (assets.length > 100) invalid('一次最多接收 100 个图组资源', 'INVALID_EPC_CONNECTOR_RESPONSE')
  const collectedAt = text(payload.collectedAt) || new Date().toISOString()
  if (Number.isNaN(Date.parse(collectedAt))) invalid('collectedAt 必须是有效时间', 'INVALID_EPC_CONNECTOR_RESPONSE')
  const preview = normalizeEpcPreviewInput({
    vin: payload.vin || requestInput.vin,
    sourceSystem: payload.sourceSystem || connector.label || connector.id,
    catalogPath: payload.catalogPath || requestInput.catalogPath || requestInput.groupCode,
    sourceContext: {
      ...object(payload.sourceContext),
      connectorId: connector.id,
      connectorLabel: connector.label,
      connectorSchema,
      connectorRequestId: text(payload.requestId),
      collectedAt,
    },
    items: payload.items,
  })
  return { ...preview, assets }
}

export { connectorSchema }
