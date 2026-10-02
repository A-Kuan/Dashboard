import { normalizeEpcConnectorCollectInput, normalizeEpcConnectorResponse, connectorSchema } from './catalog-epc-connector-validation.mjs'

function connectorError(message, statusCode, errorCode, details) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.errorCode = errorCode
  if (details) error.details = details
  return error
}

function publicConnector(connector) {
  return {
    id: connector.id,
    label: connector.label,
    description: connector.description,
    state: connector.configured ? 'ready' : 'needs_configuration',
    schemaVersion: connectorSchema,
    capabilities: connector.capabilities || [],
  }
}

export function createHttpEpcConnector(env = process.env) {
  const endpoint = String(env.CATALOG_EPC_CONNECTOR_URL || '').trim()
  const token = String(env.CATALOG_EPC_CONNECTOR_TOKEN || '').trim()
  const timeoutMs = Math.min(60000, Math.max(1000, Number(env.CATALOG_EPC_CONNECTOR_TIMEOUT_MS) || 15000))
  const maxResponseBytes = 8 * 1024 * 1024
  return {
    id: 'external-epc',
    label: String(env.CATALOG_EPC_CONNECTOR_NAME || '外部 EPC 连接器').trim(),
    description: endpoint ? '从已配置的目录服务读取 VIN、图组与零件证据。' : '配置采集地址后，可直接读取 VIN、图组与零件证据。',
    configured: Boolean(endpoint),
    capabilities: ['vin_lookup', 'catalog_group', 'diagram_reference'],
    async collect(input) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ schemaVersion: connectorSchema, ...input }),
          signal: controller.signal,
        })
        if (!response.ok) throw connectorError(`外部 EPC 服务返回 ${response.status}`, 502, 'EPC_CONNECTOR_UPSTREAM_ERROR', { upstreamStatus: response.status })
        const declaredBytes = Number(response.headers.get('content-length') || 0)
        if (declaredBytes > maxResponseBytes) throw connectorError('外部 EPC 服务返回内容过大', 502, 'EPC_CONNECTOR_UPSTREAM_ERROR')
        const raw = await response.text()
        if (Buffer.byteLength(raw, 'utf8') > maxResponseBytes) throw connectorError('外部 EPC 服务返回内容过大', 502, 'EPC_CONNECTOR_UPSTREAM_ERROR')
        try { return JSON.parse(raw) } catch { throw connectorError('外部 EPC 服务返回的不是有效 JSON', 502, 'EPC_CONNECTOR_UPSTREAM_ERROR') }
      } catch (error) {
        if (error.errorCode) throw error
        if (error.name === 'AbortError') throw connectorError('外部 EPC 服务响应超时', 504, 'EPC_CONNECTOR_TIMEOUT')
        throw connectorError('无法连接外部 EPC 服务', 502, 'EPC_CONNECTOR_UNAVAILABLE')
      } finally { clearTimeout(timeout) }
    },
  }
}

export function createCatalogEpcConnectorService({ connectors = [createHttpEpcConnector()] } = {}) {
  const byId = new Map(connectors.map((connector) => [connector.id, connector]))
  return {
    list() { return { items: connectors.map(publicConnector) } },
    async collect(id, rawInput) {
      const connector = byId.get(id)
      if (!connector) throw connectorError('EPC 连接器不存在', 404, 'EPC_CONNECTOR_NOT_FOUND')
      if (!connector.configured) throw connectorError('EPC 连接器尚未配置', 503, 'EPC_CONNECTOR_NOT_CONFIGURED')
      const input = normalizeEpcConnectorCollectInput(rawInput)
      const payload = await connector.collect(input)
      return { connector: publicConnector(connector), previewInput: normalizeEpcConnectorResponse(payload, input, connector) }
    },
  }
}
