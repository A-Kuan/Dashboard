import Fastify from 'fastify'
import { normalizeSkuInput, requireSkuVersion, validatePublishableSku } from './validation.mjs'
import { normalizeVehicleInput, requireVehicleVersion } from './vehicle-validation.mjs'
import { normalizeCatalogInput, normalizeIntakeInput, requireCatalogVersion, sanitizeCatalogFitmentReviews, validateCatalogFitmentsReviewed, validateCatalogVerifiable } from './catalog-validation.mjs'
import { catalogRoles, requireCatalogCapability, resolveCatalogActor } from './catalog-access.mjs'
import { catalogImportTemplateCsv, catalogImportTemplateSpec } from './catalog-import-spec.mjs'
import { normalizeEpcCommitInput, normalizeEpcPreviewInput } from './catalog-epc-validation.mjs'
import { normalizeEpcConnectorCollectInput } from './catalog-epc-connector-validation.mjs'
import { createHttpMetrics, createLoggerOptions, createRequestId, isOperationsRequestAuthorized, OperationalLogController } from './observability.mjs'

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

export function buildApp({ repository, vehicleRepository, dictionaryRepository, catalogRepository, catalogImportRepository, catalogImportMappingRepository, catalogDictionaryGovernanceRepository, catalogPlatformRepository, catalogEpcIntakeRepository, catalogEpcConnectorService, catalogEpcConnectorRunRepository, catalogEpcAssetRepository, catalogEpcAssetStorage, catalogLegacyMigrationRepository, businessInquiryRepository, businessPartnerRepository, businessOrderRepository, businessInventoryRepository, businessFinanceRepository, businessAfterSalesRepository, businessSupplierReturnRepository, businessOperationsRepository, businessMasterDataQualityRepository, businessControlsRepository, releaseRevision = 'development', readinessCheck = async () => ({ database: 'not-checked' }), getDatabasePoolStats = () => null, operationsToken = process.env.API_OPERATIONS_TOKEN || '', logger = createLoggerOptions() }) {
  const metrics = createHttpMetrics({ releaseRevision, getDatabasePoolStats })
  const app = Fastify({ logger, logController: new OperationalLogController(), genReqId: createRequestId, trustProxy: ['127.0.0.1', '::1'], bodyLimit: 24 * 1024 * 1024 })
  const serviceMetadata = { service: 'dashboard-sku-api', releaseRevision }
  const unresolvedDuplicates = (identifier, exceptId) => (catalogRepository.findUnresolvedDuplicates || catalogRepository.findDuplicates).call(catalogRepository, identifier, exceptId)
  const ensureNoFitmentConflicts = async (skuId) => {
    if (!catalogPlatformRepository) return
    const conflicts = await catalogPlatformRepository.conflicts({ state: 'open', skuId })
    if (!conflicts.items.length) return
    const conflict = new Error('存在未处理的车型平台或适配范围冲突')
    conflict.statusCode = 422
    conflict.errorCode = 'FITMENT_CONFLICT_BLOCKED'
    conflict.details = { issues: ['fitmentConflict'], conflicts: conflicts.items.slice(0, 20) }
    throw conflict
  }
  const executeEpcConnector = async ({ connectorId, rawInput, actor, retryOf = '' }) => {
    const input = normalizeEpcConnectorCollectInput(rawInput)
    const run = await catalogEpcConnectorRunRepository.start({ connectorId, requestContext: input, retryOf }, actor)
    try {
      const result = await catalogEpcConnectorService.collect(connectorId, input)
      const preview = await catalogEpcIntakeRepository.createPreview(result.previewInput, actor)
      const completedRun = await catalogEpcConnectorRunRepository.succeed(run.id, {
        previewId: preview.id,
        responseSummary: { sourceSystem: preview.sourceSystem, catalogPath: preview.catalogPath, items: preview.items.length, assets: preview.assets?.length || 0 },
      })
      return { ...preview, connector: result.connector, connectorRun: completedRun }
    } catch (error) {
      const safeMessage = /^EPC_CONNECTOR_/.test(error.errorCode || '') ? error.message : '采集后处理失败'
      await catalogEpcConnectorRunRepository.fail(run.id, { errorCode: error.errorCode || 'EPC_CONNECTOR_PROCESSING_FAILED', errorMessage: safeMessage }).catch(() => {})
      error.details = { ...(error.details || {}), connectorRunId: run.id }
      throw error
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'string' || !payload.trimStart().startsWith('{')) return payload
    try {
      const body = JSON.parse(payload)
      if (!body || Array.isArray(body) || typeof body !== 'object' || body.requestId) return payload
      return JSON.stringify({ ...body, requestId: request.id })
    } catch {
      return payload
    }
  })
  app.addHook('onResponse', async (request, reply) => {
    metrics.record({ method: request.method, route: request.routeOptions?.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime })
  })

  app.get('/api/health', async () => ({ status: 'ok', ...serviceMetadata }))
  app.get('/api/ready', async (request, reply) => {
    try {
      return { status: 'ready', ...serviceMetadata, ...(await readinessCheck()) }
    } catch (error) {
      request.log.warn({ err: error, code: error.code }, 'readiness check failed')
      return reply.code(503).send({ status: 'not_ready', ...serviceMetadata, error: error.code || 'DATABASE_UNAVAILABLE', requestId: request.id })
    }
  })
  app.get('/api/metrics', async (request, reply) => {
    if (!isOperationsRequestAuthorized(request, operationsToken)) return reply.code(404).send({ error: 'NOT_FOUND', message: '资源不存在', requestId: request.id })
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render())
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
  app.get('/api/v2/business/partners', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessPartnerRepository.list({ query: request.query?.q, partnerType: request.query?.type, status: request.query?.status, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/operations-center', async (request, reply) => {
    if (!businessOperationsRepository) return reply.code(503).send({ error: 'BUSINESS_OPERATIONS_UNAVAILABLE', message: '业务跟进中枢未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessOperationsRepository.listWorkItems({
      query: request.query?.q,
      kind: request.query?.kind,
      urgency: request.query?.urgency,
      assignedTo: request.query?.assignedTo,
      page: request.query?.page,
      pageSize: request.query?.pageSize,
    })
  })
  app.get('/api/v2/business/master-data-quality', async (request, reply) => {
    if (!businessMasterDataQualityRepository) return reply.code(503).send({ error: 'BUSINESS_MASTER_DATA_QUALITY_UNAVAILABLE', message: '业务主数据质量服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessMasterDataQualityRepository.list({
      kind: request.query?.kind,
      status: request.query?.status,
      severity: request.query?.severity,
      query: request.query?.q,
      assignedTo: request.query?.assignedTo,
      slaStatus: request.query?.slaStatus,
      page: request.query?.page,
      pageSize: request.query?.pageSize,
    })
  })
  app.put('/api/v2/business/master-data-quality/:issueKey/assignment', async (request, reply) => {
    if (!businessMasterDataQualityRepository) return reply.code(503).send({ error: 'BUSINESS_MASTER_DATA_QUALITY_UNAVAILABLE', message: '业务主数据质量服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.data_quality.assign')
    if (!actor) return
    const result = await businessMasterDataQualityRepository.assign(request.params.issueKey, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.post('/api/v2/business/master-data-quality/:issueKey/decisions', async (request, reply) => {
    if (!businessMasterDataQualityRepository) return reply.code(503).send({ error: 'BUSINESS_MASTER_DATA_QUALITY_UNAVAILABLE', message: '业务主数据质量服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.data_quality.review')
    if (!actor) return
    const result = await businessMasterDataQualityRepository.decide(request.params.issueKey, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/controls', async (request, reply) => {
    if (!businessControlsRepository) return reply.code(503).send({ error: 'BUSINESS_CONTROLS_UNAVAILABLE', message: '业务控制规则服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessControlsRepository.get()
  })
  app.patch('/api/v2/business/controls', async (request, reply) => {
    if (!businessControlsRepository) return reply.code(503).send({ error: 'BUSINESS_CONTROLS_UNAVAILABLE', message: '业务控制规则服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.policy')
    if (!actor) return
    return businessControlsRepository.update(request.body, actor)
  })
  app.post('/api/v2/business/partners', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return reply.code(201).send(await businessPartnerRepository.create(request.body, actor))
  })
  app.post('/api/v2/business/quick-quote/customer-onboarding/preview', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return businessPartnerRepository.previewQuickQuoteCustomerOnboarding(request.body)
  })
  app.post('/api/v2/business/quick-quote/customer-onboarding', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    const result = await businessPartnerRepository.onboardQuickQuoteCustomer(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.post('/api/v2/business/partners/merge-preview', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessPartnerRepository.previewCustomerMerge(request.body)
  })
  app.post('/api/v2/business/partners/merge', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.customer.merge')
    if (!actor) return
    const result = await businessPartnerRepository.mergeCustomer(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.post('/api/v2/business/customer-vehicles/merge-preview', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessPartnerRepository.previewCustomerVehicleMerge(request.body)
  })
  app.post('/api/v2/business/customer-vehicles/merge', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.customer.vehicle.merge')
    if (!actor) return
    const result = await businessPartnerRepository.mergeCustomerVehicle(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/partners/:id', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const partner = await businessPartnerRepository.get(request.params.id)
    return partner || reply.code(404).send({ error: 'PARTNER_NOT_FOUND', message: '客户或供应商不存在' })
  })
  app.get('/api/v2/business/partners/:id/360', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const result = await businessPartnerRepository.customer360(request.params.id, { pageSize: request.query?.pageSize, cursor: request.query?.cursor })
    return result || reply.code(404).send({ error: 'PARTNER_NOT_FOUND', message: '客户或供应商不存在' })
  })
  app.patch('/api/v2/business/partners/:id', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessPartnerRepository.update(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/partners/:id/contacts', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return reply.code(201).send(await businessPartnerRepository.addContact(request.params.id, request.body, actor))
  })
  app.patch('/api/v2/business/partners/:id/contacts/:contactId', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessPartnerRepository.updateContact(request.params.id, request.params.contactId, request.body, actor)
  })
  app.post('/api/v2/business/partners/:id/vehicles', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return reply.code(201).send(await businessPartnerRepository.addVehicle(request.params.id, request.body, actor))
  })
  app.patch('/api/v2/business/partners/:id/vehicles/:vehicleId', async (request, reply) => {
    if (!businessPartnerRepository) return reply.code(503).send({ error: 'BUSINESS_PARTNER_UNAVAILABLE', message: '客户与供应商服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessPartnerRepository.updateVehicle(request.params.id, request.params.vehicleId, request.body, actor)
  })
  app.get('/api/v2/business/quick-quote/context', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInquiryRepository.quoteContext({
      customerQuery: request.query?.customerQuery, vehicleQuery: request.query?.vehicleQuery, skuQuery: request.query?.skuQuery,
      customerId: request.query?.customerId, customerVehicleId: request.query?.customerVehicleId,
      platformId: request.query?.platformId, variantId: request.query?.variantId, pageSize: request.query?.pageSize,
    })
  })
  app.get('/api/v2/business/quick-quote/drafts', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInquiryRepository.listQuickQuoteDrafts({
      status: request.query?.status,
      customerId: request.query?.customerId,
      page: request.query?.page,
      pageSize: request.query?.pageSize,
      mine: request.query?.mine !== 'false',
    }, actor)
  })
  app.post('/api/v2/business/quick-quote/drafts', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    const result = await businessInquiryRepository.createQuickQuoteDraft(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/quick-quote/drafts/:id', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const draft = await businessInquiryRepository.getQuickQuoteDraft(request.params.id)
    return draft || reply.code(404).send({ error: 'QUICK_QUOTE_DRAFT_NOT_FOUND', message: '快速报价草稿不存在' })
  })
  app.patch('/api/v2/business/quick-quote/drafts/:id', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return businessInquiryRepository.saveQuickQuoteDraft(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/quick-quote/drafts/:id/abandon', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return businessInquiryRepository.abandonQuickQuoteDraft(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/quick-quote/drafts/:id/submit', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    const result = await businessInquiryRepository.submitQuickQuoteDraft(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/quick-quote/decision', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInquiryRepository.quoteDecision({
      customerId: request.query?.customerId, customerVehicleId: request.query?.customerVehicleId, catalogSkuId: request.query?.catalogSkuId,
      quantity: request.query?.quantity, costUnitPrice: request.query?.costUnitPrice, saleUnitPrice: request.query?.saleUnitPrice, lookbackDays: request.query?.lookbackDays,
      fulfillmentSource: request.query?.fulfillmentSource, fulfillmentWarehouseId: request.query?.fulfillmentWarehouseId, supplierPartnerId: request.query?.supplierPartnerId,
    })
  })
  app.post('/api/v2/business/quick-quotes', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    const result = await businessInquiryRepository.createQuickQuote(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/inquiries', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInquiryRepository.list({ query: request.query?.q, status: request.query?.status, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.post('/api/v2/business/inquiries', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return reply.code(201).send(await businessInquiryRepository.create(request.body, actor))
  })
  app.get('/api/v2/business/inquiries/:id', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const inquiry = await businessInquiryRepository.get(request.params.id)
    return inquiry || reply.code(404).send({ error: 'INQUIRY_NOT_FOUND', message: '询价不存在' })
  })
  app.post('/api/v2/business/inquiries/:id/items/:itemId/offers', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return reply.code(201).send(await businessInquiryRepository.addOffer(request.params.id, request.params.itemId, request.body, actor))
  })
  app.post('/api/v2/business/inquiries/:id/quotes', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return reply.code(201).send(await businessInquiryRepository.createQuote(request.params.id, request.body, actor))
  })
  app.post('/api/v2/business/quotes/:id/send', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return businessInquiryRepository.sendQuote(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/quotes/:id/revisions', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote')
    if (!actor) return
    return reply.code(201).send(await businessInquiryRepository.reviseQuote(request.params.id, request.body, actor))
  })
  app.post('/api/v2/business/quotes/:id/approval', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.quote.approve')
    if (!actor) return
    return businessInquiryRepository.reviewQuoteApproval(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/inquiries/:id/transition', async (request, reply) => {
    if (!businessInquiryRepository) return reply.code(503).send({ error: 'BUSINESS_INQUIRY_UNAVAILABLE', message: '询价业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.manage')
    if (!actor) return
    return businessInquiryRepository.transition(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/inquiries/:id/convert-order', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.order')
    if (!actor) return
    const result = await businessOrderRepository.convertInquiry(request.params.id, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/sales-orders', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessOrderRepository.listSalesOrders({ query: request.query?.q, status: request.query?.status, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/sales-orders/:id', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const order = await businessOrderRepository.getSalesOrder(request.params.id)
    return order || reply.code(404).send({ error: 'SALES_ORDER_NOT_FOUND', message: '销售订单不存在' })
  })
  app.post('/api/v2/business/sales-orders/:id/transition', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.order')
    if (!actor) return
    return businessOrderRepository.transitionSalesOrder(request.params.id, request.body, actor)
  })
  app.get('/api/v2/business/receivables', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应收与收款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessFinanceRepository.listReceivables({ query: request.query?.q, status: request.query?.status, customerPartnerId: request.query?.customerPartnerId, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/receivables/:id', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应收与收款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const receivable = await businessFinanceRepository.getReceivable(request.params.id)
    return receivable || reply.code(404).send({ error: 'RECEIVABLE_NOT_FOUND', message: '应收单不存在' })
  })
  app.post('/api/v2/business/receivables/:id/payments', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应收与收款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.finance')
    if (!actor) return
    const result = await businessFinanceRepository.recordPayment(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/payables', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应付与付款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessFinanceRepository.listPayables({ query: request.query?.q, status: request.query?.status, supplierPartnerId: request.query?.supplierPartnerId, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/payables/:id', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应付与付款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const payable = await businessFinanceRepository.getPayable(request.params.id)
    return payable || reply.code(404).send({ error: 'PAYABLE_NOT_FOUND', message: '应付单不存在' })
  })
  app.post('/api/v2/business/payables/:id/payments', async (request, reply) => {
    if (!businessFinanceRepository) return reply.code(503).send({ error: 'BUSINESS_FINANCE_UNAVAILABLE', message: '应付与付款服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.finance')
    if (!actor) return
    const result = await businessFinanceRepository.recordSupplierPayment(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/after-sales', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessAfterSalesRepository.listCases({ query: request.query?.q, status: request.query?.status, customerPartnerId: request.query?.customerPartnerId, salesOrderId: request.query?.salesOrderId, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.post('/api/v2/business/after-sales', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.after_sales')
    if (!actor) return
    const result = await businessAfterSalesRepository.createCase(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/after-sales/:id', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const afterSalesCase = await businessAfterSalesRepository.getCase(request.params.id)
    return afterSalesCase || reply.code(404).send({ error: 'AFTER_SALES_NOT_FOUND', message: '售后单不存在' })
  })
  app.post('/api/v2/business/after-sales/:id/review', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.after_sales.review')
    if (!actor) return
    return businessAfterSalesRepository.reviewCase(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/after-sales/:id/return-receipts', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    const result = await businessAfterSalesRepository.receiveReturn(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.post('/api/v2/business/after-sales/:id/refunds', async (request, reply) => {
    if (!businessAfterSalesRepository) return reply.code(503).send({ error: 'BUSINESS_AFTER_SALES_UNAVAILABLE', message: '售后服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.finance')
    if (!actor) return
    const result = await businessAfterSalesRepository.recordRefund(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/supplier-returns', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessSupplierReturnRepository.listCases({ query: request.query?.q, status: request.query?.status, supplierPartnerId: request.query?.supplierPartnerId, purchaseOrderId: request.query?.purchaseOrderId, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.post('/api/v2/business/supplier-returns', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.purchase_return')
    if (!actor) return
    const result = await businessSupplierReturnRepository.createCase(request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/supplier-returns/:id', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const supplierReturn = await businessSupplierReturnRepository.getCase(request.params.id)
    return supplierReturn || reply.code(404).send({ error: 'SUPPLIER_RETURN_NOT_FOUND', message: '供应商退货单不存在' })
  })
  app.post('/api/v2/business/supplier-returns/:id/review', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.purchase_return.review')
    if (!actor) return
    return businessSupplierReturnRepository.reviewCase(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/supplier-returns/:id/shipments', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    const result = await businessSupplierReturnRepository.shipReturn(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.post('/api/v2/business/supplier-returns/:id/refunds', async (request, reply) => {
    if (!businessSupplierReturnRepository) return reply.code(503).send({ error: 'BUSINESS_SUPPLIER_RETURN_UNAVAILABLE', message: '供应商退货服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.finance')
    if (!actor) return
    const result = await businessSupplierReturnRepository.recordRefund(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/purchase-orders', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessOrderRepository.listPurchaseOrders({ query: request.query?.q, status: request.query?.status, supplierPartnerId: request.query?.supplierPartnerId, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/purchase-orders/:id', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const order = await businessOrderRepository.getPurchaseOrder(request.params.id)
    return order || reply.code(404).send({ error: 'PURCHASE_ORDER_NOT_FOUND', message: '采购订单不存在' })
  })
  app.post('/api/v2/business/purchase-orders/:id/transition', async (request, reply) => {
    if (!businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_ORDER_UNAVAILABLE', message: '订单业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.order')
    if (!actor) return
    return businessOrderRepository.transitionPurchaseOrder(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/purchase-orders/:id/receive', async (request, reply) => {
    if (!businessInventoryRepository && !businessOrderRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, businessInventoryRepository ? 'business.inventory' : 'business.order')
    if (!actor) return
    if (businessInventoryRepository) {
      const result = await businessInventoryRepository.receivePurchaseOrder(request.params.id, request.body, actor)
      return reply.code(result.created ? 201 : 200).send(result)
    }
    return businessOrderRepository.receivePurchaseOrder(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/purchase-orders/:id/receipts', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    const result = await businessInventoryRepository.receivePurchaseOrder(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/goods-receipts/:id', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const receipt = await businessInventoryRepository.getReceipt(request.params.id)
    return receipt || reply.code(404).send({ error: 'GOODS_RECEIPT_NOT_FOUND', message: '采购收货单不存在' })
  })
  app.get('/api/v2/business/warehouses', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInventoryRepository.listWarehouses()
  })
  app.post('/api/v2/business/warehouses', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    return reply.code(201).send(await businessInventoryRepository.createWarehouse(request.body, actor))
  })
  app.get('/api/v2/business/warehouses/:id', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const warehouse = await businessInventoryRepository.getWarehouse(request.params.id)
    return warehouse || reply.code(404).send({ error: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' })
  })
  app.patch('/api/v2/business/warehouses/:id', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    return businessInventoryRepository.updateWarehouse(request.params.id, request.body, actor)
  })
  app.get('/api/v2/business/inventory-balances', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInventoryRepository.listBalances({ warehouseId: request.query?.warehouseId, query: request.query?.q, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/business/inventory-movements', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    return businessInventoryRepository.listMovements({ warehouseId: request.query?.warehouseId, stockKey: request.query?.stockKey, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.post('/api/v2/business/sales-orders/:id/reservations', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    const result = await businessInventoryRepository.reserveSalesOrder(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/reservations/:id', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const reservation = await businessInventoryRepository.getReservation(request.params.id)
    return reservation || reply.code(404).send({ error: 'RESERVATION_NOT_FOUND', message: '库存预留不存在' })
  })
  app.post('/api/v2/business/reservations/:id/release', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    return businessInventoryRepository.releaseReservation(request.params.id, request.body, actor)
  })
  app.post('/api/v2/business/sales-orders/:id/shipments', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.inventory')
    if (!actor) return
    const result = await businessInventoryRepository.shipSalesOrder(request.params.id, request.body, actor)
    return reply.code(result.created ? 201 : 200).send(result)
  })
  app.get('/api/v2/business/shipments/:id', async (request, reply) => {
    if (!businessInventoryRepository) return reply.code(503).send({ error: 'BUSINESS_INVENTORY_UNAVAILABLE', message: '库存业务服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'business.read')
    if (!actor) return
    const shipment = await businessInventoryRepository.getShipment(request.params.id)
    return shipment || reply.code(404).send({ error: 'SHIPMENT_NOT_FOUND', message: '销售出库单不存在' })
  })
  app.get('/api/v2/catalog/legacy-migration-preview', async (request, reply) => {
    if (!catalogLegacyMigrationRepository) return reply.code(503).send({ error: 'LEGACY_MIGRATION_UNAVAILABLE', message: '旧资料迁移服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogLegacyMigrationRepository.preview({ query: request.query?.q, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/legacy-migration-pilot', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.pilot) return reply.code(503).send({ error: 'LEGACY_MIGRATION_PILOT_UNAVAILABLE', message: '试运行候选服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogLegacyMigrationRepository.pilot({ size: request.query?.size })
  })
  app.post('/api/v2/catalog/legacy-migrations', async (request, reply) => {
    if (!catalogLegacyMigrationRepository) return reply.code(503).send({ error: 'LEGACY_MIGRATION_UNAVAILABLE', message: '旧资料迁移服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.migration.execute')
    if (!actor) return
    return reply.code(409).send({ error: 'LEGACY_MIGRATION_PLAN_REQUIRED', message: '旧资料必须先提交迁移方案并通过审核' })
  })
  app.get('/api/v2/catalog/legacy-migrations/:id', async (request, reply) => {
    if (!catalogLegacyMigrationRepository) return reply.code(503).send({ error: 'LEGACY_MIGRATION_UNAVAILABLE', message: '旧资料迁移服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const batch = await catalogLegacyMigrationRepository.getBatch(request.params.id)
    if (!batch) return reply.code(404).send({ error: 'LEGACY_MIGRATION_NOT_FOUND', message: '迁移批次不存在' })
    return batch
  })
  app.post('/api/v2/catalog/legacy-migration-plans', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.createPlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.migration.plan')
    if (!actor) return
    return reply.code(201).send(await catalogLegacyMigrationRepository.createPlan(request.body, actor))
  })
  app.get('/api/v2/catalog/legacy-migration-plans', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.listPlans) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogLegacyMigrationRepository.listPlans({ state: request.query?.state, limit: request.query?.limit })
  })
  app.get('/api/v2/catalog/legacy-migration-plans/:id', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.getPlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const plan = await catalogLegacyMigrationRepository.getPlan(request.params.id)
    if (!plan) return reply.code(404).send({ error: 'LEGACY_MIGRATION_PLAN_NOT_FOUND', message: '迁移方案不存在' })
    return plan
  })
  app.get('/api/v2/catalog/legacy-migration-plans/:id/preflight', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.preflightPlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案复核服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const preflight = await catalogLegacyMigrationRepository.preflightPlan(request.params.id)
    if (!preflight) return reply.code(404).send({ error: 'LEGACY_MIGRATION_PLAN_NOT_FOUND', message: '迁移方案不存在' })
    return preflight
  })
  app.post('/api/v2/catalog/legacy-migration-plans/:id/review', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.reviewPlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.migration.review')
    if (!actor) return
    return catalogLegacyMigrationRepository.reviewPlan(request.params.id, request.body, actor)
  })
  app.post('/api/v2/catalog/legacy-migration-plans/:id/commit', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.commitPlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_GOVERNANCE_UNAVAILABLE', message: '迁移方案服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.migration.execute')
    if (!actor) return
    return catalogLegacyMigrationRepository.commitPlan(request.params.id, request.body, actor)
  })
  app.get('/api/v2/catalog/legacy-migration-plans/:id/acceptance', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.acceptancePlan) return reply.code(503).send({ error: 'LEGACY_MIGRATION_ACCEPTANCE_UNAVAILABLE', message: '迁移验收服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const acceptance = await catalogLegacyMigrationRepository.acceptancePlan(request.params.id)
    if (!acceptance) return reply.code(404).send({ error: 'LEGACY_MIGRATION_PLAN_NOT_FOUND', message: '迁移方案不存在' })
    return acceptance
  })
  app.post('/api/v2/catalog/legacy-migration-plans/:id/acceptance', async (request, reply) => {
    if (!catalogLegacyMigrationRepository?.reviewAcceptance) return reply.code(503).send({ error: 'LEGACY_MIGRATION_ACCEPTANCE_UNAVAILABLE', message: '迁移验收服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.migration.accept')
    if (!actor) return
    return catalogLegacyMigrationRepository.reviewAcceptance(request.params.id, request.body, actor)
  })
  app.get('/api/v1/skus', async (request) => ({ items: await repository.list(request.query?.q || '') }))
  app.get('/api/v1/skus/:id', async (request, reply) => {
    const item = await repository.get(request.params.id)
    if (!item) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    return item
  })
  app.post('/api/v1/skus/validate-code', async (request, reply) => {
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const code = String(request.body?.skuCode || '').trim()
    return { available: Boolean(code) && !(await repository.codeExists(code, request.body?.exceptId || null)) }
  })
  app.post('/api/v1/skus', async (request, reply) => {
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const input = { ...normalizeSkuInput(request.body), lifecycleStatus: '草稿' }
    if (await repository.codeExists(input.skuCode)) return reply.code(409).send({ error: 'SKU_CODE_EXISTS', message: 'SKU 编码已存在' })
    return reply.code(201).send(await repository.create(input, actor.name))
  })
  app.put('/api/v1/skus/:id', async (request, reply) => {
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    const input = { ...normalizeSkuInput(request.body), lifecycleStatus: existing.lifecycleStatus }
    if (await repository.codeExists(input.skuCode, existing.id)) return reply.code(409).send({ error: 'SKU_CODE_EXISTS', message: 'SKU 编码已存在' })
    return repository.update(existing.id, input, actor.name, '保存草稿')
  })
  app.post('/api/v1/skus/:id/publish', async (request, reply) => {
    const actor = requireCatalogCapability(request, reply, 'catalog.submit')
    if (!actor) return
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    const input = validatePublishableSku(normalizeSkuInput({ ...existing, ...request.body, lifecycleStatus: '在售' }))
    return repository.update(existing.id, input, actor.name, '发布 SKU')
  })
  app.post('/api/v1/skus/:id/discontinue', async (request, reply) => {
    const actor = requireCatalogCapability(request, reply, 'catalog.lifecycle')
    if (!actor) return
    requireSkuVersion(request.body)
    const existing = await repository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'SKU_NOT_FOUND', message: 'SKU 不存在' })
    if (existing.lifecycleStatus !== '在售') return reply.code(409).send({ error: 'INVALID_STATUS_TRANSITION', message: '只有在售 SKU 可以停产' })
    const input = normalizeSkuInput({ ...existing, ...request.body, lifecycleStatus: '停产' })
    return repository.update(existing.id, input, actor.name, '停产 SKU')
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
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const input = { ...normalizeVehicleInput(request.body), lifecycleStatus: '草稿' }
    if (await vehicleRepository.codeExists(input.vehicleCode)) return reply.code(409).send({ error: 'VEHICLE_CODE_EXISTS', message: '车型版本编码已存在' })
    return reply.code(201).send(await vehicleRepository.create(input, actor.name))
  })
  app.put('/api/v1/vehicles/:id', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    requireVehicleVersion(request.body)
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    const input = normalizeVehicleInput({ ...existing, ...request.body, lifecycleStatus: existing.lifecycleStatus })
    if (await vehicleRepository.codeExists(input.vehicleCode, existing.id)) return reply.code(409).send({ error: 'VEHICLE_CODE_EXISTS', message: '车型版本编码已存在' })
    return vehicleRepository.update(existing.id, input, actor.name)
  })
  app.post('/api/v1/vehicles/:id/publish', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.submit')
    if (!actor) return
    requireVehicleVersion(request.body)
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    const input = normalizeVehicleInput({ ...existing, ...request.body, lifecycleStatus: '已发布' })
    if (!input.requirements.length) return reply.code(422).send({ error: 'VEHICLE_NOT_PUBLISHABLE', message: '至少需要一条常用配件记录' })
    return vehicleRepository.update(existing.id, input, actor.name, '发布车型资料')
  })
  app.post('/api/v1/vehicles/:id/auto-match', async (request, reply) => {
    if (!vehicleRepository) return reply.code(503).send({ error: 'VEHICLE_SERVICE_UNAVAILABLE', message: '车型库服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const existing = await vehicleRepository.get(request.params.id)
    if (!existing) return reply.code(404).send({ error: 'VEHICLE_NOT_FOUND', message: '车型不存在' })
    return vehicleRepository.autoMatch(existing.id, actor.name)
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
  app.post('/api/v2/catalog/epc-previews', async (request, reply) => {
    if (!catalogEpcIntakeRepository) return reply.code(503).send({ error: 'EPC_INTAKE_SERVICE_UNAVAILABLE', message: 'EPC 证据接入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    return reply.code(201).send(await catalogEpcIntakeRepository.createPreview(normalizeEpcPreviewInput(request.body), actor.name))
  })
  app.get('/api/v2/catalog/epc-connectors', async (request, reply) => {
    if (!catalogEpcConnectorService) return reply.code(503).send({ error: 'EPC_CONNECTOR_SERVICE_UNAVAILABLE', message: 'EPC 连接器服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogEpcConnectorService.list()
  })
  app.post('/api/v2/catalog/epc-connectors/:id/collect', async (request, reply) => {
    if (!catalogEpcConnectorService || !catalogEpcIntakeRepository || !catalogEpcConnectorRunRepository) return reply.code(503).send({ error: 'EPC_CONNECTOR_SERVICE_UNAVAILABLE', message: 'EPC 连接器服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    return reply.code(201).send(await executeEpcConnector({ connectorId: request.params.id, rawInput: request.body, actor: actor.name }))
  })
  app.get('/api/v2/catalog/epc-connector-runs', async (request, reply) => {
    if (!catalogEpcConnectorRunRepository) return reply.code(503).send({ error: 'EPC_CONNECTOR_RUN_SERVICE_UNAVAILABLE', message: 'EPC 连接器运行记录服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const filters = request.query || {}
    const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    if (filters.state && !['running', 'succeeded', 'failed'].includes(filters.state)) return reply.code(400).send({ error: 'INVALID_EPC_CONNECTOR_RUN_FILTER', message: '运行状态筛选无效' })
    if (String(filters.q || '').trim().length > 120) return reply.code(400).send({ error: 'INVALID_EPC_CONNECTOR_RUN_FILTER', message: '搜索条件不能超过 120 个字符' })
    if (!validDate(filters.from) || !validDate(filters.to) || (filters.from && filters.to && filters.from > filters.to)) return reply.code(400).send({ error: 'INVALID_EPC_CONNECTOR_RUN_FILTER', message: '日期范围无效' })
    return catalogEpcConnectorRunRepository.list({
      state: filters.state,
      connectorId: filters.connectorId,
      query: String(filters.q || '').trim(),
      from: filters.from,
      to: filters.to,
      page: filters.page,
      pageSize: filters.pageSize,
    })
  })
  app.get('/api/v2/catalog/epc-connector-runs/:id', async (request, reply) => {
    if (!catalogEpcConnectorRunRepository) return reply.code(503).send({ error: 'EPC_CONNECTOR_RUN_SERVICE_UNAVAILABLE', message: 'EPC 连接器运行记录服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const run = await catalogEpcConnectorRunRepository.get(request.params.id)
    return run || reply.code(404).send({ error: 'EPC_CONNECTOR_RUN_NOT_FOUND', message: '连接器运行记录不存在' })
  })
  app.post('/api/v2/catalog/epc-connector-runs/:id/retry', async (request, reply) => {
    if (!catalogEpcConnectorService || !catalogEpcIntakeRepository || !catalogEpcConnectorRunRepository) return reply.code(503).send({ error: 'EPC_CONNECTOR_RUN_SERVICE_UNAVAILABLE', message: 'EPC 连接器运行记录服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const previous = await catalogEpcConnectorRunRepository.get(request.params.id)
    if (!previous) return reply.code(404).send({ error: 'EPC_CONNECTOR_RUN_NOT_FOUND', message: '连接器运行记录不存在' })
    if (previous.state !== 'failed') return reply.code(409).send({ error: 'EPC_CONNECTOR_RUN_NOT_RETRYABLE', message: '只有失败的采集任务可以重试' })
    return reply.code(201).send(await executeEpcConnector({ connectorId: previous.connectorId, rawInput: previous.requestContext, actor: actor.name, retryOf: previous.id }))
  })
  app.get('/api/v2/catalog/epc-asset-storage', async (request, reply) => {
    if (!catalogEpcAssetStorage) return reply.code(503).send({ error: 'EPC_ASSET_STORAGE_UNAVAILABLE', message: '目录资源存储服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogEpcAssetStorage.status()
  })
  app.get('/api/v2/catalog/epc-assets', async (request, reply) => {
    if (!catalogEpcAssetRepository) return reply.code(503).send({ error: 'EPC_ASSET_SERVICE_UNAVAILABLE', message: '目录资源服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const state = String(request.query?.state || '')
    if (state && !['pending', 'mirroring', 'stored', 'failed', 'corrupt'].includes(state)) return reply.code(400).send({ error: 'INVALID_EPC_ASSET_FILTER', message: '资源状态筛选无效' })
    return catalogEpcAssetRepository.list({ intakeId: request.query?.intakeId, state, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/epc-assets/:id', async (request, reply) => {
    if (!catalogEpcAssetRepository) return reply.code(503).send({ error: 'EPC_ASSET_SERVICE_UNAVAILABLE', message: '目录资源服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const asset = await catalogEpcAssetRepository.get(request.params.id, true)
    return asset || reply.code(404).send({ error: 'EPC_ASSET_NOT_FOUND', message: '目录资源不存在' })
  })
  app.post('/api/v2/catalog/epc-assets/:id/mirror', async (request, reply) => {
    if (!catalogEpcAssetRepository || !catalogEpcAssetStorage) return reply.code(503).send({ error: 'EPC_ASSET_SERVICE_UNAVAILABLE', message: '目录资源服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const started = await catalogEpcAssetRepository.startMirror(request.params.id, actor.name)
    if (!started) return reply.code(404).send({ error: 'EPC_ASSET_NOT_FOUND', message: '目录资源不存在' })
    try {
      const result = await catalogEpcAssetStorage.mirror(started.asset)
      return await catalogEpcAssetRepository.finishMirror(started.asset.id, started.attemptId, result)
    } catch (error) {
      const errorCode = /^EPC_ASSET_/.test(error.errorCode || '') ? error.errorCode : 'EPC_ASSET_STORAGE_FAILED'
      const errorMessage = /^EPC_ASSET_/.test(error.errorCode || '') ? error.message : '目录资源托管失败'
      await catalogEpcAssetRepository.failMirror(started.asset.id, started.attemptId, errorCode, errorMessage).catch(() => {})
      throw error
    }
  })
  app.post('/api/v2/catalog/epc-assets/:id/verify', async (request, reply) => {
    if (!catalogEpcAssetRepository || !catalogEpcAssetStorage) return reply.code(503).send({ error: 'EPC_ASSET_SERVICE_UNAVAILABLE', message: '目录资源服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const started = await catalogEpcAssetRepository.startVerify(request.params.id, actor.name)
    if (!started) return reply.code(404).send({ error: 'EPC_ASSET_NOT_FOUND', message: '目录资源不存在' })
    try {
      const result = await catalogEpcAssetStorage.verify(started.asset)
      return await catalogEpcAssetRepository.finishVerify(started.asset.id, started.attemptId, result)
    } catch (error) {
      const errorCode = /^EPC_ASSET_/.test(error.errorCode || '') ? error.errorCode : 'EPC_ASSET_VERIFY_FAILED'
      const errorMessage = /^EPC_ASSET_/.test(error.errorCode || '') ? error.message : '目录资源校验失败'
      await catalogEpcAssetRepository.failVerify(started.asset.id, started.attemptId, errorCode, errorMessage).catch(() => {})
      throw error
    }
  })
  app.get('/api/v2/catalog/epc-assets/:id/content', async (request, reply) => {
    if (!catalogEpcAssetRepository || !catalogEpcAssetStorage) return reply.code(503).send({ error: 'EPC_ASSET_SERVICE_UNAVAILABLE', message: '目录资源服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const asset = await catalogEpcAssetRepository.get(request.params.id, false)
    if (!asset) return reply.code(404).send({ error: 'EPC_ASSET_NOT_FOUND', message: '目录资源不存在' })
    if (asset.state !== 'stored') return reply.code(409).send({ error: 'EPC_ASSET_NOT_STORED', message: '目录资源尚未完成托管' })
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }[asset.contentType] || 'bin'
    reply.header('content-disposition', `inline; filename="epc-asset-${asset.id}.${extension}"`)
    reply.header('content-length', String(asset.byteSize))
    reply.header('cache-control', 'private, max-age=3600')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('content-security-policy', "default-src 'none'; sandbox")
    return reply.type(asset.contentType).send(await catalogEpcAssetStorage.open(asset))
  })
  app.get('/api/v2/catalog/epc-previews', async (request, reply) => {
    if (!catalogEpcIntakeRepository) return reply.code(503).send({ error: 'EPC_INTAKE_SERVICE_UNAVAILABLE', message: 'EPC 证据接入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogEpcIntakeRepository.list({ state: request.query?.state, page: request.query?.page, pageSize: request.query?.pageSize })
  })
  app.get('/api/v2/catalog/epc-previews/:id', async (request, reply) => {
    if (!catalogEpcIntakeRepository) return reply.code(503).send({ error: 'EPC_INTAKE_SERVICE_UNAVAILABLE', message: 'EPC 证据接入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const preview = await catalogEpcIntakeRepository.get(request.params.id)
    return preview || reply.code(404).send({ error: 'EPC_PREVIEW_NOT_FOUND', message: 'EPC 匹配预览不存在' })
  })
  app.post('/api/v2/catalog/epc-previews/:id/commit', async (request, reply) => {
    if (!catalogEpcIntakeRepository) return reply.code(503).send({ error: 'EPC_INTAKE_SERVICE_UNAVAILABLE', message: 'EPC 证据接入服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.edit')
    if (!actor) return
    const preview = await catalogEpcIntakeRepository.commit(request.params.id, normalizeEpcCommitInput(request.body), actor.name)
    return preview || reply.code(404).send({ error: 'EPC_PREVIEW_NOT_FOUND', message: 'EPC 匹配预览不存在' })
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
  app.get('/api/v2/catalog/vehicle-platforms', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型平台主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogPlatformRepository.list({ query: request.query?.q, status: request.query?.status })
  })
  app.get('/api/v2/catalog/vehicle-platforms/:id', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型平台主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const item = await catalogPlatformRepository.get(request.params.id)
    return item || reply.code(404).send({ error: 'PLATFORM_NOT_FOUND', message: '车型平台不存在' })
  })
  app.post('/api/v2/catalog/vehicle-platforms', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型平台主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.manage_platform')
    if (!actor) return
    return reply.code(201).send(await catalogPlatformRepository.create(request.body, actor.name))
  })
  app.patch('/api/v2/catalog/vehicle-platforms/:id', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型平台主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.manage_platform')
    if (!actor) return
    const item = await catalogPlatformRepository.update(request.params.id, request.body, actor.name)
    return item || reply.code(404).send({ error: 'PLATFORM_NOT_FOUND', message: '车型平台不存在' })
  })
  app.get('/api/v2/catalog/vehicle-variants', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型版本主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogPlatformRepository.listVariants({ platformId: request.query?.platformId, query: request.query?.q, status: request.query?.status })
  })
  app.get('/api/v2/catalog/vehicle-variants/:id', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型版本主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    const item = await catalogPlatformRepository.getVariant(request.params.id)
    return item || reply.code(404).send({ error: 'VARIANT_NOT_FOUND', message: '车型版本不存在' })
  })
  app.post('/api/v2/catalog/vehicle-variants', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型版本主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.manage_platform')
    if (!actor) return
    return reply.code(201).send(await catalogPlatformRepository.createVariant(request.body, actor.name))
  })
  app.patch('/api/v2/catalog/vehicle-variants/:id', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '车型版本主数据服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.manage_platform')
    if (!actor) return
    const item = await catalogPlatformRepository.updateVariant(request.params.id, request.body, actor.name)
    return item || reply.code(404).send({ error: 'VARIANT_NOT_FOUND', message: '车型版本不存在' })
  })
  app.get('/api/v2/catalog/fitment-conflicts', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '适配冲突服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.read')
    if (!actor) return
    return catalogPlatformRepository.conflicts({ state: request.query?.state, query: request.query?.q, skuId: request.query?.skuId })
  })
  app.post('/api/v2/catalog/fitment-conflicts/resolve', async (request, reply) => {
    if (!catalogPlatformRepository) return reply.code(503).send({ error: 'PLATFORM_SERVICE_UNAVAILABLE', message: '适配冲突服务未配置' })
    const actor = requireCatalogCapability(request, reply, 'catalog.resolve_fitment_conflict')
    if (!actor) return
    return catalogPlatformRepository.resolveConflict(request.body, actor.name)
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
    await ensureNoFitmentConflicts(existing.id)
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
      if (request.body?.action === 'approve_review') await ensureNoFitmentConflicts(existing.id)
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

  app.setErrorHandler((error, request, reply) => {
    if (error.code === '23505') return reply.code(409).send({ error: 'CONFLICT', message: '数据已存在', requestId: request.id })
    if (error.code === '23503') return reply.code(400).send({ error: 'INVALID_REFERENCE', message: '关联的数据不存在或已经失效', requestId: request.id })
    const safeExternalError = /^EPC_CONNECTOR_(NOT_CONFIGURED|UPSTREAM_ERROR|UNAVAILABLE|TIMEOUT)$/.test(error.errorCode || '') || /^EPC_ASSET_/.test(error.errorCode || '')
    const status = error.statusCode && (error.statusCode < 500 || safeExternalError) ? error.statusCode : 500
    const payload = { error: status === 500 ? 'INTERNAL_ERROR' : error.errorCode || 'INVALID_INPUT', message: status === 500 ? '服务器暂时无法处理请求' : error.message, requestId: request.id }
    if (status !== 500 && error.details) payload.details = error.details
    if (status >= 500) request.log.error({ err: error, event: 'http.request.unhandled_error', errorCode: payload.error }, 'unhandled request error')
    return reply.code(status).send(payload)
  })
  return app
}
