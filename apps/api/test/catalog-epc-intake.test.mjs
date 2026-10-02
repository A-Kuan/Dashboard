import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

function fakeRepository() {
  const previews = []
  return {
    async createPreview(input, actor) {
      const items = input.items.map((item, index) => ({
        id: `item-${index + 1}`, rowNumber: index + 1, oe: item.rawOe, normalizedOe: item.normalizedOe,
        originalName: item.originalName, rawPayload: item.rawPayload, matchState: index ? 'new' : 'exact',
        matchedSkuId: index ? '' : 'sku-existing', matchCandidates: index ? [] : [{ id: 'sku-existing' }], decisionState: 'pending',
      }))
      const preview = { id: 'preview-1', state: 'preview', version: 1, sourceSystem: input.sourceSystem, vin: input.vin, items, summary: { total: items.length, exact: 1, new: items.length - 1, ambiguous: 0 }, createdBy: actor }
      previews.push(preview)
      return preview
    },
    async list() { return { items: previews, total: previews.length, page: 1, pageSize: 20 } },
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

  const committed = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews/preview-1/commit', payload: {
    expectedVersion: 1, decisions: [{ itemId: 'item-1', action: 'attach_evidence', targetSkuId: 'sku-existing' }],
  } })
  assert.equal(committed.statusCode, 200)
  assert.equal(committed.json().state, 'partial')
  assert.equal(committed.json().items[0].decisionState, 'attached')
  assert.equal(committed.json().items[1].decisionState, 'pending')
  await app.close()
})

test('EPC preview routes respect catalog permissions', async () => {
  const app = buildApp({ catalogEpcIntakeRepository: fakeRepository(), logger: false })
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-previews', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { sourceSystem: 'PET', items: [{ oe: '1', originalName: 'Part' }] } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().error, 'CATALOG_PERMISSION_DENIED')
  await app.close()
})
