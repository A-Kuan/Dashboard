import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { createBusinessOperationsRepository } from '../src/business-operations-repository.mjs'

test('operations center exposes a read-only cross-module work queue', async () => {
  const calls = []
  const repository = {
    listWorkItems: async (input) => {
      calls.push(input)
      return {
        asOf: '2026-10-03T06:30:00.000Z',
        items: [{ id: 'inquiry:1', kind: 'inquiry_follow_up', sourceNo: 'INQ-1', urgency: 'today' }],
        total: 1,
        page: 2,
        pageSize: 10,
        summary: { byUrgency: { today: 1 }, byKind: { inquiry_follow_up: { count: 1, amountByCurrency: { CNY: 100 } } }, exposure: {} },
      }
    },
  }
  const app = buildApp({ businessOperationsRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const response = await app.inject({
    method: 'GET',
    url: '/api/v2/business/operations-center?q=%E8%99%8E%E5%B1%B1%E8%A1%8C&kind=inquiry_follow_up&urgency=today&assignedTo=%E4%B8%9A%E5%8A%A1%E5%91%98%E7%94%B2&page=2&pageSize=10',
    headers: viewer,
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().items[0].sourceNo, 'INQ-1')
  assert.deepEqual(calls, [{ query: '虎山行', kind: 'inquiry_follow_up', urgency: 'today', assignedTo: '业务员甲', page: '2', pageSize: '10' }])
  await app.close()
})

test('operations center fails clearly when its repository is unavailable', async () => {
  const app = buildApp({ logger: false })
  const response = await app.inject({ method: 'GET', url: '/api/v2/business/operations-center', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(response.statusCode, 503)
  assert.equal(response.json().error, 'BUSINESS_OPERATIONS_UNAVAILABLE')
  await app.close()
})

test('operations center validates work item filters before querying the database', async () => {
  const repository = createBusinessOperationsRepository({ query: async () => { throw new Error('database should not be queried') } })
  await assert.rejects(() => repository.listWorkItems({ kind: 'unknown' }), (error) => error.errorCode === 'INVALID_WORK_ITEM_KIND')
  await assert.rejects(() => repository.listWorkItems({ urgency: 'whenever' }), (error) => error.errorCode === 'INVALID_WORK_ITEM_URGENCY')
  await assert.rejects(() => repository.listWorkItems({ now: 'not-a-date' }), (error) => error.errorCode === 'INVALID_WORK_ITEM_AS_OF')
})
