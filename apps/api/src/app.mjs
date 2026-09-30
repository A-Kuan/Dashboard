import Fastify from 'fastify'
import { normalizeSkuInput, requireSkuVersion, validatePublishableSku } from './validation.mjs'
import { normalizeVehicleInput, requireVehicleVersion } from './vehicle-validation.mjs'
import { normalizeCatalogInput, normalizeIntakeInput, requireCatalogVersion, validateCatalogVerifiable } from './catalog-validation.mjs'

export function buildApp({ repository, vehicleRepository, dictionaryRepository, catalogRepository, logger = true }) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 24 * 1024 * 1024 })

  app.get('/api/health', async () => ({ status: 'ok', service: 'dashboard-sku-api' }))
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
    return dictionaryRepository.save(request.body, request.headers['x-operator-name'] || '系统操作员')
  })
  app.post('/api/v1/dictionaries/reset', async (request, reply) => {
    if (!dictionaryRepository) return reply.code(503).send({ error: 'DICTIONARY_SERVICE_UNAVAILABLE', message: '字典服务未配置' })
    return dictionaryRepository.reset(request.headers['x-operator-name'] || '系统操作员')
  })

  app.post('/api/v2/catalog/intakes', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return reply.code(201).send(await catalogRepository.createIntake(normalizeIntakeInput(request.body), request.headers['x-operator-name'] || '系统操作员'))
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
  app.get('/api/v2/catalog/skus/:id', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const item = await catalogRepository.get(request.params.id)
    if (!item) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    return item
  })
  app.post('/api/v2/catalog/skus', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    return reply.code(201).send(await catalogRepository.create(normalizeCatalogInput(request.body), request.headers['x-operator-name'] || '系统操作员'))
  })
  app.patch('/api/v2/catalog/skus/:id', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const expectedVersion = requireCatalogVersion(request.body)
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    const input = normalizeCatalogInput(request.body, existing)
    return catalogRepository.update(existing.id, input, expectedVersion, request.headers['x-operator-name'] || '系统操作员')
  })
  app.post('/api/v2/catalog/skus/:id/verify', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const expectedVersion = requireCatalogVersion(request.body)
    const existing = await catalogRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    validateCatalogVerifiable(normalizeCatalogInput({}, existing))
    return catalogRepository.verify(existing.id, expectedVersion, request.headers['x-operator-name'] || '系统操作员')
  })
  app.get('/api/v2/catalog/skus/:id/changes', async (request, reply) => {
    if (!catalogRepository) return reply.code(503).send({ error: 'CATALOG_SERVICE_UNAVAILABLE', message: '资料库服务未配置' })
    const changes = await catalogRepository.changes(request.params.id)
    if (!changes) return reply.code(404).send({ error: 'CATALOG_SKU_NOT_FOUND', message: 'SKU 资料不存在' })
    return { items: changes }
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
