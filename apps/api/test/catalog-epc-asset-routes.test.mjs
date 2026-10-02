import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

function fakeAssetRepository() {
  const asset = {
    id: 'asset-1', intakeId: 'intake-1', type: 'diagram', sourceUrl: 'https://assets.example.test/601.png',
    sourceRecordId: '601-01', figureCode: '601', title: 'Brake diagram', declaredContentType: 'image/png',
    expectedChecksum: '', metadata: {}, state: 'pending', storageKey: '', contentType: '', byteSize: 0,
    checksumSha256: '', attempts: 0, error: null, createdBy: 'fixture', version: 1,
  }
  return {
    async list() { return { items: [{ ...asset }], total: 1, summary: { total: 1, pending: asset.state === 'pending' ? 1 : 0, mirroring: 0, stored: asset.state === 'stored' ? 1 : 0, failed: 0, corrupt: 0 }, page: 1, pageSize: 50 } },
    async get(id) { return id === asset.id ? { ...asset, attemptHistory: [] } : null },
    async startMirror(id) { if (id !== asset.id) return null; asset.state = 'mirroring'; asset.attempts += 1; return { asset: { ...asset }, attemptId: 'attempt-mirror' } },
    async finishMirror(id, attemptId, result) { assert.equal(attemptId, 'attempt-mirror'); Object.assign(asset, result, { state: 'stored', version: asset.version + 1, contentUrl: `/api/v2/catalog/epc-assets/${id}/content` }); return { ...asset } },
    async failMirror() {},
    async startVerify(id) { if (id !== asset.id) return null; return { asset: { ...asset }, attemptId: 'attempt-verify' } },
    async finishVerify(id, attemptId, result) { assert.equal(attemptId, 'attempt-verify'); Object.assign(asset, result, { state: 'stored', version: asset.version + 1 }); return { ...asset } },
    async failVerify() {},
  }
}

test('mirrors, verifies and serves controlled EPC assets', async () => {
  const repository = fakeAssetRepository()
  const content = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const storage = {
    status: () => ({ configured: true, maxBytes: 1024, allowedHostsConfigured: true }),
    async mirror() { return { storageKey: 'ab/fixture.png', contentType: 'image/png', byteSize: content.length, checksumSha256: 'a'.repeat(64) } },
    async verify() { return { byteSize: content.length, checksumSha256: 'a'.repeat(64) } },
    async open() { return Readable.from(content) },
  }
  const app = buildApp({ catalogEpcAssetRepository: repository, catalogEpcAssetStorage: storage, logger: false })
  assert.equal((await app.inject('/api/v2/catalog/epc-asset-storage')).json().configured, true)
  const listed = await app.inject('/api/v2/catalog/epc-assets?intakeId=intake-1')
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.json().total, 1)
  const mirrored = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-assets/asset-1/mirror', payload: {} })
  assert.equal(mirrored.statusCode, 200)
  assert.equal(mirrored.json().state, 'stored')
  assert.equal(mirrored.json().checksumSha256.length, 64)
  const verified = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-assets/asset-1/verify', payload: {} })
  assert.equal(verified.statusCode, 200)
  const served = await app.inject('/api/v2/catalog/epc-assets/asset-1/content')
  assert.equal(served.statusCode, 200)
  assert.equal(served.headers['content-type'], 'image/png')
  assert.equal(served.headers['x-content-type-options'], 'nosniff')
  assert.deepEqual(served.rawPayload, content)
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/epc-assets/asset-1/verify', headers: { 'x-operator-role': 'catalog_viewer' }, payload: {} })
  assert.equal(denied.statusCode, 403)
  await app.close()
})
