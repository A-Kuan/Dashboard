import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

test('business order routes expose reads and protect every operational write', async () => {
  const calls = []
  const salesOrder = { id: 'sales-1', orderNo: 'SO-20261003-ABC123', status: 'draft', version: 1, items: [], purchaseOrders: [] }
  const purchaseOrder = { id: 'purchase-1', orderNo: 'PO-20261003-ABC123', salesOrderId: salesOrder.id, status: 'draft', version: 1, items: [] }
  const repository = {
    listSalesOrders: async (input) => { calls.push(['listSalesOrders', input]); return { items: [salesOrder], total: 1, page: 1, pageSize: 30, summary: {} } },
    getSalesOrder: async (id) => { calls.push(['getSalesOrder', id]); return id === salesOrder.id ? salesOrder : null },
    listPurchaseOrders: async (input) => { calls.push(['listPurchaseOrders', input]); return { items: [purchaseOrder], total: 1, page: 1, pageSize: 30, summary: {} } },
    getPurchaseOrder: async (id) => { calls.push(['getPurchaseOrder', id]); return id === purchaseOrder.id ? purchaseOrder : null },
    convertInquiry: async (id, actor) => { calls.push(['convertInquiry', id, actor]); return { salesOrder, purchaseOrders: [purchaseOrder], created: true } },
    transitionSalesOrder: async (id, input, actor) => { calls.push(['transitionSalesOrder', id, input, actor]); return { ...salesOrder, status: input.status, version: 2 } },
    transitionPurchaseOrder: async (id, input, actor) => { calls.push(['transitionPurchaseOrder', id, input, actor]); return { ...purchaseOrder, status: input.status, version: 2 } },
    receivePurchaseOrder: async (id, input, actor) => { calls.push(['receivePurchaseOrder', id, input, actor]); return { ...purchaseOrder, status: 'partially_received', version: 3 } },
  }
  const app = buildApp({ businessOrderRepository: repository, logger: false })

  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const reviewer = { 'x-operator-role': 'catalog_reviewer' }
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('业务员甲'), 'x-operator-id': 'sales-1' }

  const salesList = await app.inject({ method: 'GET', url: '/api/v2/business/sales-orders?q=王师傅&status=draft', headers: viewer })
  assert.equal(salesList.statusCode, 200)
  assert.equal(salesList.json().total, 1)
  assert.equal(calls[0][1].query, '王师傅')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/sales-orders/${salesOrder.id}`, headers: reviewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/sales-orders/missing', headers: viewer })).statusCode, 404)

  const purchaseList = await app.inject({ method: 'GET', url: '/api/v2/business/purchase-orders?status=draft&supplierPartnerId=supplier-1', headers: viewer })
  assert.equal(purchaseList.statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'listPurchaseOrders')[1].supplierPartnerId, 'supplier-1')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/purchase-orders/${purchaseOrder.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/purchase-orders/missing', headers: viewer })).statusCode, 404)

  const denied = await app.inject({ method: 'POST', url: '/api/v2/business/inquiries/inquiry-1/convert-order', headers: viewer })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.order')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/sales-orders/${salesOrder.id}/transition`, headers: reviewer, payload: { expectedVersion: 1, status: 'confirmed' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/purchase-orders/${purchaseOrder.id}/transition`, headers: viewer, payload: { expectedVersion: 1, status: 'submitted' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/purchase-orders/${purchaseOrder.id}/receive`, headers: viewer, payload: { expectedVersion: 2, items: [{ itemId: 'item-1', quantity: 1 }] } })).statusCode, 403)

  const converted = await app.inject({ method: 'POST', url: '/api/v2/business/inquiries/inquiry-1/convert-order', headers: editor })
  assert.equal(converted.statusCode, 201)
  assert.equal(converted.json().salesOrder.id, salesOrder.id)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/sales-orders/${salesOrder.id}/transition`, headers: editor, payload: { expectedVersion: 1, status: 'confirmed' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/purchase-orders/${purchaseOrder.id}/transition`, headers: editor, payload: { expectedVersion: 1, status: 'submitted' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/purchase-orders/${purchaseOrder.id}/receive`, headers: editor, payload: { expectedVersion: 2, items: [{ itemId: 'item-1', quantity: 1 }] } })).statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'convertInquiry')[2].name, '业务员甲')

  await app.close()
})

test('idempotent conversion responses use success instead of creating a second order', async () => {
  const order = { id: 'sales-1', status: 'draft' }
  const app = buildApp({ businessOrderRepository: { convertInquiry: async () => ({ salesOrder: order, purchaseOrders: [], created: false }) }, logger: false })
  const response = await app.inject({ method: 'POST', url: '/api/v2/business/inquiries/inquiry-1/convert-order', headers: { 'x-operator-role': 'catalog_admin' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().created, false)
  await app.close()
})
