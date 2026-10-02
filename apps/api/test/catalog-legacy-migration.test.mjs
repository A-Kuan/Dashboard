import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { buildLegacyMigrationPilot, mapLegacySku } from '../src/catalog-legacy-migration-repository.mjs'

function legacySnapshot(overrides = {}) {
  return {
    sku: {
      id: 'legacy-1', sku_code: '95B-129-620-A', chinese_name: '空气滤芯', brand: 'Porsche',
      category: '保养件', subcategory: '空气滤芯', manufacturer_part_number: '', primary_oe: '95B129620A',
      unit: '个', lifecycle_status: '在售', image_url: 'https://old.example/filter.jpg', image_urls: [],
      data_source: '人工录入', source_evidence: {}, updated_at: '2026-10-01T08:00:00.000Z', ...overrides,
    },
    oeRelations: [{ id: 'oe-1', oe_number: '95B 129 620 A', brand: 'Porsche' }, { id: 'oe-2', oe_number: '95811013010', brand: 'Porsche' }],
    fitments: [{ id: 'fit-1', vehicle: 'Cayenne (95B)', years: '2015-2018', engine: '3.0T', body: 'SUV', fitment_condition: '以 VIN 为准', source: '旧系统' }],
  }
}

const dictionaries = {
  sku_brand: { items: [{ value: 'PORSCHE', label: 'Porsche', enabled: true }] },
  part_category: { items: [{ value: 'SERVICE', label: '保养件', enabled: true }] },
  unit: { items: [{ value: 'piece', label: '个', enabled: true }] },
}

test('maps a legacy SKU into an unverified draft while preserving provenance', () => {
  const mapped = mapLegacySku(legacySnapshot(), dictionaries)
  assert.equal(mapped.input.identity.skuCode, '95B-129-620-A')
  assert.equal(mapped.input.identity.brandCode, 'PORSCHE')
  assert.equal(mapped.input.lifecycleStatus, 'draft')
  assert.equal(mapped.input.verificationLevel, 'unverified')
  assert.equal(mapped.input.identifiers.length, 2)
  assert.equal(mapped.input.identifiers.filter((item) => item.isPrimary).length, 1)
  assert.equal(mapped.input.evidence[0].rawPayload.sku.id, 'legacy-1')
  assert.match(mapped.input.fitments[0].includeConditions.note, /发动机：3\.0T/)
  assert.ok(mapped.issues.some((issue) => issue.code === 'fitmentNeedsReview' && !issue.blocking))
  assert.ok(mapped.issues.some((issue) => issue.code === 'imagesPreservedInEvidence' && !issue.blocking))
})

test('blocks legacy records without an identifier and flags unresolved dictionary values', () => {
  const snapshot = legacySnapshot({ sku_code: '', primary_oe: '', manufacturer_part_number: '', brand: '未知品牌' })
  snapshot.oeRelations = []
  const mapped = mapLegacySku(snapshot, dictionaries)
  assert.ok(mapped.issues.some((issue) => issue.code === 'missingSkuCode' && issue.blocking))
  assert.ok(mapped.issues.some((issue) => issue.code === 'missingIdentifier' && issue.blocking))
  assert.ok(mapped.issues.some((issue) => issue.code === 'unmappedBrand' && !issue.blocking))
})

test('applies reviewed dictionary overrides without changing the legacy snapshot', () => {
  const extended = {
    ...dictionaries,
    sku_brand: { items: [...dictionaries.sku_brand.items, { value: 'AUDI', label: 'Audi', enabled: true }] },
    unit: { items: [...dictionaries.unit.items, { value: 'set', label: '套', enabled: true }] },
  }
  const snapshot = legacySnapshot()
  const mapped = mapLegacySku(snapshot, extended, { brandCode: 'AUDI', unitCode: 'set' })
  assert.equal(mapped.input.identity.brandCode, 'AUDI')
  assert.equal(mapped.input.identity.unitCode, 'set')
  assert.equal(snapshot.sku.brand, 'Porsche')
  assert.equal(mapped.mapping.brand.overridden, true)
  assert.throws(() => mapLegacySku(snapshot, extended, { categoryCode: 'MISSING' }), /不在当前字典中/)
})

