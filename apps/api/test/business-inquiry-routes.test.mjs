import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { normalizeBusinessInquiryInput } from '../src/business-inquiry-repository.mjs'

test('normalizes a business inquiry without losing vehicle and OE context', () => {
  const inquiry = normalizeBusinessInquiryInput({
    customerName: ' 王师傅汽修 ',
    vehicleLabel: 'Porsche Cayenne 95B',
    vin: 'wp1aa29p39la12345',
    priority: 'high',
    items: [{ requirementText: ' 前刹车片 ', oeNumber: ' 95b 698 151 h ', requestedQuantity: '2', unit: '套' }],
  })
  assert.equal(inquiry.customerName, '王师傅汽修')
  assert.equal(inquiry.vin, 'WP1AA29P39LA12345')
  assert.equal(inquiry.items[0].oeNumber, '95B 698 151 H')
  assert.equal(inquiry.items[0].requestedQuantity, 2)
  assert.equal(inquiry.nextAction, '核对需求并开始询价')
})

test('rejects incomplete or invalid inquiry input before writing data', () => {
  assert.throws(() => normalizeBusinessInquiryInput({ items: [{ requirementText: '空气滤芯' }] }), /客户或门店名称/)
  assert.throws(() => normalizeBusinessInquiryInput({ customerName: '测试客户', items: [] }), /1 至 50 项需求/)
  assert.throws(() => normalizeBusinessInquiryInput({ customerName: '测试客户', vin: 'INVALID', items: [{ requirementText: '空气滤芯' }] }), /VIN 必须是 17 位/)
  assert.throws(() => normalizeBusinessInquiryInput({ customerName: '测试客户', items: [{ requirementText: '空气滤芯', requestedQuantity: 0 }] }), /需求数量必须大于 0/)
  assert.throws(() => normalizeBusinessInquiryInput({ customerName: '测试客户', nextActionAt: '下周一', items: [{ requirementText: '空气滤芯' }] }), /下一步时间必须是有效时间/)
})

