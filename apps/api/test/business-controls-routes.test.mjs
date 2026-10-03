import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { evaluateQuoteRisk, normalizeBusinessControls } from '../src/business-quote-policy.mjs'

test('normalizes bounded business control settings', () => {
  assert.deepEqual(normalizeBusinessControls({ marginControlEnabled: false, minimumMarginRate: 12.34567, creditControlEnabled: true }), { marginControlEnabled: false, minimumMarginRate: 12.3457, creditControlEnabled: true })
  assert.throws(() => normalizeBusinessControls({ minimumMarginRate: 101 }), /0 到 100/)
  assert.throws(() => normalizeBusinessControls({ creditControlEnabled: 'false' }), /必须是布尔值/)
})

test('quote risk combines margin floor and projected customer exposure deterministically', async () => {
  const client = { query: async (sql) => {
    if (sql.includes("app_configuration WHERE key='business_controls'")) return { rows: [{ payload: { marginControlEnabled: true, minimumMarginRate: 15, creditControlEnabled: true }, version: 3 }] }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] }
    if (sql.includes('FROM business_partner')) return { rows: [{ id: 'customer-1', name: '测试汽修', payment_terms_days: 30, credit_limit: 1000 }] }
    if (sql.includes('FROM business_receivable')) return { rows: [{ amount: 400 }] }
    throw new Error(`unexpected query: ${sql}`)
  } }
  const risk = await evaluateQuoteRisk(client, { customerPartnerId: 'customer-1', currency: 'CNY', totalAmount: 800, marginAmount: 80 })
  assert.deepEqual(risk.reasons, ['low_margin', 'credit_limit_exceeded'])
  assert.equal(risk.marginRate, 10)
  assert.equal(risk.snapshot.projectedExposure, 1200)
  const repeated = await evaluateQuoteRisk(client, { customerPartnerId: 'customer-1', currency: 'CNY', totalAmount: 800, marginAmount: 80 })
  assert.equal(repeated.fingerprint, risk.fingerprint)
})

test('business control routes allow reads but reserve policy changes for administrators', async () => {
  const calls = []
  const repository = {
    get: async () => ({ controls: { marginControlEnabled: true, minimumMarginRate: 15, creditControlEnabled: true }, version: 1, events: [] }),
    update: async (input, actor) => { calls.push([input, actor]); return { controls: input, version: 2, events: [] } },
  }
  const app = buildApp({ businessControlsRepository: repository, logger: false })
  const read = await app.inject({ method: 'GET', url: '/api/v2/business/controls', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(read.statusCode, 200)
  assert.equal(read.json().version, 1)
  const denied = await app.inject({ method: 'PATCH', url: '/api/v2/business/controls', headers: { 'x-operator-role': 'catalog_editor' }, payload: { expectedVersion: 1, minimumMarginRate: 12 } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.policy')
  const admin = { 'x-operator-role': 'catalog_admin', 'x-operator-id': 'admin-1', 'x-operator-name': encodeURIComponent('管理员甲') }
  const updated = await app.inject({ method: 'PATCH', url: '/api/v2/business/controls', headers: admin, payload: { expectedVersion: 1, minimumMarginRate: 12 } })
  assert.equal(updated.statusCode, 200)
  assert.equal(calls[0][1].name, '管理员甲')
  await app.close()
})

test('quote approval route is independent from quote creation permission', async () => {
  const calls = []
  const repository = { reviewQuoteApproval: async (id, input, actor) => { calls.push([id, input, actor]); return { id: 'inquiry-1', quotes: [{ id, approvalStatus: input.decision }] } } }
  const app = buildApp({ businessInquiryRepository: repository, logger: false })
  const editor = await app.inject({ method: 'POST', url: '/api/v2/business/quotes/quote-1/approval', headers: { 'x-operator-role': 'catalog_editor' }, payload: { expectedRevision: 1, decision: 'approved' } })
  assert.equal(editor.statusCode, 403)
  const reviewer = await app.inject({ method: 'POST', url: '/api/v2/business/quotes/quote-1/approval', headers: { 'x-operator-role': 'catalog_reviewer', 'x-operator-id': 'reviewer-1', 'x-operator-name': encodeURIComponent('审核员甲') }, payload: { expectedRevision: 1, decision: 'approved', note: '额度与毛利已复核' } })
  assert.equal(reviewer.statusCode, 200)
  assert.equal(calls[0][2].name, '审核员甲')
  await app.close()
})