test('builds a deterministic pilot cohort with workload and scenario coverage', () => {
  const item = (id, category, { identifiers = 2, fitments = 0, issues = [], migrated = false, blocking = false } = {}) => ({
    legacySkuId: id,
    sourceHash: `hash-${id}`,
    migrated,
    blocking,
    legacy: { skuCode: `SKU-${id}`, name: `零件 ${id}`, brand: id === '6' ? 'Audi' : 'Porsche', category, identifierCount: identifiers, fitmentCount: fitments },
    target: { identity: { brandLabel: id === '6' ? '奥迪' : '保时捷', categoryLabel: `${category}标准分类` } },
    mapping: { images: issues.some((issue) => issue.code === 'imagesPreservedInEvidence') ? ['old.jpg'] : [] },
    issues,
  })
  const items = [
    item('1', '滤清器', { identifiers: 3 }),
    item('2', '制动系统', { fitments: 1, issues: [{ code: 'fitmentNeedsReview', blocking: false }] }),
    item('3', '悬挂系统'),
    item('4', '滤清器', { issues: [{ code: 'weakEvidence', blocking: false }] }),
    item('5', '制动系统', { issues: [{ code: 'imagesPreservedInEvidence', blocking: false }] }),
    item('6', '发动机附件'),
    item('7', '电气系统', { blocking: true }),
    item('8', '车身附件', { migrated: true }),
  ]
  const pilot = buildLegacyMigrationPilot(items, 5)
  const repeated = buildLegacyMigrationPilot(items, 5)
  assert.equal(pilot.summary.selected, 5)
  assert.equal(pilot.summary.available, 6)
  assert.ok(pilot.summary.categoryCount >= 3)
  assert.ok(pilot.items.some((candidate) => candidate.fitmentCount > 0))
  assert.ok(pilot.summary.tasks.fitmentResearch >= 1)
  assert.ok(pilot.summary.tasks.fitmentReview >= 1)
  assert.ok(pilot.summary.estimatedMinutes > 0)
  assert.ok(pilot.items.every((candidate) => candidate.brand === '保时捷' || candidate.brand === '奥迪'))
  assert.ok(pilot.items.every((candidate) => candidate.category.endsWith('标准分类')))
  assert.deepEqual(pilot.items.map((candidate) => candidate.legacySkuId), repeated.items.map((candidate) => candidate.legacySkuId))
  assert.throws(() => buildLegacyMigrationPilot(items, 4), /5 至 10/)
  assert.throws(() => buildLegacyMigrationPilot(items, 11), /5 至 10/)
})

