import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

test('finance routes expose receivables and protect payment recording', async () => {
  const calls = []
  const receivable = { id: 'receivable-1', receivableNo: 'AR-20261003-ABC123', salesOrderId: 'sales-1', status: 'open', originalAmount: 3200, paidAmount: 0, outstandingAmount: 3200, payments: [], events: [] }
  const repository = {
    listReceivables: async (input) => { calls.push(['listReceivables', input]); return { items: [receivable], total: 1, page: 1, pageSize: 30, summary: {}, overdue: { count: 0, amount: 0 } } },
    getReceivable: async (id) => { calls.push(['getReceivable', id]); return id === receivable.id ? receivable : null },
    recordPayment: async (id, input, actor) => { calls.push(['recordPayment', id, input, actor]); return { created: input.requestKey !== 'repeat', payment: { id: 'payment-1', amount: input.amount }, receivable: { ...receivable, status: 'partial', paidAmount: input.amount, outstandingAmount: 3200 - input.amount } } },
  }
  const app = buildApp({ businessFinanceRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('财务员甲'), 'x-operator-id': 'finance-1' }

  const listed = await app.inject({ method: 'GET', url: '/api/v2/business/receivables?q=客户&status=open&customerPartnerId=customer-1', headers: viewer })
  assert.equal(listed.statusCode, 200)
  assert.equal(calls[0][1].customerPartnerId, 'customer-1')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/receivables/${receivable.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/receivables/missing', headers: viewer })).statusCode, 404)

  const denied = await app.inject({ method: 'POST', url: `/api/v2/business/receivables/${receivable.id}/payments`, headers: viewer, payload: { requestKey: 'payment-1', amount: 1000, paymentMethod: 'bank_transfer' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.finance')
  const created = await app.inject({ method: 'POST', url: `/api/v2/business/receivables/${receivable.id}/payments`, headers: editor, payload: { requestKey: 'payment-1', amount: 1000, paymentMethod: 'bank_transfer' } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().receivable.outstandingAmount, 2200)
  const repeated = await app.inject({ method: 'POST', url: `/api/v2/business/receivables/${receivable.id}/payments`, headers: editor, payload: { requestKey: 'repeat', amount: 1000, paymentMethod: 'bank_transfer' } })
  assert.equal(repeated.statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'recordPayment')[3].name, '财务员甲')
  await app.close()
})
