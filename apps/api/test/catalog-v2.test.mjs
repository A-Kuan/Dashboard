import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { resolveCatalogActor } from '../src/catalog-access.mjs'

function createCatalogRepository() {
  const items = []
  const intakes = []
  const resolutions = []
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
  function duplicateMatches(identifier, exceptId, unresolvedOnly = false) {
    const normalized = String(identifier).toUpperCase().replace(/[\s._/#+()\-]/g, '')
    return items.filter((item) => item.id !== exceptId && item.identifiers.some((entry) => entry.normalizedValue === normalized) && (!unresolvedOnly || !resolutions.some((resolution) => resolution.normalizedValue === normalized && ['shared_reference', 'separate_scope'].includes(resolution.resolutionType) && [resolution.skuIdA, resolution.skuIdB].includes(exceptId) && [resolution.skuIdA, resolution.skuIdB].includes(item.id)))).map((item) => ({ skuId: item.id, skuCode: item.identity.skuCode, nameZh: item.identity.nameZh }))
  }
  return {
    async list({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
      const term = String(query).toLowerCase()
      const filtered = items.filter((item) => (!status || item.lifecycleStatus === status) && (!term || JSON.stringify(item).toLowerCase().includes(term)))
      return { items: filtered, total: filtered.length, page: Number(page), pageSize: Number(pageSize), statusCounts: { draft: filtered.filter((item) => item.lifecycleStatus === 'draft').length, verified: filtered.filter((item) => item.lifecycleStatus === 'verified').length } }
    },
    async qualityQueue({ issue = '', status = '', page = 1, pageSize = 30 } = {}) {
      const withIssues = items.map((item) => ({ ...item, qualityIssues: item.completenessScore === 100 ? [] : ['fitment'] }))
      const filtered = withIssues.filter((item) => (!status || item.lifecycleStatus === status) && (!issue || item.qualityIssues.includes(issue)) && (['draft', 'review'].includes(item.lifecycleStatus) || item.qualityIssues.length))
      return { items: filtered, total: filtered.length, page: Number(page), pageSize: Number(pageSize), statusCounts: { draft: filtered.filter((item) => item.lifecycleStatus === 'draft').length, review: filtered.filter((item) => item.lifecycleStatus === 'review').length }, issueCounts: { fitment: filtered.filter((item) => item.qualityIssues.includes('fitment')).length } }
    },
    async metrics({ days = 30 } = {}) {
      return { days: Number(days), statusCounts: { draft: items.filter((item) => item.lifecycleStatus === 'draft').length }, issueCounts: { fitment: items.filter((item) => item.completenessScore < 100).length }, completeness: { low: 1, medium: 0, complete: 0 }, reviews: { submitted: 0, approved: 0, rejected: 0, avg_hours: 0, overdue: 0 }, imports: { batches: 0, total_rows: 0, imported_rows: 0, failed_rows: 0, successRate: 0 }, activity: [] }
    },
    async exportSnapshot({ status = '' } = {}) {
      const selected = items.filter((item) => !status || item.lifecycleStatus === status).map((item) => ({ ...structuredClone(item), changes: structuredClone(changes.get(item.id) || []) }))
      return {
        schemaVersion: 'catalog-export-v1', exportId: 'export-1', generatedAt: '2026-10-02T00:00:00.000Z', filter: { status: status || 'all' },
        counts: { skus: selected.length, identifiers: selected.reduce((sum, item) => sum + item.identifiers.length, 0), fitments: selected.reduce((sum, item) => sum + item.fitments.length, 0), evidence: selected.reduce((sum, item) => sum + item.evidence.length, 0), changes: selected.reduce((sum, item) => sum + item.changes.length, 0), identifierResolutions: resolutions.length, merges: 0 },
        checksum: { algorithm: 'sha256', value: 'a'.repeat(64) }, items: selected, relations: { identifierResolutions: structuredClone(resolutions), merges: [] },
      }
    },
    async findDuplicates(identifier, exceptId) {
      return duplicateMatches(identifier, exceptId)
    },
    async findUnresolvedDuplicates(identifier, exceptId) { return duplicateMatches(identifier, exceptId, true) },
    async identifierConflicts() {
      const pairs = []
      for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const left = items[leftIndex]
        const right = items[rightIndex]
        if (left.lifecycleStatus === 'discontinued' || right.lifecycleStatus === 'discontinued') continue
        const shared = left.identifiers.find((entry) => right.identifiers.some((other) => other.normalizedValue === entry.normalizedValue))
        if (!shared) continue
        const resolution = resolutions.find((entry) => entry.normalizedValue === shared.normalizedValue && entry.skuIdA === left.id && entry.skuIdB === right.id)
        pairs.push({ key: `${shared.normalizedValue}:${left.id}:${right.id}`, normalizedValue: shared.normalizedValue, rawValues: [shared.rawValue, shared.rawValue], left: { id: left.id, skuCode: left.identity.skuCode, nameZh: left.identity.nameZh, lifecycleStatus: left.lifecycleStatus, completenessScore: left.completenessScore, version: left.version }, right: { id: right.id, skuCode: right.identity.skuCode, nameZh: right.identity.nameZh, lifecycleStatus: right.lifecycleStatus, completenessScore: right.completenessScore, version: right.version }, resolution: resolution || null })
      }
      return pairs
    },
    async resolveIdentifierConflict(input, actor) {
      const left = find(input.skuIdA)
      const right = find(input.skuIdB)
      if (left.version !== input.expectedVersionA) throw conflict(left.version)
      if (right.version !== input.expectedVersionB) throw conflict(right.version)
      const resolution = { id: `resolution-${resolutions.length + 1}`, normalizedValue: input.normalizedValue, skuIdA: left.id, skuIdB: right.id, resolutionType: input.resolutionType, note: input.note, resolvedBy: actor }
      resolutions.push(resolution)
      for (const item of [left, right]) {
        item.version += 1
        changes.get(item.id).unshift({ version: item.version, action: 'resolve_identifier_conflict', changedBy: actor, summary: resolution, snapshot: structuredClone(item) })
      }
      return { ...resolution, items: [left, right] }
    },
    async mergePreview(input) {
      const survivor = find(input.survivorSkuId)
      const retired = find(input.retiredSkuId)
      const resolution = resolutions.find((entry) => entry.normalizedValue === input.normalizedValue && entry.resolutionType === 'merge_required' && [entry.skuIdA, entry.skuIdB].includes(survivor?.id) && [entry.skuIdA, entry.skuIdB].includes(retired?.id))
      if (!survivor || !retired || !resolution) {
        const error = new Error('请先把该编号冲突标记为“确认为重复，待合并”')
        error.statusCode = 409
        error.errorCode = 'INVALID_STATUS_TRANSITION'
        throw error
      }
      const additions = {
        identifiers: retired.identifiers.filter((entry) => !survivor.identifiers.some((item) => item.type === entry.type && item.normalizedValue === entry.normalizedValue)),
        evidence: retired.evidence.filter((entry) => !survivor.evidence.some((item) => item.immutableHash === entry.immutableHash)),
        fitments: retired.fitments.filter((entry) => !survivor.fitments.some((item) => item.vehicleLabel === entry.vehicleLabel && item.years === entry.years)),
        interchanges: retired.interchanges,
      }
      return { normalizedValue: input.normalizedValue, survivor, retired, resolution, additions, identityDifferences: [], summary: { identifiersAdded: additions.identifiers.length, identifiersDeduplicated: retired.identifiers.length - additions.identifiers.length, fitmentsAdded: additions.fitments.length, fitmentsDeduplicated: retired.fitments.length - additions.fitments.length, evidenceAdded: additions.evidence.length, evidenceDeduplicated: retired.evidence.length - additions.evidence.length, interchangesReviewed: additions.interchanges.length } }
    },
    async mergeSkus(input, actor) {
      const preview = await this.mergePreview(input)
      const { survivor, retired } = preview
      if (survivor.version !== input.survivorExpectedVersion) throw conflict(survivor.version)
      if (retired.version !== input.retiredExpectedVersion) throw conflict(retired.version)
      if (!input.reason) throw Object.assign(new Error('请填写合并依据'), { statusCode: 409, errorCode: 'INVALID_STATUS_TRANSITION' })
      survivor.identifiers.push(...structuredClone(preview.additions.identifiers).map((entry) => ({ ...entry, isPrimary: false })))
      survivor.evidence.push(...structuredClone(preview.additions.evidence))
      survivor.fitments.push(...structuredClone(preview.additions.fitments))
      survivor.interchanges.push(...structuredClone(preview.additions.interchanges))
      Object.assign(survivor, { version: survivor.version + 1, lifecycleStatus: 'draft', verificationLevel: 'unverified', updatedBy: actor })
      Object.assign(retired, { version: retired.version + 1, lifecycleStatus: 'discontinued', verificationLevel: 'unverified', discontinuedReason: `已合并至 ${survivor.identity.skuCode}`, identifiers: [], evidence: [], fitments: [], interchanges: [], updatedBy: actor })
      changes.get(survivor.id).unshift({ version: survivor.version, action: 'merge_absorb', changedBy: actor, summary: { retiredSkuId: retired.id, reason: input.reason }, snapshot: structuredClone(survivor) })
      changes.get(retired.id).unshift({ version: retired.version, action: 'merge_retire', changedBy: actor, summary: { survivorSkuId: survivor.id, reason: input.reason }, snapshot: structuredClone(retired) })
      return { id: `merge-${retired.id}`, normalizedValue: input.normalizedValue, reason: input.reason, summary: preview.summary, survivor, retired }
    },
    async get(id) { return find(id) },
    async create(input, actor) {
      const item = { id: `catalog-${nextId++}`, ...structuredClone(input), identity: { ...input.identity, skuCode: input.identity.skuCode || `SKU-AUTO-${nextId}` }, version: 1, createdBy: actor, updatedBy: actor }
      items.push(item)
      changes.set(item.id, [{ version: 1, action: 'create_draft', changedBy: actor, snapshot: structuredClone(item) }])
      return { ...item, changes: changes.get(item.id) }
    },
    async update(id, input, expectedVersion, actor) {
      const item = find(id)
      if (item.version !== expectedVersion) throw conflict(item.version)
      const wasDraft = item.lifecycleStatus === 'draft'
      Object.assign(item, structuredClone(input), { version: item.version + 1, lifecycleStatus: 'draft', verificationLevel: 'unverified', reviewAssignee: '', updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: wasDraft ? 'update_draft' : 'update_requires_review', changedBy: actor, snapshot: structuredClone(item) })
      return item
    },
    async restore(id, input, expectedVersion, sourceVersion, reason, actor) {
      const item = find(id)
      if (!item) return null
      if (item.version !== expectedVersion) throw conflict(item.version)
      Object.assign(item, structuredClone(input), { version: item.version + 1, lifecycleStatus: 'draft', verificationLevel: 'unverified', reviewAssignee: '', updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: 'restore_version', changedBy: actor, summary: { sourceVersion, reason }, snapshot: structuredClone(item) })
      return { ...item, changes: changes.get(item.id) }
    },
    async verify(id, expectedVersion, actor) {
      const item = find(id)
      if (item.version !== expectedVersion) throw conflict(item.version)
      Object.assign(item, { version: item.version + 1, lifecycleStatus: 'verified', verificationLevel: 'verified', completenessScore: 100, updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: 'verify', changedBy: actor })
      return item
    },
    async transition(id, input, actor) {
      const item = find(id)
      if (!item) return null
      if (item.version !== input.expectedVersion) throw conflict(item.version)
      const rules = {
        submit_review: ['draft', 'review'], approve_review: ['review', 'verified'], reject_review: ['review', 'draft'],
        discontinue: ['verified', 'discontinued'], reopen: ['discontinued', 'draft'], assign_review: ['review', 'review'],
      }
      const rule = rules[input.action]
      if (!rule || item.lifecycleStatus !== rule[0]) {
        const error = new Error('当前状态不能执行该操作')
        error.statusCode = 409
        error.errorCode = 'INVALID_STATUS_TRANSITION'
        throw error
      }
      if (['reject_review', 'discontinue', 'reopen'].includes(input.action) && !input.note) {
        const error = new Error('请填写操作原因')
        error.statusCode = 409
        error.errorCode = 'INVALID_STATUS_TRANSITION'
        throw error
      }
      Object.assign(item, { version: item.version + 1, lifecycleStatus: rule[1], verificationLevel: rule[1] === 'verified' ? 'verified' : 'unverified', reviewAssignee: input.assignee || item.reviewAssignee || '', reviewNote: input.note || '', updatedBy: actor })
      changes.get(item.id).unshift({ version: item.version, action: input.action, changedBy: actor })
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

test('catalog production identity is fail-closed unless a trusted proxy is configured', () => {
  const request = { headers: { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'forged-admin' } }
  const untrusted = resolveCatalogActor(request, { NODE_ENV: 'production' })
  assert.equal(untrusted.role, 'catalog_viewer')
  assert.equal(untrusted.name, '只读访客')
  const trusted = resolveCatalogActor(request, { NODE_ENV: 'production', TRUST_PROXY_IDENTITY: '1' })
  assert.equal(trusted.role, 'catalog_admin')
  assert.equal(trusted.name, 'forged-admin')
})

function createCatalogImportRepository() {
  const jobs = []
  return {
    async list() { return { items: jobs.map(({ rows, ...job }) => job), total: jobs.length, page: 1, pageSize: 20 } },
    async createPreview(input, actor) {
      const rows = (input.rows || []).map((row, index) => ({
        id: `row-${index + 1}`, rowNumber: index + 2, payload: { identity: { nameZh: row.nameZh }, identifiers: row.primaryOe ? [{ rawValue: row.primaryOe, isPrimary: true }] : [] },
        state: row.nameZh && row.primaryOe ? row.primaryOe === 'DUPLICATE' ? 'duplicate' : 'ready' : 'invalid', issues: [], duplicateMatches: [], shouldFail: row.primaryOe === 'FAIL-ONCE',
      }))
      const job = { id: `import-${jobs.length + 1}`, sourceName: input.sourceName, state: 'preview', totalRows: rows.length, readyRows: rows.filter((row) => row.state === 'ready').length, duplicateRows: rows.filter((row) => row.state === 'duplicate').length, invalidRows: rows.filter((row) => row.state === 'invalid').length, importedRows: 0, failedRows: 0, version: 1, createdBy: actor, rows, attempts: [] }
      jobs.push(job)
      return job
    },
    async get(id) { return jobs.find((job) => job.id === id) || null },
    async resolveValues(id, input, actor) {
      const job = jobs.find((item) => item.id === id)
      if (!job) return null
      job.version += 1
      job.mappingSnapshot = { version: input.expectedProfileVersion + 1 }
      job.valueResolutions = input.resolutions.map((item, index) => ({ id: `resolution-${index + 1}`, ...item, profileVersion: input.expectedProfileVersion + 1, resolvedBy: actor }))
      return job
    },
    async commit(id, input) {
      const job = jobs.find((item) => item.id === id)
      if (!job) return null
      if (job.version !== input.expectedVersion) {
        const error = new Error('导入批次已更新')
        error.statusCode = 409
        error.errorCode = 'IMPORT_VERSION_CONFLICT'
        throw error
      }
      job.rows = job.rows.map((row) => input.rowIds.includes(row.id) ? row.shouldFail ? { ...row, state: 'failed', errorMessage: '临时写入失败' } : { ...row, state: 'imported', importedSkuId: `sku-${row.id}` } : { ...row, state: 'skipped' })
      job.importedRows = job.rows.filter((row) => row.state === 'imported').length
      job.failedRows = job.rows.filter((row) => row.state === 'failed').length
      job.state = job.failedRows ? 'partial' : 'completed'
      job.version += 2
      job.attempts.unshift({ id: 'attempt-1', attemptNumber: 1, attemptType: 'initial', state: job.state, selectedRows: input.rowIds.length, importedRows: job.importedRows, failedRows: job.failedRows })
      return job
    },
    async retry(id, input) {
      const job = jobs.find((item) => item.id === id)
      if (!job) return null
      if (job.version !== input.expectedVersion || job.state !== 'partial') {
        const error = new Error('批次不能重试')
        error.statusCode = 409
        error.errorCode = 'IMPORT_NOT_RETRYABLE'
        throw error
      }
      const failed = job.rows.filter((row) => row.state === 'failed' && (!input.rowIds?.length || input.rowIds.includes(row.id)))
      job.rows = job.rows.map((row) => failed.some((item) => item.id === row.id) ? { ...row, state: 'imported', shouldFail: false, errorMessage: '', importedSkuId: `sku-retry-${row.id}` } : row)
      job.importedRows = job.rows.filter((row) => row.state === 'imported').length
      job.failedRows = job.rows.filter((row) => row.state === 'failed').length
      job.state = job.failedRows ? 'partial' : 'completed'
      job.version += 2
      job.attempts.unshift({ id: 'attempt-2', attemptNumber: 2, attemptType: 'retry', state: 'completed', selectedRows: failed.length, importedRows: failed.length, failedRows: 0 })
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
  const rejected = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'submit_review', expectedVersion: 1 } })
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
  const submitted = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'submit_review', expectedVersion: 2, assignee: '资料审核员' } })
  assert.equal(submitted.statusCode, 200)
  assert.equal(submitted.json().lifecycleStatus, 'review')
  const verified = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/verify`, payload: { expectedVersion: 3 } })
  assert.equal(verified.statusCode, 200)
  assert.equal(verified.json().lifecycleStatus, 'verified')
  assert.equal((await app.inject(`/api/v2/catalog/skus/${draft.id}/changes`)).json().items[0].action, 'approve_review')
  const editedAfterApproval = await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${draft.id}`, payload: { expectedVersion: 4, identity: { nameZh: '前刹车片（修订）' } } })
  assert.equal(editedAfterApproval.statusCode, 200)
  assert.equal(editedAfterApproval.json().lifecycleStatus, 'draft')
  assert.equal(editedAfterApproval.json().verificationLevel, 'unverified')
  const resubmitted = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'submit_review', expectedVersion: 5, assignee: '审核员甲' } })
  assert.equal(resubmitted.json().lifecycleStatus, 'review')
  const assigned = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'assign_review', expectedVersion: 6, assignee: '审核员乙' } })
  assert.equal(assigned.json().reviewAssignee, '审核员乙')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'reject_review', expectedVersion: 7 } })).statusCode, 409)
  const rejectedForEdit = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'reject_review', expectedVersion: 7, note: '请补充适配条件说明' } })
  assert.equal(rejectedForEdit.json().lifecycleStatus, 'draft')
  await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'submit_review', expectedVersion: 8, assignee: '审核员乙' } })
  await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'approve_review', expectedVersion: 9 } })
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'discontinue', expectedVersion: 10 } })).statusCode, 409)
  const discontinued = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'discontinue', expectedVersion: 10, note: '编号已被替代' } })
  assert.equal(discontinued.json().lifecycleStatus, 'discontinued')
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${draft.id}`, payload: { expectedVersion: 11, identity: { nameZh: '不应保存' } } })).statusCode, 409)
  const reopened = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'reopen', expectedVersion: 11, note: '重新确认编号' } })
  assert.equal(reopened.json().lifecycleStatus, 'draft')
  await app.close()
})

test('catalog v2 exposes a quality queue and enforces audited lifecycle transitions', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const draft = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: { identity: { nameZh: '待补资料' } } })).json()
  const queue = await app.inject('/api/v2/catalog/quality?issue=fitment')
  assert.equal(queue.statusCode, 200)
  assert.equal(queue.json().items[0].id, draft.id)
  const incomplete = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'submit_review', expectedVersion: 1 } })
  assert.equal(incomplete.statusCode, 422)
  const invalidTransition = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${draft.id}/transition`, payload: { action: 'discontinue', expectedVersion: 1, note: '不再销售' } })
  assert.equal(invalidTransition.statusCode, 409)
  assert.equal(invalidTransition.json().error, 'INVALID_STATUS_TRANSITION')
  const metrics = await app.inject('/api/v2/catalog/metrics?days=14')
  assert.equal(metrics.statusCode, 200)
  assert.equal(metrics.json().days, 14)
  assert.equal(metrics.json().statusCounts.draft, 1)
  await app.close()
})

