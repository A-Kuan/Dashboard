import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

function createCatalogRepository() {
  const items = []
  const intakes = []
  let nextId = 1
  const changes = new Map()
  function find(id) {
    return items.find((item) => item.id === id || item.identity.skuCode === id) || null
  }
  function conflict(currentVersion) {
    const error = new Error(`资料已被其他操作更新（当前版本 v${currentVersion}），请刷新后再编辑`)
    error.statusCode = 409
    error.errorCode = 'CATALOG_VERSION_CONFLICT'
    error.details = { currentVersion }
    return error
  }
  return {
    async list({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
      const term = String(query).toLowerCase()
      const filtered = items.filter((item) => (!status || item.lifecycleStatus === status) && (!term || JSON.stringify(item).toLowerCase().includes(term)))
      return { items: filtered, total: filtered.length, page: Number(page), pageSize: Number(pageSize), statusCounts: { draft: filtered.filter((item) => item.lifecycleStatus === 'draft').length, verified: filtered.filter((item) => item.lifecycleStatus === 'verified').length } }
    },
    async findDuplicates(identifier, exceptId) {
      const normalized = String(identifier).toUpperCase().replace(/[\s._/#+()\-]/g, '')
      return items.filter((item) => item.id !== exceptId && item.identifiers.some((entry) => entry.normalizedValue === normalized)).map((item) => ({ skuId: item.id, skuCode: item.identity.skuCode, nameZh: item.identity.nameZh }))
    },
    async get(id) { return find(id) },
    async create(input, actor) {
      const item = { id: `catalog-${nextId++}`, ...structuredClone(input), identity: { ...input.identity, skuCode: input.identity.skuCode || `SKU-AUTO-${nextId}` }, version: 1, createdBy: actor, updatedBy: actor }
      items.push(item)
      changes.set(item.id, [{ version: 1, action: 'create_draft', changedBy: actor }])
      return item
    },
    async update(id, input, expectedVersion, actor) {
      const item = find(id)
      if (item.version !== expectedVersion) throw conflict(item.version)
      Object.assign(item, structuredClone(input), { version: item.version + 1, updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: 'update_draft', changedBy: actor })
      return item
    },
    async verify(id, expectedVersion, actor) {
      const item = find(id)
      if (item.version !== expectedVersion) throw conflict(item.version)
      Object.assign(item, { version: item.version + 1, lifecycleStatus: 'verified', verificationLevel: 'verified', completenessScore: 100, updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: 'verify', changedBy: actor })
      return item
    },
    async changes(id) { return find(id) ? changes.get(find(id).id) : null },
    async createIntake(input, actor) {
      const intake = { id: `intake-${intakes.length + 1}`, ...structuredClone(input), state: 'received', version: 1, createdBy: actor }
      intakes.push(intake)
      return intake
    },
    async getIntake(id) { return intakes.find((item) => item.id === id) || null },
  }
}

function createCatalogImportRepository() {
  const jobs = []
  return {
    async createPreview(input, actor) {
      const rows = (input.rows || []).map((row, index) => ({
        id: `row-${index + 1}`, rowNumber: index + 2, payload: { identity: { nameZh: row.nameZh }, identifiers: row.primaryOe ? [{ rawValue: row.primaryOe, isPrimary: true }] : [] },
        state: row.nameZh && row.primaryOe ? row.primaryOe === 'DUPLICATE' ? 'duplicate' : 'ready' : 'invalid', issues: [], duplicateMatches: [],
      }))
      const job = { id: `import-${jobs.length + 1}`, sourceName: input.sourceName, state: 'preview', totalRows: rows.length, readyRows: rows.filter((row) => row.state === 'ready').length, duplicateRows: rows.filter((row) => row.state === 'duplicate').length, invalidRows: rows.filter((row) => row.state === 'invalid').length, importedRows: 0, failedRows: 0, version: 1, createdBy: actor, rows }
      jobs.push(job)
      return job
    },
    async get(id) { return jobs.find((job) => job.id === id) || null },
    async commit(id, input) {
      const job = jobs.find((item) => item.id === id)
      if (!job) return null
      if (job.version !== input.expectedVersion) {
        const error = new Error('导入批次已更新')
        error.statusCode = 409
        error.errorCode = 'IMPORT_VERSION_CONFLICT'
        throw error
      }
      job.rows = job.rows.map((row) => input.rowIds.includes(row.id) ? { ...row, state: 'imported', importedSkuId: `sku-${row.id}` } : { ...row, state: 'skipped' })
      job.importedRows = input.rowIds.length
      job.state = 'completed'
      job.version += 2
      return job
    },
  }
}

test('catalog v2 accepts incomplete drafts without touching the legacy SKU contract', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const created = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: { identity: { nameZh: '前刹车片' } } })
  assert.equal(created.statusCode, 201)
  assert.match(created.json().identity.skuCode, /^SKU-AUTO-/)
  assert.equal(created.json().completenessScore, 20)
  assert.equal(created.json().lifecycleStatus, 'draft')
  assert.equal((await app.inject('/api/v2/catalog/skus?q=刹车')).json().total, 1)
  await app.close()
})

