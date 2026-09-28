import Fastify from 'fastify'
import { normalizeSkuInput, requireSkuVersion, validatePublishableSku } from './validation.mjs'
import { normalizeVehicleInput, requireVehicleVersion } from './vehicle-validation.mjs'

export function buildApp({ repository, vehicleRepository, dictionaryRepository, logger = true }) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 5 * 1024 * 1024 })

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

  app.setErrorHandler((error, _request, reply) => {
    if (error.code === '23505') return reply.code(409).send({ error: 'CONFLICT', message: '数据已存在' })
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
    return reply.code(status).send({ error: status === 500 ? 'INTERNAL_ERROR' : error.errorCode || 'INVALID_INPUT', message: status === 500 ? '服务器暂时无法处理请求' : error.message })
  })
  return app
}