test('catalog v2 exposes development roles and enforces write capabilities', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const session = await app.inject({ url: '/api/v2/catalog/session', headers: { 'x-operator-role': 'catalog_editor', 'x-operator-name': '录入员甲' } })
  assert.equal(session.statusCode, 200)
  assert.equal(session.json().role, 'catalog_editor')
  assert.equal(session.json().name, '录入员甲')
  assert.equal(session.json().capabilities.includes('catalog.edit'), true)
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { identity: { nameZh: '不应创建' } } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().error, 'CATALOG_PERMISSION_DENIED')
  const created = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', headers: { 'x-operator-role': 'catalog_editor', 'x-operator-name': '录入员甲' }, payload: { identity: { nameZh: '允许创建' } } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().createdBy, '录入员甲')
  await app.close()
})

test('catalog v2 exports an auditable JSON snapshot and an operations CSV', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: {
    identity: { nameZh: '导出测试件', brandCode: 'POR', brandLabel: 'Porsche', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: 'EXPORT-01' }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'EXPORT-001', isPrimary: true, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: 'Cayenne (9YA)', years: '2018-2023', evidenceKey: 'source' }],
  } })
  const denied = await app.inject({ method: 'GET', url: '/api/v2/catalog/export?format=json', headers: { 'x-operator-role': 'catalog_reviewer' } })
  assert.equal(denied.statusCode, 403)
  const json = await app.inject('/api/v2/catalog/export?format=json&status=draft')
  assert.equal(json.statusCode, 200)
  assert.match(json.headers['content-disposition'], /hushanxing-sku-20261002-draft\.json/)
  assert.equal(json.json().schemaVersion, 'catalog-export-v1')
  assert.equal(json.json().counts.skus, 1)
  assert.equal(json.json().checksum.value.length, 64)
  assert.equal(json.json().items[0].changes[0].action, 'create_draft')
  const csv = await app.inject('/api/v2/catalog/export?format=csv')
  assert.equal(csv.statusCode, 200)
  assert.match(csv.headers['content-type'], /^text\/csv/)
  assert.match(csv.body, /SKU 编码,中文名称/)
  assert.match(csv.body, /EXPORT-001/)
  assert.equal((await app.inject('/api/v2/catalog/export?format=xlsx')).statusCode, 400)
  await app.close()
})

