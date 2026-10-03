import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { createBusinessMasterDataQualityRepository } from '../src/business-master-data-quality-repository.mjs'

test('master-data quality routes expose candidates and reserve decisions for reviewers', async () => {
  const calls = []
  const issueKey = 'vehicle_duplicate:vehicle-1:vehicle-2'
  const repository = {
    list: async (input) => { calls.push(['list', input]); return { items: [{ issueKey, kind: 'vehicle_duplicate', severity: 'high', status: 'open' }], total: 1, page: 2, pageSize: 10, summary: { open: 1 } } },
    decide: async (key, input, actor) => { calls.push(['decide', key, input, actor]); return { created: true, item: { issueKey: key }, decision: { decision: input.decision, actorName: actor.name } } },
  }
  const app = buildApp({ businessMasterDataQualityRepository: repository, logger: false })
  const viewer = { 'x-operator-role': 'catalog_viewer' }
  const listed = await app.inject({ method: 'GET', url: '/api/v2/business/master-data-quality?kind=vehicle_duplicate&status=open&severity=high&q=Cayenne&page=2&pageSize=10', headers: viewer })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().items[0].issueKey, issueKey)
  assert.deepEqual(calls[0][1], { kind: 'vehicle_duplicate', status: 'open', severity: 'high', query: 'Cayenne', page: '2', pageSize: '10' })
  const editor = { 'x-operator-role': 'catalog_editor', 'x-operator-id': 'editor-1', 'x-operator-name': encodeURIComponent('业务员甲') }
  const denied = await app.inject({ method: 'POST', url: `/api/v2/business/master-data-quality/${encodeURIComponent(issueKey)}/decisions`, headers: editor, payload: { requestKey: 'decision-1', issueFingerprint: 'a'.repeat(64), decision: 'not_duplicate', reason: '确认不是同一辆车' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'business.data_quality.review')
  const reviewer = { 'x-operator-role': 'catalog_reviewer', 'x-operator-id': 'reviewer-1', 'x-operator-name': encodeURIComponent('资料复核员') }
  const decided = await app.inject({ method: 'POST', url: `/api/v2/business/master-data-quality/${encodeURIComponent(issueKey)}/decisions`, headers: reviewer, payload: { requestKey: 'decision-1', issueFingerprint: 'a'.repeat(64), decision: 'not_duplicate', reason: '确认不是同一辆车' } })
  assert.equal(decided.statusCode, 201)
  assert.equal(decided.json().decision.actorName, '资料复核员')
  await app.close()
})

test('master-data quality repository validates filters before querying the database', async () => {
  const repository = createBusinessMasterDataQualityRepository({ query: async () => { throw new Error('database should not be queried') } })
  await assert.rejects(() => repository.list({ kind: 'unknown' }), (error) => error.errorCode === 'INVALID_MASTER_DATA_QUALITY_KIND')
  await assert.rejects(() => repository.list({ status: 'closed' }), (error) => error.errorCode === 'INVALID_MASTER_DATA_QUALITY_STATUS')
  await assert.rejects(() => repository.list({ severity: 'low' }), (error) => error.errorCode === 'INVALID_MASTER_DATA_QUALITY_SEVERITY')
})
