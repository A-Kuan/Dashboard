import Fastify from 'fastify'
import { normalizeSkuInput, requireSkuVersion, validatePublishableSku } from './validation.mjs'
import { normalizeVehicleInput, requireVehicleVersion } from './vehicle-validation.mjs'
import { normalizeCatalogInput, normalizeIntakeInput, requireCatalogVersion, sanitizeCatalogFitmentReviews, validateCatalogFitmentsReviewed, validateCatalogVerifiable } from './catalog-validation.mjs'
import { catalogRoles, requireCatalogCapability, resolveCatalogActor } from './catalog-access.mjs'
import { catalogImportTemplateCsv, catalogImportTemplateSpec } from './catalog-import-spec.mjs'

const transitionCapabilities = {
  submit_review: 'catalog.submit',
  approve_review: 'catalog.review',
  reject_review: 'catalog.review',
  assign_review: 'catalog.assign',
  discontinue: 'catalog.lifecycle',
  reopen: 'catalog.lifecycle',
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function catalogSnapshotCsv(snapshot) {
  const headers = ['SKU 编码', '中文名称', '英文名称', '品牌', '分类', '单位', '状态', '完整度', '主编号', '全部编号', '适配车型', '来源系统', '来源记录', '版本', '更新时间']
  const rows = snapshot.items.map((item) => {
    const primary = item.identifiers.find((identifier) => identifier.isPrimary)
    return [
      item.identity.skuCode, item.identity.nameZh, item.identity.nameEn, item.identity.brandLabel || item.identity.brandCode,
      item.identity.categoryLabel || item.identity.categoryCode, item.identity.unitLabel, item.lifecycleStatus, item.completenessScore,
      primary?.rawValue || '', item.identifiers.map((identifier) => `${identifier.type}:${identifier.rawValue}`).join(' | '),
      item.fitments.map((fitment) => `${fitment.vehicleLabel}${fitment.years ? ` ${fitment.years}` : ''}`).join(' | '),
      [...new Set(item.evidence.map((evidence) => evidence.sourceSystem).filter(Boolean))].join(' | '),
      item.evidence.map((evidence) => evidence.sourceRecordId).filter(Boolean).join(' | '), item.version, item.updatedAt,
    ].map(csvCell).join(',')
  })
  return `\uFEFF${headers.map(csvCell).join(',')}\n${rows.join('\n')}\n`
}

export function buildApp({ repository, vehicleRepository, dictionaryRepository, catalogRepository, catalogImportRepository, catalogImportMappingRepository, catalogDictionaryGovernanceRepository, readinessCheck = async () => ({ database: 'not-checked' }), logger = true }) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 24 * 1024 * 1024 })
  const unresolvedDuplicates = (identifier, exceptId) => (catalogRepository.findUnresolvedDuplicates || catalogRepository.findDuplicates).call(catalogRepository, identifier, exceptId)

  app.get('/api/health', async () => ({ status: 'ok', service: 'dashboard-sku-api' }))
  app.get('/api/ready', async (request, reply) => {
    try {
      return { status: 'ready', service: 'dashboard-sku-api', ...(await readinessCheck()) }
    } catch (error) {
      request.log.warn({ err: error, code: error.code }, 'readiness check failed')
      return reply.code(503).send({ status: 'not_ready', service: 'dashboard-sku-api', error: error.code || 'DATABASE_UNAVAILABLE' })
    }
  })
  app.get('/api/v2/catalog/import-template', async (request, reply) => {
    const format = String(request.query?.format || 'json').toLowerCase()
    if (format === 'json') return catalogImportTemplateSpec
    if (format === 'csv') {
      reply.header('content-disposition', 'attachment; filename="hushanxing-sku-import-template.csv"')
      return reply.type('text/csv; charset=utf-8').send(catalogImportTemplateCsv())
    }
    return reply.code(400).send({ error: 'INVALID_IMPORT_TEMPLATE_FORMAT', message: '仅支持 JSON 或 CSV 模板' })
  })
  app.get('/api/v2/catalog/session', async (request) => {
    const actor = resolveCatalogActor(request)
    return { ...actor, availableRoles: actor.development ? Object.values(catalogRoles) : [] }
  })
  app.get('/api/v1/skus', async (request) => ({ items: await repository.list(request.query?.q || '') }))
  app.get('/api/v1/skus/:id', async (request, reply) => {
    const item = await repository.get(request.params.id)
    if (!item) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    return item
  })
  app.post('/api/v1/skus/validate-code', async (request) => {
    const code = String(request.body?.skuCode || '').trim()
    return { available: Boolean(code) && !(await repository.codeExists(code, request.body?.exceptId || null)) }
  })
  app.post('/api/v1/skus', async (request, reply) => {
    const input = { ...normalizeSkuInput(request.body), lifecycleStatus: '草稿' }
    if (await repository.codeExists(input.skuCode)) return reply.code(409).send({ error: 'SKU_CODE_EXISTS', message: 'SKU 编码已存在' })
    return reply.code(201).send(await repository.create(input, request.headers['x-operator-name'] || '系统操作员'))
  })
  app.put('/api/v1/skus/:id', async (request, reply) => {
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    const input = { ...normalizeSkuInput(request.body), lifecycleStatus: existing.lifecycleStatus }
    if (await repository.codeExists(input.skuCode, existing.id)) return reply.code(409).send({ error: 'SKU_CODE_EXISTS', message: 'SKU 编码已存在' })
    return repository.update(existing.id, input, request.headers['x-operator-name'] || '系统操作员', '保存草稿')
  })
  app.post('/api/v1/skus/:id/publish', async (request, reply) => {
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    const input = validatePublishableSku(normalizeSkuInput({ ...existing, ...request.body, lifecycleStatus: '在售' }))
    return repository.update(existing.id, input, request.headers['x-operator-name'] || '系统操作员', '发布 SKU')
  })
  app.post('/api/v1/skus/:id/discontinue', async (request, reply) => {
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    if (existing.lifecycleStatus !== '在售') return reply.code(409).send({ error: 'INVALID_STATUS_TRANSITION', message: '只有在售 SKU 可以停产' })
    const input = normalizeSkuInput({ ...existing, ...request.body, lifecycleStatus: '停产' })
    return repository.update(existing.id, input, request.headers['x-operator-name'] || '系统操作员', '停产 SKU')
  })

  app.get('/api/v1/vehicles', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    return { items: await vehicleRepository.list(request.query?.q || '') }
  })
  app.get('/api/v1/vehicles/:id', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const item = await vehicleRepository.get(request.params.id)
    if (!item) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    return item
  })
  app.post('/api/v1/vehicles', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const input = { ...normalizeVehicleInput(request.body), lifecycleStatus: '草稿' }
    if (await vehicleRepository.codeExists(input.vehicleCode)) return reply.code(409).send({ error: 'VEHICLE_CODE_EXISTS', message: '车型版本编码已存在' })
    return reply.code(201).send(await vehicleRepository.create(input, request.headers['x-operator-name'] || '系统操作员'))
  })
  app.put('/api/v1/vehicles/:id', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    requireVehicleVersion(request.body)
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    const input = normalizeVehicleInput({ ...existing, ...request.body, lifecycleStatus: existing.lifecycleStatus })
    if (await vehicleRepository.codeExists(input.vehicleCode, existing.id)) return reply.code(409).send({ error: 'VEHICLE_CODE_EXISTS', message: '车型版本编码已存在' })
    return vehicleRepository.update(existing.id, input, request.headers['x-operator-name'] || '系统操作员')
  })
  app.post('/api/v1/vehicles/:id/publish', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    requireVehicleVersion(request.body)
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    const input = normalizeVehicleInput({ ...existing, ...request.body, lifecycleStatus: '已发布' })
    if (!input.requirements.length) return reply.code(422).send({ error: 'VEHICLE_NOT_PUBLISHABLE', message: '至少需要一条常用配件记录' })
    return vehicleRepository.update(existing.id, input, request.headers['x-operator-name'] || '系统操作员', '发布车型资料')
  })
  app.post('/api/v1/vehicles/:id/auto-match', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    return vehicleRepository.autoMatch(existing.id, request.headers['x-operator-name'] || '系统操作员')
  })

  app.get('/api/v1/dictionaries', async (_request, reply) => {
    if (!dictionaryRepository) return reply.code(503).send({ error: 'DICTIONARY_SERVICE_UNAVAILABLE', message: '字典服务未配置' })
    return dictionaryRepository.get()
  })
  app.put('/api/v1/dictionaries', async (request, reply) => {
    if (!dictionaryRepository) return reply.code(503).send({ error: 'DICTIONARY_SERVICE_UNAVAILABLE', message: '字典服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.configure')
    if (!actor) return
    return dictionaryRepository.save(request.body, actor.name)
  })
  app.post('/api/v1/dictionaries/reset', async (request, reply) => {
    if (!dictionaryRepository) return reply.code(503).send({ error: 'DICTIONARY_SERVICE_UNAVAILABLE', message: '字典服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.configure')
    if (!actor) return
    return dictionaryRepository.reset(actor.name)
  })

  app.post('/api/v2/catalog/intakes', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    return reply.code(201).send(await catalogRepository.createIntake(normalizeIntakeInput(request.body), actor.name))
  })
  app.get('/api/v2/catalog/intakes/:id', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const intake = await catalogRepository.getIntake(request.params.id)
    if (!intake) return reply.code(404).send({ error: 'CATALOG_INTAKE_NOT_FOUND', message: '导入批次不存在' })
    return intake
  })
  app.get('/api/v2/catalog/skus', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return catalogRepository.list({ query: request.query?.q, status: request.query?.status, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/quality', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return catalogRepository.qualityQueue({ issue: request.query?.issue, status: request.query?.status, assignee: request.query?.assignee, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/fitments/review', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogRepository.fitmentReviewQueue({
      state: request.query?.state ?? 'pending', query: request.query?.q, page: request.query?.page, pageSize: request.query?.pageSize,
    })
  })
  app.post('/api/v2/catalog/fitments/:id/review', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.review_fitment')
    if (!actor) return
    const result = await catalogRepository.reviewFitment(request.params.id, request.body, actor.name)
    if (!result) return reply.code(404).send({ error: 'CATALOG_FITMENT_NOT_FOUND', message: '适配关系不存在' })
    return result
  })
  app.get('/api/v2/catalog/metrics', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return catalogRepository.metrics({ days: request.query?.days })
  })
  app.get('/api/v2/catalog/export', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.export')
    if (!actor) return
    const format = String(request.query?.format || 'json').toLowerCase()
    if (!['json', 'csv'].includes(format)) return reply.code(400).send({ error: 'INVALID_CATALOG_EXPORT_FORMAT', message: '仅支持 JSON 或 CSV 导出' })
    const snapshot = await catalogRepository.exportSnapshot({ status: String(request.query?.status || '') })
    const date = snapshot.generatedAt.slice(0, 10).replaceAll('-', '')
    const suffix = snapshot.filter.status === 'all' ? '' : `-${snapshot.filter.status}`
    const filename = `hushanxing-sku-${date}${suffix}.${format}`
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    if (format === 'csv') return reply.type('text/csv; charset=utf-8').send(catalogSnapshotCsv(snapshot))
    return reply.type('application/json; charset=utf-8').send(snapshot)
  })
  app.get('/api/v2/catalog/conflicts', async (_request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return { items: await catalogRepository.identifierConflicts() }
  })
  app.post('/api/v2/catalog/conflicts/resolve', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.resolve_conflict')
    if (!actor) return
    return catalogRepository.resolveIdentifierConflict(request.body, actor.name)
  })
  app.post('/api/v2/catalog/conflicts/merge-preview', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.merge')
    if (!actor) return
    return catalogRepository.mergePreview(request.body)
  })
  app.post('/api/v2/catalog/conflicts/merge', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.merge')
    if (!actor) return
    return catalogRepository.mergeSkus(request.body, actor.name)
  })
  app.get('/api/v2/catalog/duplicates', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const identifier = String(request.query?.identifier || '').trim()
    if (!identifier) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: 'identifier 不能为空' })
    return { items: await catalogRepository.findDuplicates(identifier, request.query?.exceptId || null) }
  })
  app.get('/api/v2/catalog/skus/:id', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const item = await catalogRepository.get(request.params.id)
    if (!item) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    return item
  })
  app.post('/api/v2/catalog/skus', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    return reply.code(201).send(await catalogRepository.create(sanitizeCatalogFitmentReviews(normalizeCatalogInput(request.body)), actor.name))
  })
  app.patch('/api/v2/catalog/skus/:id', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const expectedVersion = requireCatalogVersion(request.body)
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    if (existing.lifecycleStatus === 'discontinued') return reply.code(409).send({ error: 'INVALID_STATUS_TRANSITION', message: '已停用资料需先恢复为草稿后才能编辑' })
    const input = sanitizeCatalogFitmentReviews(normalizeCatalogInput(request.body, existing), existing)
    return catalogRepository.update(existing.id, input, expectedVersion, actor.name)
  })
  app.post('/api/v2/catalog/skus/:id/verify', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.review')
    if (!actor) return
    const expectedVersion = requireCatalogVersion(request.body)
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    if (existing.lifecycleStatus !== 'review') return reply.code(409).send({ error: 'INVALID_STATUS_TRANSITION', message: '请先提交审核，再执行核验通过' })
    validateCatalogVerifiable(normalizeCatalogInput({}, existing))
    validateCatalogFitmentsReviewed(normalizeCatalogInput({}, existing))
    const duplicateMatches = (await Promise.all(existing.identifiers.map((item) => unresolvedDuplicates(item.rawValue, existing.id)))).flat()
    if (duplicateMatches.length) return reply.code(422).send({ error: 'SKU_QUALITY_BLOCKED', message: '存在与其他 SKU 重复的零件编号', details: { issues: ['duplicateIdentifier'], matches: duplicateMatches } })
    return catalogRepository.transition(existing.id, { action: 'approve_review', expectedVersion, note: request.body?.note }, actor.name)
  })
  app.post('/api/v2/catalog/skus/:id/transition', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const capability = transitionCapabilities[request.body?.action]
    if (!capability) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: '不支持的资料状态操作' })
    const actor = requireCatalogCapability(request, reply, capability)
    if (!actor) return
    const expectedVersion = requireCatalogVersion(request.body)
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    if (['submit_review', 'approve_review'].includes(request.body?.action)) {
      const normalized = normalizeCatalogInput({}, existing)
      validateCatalogVerifiable(normalized)
      if (request.body?.action === 'approve_review') validateCatalogFitmentsReviewed(normalized)
      const duplicateMatches = (await Promise.all(existing.identifiers.map((item) => unresolvedDuplicates(item.rawValue, existing.id)))).flat()
      if (duplicateMatches.length) return reply.code(422).send({ error: 'SKU_QUALITY_BLOCKED', message: '存在与其他 SKU 重复的零件编号', details: { issues: ['duplicateIdentifier'], matches: duplicateMatches } })
    }
    const item = await catalogRepository.transition(existing.id, { ...request.body, expectedVersion }, actor.name)
    if (!item) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    return item
  })
  app.post('/api/v2/catalog/skus/bulk-transition', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const action = String(request.body?.action || '').trim()
    if (!['submit_review', 'assign_review', 'discontinue'].includes(action)) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: '该操作不支持批量执行' })
    const actor = requireCatalogCapability(request, reply, transitionCapabilities[action])
    if (!actor) return
    if (!requireCatalogCapability(request, reply, 'catalog.bulk')) return
    const items = Array.isArray(request.body?.items) ? request.body.items : []
    if (!items.length || items.length > 100) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: '每次请选择 1 至 100 条资料' })
    const results = []
    const failures = []
    for (const candidate of items) {
      const id = String(candidate?.id || '').trim()
      const expectedVersion = Number(candidate?.expectedVersion)
      try {
        if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error('资料 ID 或版本无效'), { errorCode: 'INVALID_CATALOG_INPUT' })
        const existing = await catalogRepository.get(id)
        if (!existing) throw Object.assign(new Error('SKU 资料不存在'), { errorCode: 'CATALOG_SKU_NOT_FOUND' })
        if (action === 'submit_review') {
          validateCatalogVerifiable(normalizeCatalogInput({}, existing))
          const duplicateMatches = (await Promise.all(existing.identifiers.map((item) => unresolvedDuplicates(item.rawValue, existing.id)))).flat()
          if (duplicateMatches.length) throw Object.assign(new Error('存在与其他 SKU 重复的零件编号'), { errorCode: 'SKU_QUALITY_BLOCKED' })
        }
        const item = await catalogRepository.transition(existing.id, {
          action, expectedVersion, note: request.body?.note, assignee: request.body?.assignee, dueAt: request.body?.dueAt,
        }, actor.name)
        results.push({ id: item.id, version: item.version, lifecycleStatus: item.lifecycleStatus })
      } catch (error) {
        failures.push({ id, error: error.errorCode || 'CATALOG_BULK_ITEM_FAILED', message: error.message || '操作失败', details: error.details })
      }
    }
    return { action, total: items.length, succeeded: results.length, failed: failures.length, results, failures }
  })
  app.get('/api/v2/catalog/skus/:id/changes', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const changes = await catalogRepository.changes(request.params.id)
    if (!changes) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    return { items: changes }
  })
  app.post('/api/v2/catalog/skus/:id/restore', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.restore')
    if (!actor) return
    const expectedVersion = requireCatalogVersion(request.body)
    const sourceVersion = Number(request.body?.sourceVersion)
    const reason = String(request.body?.reason || '').trim()
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: 'sourceVersion 必须是正整数' })
    if (!reason) return reply.code(400).send({ error: 'INVALID_CATALOG_INPUT', message: '请填写恢复原因' })
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    const changes = await catalogRepository.changes(existing.id)
    const source = changes.find((change) => change.version === sourceVersion)
    if (!source) return reply.code(404).send({ error: 'CATALOG_VERSION_NOT_FOUND', message: `找不到版本 v${sourceVersion}` })
    const input = sanitizeCatalogFitmentReviews(normalizeCatalogInput(source.snapshot, existing))
    return catalogRepository.restore(existing.id, input, expectedVersion, sourceVersion, reason, actor.name)
  })
  app.post('/api/v2/catalog/imports', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const job = await catalogImportRepository.createPreview(request.body, actor.name)
    return reply.code(job.duplicateUpload ? 200 : 201).send(job)
  })
  app.get('/api/v2/catalog/import-mappings', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    return catalogImportMappingRepository.list({ query: request.query?.q, active: request.query?.active })
  })
  app.post('/api/v2/catalog/import-mappings/match', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    return catalogImportMappingRepository.match(request.body)
  })
  app.post('/api/v2/catalog/import-mappings', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const profile = await catalogImportMappingRepository.save(request.body, actor.name)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return reply.code(request.body?.id ? 200 : 201).send(profile)
  })
  app.get('/api/v2/catalog/import-mappings/:id', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const profile = await catalogImportMappingRepository.get(request.params.id)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return profile
  })
  app.patch('/api/v2/catalog/import-mappings/:id', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const profile = await catalogImportMappingRepository.updateMetadata(request.params.id, request.body, actor.name)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return profile
  })
  app.patch('/api/v2/catalog/import-mappings/:id/rules', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const profile = await catalogImportMappingRepository.updateRules(request.params.id, request.body, actor.name)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return profile
  })
  app.patch('/api/v2/catalog/import-mappings/:id/value-mappings', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const profile = await catalogImportMappingRepository.updateValueMappings(request.params.id, request.body, actor.name)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return profile
  })
  app.post('/api/v2/catalog/import-mappings/:id/clone', async (request, reply) => {
    if (!catalogImportMappingRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_MAPPING_UNAVAILABLE', message: '供应商映射服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const profile = await catalogImportMappingRepository.clone(request.params.id, request.body, actor.name)
    if (!profile) return reply.code(404).send({ error: 'CATALOG_IMPORT_MAPPING_NOT_FOUND', message: '映射方案不存在' })
    return reply.code(201).send(profile)
  })
  app.get('/api/v2/catalog/imports', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    return catalogImportRepository.list({ state: request.query?.state, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/imports/:id', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    const job = await catalogImportRepository.get(request.params.id)
    if (!job) return reply.code(404).send({ error: 'CATALOG_IMPORT_NOT_FOUND', message: '导入批次不存在' })
    return job
  })
  app.post('/api/v2/catalog/imports/:id/resolve-values', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const job = await catalogImportRepository.resolveValues(request.params.id, request.body, actor.name)
    if (!job) return reply.code(404).send({ error: 'CATALOG_IMPORT_NOT_FOUND', message: '导入批次不存在' })
    return job
  })
  app.get('/api/v2/catalog/dictionary-proposals', async (request, reply) => {
    if (!catalogDictionaryGovernanceRepository) return reply.code(503).send({ error: 'CATALOG_DICTIONARY_GOVERNANCE_UNAVAILABLE', message: '标准值治理服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogDictionaryGovernanceRepository.list({ state: request.query?.state })
  })
  app.post('/api/v2/catalog/dictionary-proposals', async (request, reply) => {
    if (!catalogDictionaryGovernanceRepository) return reply.code(503).send({ error: 'CATALOG_DICTIONARY_GOVERNANCE_UNAVAILABLE', message: '标准值治理服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const proposal = await catalogDictionaryGovernanceRepository.create(request.body, actor.name)
    return reply.code(proposal.duplicateProposal ? 200 : 201).send(proposal)
  })
  app.post('/api/v2/catalog/dictionary-proposals/:id/review', async (request, reply) => {
    if (!catalogDictionaryGovernanceRepository) return reply.code(503).send({ error: 'CATALOG_DICTIONARY_GOVERNANCE_UNAVAILABLE', message: '标准值治理服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.configure')
    if (!actor) return
    const proposal = await catalogDictionaryGovernanceRepository.review(request.params.id, request.body, actor.name)
    if (!proposal) return reply.code(404).send({ error: 'CATALOG_DICTIONARY_PROPOSAL_NOT_FOUND', message: '标准值申请不存在' })
    return proposal
  })
  app.post('/api/v2/catalog/imports/:id/commit', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const job = await catalogImportRepository.commit(request.params.id, request.body, actor.name)
    if (!job) return reply.code(404).send({ error: 'CATALOG_IMPORT_NOT_FOUND', message: '导入批次不存在' })
    return job
  })
  app.post('/api/v2/catalog/imports/:id/retry', async (request, reply) => {
    if (!catalogImportRepository) return reply.code(503).send({ error: 'CATALOG_IMPORT_UNAVAILABLE', message: '批量导入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.import')
    if (!actor) return
    const job = await catalogImportRepository.retry(request.params.id, request.body, actor.name)
    if (!job) return reply.code(404).send({ error: 'CATALOG_IMPORT_NOT_FOUND', message: '导入批次不存在' })
    return job
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error.code === '23505') return reply.code(409).send({ error: 'CONFLICT', message: '数据已存在' })
    if (error.code === '23503') return reply.code(400).send({ error: 'INVALID_REFERENCE', message: '关联的数据不存在或已经失效' })
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
    const payload = { error: status === 500 ? 'INTERNAL_ERROR' : error.errorCode || 'INVALID_INPUT', message: status === 500 ? '服务器暂时无法处理请求' : error.message }
    if (status < 500 && error.details) payload.details = error.details
    return reply.code(status).send(payload)
  })
  return app
}