test('catalog v2 performs controlled bulk transitions with per-record results', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const makePayload = (name, oe) => ({
    identity: { nameZh: name, brandCode: 'POR', categoryCode: 'BRAKE' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: oe }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: oe, isPrimary: true, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: 'Cayenne (9YA)', years: '2018-2023', evidenceKey: 'source' }],
  })
  const first = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('批量资料一', 'BULK-001') })).json()
  const second = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('批量资料二', 'BULK-002') })).json()
  const response = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus/bulk-transition', payload: {
    action: 'submit_review', assignee: '审核员甲', items: [{ id: first.id, expectedVersion: first.version }, { id: second.id, expectedVersion: second.version }],
  } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().succeeded, 2)
  assert.equal(response.json().failed, 0)
  assert.equal((await app.inject(`/api/v2/catalog/skus/${first.id}`)).json().lifecycleStatus, 'review')
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/skus/bulk-transition', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { action: 'submit_review', items: [{ id: first.id, expectedVersion: 2 }] } })
  assert.equal(denied.statusCode, 403)
  await app.close()
})

test('catalog v2 resolves shared identifier conflicts with an audited decision', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const makePayload = (name) => ({
    identity: { nameZh: name, brandCode: 'POR', categoryCode: 'BRAKE' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: name }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'SHARED-001', isPrimary: true, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: 'Cayenne (9YA)', years: '2018-2023', evidenceKey: 'source' }],
  })
  const first = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('共享编号资料一') })).json()
  const second = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('共享编号资料二') })).json()
  const blocked = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${first.id}/transition`, payload: { action: 'submit_review', expectedVersion: first.version } })
  assert.equal(blocked.statusCode, 422)
  const conflicts = await app.inject('/api/v2/catalog/conflicts')
  assert.equal(conflicts.json().items.length, 1)
  const resolved = await app.inject({ method: 'POST', url: '/api/v2/catalog/conflicts/resolve', headers: { 'x-operator-role': 'catalog_reviewer' }, payload: {
    normalizedValue: 'SHARED001', skuIdA: first.id, skuIdB: second.id, expectedVersionA: first.version, expectedVersionB: second.version,
    resolutionType: 'shared_reference', note: '套装与单件共用参考编号，保留独立资料',
  } })
  assert.equal(resolved.statusCode, 200)
  assert.equal(resolved.json().resolutionType, 'shared_reference')
  const submitted = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${first.id}/transition`, payload: { action: 'submit_review', expectedVersion: first.version + 1 } })
  assert.equal(submitted.statusCode, 200)
  const audited = (await app.inject(`/api/v2/catalog/skus/${first.id}/changes`)).json().items
  assert.equal(audited[0].action, 'submit_review')
  assert.equal(audited[1].action, 'resolve_identifier_conflict')
  await app.close()
})

