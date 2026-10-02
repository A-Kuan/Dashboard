import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { createCatalogEpcConnectorService, createHttpEpcConnector } from '../src/catalog-epc-connector-service.mjs'

function fakeRepository() {
  const previews = []
  return {
    async createPreview(input, actor) {
      const items = input.items.map((item, index) => ({
        id: `item-${index + 1}`, rowNumber: index + 1, oe: item.rawOe, normalizedOe: item.normalizedOe,
        originalName: item.originalName, rawPayload: item.rawPayload, matchState: index ? 'new' : 'exact',
        matchedSkuId: index ? '' : 'sku-existing', matchCandidates: index ? [] : [{ id: 'sku-existing' }], decisionState: 'pending',
      }))
      const preview = { id: 'preview-1', state: 'preview', version: 1, sourceSystem: input.sourceSystem, vin: input.vin, sourceContext: input.sourceContext || {}, assets: input.assets || [], items, summary: { total: items.length, exact: 1, new: items.length - 1, ambiguous: 0 }, createdBy: actor }
      previews.push(preview)
      return preview
    },
    async list() { return { items: previews.map((preview) => ({ ...preview, progress: { total: preview.items.length, pending: preview.items.filter((item) => item.decisionState === 'pending').length, processed: preview.items.filter((item) => item.decisionState !== 'pending').length } })), total: previews.length, page: 1, pageSize: 20 } },
    async get(id) { return previews.find((item) => item.id === id) || null },
    async commit(id, input, actor) {
      const preview = previews.find((item) => item.id === id)
      if (!preview) return null
      preview.items = preview.items.map((item) => {
        const decision = input.decisions.find((entry) => entry.itemId === item.id)
        return decision ? { ...item, decisionState: decision.action === 'create_sku' ? 'created' : decision.action === 'attach_evidence' ? 'attached' : 'skipped', resultingSkuId: decision.targetSkuId || 'sku-new' } : item
      })
      preview.version += 1
      preview.state = preview.items.every((item) => item.decisionState !== 'pending') ? 'completed' : 'partial'
      preview.decidedBy = actor
      return preview
    },
  }
}

function fakeRunRepository() {
  const runs = []
  return {
    async start({ connectorId, requestContext, retryOf = '' }, actor) {
      const run = { id: `run-${runs.length + 1}`, connectorId, state: 'running', requestContext, responseSummary: {}, previewId: '', retryOf, error: null, createdBy: actor, startedAt: new Date().toISOString(), completedAt: null }
      runs.push(run)
      return { ...run }
    },
    async succeed(id, { previewId, responseSummary }) {
      const run = runs.find((item) => item.id === id)
      Object.assign(run, { state: 'succeeded', previewId, responseSummary, completedAt: new Date().toISOString(), error: null })
      return { ...run }
    },
    async fail(id, { errorCode, errorMessage }) {
      const run = runs.find((item) => item.id === id)
      Object.assign(run, { state: 'failed', error: { code: errorCode, message: errorMessage }, completedAt: new Date().toISOString() })
      return { ...run }
    },
    async get(id) { return runs.find((item) => item.id === id) || null },
    async list({ state = '', connectorId = '', query = '', page = 1, pageSize = 20 } = {}) {
      const matchesBase = (item) => (!connectorId || item.connectorId === connectorId) && (!query || JSON.stringify(item.requestContext).toLowerCase().includes(String(query).toLowerCase()) || item.connectorId.toLowerCase().includes(String(query).toLowerCase()))
      const base = runs.filter(matchesBase)
      const filtered = base.filter((item) => !state || item.state === state)
      const summary = { total: base.length, running: 0, succeeded: 0, failed: 0 }
      for (const item of base) summary[item.state] += 1
      return { items: filtered.map((item) => ({ ...item })), total: filtered.length, summary, page: Number(page), pageSize: Number(pageSize) }
    },
  }
}

