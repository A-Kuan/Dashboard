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

test('operations center combines open master-data risks with the existing work queue', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes('SELECT * FROM classified')) return { rows: [{
        id: 'inquiry:1', kind: 'inquiry_follow_up', source_type: 'inquiry', source_id: '1', source_no: 'INQ-1', status: 'new',
        title: '跟进询价：现有客户', counterpart_name: '现有客户', customer_partner_id: 'customer-1', supplier_partner_id: null,
        assigned_to: '业务员甲', next_action: '核对需求', action_capability: 'business.manage', route_path: '/business/inquiries/1',
        due_at: '2026-10-03T15:59:59.999Z', urgency: 'today', overdue_days: 0, amount: 100, currency: 'CNY', details: {},
        updated_at: '2026-10-03T07:00:00.000Z', priority_rank: 120,
      }] }
      return { rows: [{ kind: 'inquiry_follow_up', urgency: 'today', currency: 'CNY', count: 1, amount: 100 }] }
    },
  }
  const issue = {
    issueKey: 'vehicle_duplicate:vehicle-1:vehicle-2', kind: 'vehicle_duplicate', status: 'open', severity: 'high', score: 85,
    title: '疑似重复车辆：卡宴 / 卡宴', explanation: '车牌一致', signals: [{ code: 'same_license_plate', label: '车牌一致' }], sameOwner: true,
    fingerprint: 'a'.repeat(64), recommendedAction: 'vehicle_merge_preview', previewRequest: { survivorVehicleId: 'vehicle-1', retiredVehicleId: 'vehicle-2' },
    candidateA: { id: 'vehicle-1', partnerId: 'customer-1', customerName: '虎山行客户', vehicleLabel: '卡宴', licensePlate: '浙A12345', updatedAt: '2026-10-03T08:00:00.000Z' },
    candidateB: { id: 'vehicle-2', partnerId: 'customer-1', customerName: '虎山行客户', vehicleLabel: '卡宴', licensePlate: '浙A12345', updatedAt: '2026-10-03T09:00:00.000Z' },
  }
  const qualityCalls = []
  const repository = createBusinessOperationsRepository(pool, { masterDataQualityRepository: {
    listOpenForOperations: async (input) => { qualityCalls.push(input); return [issue] },
  } })
  const result = await repository.listWorkItems({ now: '2026-10-03T06:00:00.000Z', pageSize: 10 })
  assert.equal(result.total, 2)
  assert.equal(result.items[0].kind, 'vehicle_duplicate')
  assert.equal(result.items[0].actionCapability, 'business.data_quality.review')
  assert.equal(result.items[0].details.fingerprint, 'a'.repeat(64))
  assert.equal(result.items[0].details.previewRequest.survivorVehicleId, 'vehicle-1')
  assert.equal('sortRank' in result.items[0], false)
  assert.equal(result.summary.byKind.vehicle_duplicate.count, 1)
  assert.equal(result.summary.byKind.inquiry_follow_up.count, 1)
  assert.equal(result.summary.byUrgency.today, 2)
  assert.deepEqual(qualityCalls, [{ kind: '', query: '' }])
})

test('operations center can filter directly to one master-data quality kind', async () => {
  const calls = []
  const repository = createBusinessOperationsRepository({ query: async () => { throw new Error('operational query should be skipped') } }, {
    masterDataQualityRepository: { listOpenForOperations: async (input) => { calls.push(input); return [] } },
  })
  const result = await repository.listWorkItems({ kind: 'customer_duplicate', query: '虎山行', pageSize: 20, now: '2026-10-03T06:00:00.000Z' })
  assert.equal(result.total, 0)
  assert.deepEqual(result.items, [])
  assert.deepEqual(calls, [{ kind: 'customer_duplicate', query: '虎山行' }])
})
