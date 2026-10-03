import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { normalizeBusinessPartnerInput } from '../src/business-partner-repository.mjs'

test('normalizes partner master data and rejects unsafe values', () => {
  const partner = normalizeBusinessPartnerInput({ partnerType: 'supplier', name: ' 华东供应商 ', email: 'SALES@EXAMPLE.COM', paymentTermsDays: '30', creditLimit: '50000.126' })
  assert.equal(partner.name, '华东供应商')
  assert.equal(partner.email, 'sales@example.com')
  assert.equal(partner.paymentTermsDays, 30)
  assert.equal(partner.creditLimit, 50000.13)
  assert.throws(() => normalizeBusinessPartnerInput({ partnerType: 'other', name: '无效类型' }), /合作方类型无效/)
  assert.throws(() => normalizeBusinessPartnerInput({ partnerType: 'customer', name: '', email: 'bad' }), /名称为必填项/)
  assert.throws(() => normalizeBusinessPartnerInput({ partnerType: 'customer', name: '测试', paymentTermsDays: 1.5 }), /账期天数/)
})

test('partner routes keep reads visible and protect master-data writes', async () => {
  const calls = []
  const partner = { id: 'partner-1', partnerNo: 'BP-20261003-ABC123', partnerType: 'customer', name: '王师傅汽修', status: 'active', version: 1, contacts: [], vehicles: [] }
  const repository = {
    list: async (input) => { calls.push(['list', input]); return { items: [partner], total: 1, page: 1, pageSize: 30, summary: [] } },
    get: async (id) => { calls.push(['get', id]); return id === partner.id ? partner : null },
    onboardQuickQuoteCustomer: async (input, actor) => { calls.push(['onboardQuickQuoteCustomer', input, actor]); return { created: true, createdPartner: true, createdVehicle: true, matchedBy: 'created', customer: partner, vehicle: { id: 'vehicle-1' } } },
    create: async (input, actor) => { calls.push(['create', input, actor]); return partner },
    update: async (id, input, actor) => { calls.push(['update', id, input, actor]); return { ...partner, ...input, version: 2 } },
    addContact: async (id, input, actor) => { calls.push(['addContact', id, input, actor]); return { ...partner, contacts: [{ id: 'contact-1', name: input.name }] } },
    updateContact: async (id, contactId, input, actor) => { calls.push(['updateContact', id, contactId, input, actor]); return partner },
    addVehicle: async (id, input, actor) => { calls.push(['addVehicle', id, input, actor]); return { ...partner, vehicles: [{ id: 'vehicle-1', vehicleLabel: input.vehicleLabel }] } },
    updateVehicle: async (id, vehicleId, input, actor) => { calls.push(['updateVehicle', id, vehicleId, input, actor]); return partner },
  }
  const app = buildApp({ businessPartnerRepository: repository, logger: false })

  const listed = await app.inject({ method: 'GET', url: '/api/v2/business/partners?q=王师傅&type=customer&status=active', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(listed.statusCode, 200)
  assert.equal(calls[0][1].partnerType, 'customer')
  const found = await app.inject({ method: 'GET', url: `/api/v2/business/partners/${partner.id}`, headers: { 'x-operator-role': 'catalog_reviewer' } })
  assert.equal(found.statusCode, 200)
  const missing = await app.inject({ method: 'GET', url: '/api/v2/business/partners/missing', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(missing.statusCode, 404)

  const denied = await app.inject({ method: 'POST', url: '/api/v2/business/partners', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { partnerType: 'customer', name: '无权限' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.manage')
  const onboardingDenied = await app.inject({ method: 'POST', url: '/api/v2/business/quick-quote/customer-onboarding', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { requestKey: 'denied' } })
  assert.equal(onboardingDenied.statusCode, 403)
  assert.equal(onboardingDenied.json().details.capability, 'business.quote')

  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('业务员甲'), 'x-operator-id': 'sales-1' }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/partners', headers: editor, payload: { partnerType: 'customer', name: '王师傅汽修' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/business/quick-quote/customer-onboarding', headers: editor, payload: { requestKey: 'onboard-1', customer: { name: '新客户', phone: '13800000000' }, vehicle: { platformMasterId: 'platform-1' } } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/business/partners/${partner.id}`, headers: editor, payload: { expectedVersion: 1, address: '杭州' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/partners/${partner.id}/contacts`, headers: editor, payload: { expectedPartnerVersion: 1, name: '王师傅' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/business/partners/${partner.id}/contacts/contact-1`, headers: editor, payload: { expectedPartnerVersion: 2, expectedVersion: 1, name: '王师傅' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/business/partners/${partner.id}/vehicles`, headers: editor, payload: { expectedPartnerVersion: 3, vehicleLabel: 'Cayenne 95B' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/business/partners/${partner.id}/vehicles/vehicle-1`, headers: editor, payload: { expectedPartnerVersion: 4, expectedVersion: 1, vehicleLabel: 'Cayenne 95B' } })).statusCode, 200)
  assert.equal(calls.find((entry) => entry[0] === 'create')[2].name, '业务员甲')
  assert.equal(calls.find((entry) => entry[0] === 'onboardQuickQuoteCustomer')[2].name, '业务员甲')

  await app.close()
})
