const allowedSourceTypes = new Set(['epc', 'vin_epc', 'oe_lookup', 'brand_catalog', 'supplier', 'manual', 'import'])

function text(value) {
  return String(value ?? '').trim()
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function stringList(value) {
  return list(value).map(text).filter(Boolean)
}

function optionalInteger(value, field) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isInteger(number)) invalid(`${field} 必须是整数`)
  return number
}

function invalid(message, details) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'INVALID_CATALOG_INPUT'
  if (details) error.details = details
  throw error
}

export function normalizeIdentifierValue(value) {
  return text(value).toUpperCase().replace(/[\s._/#+()\-]/g, '')
}

export function requireCatalogVersion(input) {
  const version = Number(input?.expectedVersion)
  if (!Number.isInteger(version) || version < 1) invalid('expectedVersion 必须是正整数')
  return version
}

export function normalizeIntakeInput(input = {}) {
  const sourceType = text(input.sourceType)
  if (!allowedSourceTypes.has(sourceType)) invalid('sourceType 不受支持')
  return {
    sourceType,
    sourceContext: object(input.sourceContext),
    rawPayload: object(input.rawPayload),
  }
}

function normalizeIdentity(value = {}) {
  const identity = object(value)
  return {
    skuCode: text(identity.skuCode).toUpperCase(),
    nameZh: text(identity.nameZh),
    nameEn: text(identity.nameEn),
    brandCode: text(identity.brandCode),
    brandLabel: text(identity.brandLabel),
    categoryCode: text(identity.categoryCode),
    categoryLabel: text(identity.categoryLabel),
    unitCode: text(identity.unitCode) || 'piece',
    unitLabel: text(identity.unitLabel) || '件',
  }
}

function normalizeEvidence(item, index) {
  const sourceType = text(item.sourceType) || 'manual'
  if (!allowedSourceTypes.has(sourceType)) invalid(`evidence[${index}].sourceType 不受支持`)
  const normalized = {
    id: text(item.id), clientKey: text(item.clientKey) || `evidence-${index}`, intakeId: text(item.intakeId),
    sourceType, sourceSystem: text(item.sourceSystem), sourceRecordId: text(item.sourceRecordId),
    catalogPath: text(item.catalogPath), figurePosition: text(item.figurePosition), originalName: text(item.originalName),
    vinContext: text(item.vinContext).toUpperCase(), rawPayload: object(item.rawPayload), confidence: text(item.confidence) || 'pending',
    immutableHash: '', capturedAt: text(item.capturedAt), sortOrder: index,
  }
  normalized.immutableHash = createHash('sha256').update(JSON.stringify({
    sourceType: normalized.sourceType, sourceSystem: normalized.sourceSystem, sourceRecordId: normalized.sourceRecordId,
    catalogPath: normalized.catalogPath, figurePosition: normalized.figurePosition, originalName: normalized.originalName,
    vinContext: normalized.vinContext, rawPayload: normalized.rawPayload,
  })).digest('hex')
  return normalized
}

function normalizeIdentifier(item, index) {
  const rawValue = text(item.rawValue)
  if (!rawValue) invalid(`identifiers[${index}].rawValue 不能为空`)
  return {
    id: text(item.id), clientKey: text(item.clientKey) || `identifier-${index}`,
    type: text(item.type) || 'oe', rawValue, normalizedValue: normalizeIdentifierValue(rawValue),
    manufacturerCode: text(item.manufacturerCode), isPrimary: Boolean(item.isPrimary),
    evidenceId: text(item.evidenceId), evidenceKey: text(item.evidenceKey),
    verificationStatus: text(item.verificationStatus) || 'pending', sortOrder: index,
  }
}

function normalizeFitment(item, index) {
  const vehicleLabel = text(item.vehicleLabel)
  if (!vehicleLabel) invalid(`fitments[${index}].vehicleLabel 不能为空`)
  const yearFrom = optionalInteger(item.yearFrom, `fitments[${index}].yearFrom`)
  const yearTo = optionalInteger(item.yearTo, `fitments[${index}].yearTo`)
  if (yearFrom && yearTo && yearFrom > yearTo) invalid(`fitments[${index}] 的年份范围无效`)
  return {
    id: text(item.id), vehiclePlatformId: text(item.vehiclePlatformId), vehicleLabel, years: text(item.years), yearFrom, yearTo,
    engineCodes: stringList(item.engineCodes), marketCodes: stringList(item.marketCodes), prCodes: stringList(item.prCodes),
    bodyStyles: stringList(item.bodyStyles), position: text(item.position), includeConditions: object(item.includeConditions),
    excludeConditions: object(item.excludeConditions), evidenceId: text(item.evidenceId), evidenceKey: text(item.evidenceKey),
    verificationStatus: text(item.verificationStatus) || 'pending', reviewNote: text(item.reviewNote), reviewedBy: text(item.reviewedBy),
    reviewedAt: text(item.reviewedAt), reviewVersion: Number.isInteger(Number(item.reviewVersion)) && Number(item.reviewVersion) > 0 ? Number(item.reviewVersion) : 1,
    sortOrder: index,
  }
}

function normalizeInterchange(item, index) {
  return {
    id: text(item.id), fromIdentifierId: text(item.fromIdentifierId), fromIdentifierKey: text(item.fromIdentifierKey),
    toIdentifierId: text(item.toIdentifierId), toIdentifierKey: text(item.toIdentifierKey),
    relationType: text(item.relationType) || 'interchange', direction: text(item.direction) || 'bidirectional',
    effectiveFrom: text(item.effectiveFrom), effectiveTo: text(item.effectiveTo), conditions: object(item.conditions),
    evidenceId: text(item.evidenceId), evidenceKey: text(item.evidenceKey), sortOrder: index,
  }
}

export function catalogQuality(input) {
  const checks = {
    identity: Boolean(input.identity.nameZh || input.identity.nameEn),
    classification: Boolean((input.identity.brandCode || input.identity.brandLabel) && (input.identity.categoryCode || input.identity.categoryLabel)),
    primaryIdentifier: input.identifiers.some((item) => item.isPrimary && item.normalizedValue),
    fitment: input.fitments.length > 0,
    evidence: input.evidence.some((item) => item.sourceSystem || item.sourceRecordId || item.catalogPath || Object.keys(item.rawPayload).length),
  }
  const issues = Object.entries(checks).filter(([, passed]) => !passed).map(([code]) => code)
  return { completenessScore: (5 - issues.length) * 20, issues }
}

export function normalizeCatalogInput(input = {}, existing = null) {
  const source = object(input)
  const identity = normalizeIdentity(source.identity === undefined ? existing?.identity : { ...existing?.identity, ...object(source.identity) })
  const evidence = list(source.evidence === undefined ? existing?.evidence : source.evidence).map(normalizeEvidence)
  const identifiers = list(source.identifiers === undefined ? existing?.identifiers : source.identifiers).map(normalizeIdentifier)
  if (identifiers.filter((item) => item.isPrimary).length > 1) invalid('只能设置一个主编号')
  const fitments = list(source.fitments === undefined ? existing?.fitments : source.fitments).map(normalizeFitment)
  const interchanges = list(source.interchanges === undefined ? existing?.interchanges : source.interchanges).map(normalizeInterchange)
  const evidenceReferences = new Set(evidence.flatMap((item) => [item.id, item.clientKey]).filter(Boolean))
  const identifierReferences = new Set(identifiers.flatMap((item) => [item.id, item.clientKey]).filter(Boolean))
  const normalizedIdentifiers = new Set()
  identifiers.forEach((item, index) => {
    const duplicateKey = `${item.type}:${item.normalizedValue}`
    if (normalizedIdentifiers.has(duplicateKey)) invalid(`identifiers[${index}] 与已有编号重复`)
    normalizedIdentifiers.add(duplicateKey)
    const evidenceReference = item.evidenceKey || item.evidenceId
    if (evidenceReference && !evidenceReferences.has(evidenceReference)) invalid(`identifiers[${index}] 引用了不存在的来源证据`)
  })
  fitments.forEach((item, index) => {
    const evidenceReference = item.evidenceKey || item.evidenceId
    if (evidenceReference && !evidenceReferences.has(evidenceReference)) invalid(`fitments[${index}] 引用了不存在的来源证据`)
  })
  interchanges.forEach((item, index) => {
    const from = item.fromIdentifierKey || item.fromIdentifierId
    const to = item.toIdentifierKey || item.toIdentifierId
    if (!from || !to || !identifierReferences.has(from) || !identifierReferences.has(to)) invalid(`interchanges[${index}] 必须关联当前 SKU 的两个有效编号`)
    const evidenceReference = item.evidenceKey || item.evidenceId
    if (evidenceReference && !evidenceReferences.has(evidenceReference)) invalid(`interchanges[${index}] 引用了不存在的来源证据`)
  })
  const normalized = { identity, evidence, identifiers, fitments, interchanges }
  return { ...normalized, lifecycleStatus: existing?.lifecycleStatus || 'draft', verificationLevel: existing?.verificationLevel || 'unverified', ...catalogQuality(normalized) }
}

function fitmentReviewFingerprint(item) {
  return JSON.stringify({
    vehiclePlatformId: item.vehiclePlatformId, vehicleLabel: item.vehicleLabel, years: item.years, yearFrom: item.yearFrom, yearTo: item.yearTo,
    engineCodes: item.engineCodes, marketCodes: item.marketCodes, prCodes: item.prCodes, bodyStyles: item.bodyStyles, position: item.position,
    includeConditions: item.includeConditions, excludeConditions: item.excludeConditions,
  })
}

export function sanitizeCatalogFitmentReviews(input, existing = null) {
  const existingById = new Map((existing?.fitments || []).filter((item) => item.id).map((item) => [item.id, item]))
  return {
    ...input,
    fitments: input.fitments.map((item) => {
      const previous = existingById.get(item.id)
      if (previous && fitmentReviewFingerprint(item) === fitmentReviewFingerprint(previous)) {
        return {
          ...item, verificationStatus: previous.verificationStatus || 'pending', reviewNote: previous.reviewNote || '',
          reviewedBy: previous.reviewedBy || '', reviewedAt: previous.reviewedAt || '', reviewVersion: previous.reviewVersion || 1,
        }
      }
      return { ...item, verificationStatus: 'pending', reviewNote: '', reviewedBy: '', reviewedAt: '', reviewVersion: 1 }
    }),
  }
}

export function validateCatalogVerifiable(input) {
  const quality = catalogQuality(input)
  if (quality.issues.length) {
    const error = new Error('SKU 资料尚不满足核验条件')
    error.statusCode = 422
    error.errorCode = 'SKU_NOT_VERIFIABLE'
    error.details = { issues: quality.issues }
    throw error
  }
  return { ...input, ...quality }
}

export function validateCatalogFitmentsReviewed(input) {
  const pending = input.fitments.filter((item) => item.verificationStatus !== 'verified')
  if (pending.length) {
    const error = new Error('仍有适配关系未通过专项审核')
    error.statusCode = 422
    error.errorCode = 'FITMENT_REVIEW_REQUIRED'
    error.details = { issues: ['fitmentReview'], fitmentIds: pending.map((item) => item.id).filter(Boolean) }
    throw error
  }
  return input
}
import { createHash } from 'node:crypto'