test('catalog v2 previews and safely merges confirmed duplicate SKUs', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const makePayload = (name, secondary, vehicle) => ({
    identity: { nameZh: name, brandCode: 'POR', brandLabel: 'Porsche', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: name }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'MERGE-001', isPrimary: true, evidenceKey: 'source' }, { clientKey: 'ref', type: 'reference', rawValue: secondary, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: vehicle, years: '2018-2023', evidenceKey: 'source' }],
  })
  const survivor = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('主资料', 'REF-A', 'Cayenne (9YA)') })).json()
  const retired = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: makePayload('重复资料', 'REF-B', 'Touareg (CR)') })).json()
  const resolution = await app.inject({ method: 'POST', url: '/api/v2/catalog/conflicts/resolve', headers: { 'x-operator-role': 'catalog_reviewer' }, payload: {
    normalizedValue: 'MERGE001', skuIdA: survivor.id, skuIdB: retired.id, expectedVersionA: 1, expectedVersionB: 1,
    resolutionType: 'merge_required', note: '品牌目录与实物标签复核为同一零件',
  } })
  assert.equal(resolution.statusCode, 200)
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/conflicts/merge-preview', headers: { 'x-operator-role': 'catalog_reviewer' }, payload: { normalizedValue: 'MERGE001', survivorSkuId: survivor.id, retiredSkuId: retired.id } })
  assert.equal(denied.statusCode, 403)
  const preview = await app.inject({ method: 'POST', url: '/api/v2/catalog/conflicts/merge-preview', payload: { normalizedValue: 'MERGE001', survivorSkuId: survivor.id, retiredSkuId: retired.id } })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.json().summary.identifiersAdded, 1)
  assert.equal(preview.json().summary.identifiersDeduplicated, 1)
  assert.equal(preview.json().summary.fitmentsAdded, 1)
  const merged = await app.inject({ method: 'POST', url: '/api/v2/catalog/conflicts/merge', payload: {
    normalizedValue: 'MERGE001', survivorSkuId: survivor.id, retiredSkuId: retired.id,
    survivorExpectedVersion: 2, retiredExpectedVersion: 2, reason: '确认同件，保留资料较完整的主 SKU',
  } })
  assert.equal(merged.statusCode, 200)
  assert.equal(merged.json().survivor.lifecycleStatus, 'draft')
  assert.equal(merged.json().survivor.identifiers.length, 3)
  assert.equal(merged.json().survivor.fitments.length, 2)
  assert.equal(merged.json().retired.lifecycleStatus, 'discontinued')
  assert.match(merged.json().retired.discontinuedReason, /已合并至/)
  assert.equal((await app.inject('/api/v2/catalog/conflicts')).json().items.length, 0)
  assert.equal((await app.inject(`/api/v2/catalog/skus/${survivor.id}/changes`)).json().items[0].action, 'merge_absorb')
  assert.equal((await app.inject(`/api/v2/catalog/skus/${retired.id}/changes`)).json().items[0].action, 'merge_retire')
  await app.close()
})