test('legacy migration routes are read-visible but writes require import capability', async () => {
  const repository = {
    preview: async () => ({ items: [], total: 0, summary: { pending: 0 } }),
    pilot: async ({ size }) => ({ requestedSize: Number(size), items: [], summary: { selected: 0, tasks: {} } }),
    commit: async (_input, actor) => ({ id: 'batch-1', state: 'succeeded', createdBy: actor }),
    getBatch: async (id) => id === 'batch-1' ? { id, state: 'succeeded' } : null,
    createPlan: async (_input, actor) => ({ id: 'plan-1', state: 'submitted', version: 1, createdBy: actor.name, createdById: actor.id }),
    listPlans: async () => ({ items: [], total: 0 }),
    getPlan: async (id) => id === 'plan-1' ? { id, state: 'submitted', version: 1 } : null,
    preflightPlan: async (id) => id === 'plan-1' ? { planId: id, ready: true, summary: { total: 1, ready: 1, blocked: 0 } } : null,
    reviewPlan: async (id, input, actor) => ({ id, state: input.decision === 'approve' ? 'approved' : 'rejected', reviewedBy: actor.name }),
    commitPlan: async (id, _input, actor) => ({ id, state: 'committed', committedBy: actor.name }),
    acceptancePlan: async (id) => id === 'plan-1' ? { planId: id, ready: true, status: 'ready', summary: { total: 1, verified: 1, needsAttention: 0 } } : null,
    reviewAcceptance: async (id, input, actor) => ({ id, state: 'committed', acceptanceState: input.decision === 'accept' ? 'accepted' : 'changes_required', acceptanceBy: actor.name }),
  }
  const app = buildApp({ catalogLegacyMigrationRepository: repository, logger: false })
  const preview = await app.inject('/api/v2/catalog/legacy-migration-preview')
  assert.equal(preview.statusCode, 200)
  const pilot = await app.inject('/api/v2/catalog/legacy-migration-pilot?size=8')
  assert.equal(pilot.statusCode, 200)
  assert.equal(pilot.json().requestedSize, 8)
  const denied = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migrations', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { items: [], reason: '测试' } })
  assert.equal(denied.statusCode, 403)
  const directCommit = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migrations', headers: { 'x-operator-role': 'catalog_admin', 'x-operator-name': '管理员' }, payload: { items: [{ legacySkuId: 'legacy-1', sourceHash: 'hash' }], reason: '经审核迁移' } })
  assert.equal(directCommit.statusCode, 409)
  assert.equal(directCommit.json().error, 'LEGACY_MIGRATION_PLAN_REQUIRED')
  const planDenied = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans', headers: { 'x-operator-role': 'catalog_viewer' }, payload: { items: [], reason: '测试' } })
  assert.equal(planDenied.statusCode, 403)
  const planCreated = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans', headers: { 'x-operator-role': 'catalog_editor', 'x-operator-name': '迁移员' }, payload: { items: [{ legacySkuId: 'legacy-1' }], reason: '提交审核' } })
  assert.equal(planCreated.statusCode, 201)
  assert.equal(planCreated.json().state, 'submitted')
  const preflight = await app.inject({ method: 'GET', url: '/api/v2/catalog/legacy-migration-plans/plan-1/preflight', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(preflight.statusCode, 200)
  assert.equal(preflight.json().ready, true)
  const reviewDenied = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/review', headers: { 'x-operator-role': 'catalog_editor' }, payload: { expectedVersion: 1, decision: 'approve' } })
  assert.equal(reviewDenied.statusCode, 403)
  const reviewed = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/review', headers: { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': '审核员' }, payload: { expectedVersion: 1, decision: 'approve' } })
  assert.equal(reviewed.statusCode, 200)
  assert.equal(reviewed.json().reviewedBy, '审核员')
  const reviewerCommitDenied = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/commit', headers: { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': '审核员' }, payload: { expectedVersion: 2 } })
  assert.equal(reviewerCommitDenied.statusCode, 403)
  const committed = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/commit', headers: { 'x-operator-role': 'catalog_admin', 'x-operator-name': '资料管理员' }, payload: { expectedVersion: 2 } })
  assert.equal(committed.statusCode, 200)
  assert.equal(committed.json().committedBy, '资料管理员')
  const acceptance = await app.inject({ method: 'GET', url: '/api/v2/catalog/legacy-migration-plans/plan-1/acceptance', headers: { 'x-operator-role': 'catalog_viewer' } })
  assert.equal(acceptance.statusCode, 200)
  assert.equal(acceptance.json().ready, true)
  const editorAcceptanceDenied = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/acceptance', headers: { 'x-operator-role': 'catalog_editor' }, payload: { expectedVersion: 3, decision: 'accept' } })
  assert.equal(editorAcceptanceDenied.statusCode, 403)
  const accepted = await app.inject({ method: 'POST', url: '/api/v2/catalog/legacy-migration-plans/plan-1/acceptance', headers: { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': '验收员' }, payload: { expectedVersion: 3, decision: 'accept' } })
  assert.equal(accepted.statusCode, 200)
  assert.equal(accepted.json().acceptanceState, 'accepted')
  assert.equal(accepted.json().acceptanceBy, '验收员')
  await app.close()
})