test('EPC preview validates provenance, explains matches and commits only explicit decisions', async () => {
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), logger: false })
  const invalidVin = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews', payload: { vin: 'INVALID', sourceSystem: 'Porsche PET', items: [{ oe: '95B 698 151 H', originalName: 'Brake pad set' }] } })
  assert.equal(invalidVin.statusCode, 400)

  const created = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews', payload: {
    vin: 'WP1ZZZ95ZHLB12345', sourceSystem: 'Porsche PET', catalogPath: '95B / 601-05',
    items: [
      { oe: '95B 698 151 H', originalName: 'Brake pad set', rawPayload: { position: 1 } },
      { oe: '9A7 199 132 02', originalName: 'Hydromount, right', rawPayload: { position: 6 } },
    ],
  } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().items[0].normalizedOe, '95B698151H')
  assert.equal(created.json().items[0].matchState, 'exact')
  assert.deepEqual(created.json().items[1].rawPayload, { position: 6 })
  const history = await app.inject('/api/v2/catalog/epc-previews')
  assert.equal(history.statusCode, 200)
  assert.equal(history.json().items[0].progress.pending, 2)
  assert.equal((await app.inject('/api/v2/catalog/epc-previews/preview-1')).json().items.length, 2)

  const committed = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews/preview-1/commit', payload: {
    expectedVersion: 1, decisions: [{ itemId: 'item-1', action: 'attach_evidence', targetSkuId: 'sku-existing' }],
  } })
  assert.equal(committed.statusCode, 200)
  assert.equal(committed.json().state, 'partial')
  assert.equal(committed.json().items[0].decisionState, 'attached')
  assert.equal(committed.json().items[1].decisionState, 'pending')
  assert.equal((await app.inject('/api/v2/catalog/epc-previews')).json().items[0].progress.processed, 1)
  await app.close()
})

test('EPC preview routes respect catalog permissions', async () => {
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), logger: false })
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { sourceSystem: 'PET', items: [{ oe: '1', originalName: 'Part' }] } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().error, 'CATALOG_PERMISSION_DENIED')
  await app.close()
})

test('collects a normalized connector response without bypassing the write preview', async () => {
  const catalogEpcConnectorService = createCatalogEpcConnectorService({ connectors: [{
    id: 'test-epc', label: 'Test EPC', description: 'contract fixture', configured: true,
    capabilities: ['vin_lookup', 'diagram_reference'],
    async collect(input) {
      return {
        schemaVersion: 'hushanxing-epc-connector-v1', requestId: 'request-1', collectedAt: '2026-10-02T05:00:00.000Z',
        vin: input.vin, sourceSystem: 'Porsche PET', catalogPath: '95B / 601-05',
        items: [{ oe: '95B 698 151 H', originalName: 'Brake pad set', sourceRecordId: '601-05-01', rawPayload: { quantity: 1 } }],
        assets: [{ type: 'diagram', sourceUrl: 'https://assets.example.test/601-05.png', sourceRecordId: '601-05-01', figureCode: '601-05', checksum: `sha256:${'a'.repeat(64)}` }],
      }
    },
  }] })
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), catalogEpcConnectorService, catalogEpcConnectorRunRepository: fakeRunRepository(), logger: false })
  const connectors = await app.inject('/api/v2/catalog/epc-connectors')
  assert.equal(connectors.statusCode, 200)
  assert.equal(connectors.json().items[0].state, 'ready')

  const collected = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-connectors/test-epc/collect', payload: { vin: 'WP1ZZZ95ZHLB12345' } })
  assert.equal(collected.statusCode, 201)
  assert.equal(collected.json().state, 'preview')
  assert.equal(collected.json().sourceContext.connectorRequestId, 'request-1')
  assert.equal(collected.json().assets[0].figureCode, '601-05')
  assert.equal(collected.json().items[0].decisionState, 'pending')
  assert.equal(collected.json().connectorRun.state, 'succeeded')
  await app.close()
})

test('reports an unconfigured connector without exposing credentials', async () => {
  const catalogEpcConnectorService = createCatalogEpcConnectorService({ connectors: [{
    id: 'external-epc', label: 'External EPC', description: 'pending', configured: false, capabilities: [],
  }] })
  const runRepository = fakeRunRepository()
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), catalogEpcConnectorService, catalogEpcConnectorRunRepository: runRepository, logger: false })
  const listed = (await app.inject('/api/v2/catalog/epc-connectors')).json().items[0]
  assert.deepEqual(Object.keys(listed).sort(), ['capabilities', 'description', 'id', 'label', 'schemaVersion', 'state'])
  const response = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-connectors/external-epc/collect', payload: { vin: 'WP1ZZZ95ZHLB12345' } })
  assert.equal(response.statusCode, 503)
  assert.equal(response.json().error, 'EPC_CONNECTOR_NOT_CONFIGURED')
  assert.equal((await runRepository.list()).items[0].state, 'failed')
  await app.close()
})