test('catalog v2 captures source intake and preserves raw source context', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const response = await app.inject({
    method: 'POST', url: '/api/v2/catalog/intakes',
    payload: { sourceType: 'vin_epc', sourceContext: { vin: 'WP1ZZZ95ZHLB12345' }, rawPayload: { figure: '601-05' } },
  })
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().sourceContext.vin, 'WP1ZZZ95ZHLB12345')
  assert.equal((await app.inject('/api/v2/catalog/intakes/intake-1')).json().rawPayload.figure, '601-05')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/catalog/intakes', payload: { sourceType: 'unknown' } })).statusCode, 400)
  await app.close()
})

test('catalog v2 requires traceable complete data before verification', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const draft = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: { identity: { nameZh: '前刹车片' } } })).json()
  const rejected = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/verify`, payload: { expectedVersion: 1 } })
  assert.equal(rejected.statusCode, 422)
  assert.equal(rejected.json().error, 'SKU_NOT_VERIFIABLE')
  assert.deepEqual(rejected.json().details.issues, ['classification', 'primaryIdentifier', 'fitment', 'evidence'])

  const completed = await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${draft.id}`, payload: {
    expectedVersion: 1,
    identity: { ...draft.identity, brandCode: 'POR', brandLabel: 'Porsche', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'epc-1', sourceType: 'vin_epc', sourceSystem: 'Porsche EPC', sourceRecordId: '601-05-01', catalogPath: '前桥/制动器' }],
    identifiers: [{ clientKey: 'oe-1', type: 'oe', rawValue: '95B 698 151 H', isPrimary: true, evidenceKey: 'epc-1' }],
    fitments: [{ vehicleLabel: 'Porsche Macan (95B)', years: '2014-2018', engineCodes: ['CYP'], evidenceKey: 'epc-1' }],
  } })
  assert.equal(completed.statusCode, 200)
  assert.equal(completed.json().completenessScore, 100)
  assert.equal(completed.json().identifiers[0].normalizedValue, '95B698151H')
  assert.match(completed.json().evidence[0].immutableHash, /^[a-f0-9]{64}$/)
  const verified = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/verify`, payload: { expectedVersion: 2 } })
  assert.equal(verified.statusCode, 200)
  assert.equal(verified.json().lifecycleStatus, 'verified')
  assert.equal((await app.inject(`/api/v2/catalog/skus/${draft.id}/changes`)).json().items[0].action, 'verify')
  await app.close()
})

test('catalog v2 rejects broken provenance links and duplicate identifiers', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const brokenEvidence = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: {
    identifiers: [{ rawValue: '95B698151H', evidenceKey: 'missing' }],
  } })
  assert.equal(brokenEvidence.statusCode, 400)
  assert.match(brokenEvidence.json().message, /不存在的来源证据/)
  const duplicate = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: {
    identifiers: [{ type: 'oe', rawValue: '95B 698 151 H' }, { type: 'oe', rawValue: '95B-698-151-H' }],
  } })
  assert.equal(duplicate.statusCode, 400)
  assert.match(duplicate.json().message, /重复/)
  await app.close()
})

test('catalog v2 rejects stale updates with the current version', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const draft = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: {} })).json()
  const saved = await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${draft.id}`, payload: { expectedVersion: 1, identity: { nameZh: '第一次保存' } } })
  assert.equal(saved.json().identity.skuCode, draft.identity.skuCode)
  const stale = await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${draft.id}`, payload: { expectedVersion: 1, identity: { nameZh: '覆盖保存' } } })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().error, 'CATALOG_VERSION_CONFLICT')
  assert.equal(stale.json().details.currentVersion, 2)
  await app.close()
})

test('catalog v2 detects normalized duplicate identifiers without blocking legitimate drafts', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const first = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: {
    identity: { nameZh: '前刹车片' }, identifiers: [{ rawValue: '95B 698 151 H', isPrimary: true }],
  } })).json()
  const duplicates = await app.inject('/api/v2/catalog/duplicates?identifier=95B-698-151-H')
  assert.equal(duplicates.statusCode, 200)
  assert.equal(duplicates.json().items[0].skuId, first.id)
  const exceptCurrent = await app.inject(`/api/v2/catalog/duplicates?identifier=95B698151H&exceptId=${first.id}`)
  assert.deepEqual(exceptCurrent.json().items, [])
  assert.equal((await app.inject('/api/v2/catalog/duplicates')).statusCode, 400)
  await app.close()
})

test('catalog v2 previews and commits explicitly selected import rows', async () => {
  const app = buildApp({ catalogImportRepository: createCatalogImportRepository(), logger: false })
  const preview = await app.inject({ method: 'POST', url: '/api/v2/catalog/imports', payload: {
    sourceName: 'sku-import.csv', rows: [
      { nameZh: '前刹车片', primaryOe: '95B698151H' },
      { nameZh: '重复件', primaryOe: 'DUPLICATE' },
      { nameZh: '', primaryOe: '' },
    ],
  } })
  assert.equal(preview.statusCode, 201)
  assert.equal(preview.json().readyRows, 1)
  assert.equal(preview.json().duplicateRows, 1)
  assert.equal(preview.json().invalidRows, 1)
  const job = preview.json()
  const committed = await app.inject({ method: 'POST', url: `/api/v2/catalog/imports/${job.id}/commit`, payload: { expectedVersion: 1, rowIds: [job.rows[0].id] } })
  assert.equal(committed.statusCode, 200)
  assert.equal(committed.json().state, 'completed')
  assert.equal(committed.json().importedRows, 1)
  assert.equal(committed.json().rows[1].state, 'skipped')
  assert.equal((await app.inject(`/api/v2/catalog/imports/${job.id}`)).statusCode, 200)
  await app.close()
})
