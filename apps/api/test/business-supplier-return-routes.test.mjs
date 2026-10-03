import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

test('supplier return routes separate request, review, inventory and finance permissions', async () => {
  const calls = []
  const supplierReturn = { id: 'supplier-return-1', returnNo: 'SRT-20261003-ABC123', status: 'requested', purchaseOrderId: 'purchase-1', items: [], shipments: [], refunds: [], events: [] }
  const repository = {
    listCases: async (input) => { calls.push(['listCases', input]); return { items: [supplierReturn], total: 1, page: 1, pageSize: 30, summary: {} } },
    getCase: async (id) => { calls.push(['getCase', id]); return id === supplierReturn.id ? supplierReturn : null },
    createCase: async (input, actor) => { calls.push(['createCase', input, actor]); return { created: input.requestKey !== 'repeat', case: supplierReturn } },
    reviewCase: async (id, input, actor) => { calls.push(['reviewCase', id, input, actor]); return { ...supplierReturn, status: input.decision === 'approve' ? 'approved' : 'rejected' } },
    shipReturn: async (id, input, actor) => { calls.push(['shipReturn', id, input, actor]); return { created: true, shipment: { id: 'shipment-1' }, case: { ...supplierReturn, status: 'refund_pending' } } },
    recordRefund: async (id, input, actor) => { calls.push(['recordRefund', id, input, actor]); return { created: true, refund: { id: 'refund-1', amount: input.amount }, case: { ...supplierReturn, status: 'completed' } } },
  }
  const app = buildApp({ businessSupplierReturnRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('采购员甲'), 'x-operator-id': 'buyer-1' }
  const reviewer = { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': encodeURIComponent('审核员乙'), 'x-operator-id': 'reviewer-1' }

  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/supplier-returns?supplierPartnerId=supplier-1', headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/supplier-returns/${supplierReturn.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/supplier-returns/missing', headers: viewer })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/supplier-returns', headers: viewer, payload: { requestKey: 'create-1' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/supplier-returns', headers: editor, payload: { requestKey: 'create-1' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/review`, headers: editor, payload: { decision: 'approve' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/review`, headers: reviewer, payload: { decision: 'approve' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/shipments`, headers: reviewer, payload: { requestKey: 'ship-1' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/shipments`, headers: editor, payload: { requestKey: 'ship-1' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/refunds`, headers: reviewer, payload: { requestKey: 'refund-1', amount: 100 } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/supplier-returns/${supplierReturn.id}/refunds`, headers: editor, payload: { requestKey: 'refund-1', amount: 100 } })).statusCode, 201)
  assert.equal(calls.find((entry) => entry[0] === 'createCase')[2].name, '采购员甲')
  assert.equal(calls.find((entry) => entry[0] === 'reviewCase')[3].name, '审核员乙')
  await app.close()
})