test('catalog v2 restores an audited historical snapshot as a new draft version', async () => {
  const app = buildApp({ catalogRepository: createCatalogRepository(), logger: false })
  const created = (await app.inject({ method: 'POST', url: '/api/v2/catalog/skus', payload: { identity: { nameZh: '原始名称' } } })).json()
  const updated = (await app.inject({ method: 'PATCH', url: `/api/v2/catalog/skus/${created.id}`, payload: { expectedVersion: 1, identity: { nameZh: '误改名称' } } })).json()
  const missingReason = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${created.id}/restore`, payload: { expectedVersion: updated.version, sourceVersion: 1 } })
  assert.equal(missingReason.statusCode, 400)
  const restored = await app.inject({ method: 'POST', url: `/api/v2/catalog/skus/${created.id}/restore`, payload: { expectedVersion: updated.version, sourceVersion: 1, reason: '撤销误改' } })
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().identity.nameZh, '原始名称')
  assert.equal(restored.json().lifecycleStatus, 'draft')
  assert.equal(restored.json().version, 3)
  assert.equal(restored.json().changes[0].action, 'restore_version')
  assert.equal(restored.json().changes[0].summary.sourceVersion, 1)
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
  assert.equal((await app.inject('/api/v2/catalog/imports')).json().total, 1)
  const resolved = await app.inject({ method: 'POST', url: `/api/v2/catalog/imports/${job.id}/resolve-values`, payload: {
    expectedVersion: job.version, expectedProfileVersion: 3, resolutions: [{ field: 'brand', source: '神秘品牌', target: 'MYSTERY' }],
  } })
  assert.equal(resolved.statusCode, 200)
  assert.equal(resolved.json().valueResolutions[0].target, 'MYSTERY')
  await app.close()
})

test('catalog v2 returns an existing import batch for duplicate content', async () => {
  const app = buildApp({ catalogImportRepository: {
    async createPreview() { return { id: 'existing-import', state: 'completed', duplicateUpload: true, rows: [] } },
  }, logger: false })
  const response = await app.inject({ method: 'POST', url: '/api/v2/catalog/imports', payload: {
    sourceName: 'renamed-copy.csv', rows: [{ nameZh: '前刹车片', primaryOe: '95B 698 151 H' }],
  } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().id, 'existing-import')
  assert.equal(response.json().duplicateUpload, true)
  await app.close()
})

test('catalog v2 matches and saves versioned supplier mapping profiles', async () => {
  const saved = []
  const catalogImportMappingRepository = {
    async list() { return { items: saved, total: saved.length } },
    async match(input) { return { status: 'exact', profile: { id: 'profile-1', name: '华东供应商', version: 2 }, suggestedMapping: { nameZh: 0, primaryOe: 1 }, changes: { added: [], removed: [], similarity: 1 }, sourceName: input.sourceName } },
    async save(input, actor) { const profile = { id: input.id || 'profile-1', name: input.name, version: (input.expectedVersion || 0) + 1, updatedBy: actor }; saved.push(profile); return profile },
    async get(id) { return id === 'profile-1' ? { id, name: '华东供应商', version: 2, recentUses: [], changes: [] } : null },
    async updateMetadata(id, input, actor) { return id === 'profile-1' ? { id, name: input.name || '华东供应商', active: input.active ?? true, version: input.expectedVersion + 1, updatedBy: actor } : null },
    async updateRules(id, input, actor) { return id === 'profile-1' ? { id, name: '华东供应商', defaultValues: input.defaultValues, transformRules: input.transformRules, version: input.expectedVersion + 1, updatedBy: actor } : null },
    async updateValueMappings(id, input, actor) { return id === 'profile-1' ? { id, name: '华东供应商', valueMappings: input.valueMappings, version: input.expectedVersion + 1, updatedBy: actor } : null },
    async clone(id, input, actor) { return id === 'profile-1' ? { id: 'profile-clone', name: input.name, active: true, version: 1, updatedBy: actor } : null },
  }
  const app = buildApp({ catalogImportMappingRepository, logger: false })
  const match = await app.inject({ method: 'POST', url: '/api/v2/catalog/import-mappings/match', payload: { sourceName: 'supplier.csv', columns: [{ sourceKey: '品名', label: '品名' }, { sourceKey: 'OE', label: 'OE' }] } })
  assert.equal(match.statusCode, 200)
  assert.equal(match.json().status, 'exact')
  assert.equal(match.json().suggestedMapping.primaryOe, 1)
  const created = await app.inject({ method: 'POST', url: '/api/v2/catalog/import-mappings', payload: { name: '华东供应商', sourceName: 'supplier.csv', columns: [], mapping: {} } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().updatedBy, 'hushanxing-workbench')
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/import-mappings', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { name: '无权限方案' } })
  assert.equal(denied.statusCode, 403)
  assert.equal((await app.inject('/api/v2/catalog/import-mappings')).json().total, 1)
  assert.equal((await app.inject('/api/v2/catalog/import-mappings/profile-1')).json().version, 2)
  const renamed = await app.inject({ method: 'PATCH', url: '/api/v2/catalog/import-mappings/profile-1', payload: { expectedVersion: 2, name: '华东月结模板' } })
  assert.equal(renamed.json().name, '华东月结模板')
  assert.equal(renamed.json().version, 3)
  const rules = await app.inject({ method: 'PATCH', url: '/api/v2/catalog/import-mappings/profile-1/rules', payload: { expectedVersion: 2, defaultValues: { brand: 'MANN' }, transformRules: { uppercaseOe: true } } })
  assert.equal(rules.statusCode, 200)
  assert.equal(rules.json().defaultValues.brand, 'MANN')
  assert.equal(rules.json().version, 3)
  const values = await app.inject({ method: 'PATCH', url: '/api/v2/catalog/import-mappings/profile-1/value-mappings', payload: { expectedVersion: 2, valueMappings: { brand: [{ source: '博世中国', target: 'BOSCH' }] } } })
  assert.equal(values.statusCode, 200)
  assert.equal(values.json().valueMappings.brand[0].target, 'BOSCH')
  assert.equal(values.json().version, 3)
  const cloned = await app.inject({ method: 'POST', url: '/api/v2/catalog/import-mappings/profile-1/clone', payload: { name: '华东备用模板' } })
  assert.equal(cloned.statusCode, 201)
  assert.equal(cloned.json().id, 'profile-clone')
  assert.equal((await app.inject('/api/v2/catalog/import-mappings/missing')).statusCode, 404)
  await app.close()
})

test('catalog v2 governs proposed dictionary values with admin-only review', async () => {
  const proposals = [{ id: 'proposal-1', field: 'brand', sourceValue: '新品牌中国', proposedValue: 'NEW-BRAND', state: 'pending', version: 1 }]
  const catalogDictionaryGovernanceRepository = {
    async list({ state }) { return { items: state ? proposals.filter((item) => item.state === state) : proposals, total: proposals.length } },
    async create(input, actor) { const proposal = { id: `proposal-${proposals.length + 1}`, ...input, state: 'pending', version: 1, requestedBy: actor }; proposals.push(proposal); return proposal },
    async review(id, input, actor) { const proposal = proposals.find((item) => item.id === id); if (!proposal) return null; Object.assign(proposal, { state: input.decision === 'approve' ? 'approved' : 'rejected', version: proposal.version + 1, reviewedBy: actor, reviewNote: input.reviewNote }); return proposal },
  }
  const app = buildApp({ catalogDictionaryGovernanceRepository, logger: false })
  const list = await app.inject('/api/v2/catalog/dictionary-proposals?state=pending')
  assert.equal(list.statusCode, 200)
  assert.equal(list.json().items[0].proposedValue, 'NEW-BRAND')
  const created = await app.inject({ method: 'POST', url: '/api/v2/catalog/dictionary-proposals', headers: { 'x-operator-role': 'catalog_editor', 'x-operator-name': '录入员甲' }, payload: { field: 'unit', sourceValue: 'PCS', proposedValue: '包', reason: '供应商包装单位' } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().requestedBy, '录入员甲')
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/dictionary-proposals/proposal-1/review', headers: { 'x-operator-role': 'catalog_editor' }, payload: { expectedVersion: 1, decision: 'approve', reviewNote: '无权操作' } })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().details.capability, 'catalog.configure')
  const approved = await app.inject({ method: 'POST', url: '/api/v2/catalog/dictionary-proposals/proposal-1/review', payload: { expectedVersion: 1, decision: 'approve', reviewNote: '资料完整，同意加入' } })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().state, 'approved')
  assert.equal(approved.json().reviewedBy, 'hushanxing-workbench')
  await app.close()
})

test('catalog v2 preserves import attempts and retries only failed rows', async () => {
  const app = buildApp({ catalogImportRepository: createCatalogImportRepository(), logger: false })
  const preview = (await app.inject({ method: 'POST', url: '/api/v2/catalog/imports', payload: {
    sourceName: 'retry.csv', rows: [{ nameZh: '临时失败件', primaryOe: 'FAIL-ONCE' }],
  } })).json()
  const partial = await app.inject({ method: 'POST', url: `/api/v2/catalog/imports/${preview.id}/commit`, payload: { expectedVersion: 1, rowIds: [preview.rows[0].id] } })
  assert.equal(partial.json().state, 'partial')
  assert.equal(partial.json().attempts[0].failedRows, 1)
  const retried = await app.inject({ method: 'POST', url: `/api/v2/catalog/imports/${preview.id}/retry`, payload: { expectedVersion: 3 } })
  assert.equal(retried.statusCode, 200)
  assert.equal(retried.json().state, 'completed')
  assert.equal(retried.json().attempts.length, 2)
  assert.equal(retried.json().rows[0].state, 'imported')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v2/catalog/imports/${preview.id}/retry`, payload: { expectedVersion: 5 } })).statusCode, 409)
  await app.close()
})