test('business inquiry routes expose reads while protecting operational writes', async () => {
  const calls = []
  const inquiry = { id: 'inquiry-1', inquiryNo: 'INQ-20261002-ABC123', status: 'new', version: 1, items: [{ id: 'item-1' }], quotes: [] }
  const repository = {
    quoteContext: async (input) => { calls.push(['quoteContext', input]); return { customers: [], vehicles: [], skus: [] } },
    quoteDecision: async (input) => { calls.push(['quoteDecision', input]); return { decisionFingerprint: 'decision-1', pricing: { marginFloorUnitPrice: 705.89 } } },
    createQuickQuote: async (input, actor) => { calls.push(['createQuickQuote', input, actor]); return { created: true, quoteId: 'quote-quick-1', inquiry } },
    list: async (input) => { calls.push(['list', input]); return { items: [inquiry], total: 1, page: 1, pageSize: 30, summary: { new: { count: 1, amount: 0 } } } },
    get: async (id) => { calls.push(['get', id]); return id === inquiry.id ? inquiry : null },
    create: async (input, actor) => { calls.push(['create', input, actor]); return inquiry },
    addOffer: async (id, itemId, input, actor) => { calls.push(['addOffer', id, itemId, input, actor]); return { ...inquiry, status: 'sourcing' } },
    createQuote: async (id, input, actor) => { calls.push(['createQuote', id, input, actor]); return { ...inquiry, status: 'quoting', quotes: [{ id: 'quote-1' }] } },
    reviseQuote: async (id, input, actor) => { calls.push(['reviseQuote', id, input, actor]); return { ...inquiry, status: 'quoting', quotes: [{ id: 'quote-2', predecessorQuoteId: id, versionNo: 2 }] } },
    sendQuote: async (id, input, actor) => { calls.push(['sendQuote', id, input, actor]); return { ...inquiry, status: 'quoted', version: 4 } },
    transition: async (id, input, actor) => { calls.push(['transition', id, input, actor]); return { ...inquiry, status: input.status } },
  }
  const app = buildApp({ businessInquiryRepository: repository, logger: false })

  const listed = await app.inject({ method: 'GET', url: '/api/v2/business/inquiries?q=Cayenne&status=new', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().total, 1)
  assert.equal(calls[0][1].query, 'Cayenne')

  const found = await app.inject({ method: 'GET', url: `/api/v2/business/inquiries/${inquiry.id}`, headers: { 'x-operator-role': 'catalog_reviewer' } })
  assert.equal(found.statusCode, 200)
  const missing = await app.inject({ method: 'GET', url: '/api/v2/business/inquiries/missing', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(missing.statusCode, 404)
  const context = await app.inject({ method: 'GET', url: '/api/v2/business/quick-quote/context?customerQuery=%E7%8E%8B%E5%B8%88%E5%82%85&skuQuery=95B', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(context.statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'quoteContext')[1].skuQuery, '95B')
  const decision = await app.inject({ method: 'GET', url: '/api/v2/business/quick-quote/decision?customerId=partner-1&customerVehicleId=vehicle-1&catalogSkuId=sku-1&quantity=2&costUnitPrice=600&saleUnitPrice=888', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(decision.statusCode, 200)
  assert.equal(decision.json().pricing.marginFloorUnitPrice, 705.89)
  assert.equal(calls.find((entry) => entry[0] === 'quoteDecision')[1].quantity, '2')

  const denied = await app.inject({ method: 'POST', url: '/api/v2/business/inquiries', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { customerName: '无权限客户' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.manage')
  const reviewerDenied = await app.inject({ method: 'POST', url: `/api/v2/business/inquiries/${inquiry.id}/quotes`, headers: { 'x-operator-role': 'catalog_reviewer' }, payload: { items: [] } })
  assert.equal(reviewerDenied.statusCode, 403)
  assert.equal(reviewerDenied.json().details.capability, 'business.quote')
  const quickDenied = await app.inject({ method: 'POST', url: '/api/v2/business/quick-quotes', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { requestKey: 'quick-denied-1' } })
  assert.equal(quickDenied.statusCode, 403)

  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('业务员甲'), 'x-operator-id': 'sales-1' }
  const created = await app.inject({ method: 'POST', url: '/api/v2/business/inquiries', headers: editor, payload: { customerName: '王师傅汽修', items: [{ requirementText: '前刹车片' }] } })
  assert.equal(created.statusCode, 201)
  const quick = await app.inject({ method: 'POST', url: '/api/v2/business/quick-quotes', headers: editor, payload: { requestKey: 'quick-route-001', customerPartnerId: 'partner-1', customerVehicleId: 'vehicle-1', items: [{ catalogSkuId: 'sku-1', quantity: 1, saleUnitPrice: 850 }] } })
  assert.equal(quick.statusCode, 201)
  assert.equal(calls.find((entry) => entry[0] === 'createQuickQuote')[2].name, '业务员甲')
  const offered = await app.inject({ method: 'POST', url: `/api/v2/business/inquiries/${inquiry.id}/items/item-1/offers`, headers: editor, payload: { supplierName: '华东供应商', unitPrice: 680 } })
  assert.equal(offered.statusCode, 201)
  const quoted = await app.inject({ method: 'POST', url: `/api/v2/business/inquiries/${inquiry.id}/quotes`, headers: editor, payload: { items: [{ inquiryItemId: 'item-1', saleUnitPrice: 850 }] } })
  assert.equal(quoted.statusCode, 201)
  const sent = await app.inject({ method: 'POST', url: '/api/v2/business/quotes/quote-1/send', headers: editor, payload: { expectedRevision: 1 } })
  assert.equal(sent.statusCode, 200)
  const revised = await app.inject({ method: 'POST', url: '/api/v2/business/quotes/quote-1/revisions', headers: editor, payload: { expectedRevision: 2, reason: '客户要求调整价格' } })
  assert.equal(revised.statusCode, 201)
  assert.equal(calls.find((entry) => entry[0] === 'reviseQuote')[2].reason, '客户要求调整价格')
  const transitioned = await app.inject({ method: 'POST', url: `/api/v2/business/inquiries/${inquiry.id}/transition`, headers: editor, payload: { expectedVersion: 4, status: 'follow_up' } })
  assert.equal(transitioned.statusCode, 200)
  assert.equal(transitioned.json().status, 'follow_up')
  assert.equal(calls.find((entry) => entry[0] === 'create')[2].name, '业务员甲')

  await app.close()
})