test('rejects unsafe connector assets before creating a preview', async () => {
  const catalogEpcConnectorService = createCatalogEpcConnectorService({ connectors: [{
    id: 'unsafe-epc', label: 'Unsafe EPC', description: 'fixture', configured: true, capabilities: [],
    async collect() {
      return {
        schemaVersion: 'hushanxing-epc-connector-v1', sourceSystem: 'Fixture',
        items: [{ oe: 'TEST-001', originalName: 'Fixture part' }],
        assets: [{ type: 'diagram', sourceUrl: 'file:///private/catalog.png' }],
      }
    },
  }] })
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), catalogEpcConnectorService, catalogEpcConnectorRunRepository: fakeRunRepository(), logger: false })
  const response = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-connectors/unsafe-epc/collect', payload: { catalogPath: 'fixture' } })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'INVALID_EPC_CONNECTOR_RESPONSE')
  await app.close()
})

test('retains failed connector runs and retries them as a linked attempt', async () => {
  let fail = true
  const connector = {
    id: 'retry-epc', label: 'Retry EPC', description: 'fixture', configured: true, capabilities: [],
    async collect(input) {
      if (fail) {
        const error = new Error('上游临时不可用')
        error.statusCode = 502
        error.errorCode = 'EPC_CONNECTOR_UPSTREAM_ERROR'
        throw error
      }
      return { schemaVersion: 'hushanxing-epc-connector-v1', sourceSystem: 'Retry EPC', catalogPath: input.catalogPath, items: [{ oe: 'RETRY-001', originalName: 'Retry fixture part' }] }
    },
  }
  const catalogEpcConnectorService = createCatalogEpcConnectorService({ connectors: [connector] })
  const runRepository = fakeRunRepository()
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), catalogEpcConnectorService, catalogEpcConnectorRunRepository: runRepository, logger: false })
  const failed = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-connectors/retry-epc/collect', payload: { catalogPath: 'fixture / retry' } })
  assert.equal(failed.statusCode, 502)
  assert.equal(failed.json().details.connectorRunId, 'run-1')
  assert.equal((await app.inject('/api/v2/catalog/epc-connector-runs/run-1')).json().state, 'failed')

  fail = false
  const retried = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-connector-runs/run-1/retry' })
  assert.equal(retried.statusCode, 201)
  assert.equal(retried.json().connectorRun.state, 'succeeded')
  assert.equal(retried.json().connectorRun.retryOf, 'run-1')
  const history = (await app.inject('/api/v2/catalog/epc-connector-runs')).json()
  assert.equal(history.total, 2)
  assert.deepEqual(history.items.map((item) => item.state), ['failed', 'succeeded'])
  const failedOnly = (await app.inject('/api/v2/catalog/epc-connector-runs?state=failed&connectorId=retry-epc&q=fixture')).json()
  assert.equal(failedOnly.total, 1)
  assert.equal(failedOnly.summary.total, 2)
  assert.equal(failedOnly.summary.failed, 1)
  const invalidRange = await app.inject('/api/v2/catalog/epc-connector-runs?from=2026-10-03&to=2026-10-02')
  assert.equal(invalidRange.statusCode, 400)
  assert.equal(invalidRange.json().error, 'INVALID_EPC_CONNECTOR_RUN_FILTER')
  await app.close()
})

test('HTTP connector sends the versioned contract and server-only authorization', async () => {
  let received
  const upstream = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = { authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ schemaVersion: 'hushanxing-epc-connector-v1', sourceSystem: 'Fixture EPC', items: [{ oe: 'HTTP-001', originalName: 'HTTP fixture part' }] }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const { port } = upstream.address()
  try {
    const connector = createHttpEpcConnector({
      CATALOG_EPC_CONNECTOR_URL: `http://127.0.0.1:${port}/collect`,
      CATALOG_EPC_CONNECTOR_TOKEN: 'server-secret',
      CATALOG_EPC_CONNECTOR_NAME: 'Fixture connector',
    })
    const service = createCatalogEpcConnectorService({ connectors: [connector] })
    const result = await service.collect('external-epc', { catalogPath: 'fixture / 001' })
    assert.equal(result.previewInput.items[0].rawOe, 'HTTP-001')
    assert.equal(received.authorization, 'Bearer server-secret')
    assert.equal(received.body.schemaVersion, 'hushanxing-epc-connector-v1')
    assert.equal(service.list().items[0].token, undefined)
  } finally {
    upstream.close()
    await once(upstream, 'close')
  }
})
