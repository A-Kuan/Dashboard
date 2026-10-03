import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

test('finance routes expose receivables and payables while protecting money movements', async () => {
  const calls = []
  const receivable = { id: 'receivable-1', receivableNo: 'AR-20261003-ABC123', salesOrderId: 'sales-1', status: 'open', originalAmount: 3200, paidAmount: 0, outstandingAmount: 3200, payments: [], events: [] }
  const payable = { id: 'payable-1', payableNo: 'AP-20261003-ABC123', purchaseOrderId: 'purchase-1', status: 'open', originalAmount: 2400, paidAmount: 0, outstandingAmount: 2400, payments: [], events: [] }
  const repository = {
    listReceivables: async (input) => { calls.push(['listReceivables', input]); return { items: [receivable], total: 1, page: 1, pageSize: 30, summary: {}, overdue: { count: 0, amount: 0 } } },
    getReceivable: async (id) => { calls.push(['getReceivable', id]); return id === receivable.id ? receivable : null },
    recordPayment: async (id, input, actor) => { calls.push(['recordPayment', id, input, actor]); return { created: input.requestKey !== 'repeat', payment: { id: 'payment-1', amount: input.amount }, receivable: { ...receivable, status: 'partial', paidAmount: input.amount, outstandingAmount: 3200 - input.amount } } },
    listPayables: async (input) => { calls.push(['listPayables', input]); return { items: [payable], total: 1, page: 1, pageSize: 30, summary: {}, overdue: { count: 0, amount: 0 } } },
    getPayable: async (id) => { calls.push(['getPayable', id]); return id === payable.id ? payable : null },
    recordSupplierPayment: async (id, input, actor) => { calls.push(['recordSupplierPayment', id, input, actor]); return { created: input.requestKey !== 'supplier-repeat', payment: { id: 'supplier-payment-1', amount: input.amount }, payable: { ...payable, status: 'partial', paidAmount: input.amount, outstandingAmount: 2400 - input.amount } } },
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

  const payableList = await app.inject({ method: 'GET', url: '/api/v2/business/payables?q=供应商&status=open&supplierPartnerId=supplier-1', headers: viewer })
  assert.equal(payableList.statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'listPayables')[1].supplierPartnerId, 'supplier-1')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/payables/${payable.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/payables/missing', headers: viewer })).statusCode, 404)
  const deniedSupplierPayment = await app.inject({ method: 'POST', url: `/api/v2/business/payables/${payable.id}/payments`, headers: viewer, payload: { requestKey: 'supplier-payment-1', amount: 1000, paymentMethod: 'bank_transfer' } })
  assert.equal(deniedSupplierPayment.statusCode, 403)
  const supplierPayment = await app.inject({ method: 'POST', url: `/api/v2/business/payables/${payable.id}/payments`, headers: editor, payload: { requestKey: 'supplier-payment-1', amount: 1000, paymentMethod: 'bank_transfer' } })
  assert.equal(supplierPayment.statusCode, 201)
  assert.equal(supplierPayment.json().payable.outstandingAmount, 1400)
  assert.equal(calls.find((entry) => entry[0] === 'recordSupplierPayment')[3].name, '财务员甲')
  await app.close()
})
