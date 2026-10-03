import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

test('after-sales routes expose cases and separate review, inventory and finance permissions', async () => {
  const calls = []
  const afterSalesCase = { id: 'after-sales-1', caseNo: 'AS-20261003-ABC123', salesOrderId: 'sales-1', status: 'requested', version: 1, items: [], returnReceipts: [], refunds: [], events: [] }
  const repository = {
    listCases: async (input) => { calls.push(['listCases', input]); return { items: [afterSalesCase], total: 1, page: 1, pageSize: 30, summary: {} } },
    getCase: async (id) => { calls.push(['getCase', id]); return id === afterSalesCase.id ? afterSalesCase : null },
    createCase: async (input, actor) => { calls.push(['createCase', input, actor]); return { created: input.requestKey !== 'repeat', case: afterSalesCase } },
    reviewCase: async (id, input, actor) => { calls.push(['reviewCase', id, input, actor]); return { ...afterSalesCase, status: input.decision === 'approve' ? 'approved' : 'rejected', version: 2 } },
    receiveReturn: async (id, input, actor) => { calls.push(['receiveReturn', id, input, actor]); return { created: true, returnReceipt: { id: 'return-1' }, case: { ...afterSalesCase, status: 'refund_pending' } } },
    recordRefund: async (id, input, actor) => { calls.push(['recordRefund', id, input, actor]); return { created: true, refund: { id: 'refund-1', amount: input.amount }, case: { ...afterSalesCase, status: 'completed' } } },
  }
  const app = buildApp({ businessAfterSalesRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('售后员甲'), 'x-operator-id': 'after-sales-1' }
  const reviewer = { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': encodeURIComponent('售后审核员乙'), 'x-operator-id': 'after-sales-reviewer-1' }

  const listed = await app.inject({ method: 'GET', url: '/api/v2/business/after-sales?q=客户&status=requested&customerPartnerId=customer-1&salesOrderId=sales-1', headers: viewer })
  assert.equal(listed.statusCode, 200)
  assert.equal(calls[0][1].customerPartnerId, 'customer-1')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/after-sales/${afterSalesCase.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/after-sales/missing', headers: viewer })).statusCode, 404)

  const createPayload = { requestKey: 'after-sales-create', salesOrderId: 'sales-1', reasonCode: 'fitment_issue', items: [{ shipmentItemId: 'shipment-item-1', quantity: 1 }] }
  const deniedCreate = await app.inject({ method: 'POST', url: '/api/v2/business/after-sales', headers: viewer, payload: createPayload })
  assert.equal(deniedCreate.statusCode, 403)
  assert.equal(deniedCreate.json().details.capability, 'business.after_sales')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/after-sales', headers: editor, payload: createPayload })).statusCode, 201)
  const deniedReview = await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/review`, headers: editor, payload: { expectedVersion: 1, decision: 'approve' } })
  assert.equal(deniedReview.statusCode, 403)
  assert.equal(deniedReview.json().details.capability, 'business.after_sales.review')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/review`, headers: reviewer, payload: { expectedVersion: 1, decision: 'approve' } })).statusCode, 200)

  const deniedReceipt = await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/return-receipts`, headers: viewer, payload: { requestKey: 'return-1', expectedVersion: 2, items: [{ itemId: 'item-1', quantity: 1 }] } })
  assert.equal(deniedReceipt.statusCode, 403)
  assert.equal(deniedReceipt.json().details.capability, 'business.inventory')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/return-receipts`, headers: editor, payload: { requestKey: 'return-1', expectedVersion: 2, items: [{ itemId: 'item-1', quantity: 1 }] } })).statusCode, 201)

  const deniedRefund = await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/refunds`, headers: viewer, payload: { requestKey: 'refund-1', amount: 100, refundMethod: 'cash' } })
  assert.equal(deniedRefund.statusCode, 403)
  assert.equal(deniedRefund.json().details.capability, 'business.finance')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/after-sales/${afterSalesCase.id}/refunds`, headers: editor, payload: { requestKey: 'refund-1', amount: 100, refundMethod: 'cash' } })).statusCode, 201)
  assert.equal(calls.find((entry) => entry[0] === 'recordRefund')[3].name, '售后员甲')
  await app.close()
})
