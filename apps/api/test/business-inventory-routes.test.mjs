import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { normalizeWarehouseInput } from '../src/business-inventory-repository.mjs'

test('normalizes warehouse master data and rejects unsafe codes', () => {
  const warehouse = normalizeWarehouseInput({ warehouseCode: ' hz-main ', name: ' 杭州主仓 ', isDefault: true })
  assert.equal(warehouse.warehouseCode, 'HZ-MAIN')
  assert.equal(warehouse.name, '杭州主仓')
  assert.equal(warehouse.isDefault, true)
  assert.throws(() => normalizeWarehouseInput({ warehouseCode: '中转仓', name: '中转仓' }), /仓库编码/)
  assert.throws(() => normalizeWarehouseInput({ warehouseCode: 'A', name: '过短' }), /2 至 32 位/)
  assert.throws(() => normalizeWarehouseInput({ warehouseCode: 'HZ-02', name: '', status: 'active' }), /仓库名称/)
})

test('inventory routes expose stock evidence while protecting every stock mutation', async () => {
  const calls = []
  const warehouse = { id: 'warehouse-1', warehouseCode: 'HZ-MAIN', name: '杭州主仓', status: 'active', isDefault: true, version: 1 }
  const receipt = { id: 'receipt-1', receiptNo: 'GR-20261003-ABC123', purchaseOrderId: 'purchase-1', warehouseId: warehouse.id, items: [] }
  const reservation = { id: 'reservation-1', reservationNo: 'RSV-20261003-ABC123', salesOrderId: 'sales-1', warehouseId: warehouse.id, status: 'active', version: 1, items: [] }
  const shipment = { id: 'shipment-1', shipmentNo: 'SHP-20261003-ABC123', salesOrderId: 'sales-1', warehouseId: warehouse.id, items: [] }
  const repository = {
    listWarehouses: async () => { calls.push(['listWarehouses']); return { items: [warehouse] } },
    getWarehouse: async (id) => { calls.push(['getWarehouse', id]); return id === warehouse.id ? warehouse : null },
    createWarehouse: async (input, actor) => { calls.push(['createWarehouse', input, actor]); return warehouse },
    updateWarehouse: async (id, input, actor) => { calls.push(['updateWarehouse', id, input, actor]); return { ...warehouse, ...input, version: 2 } },
    listBalances: async (input) => { calls.push(['listBalances', input]); return { items: [], total: 0, page: 1, pageSize: 50 } },
    listMovements: async (input) => { calls.push(['listMovements', input]); return { items: [], total: 0, page: 1, pageSize: 50 } },
    receivePurchaseOrder: async (id, input, actor) => { calls.push(['receivePurchaseOrder', id, input, actor]); return { receipt, created: true } },
    getReceipt: async (id) => { calls.push(['getReceipt', id]); return id === receipt.id ? receipt : null },
    reserveSalesOrder: async (id, input, actor) => { calls.push(['reserveSalesOrder', id, input, actor]); return { reservation, created: true } },
    getReservation: async (id) => { calls.push(['getReservation', id]); return id === reservation.id ? reservation : null },
    releaseReservation: async (id, input, actor) => { calls.push(['releaseReservation', id, input, actor]); return { ...reservation, status: 'released', version: 2 } },
    shipSalesOrder: async (id, input, actor) => { calls.push(['shipSalesOrder', id, input, actor]); return { shipment, created: true } },
    getShipment: async (id) => { calls.push(['getShipment', id]); return id === shipment.id ? shipment : null },
  }
  const app = buildApp({ businessInventoryRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('仓库员甲'), 'x-operator-id': 'warehouse-user-1' }

  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/warehouses', headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/warehouses/${warehouse.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/business/warehouses/missing', headers: viewer })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/inventory-balances?warehouseId=${warehouse.id}&q=刹车`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/inventory-movements?warehouseId=${warehouse.id}&stockKey=oe:95B698151H`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/goods-receipts/${receipt.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/reservations/${reservation.id}`, headers: viewer })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v2/business/shipments/${shipment.id}`, headers: viewer })).statusCode, 200)

  const denied = await app.inject({ method: 'POST', url: '/api/v2/business/warehouses', headers: viewer, payload: { warehouseCode: 'HZ-01', name: '杭州仓' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.inventory')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/purchase-orders/purchase-1/receipts', headers: viewer, payload: {} })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/sales-orders/sales-1/reservations', headers: viewer, payload: {} })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/reservations/reservation-1/release', headers: viewer, payload: {} })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/sales-orders/sales-1/shipments', headers: viewer, payload: {} })).statusCode, 403)

  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/warehouses', headers: editor, payload: { warehouseCode: 'HZ-MAIN', name: '杭州主仓' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/business/warehouses/${warehouse.id}`, headers: editor, payload: { expectedVersion: 1, address: '杭州' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/purchase-orders/purchase-1/receipts', headers: editor, payload: { requestKey: 'receipt-1', warehouseId: warehouse.id, expectedVersion: 3, items: [{ itemId: 'item-1', quantity: 1 }] } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/sales-orders/sales-1/reservations', headers: editor, payload: { warehouseId: warehouse.id, items: [{ itemId: 'sales-item-1', quantity: 1 }] } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/reservations/${reservation.id}/release`, headers: editor, payload: { expectedVersion: 1 } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/sales-orders/sales-1/shipments', headers: editor, payload: { requestKey: 'shipment-1', reservationId: reservation.id, expectedReservationVersion: 1, items: [{ itemId: 'sales-item-1', quantity: 1 }] } })).statusCode, 201)
  assert.equal(calls.find((entry) => entry[0] === 'createWarehouse')[2].name, '仓库员甲')

  await app.close()
})
