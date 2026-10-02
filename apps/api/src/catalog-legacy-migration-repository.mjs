import { createHash, randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'
import { normalizeCatalogInput, normalizeIdentifierValue } from './catalog-validation.mjs'

function text(value) {
  return String(value ?? '').trim()
}

function problem(errorCode, message, statusCode = 409, details) {
  const error = new Error(message)
  error.errorCode = errorCode
  error.statusCode = statusCode
  if (details) error.details = details
  return error
}

function hashSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function resolveDictionary(dictionaries, code, rawValue) {
  const raw = text(rawValue)
  if (!raw) return { code: '', label: '', resolved: false }
  const items = dictionaries?.[code]?.items || []
  const match = items.find((item) => item.enabled !== false && item.value !== '__all__'
    && [item.value, item.label].some((value) => text(value).toLocaleLowerCase('zh-CN') === raw.toLocaleLowerCase('zh-CN')))
  return match ? { code: text(match.value), label: text(match.label || match.value), resolved: true } : { code: '', label: raw, resolved: false }
}

function confidence(value) {
  const normalized = text(value).toLocaleLowerCase('zh-CN')
  if (['高', 'high', '已验证'].includes(normalized)) return 'high'
  if (['中', 'medium'].includes(normalized)) return 'medium'
  if (['低', 'low', '存疑'].includes(normalized)) return 'low'
  return 'pending'
}

function snapshotFromRow(row) {
  return {
    sku: row.sku,
    oeRelations: row.oe_relations || [],
    fitments: row.fitments || [],
  }
}

function identifierCandidates(snapshot) {
  const sku = snapshot.sku
  const candidates = []
  if (text(sku.primary_oe)) candidates.push({ type: 'oe', rawValue: sku.primary_oe, primary: true })
  if (text(sku.sku_code)) candidates.push({ type: 'internal', rawValue: sku.sku_code, primary: !text(sku.primary_oe) })
  if (text(sku.manufacturer_part_number)) candidates.push({ type: 'mpn', rawValue: sku.manufacturer_part_number, primary: false })
  for (const relation of snapshot.oeRelations) candidates.push({
    type: 'oe', rawValue: relation.oe_number, primary: false, manufacturerCode: relation.brand,
  })
  const seen = new Set()
  return candidates.filter((item) => {
    const normalized = normalizeIdentifierValue(item.rawValue)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function resolveOverride(dictionaries, dictionaryCode, overrideCode, fallback) {
  const requested = text(overrideCode)
  if (!requested) return fallback
  const match = (dictionaries?.[dictionaryCode]?.items || []).find((item) => item.enabled !== false && text(item.value) === requested)
  if (!match) throw problem('LEGACY_MIGRATION_INVALID_OVERRIDE', `修正后的${dictionaryCode === 'sku_brand' ? '品牌' : dictionaryCode === 'part_category' ? '分类' : '单位'}不在当前字典中`, 422, { dictionaryCode, value: requested })
  return { code: text(match.value), label: text(match.label || match.value), resolved: true, overridden: true }
}

export function mapLegacySku(snapshot, dictionaries = {}, overrides = {}) {
  const sku = snapshot.sku
  const brand = resolveOverride(dictionaries, 'sku_brand', overrides.brandCode, resolveDictionary(dictionaries, 'sku_brand', sku.brand))
  const category = resolveOverride(dictionaries, 'part_category', overrides.categoryCode, resolveDictionary(dictionaries, 'part_category', sku.category))
  const unit = resolveOverride(dictionaries, 'unit', overrides.unitCode, resolveDictionary(dictionaries, 'unit', sku.unit))
  const identifiers = identifierCandidates(snapshot)
  const evidenceKey = 'legacy-evidence'
  const fitments = snapshot.fitments.map((fitment) => {
    const detail = [
      text(fitment.engine) && `发动机：${text(fitment.engine)}`,
      text(fitment.body) && `车身：${text(fitment.body)}`,
      text(fitment.fitment_condition) && `原适配条件：${text(fitment.fitment_condition)}`,
      text(fitment.source) && `原来源：${text(fitment.source)}`,
    ].filter(Boolean).join('；')
    return {
      vehicleLabel: text(fitment.vehicle), years: text(fitment.years), engineCodes: [], bodyStyles: [],
      includeConditions: detail ? { note: detail } : {}, evidenceKey, verificationStatus: 'pending',
    }
  })
  const input = normalizeCatalogInput({
    identity: {
      skuCode: sku.sku_code,
      nameZh: sku.chinese_name,
      brandCode: brand.code,
      brandLabel: brand.label,
      categoryCode: category.code,
      categoryLabel: [category.label, text(sku.subcategory)].filter(Boolean).join(' / '),
      unitCode: unit.code || 'piece',
      unitLabel: unit.label || text(sku.unit) || '件',
    },
    evidence: [{
      clientKey: evidenceKey,
      sourceType: 'import',
      sourceSystem: '旧 SKU 资料库',
      sourceRecordId: sku.id,
      originalName: sku.chinese_name,
      rawPayload: snapshot,
      confidence: confidence(sku.source_evidence?.confidence),
      capturedAt: sku.updated_at,
    }],
    identifiers: identifiers.map((item) => ({
      type: item.type,
      rawValue: item.rawValue,
      manufacturerCode: item.manufacturerCode || sku.brand,
      isPrimary: item.primary,
      evidenceKey,
      verificationStatus: 'pending',
    })),
    fitments,
    interchanges: [],
  })
  const issues = []
  if (!text(sku.sku_code)) issues.push({ code: 'missingSkuCode', label: '缺少 SKU 编码', blocking: true })
  if (!text(sku.chinese_name)) issues.push({ code: 'missingName', label: '缺少配件名称', blocking: true })
  if (!identifiers.length) issues.push({ code: 'missingIdentifier', label: '缺少可迁移的零件编号', blocking: true })
  if (!brand.resolved && text(sku.brand)) issues.push({ code: 'unmappedBrand', label: `品牌“${sku.brand}”未匹配标准字典`, blocking: false })
  if (!category.resolved && text(sku.category)) issues.push({ code: 'unmappedCategory', label: `分类“${sku.category}”未匹配标准字典`, blocking: false })
  if (!unit.resolved && text(sku.unit)) issues.push({ code: 'unmappedUnit', label: `单位“${sku.unit}”未匹配标准字典`, blocking: false })
  if (snapshot.fitments.length) issues.push({ code: 'fitmentNeedsReview', label: `${snapshot.fitments.length} 条旧适配需人工复核平台与条件`, blocking: false })
  const images = [...new Set([sku.image_url, ...(Array.isArray(sku.image_urls) ? sku.image_urls : [])].map(text).filter(Boolean))]
  if (images.length) issues.push({ code: 'imagesPreservedInEvidence', label: `${images.length} 张旧图片仅保留在来源快照`, blocking: false })
  if (!text(sku.data_source) && !sku.source_evidence) issues.push({ code: 'weakEvidence', label: '旧资料缺少明确来源说明', blocking: false })
  return { input, issues, mapping: { brand, category, unit, images } }
}

async function loadDictionaryConfiguration(client) {
  const row = (await client.query("SELECT payload FROM app_configuration WHERE key='dictionaries'")).rows[0]
  return row?.payload?.dictionaries || {}
}

async function loadLegacyRows(client, { query = '', legacySkuId = '' } = {}) {
  const values = []
  const conditions = []
  if (text(legacySkuId)) conditions.push(`s.id=$${values.push(text(legacySkuId))}`)
  if (text(query)) conditions.push(`lower(concat_ws(' ',s.sku_code,s.chinese_name,s.brand,s.category,s.primary_oe,s.manufacturer_part_number)) LIKE $${values.push(`%${text(query).toLocaleLowerCase('zh-CN')}%`)}`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await client.query(`SELECT to_jsonb(s) AS sku,
    COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.sort_order,o.created_at) FROM sku_oe_relation o WHERE o.sku_id=s.id),'[]'::jsonb) AS oe_relations,
    COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.sort_order,f.created_at) FROM sku_fitment f WHERE f.sku_id=s.id),'[]'::jsonb) AS fitments
    FROM sku s ${where} ORDER BY s.updated_at DESC,s.sku_code`, values)
  return rows
}

async function migrationState(client, legacySkuId) {
  return (await client.query(`SELECT m.*,b.state AS batch_state FROM catalog_legacy_sku_migration m
    JOIN catalog_legacy_migration_batch b ON b.id=m.batch_id WHERE m.legacy_sku_id=$1`, [legacySkuId])).rows[0] || null
}

async function conflictIssues(client, snapshot, exceptLegacyId = '') {
  const candidates = identifierCandidates(snapshot)
  const normalized = candidates.map((item) => normalizeIdentifierValue(item.rawValue))
  const issues = []
  if (normalized.length) {
    const existing = (await client.query(`SELECT i.normalized_value,s.id,s.sku_code,s.canonical_name_zh
      FROM catalog_part_identifier i JOIN catalog_sku s ON s.id=i.sku_id
      WHERE i.normalized_value=ANY($1::text[]) AND s.lifecycle_status<>'discontinued'`, [normalized])).rows
    if (existing.length) issues.push({ code: 'catalogIdentifierConflict', label: `与新资料库 ${existing.length} 个编号冲突`, blocking: true, matches: existing })
    const legacy = (await client.query(`WITH legacy_identifier AS (
        SELECT s.id,s.sku_code,s.chinese_name,v.value FROM sku s
        CROSS JOIN LATERAL (VALUES (s.primary_oe),(s.manufacturer_part_number),(s.sku_code)) v(value)
        UNION ALL
        SELECT s.id,s.sku_code,s.chinese_name,o.oe_number FROM sku s JOIN sku_oe_relation o ON o.sku_id=s.id
      )
      SELECT DISTINCT id,sku_code,chinese_name,upper(regexp_replace(value,'[\\s._/#+()\\-]','','g')) AS normalized_value
      FROM legacy_identifier WHERE id<>$1 AND value<>''
        AND upper(regexp_replace(value,'[\\s._/#+()\\-]','','g'))=ANY($2::text[])`, [exceptLegacyId, normalized])).rows
    if (legacy.length) issues.push({ code: 'legacyIdentifierConflict', label: `与其他旧 SKU 的 ${legacy.length} 个编号冲突`, blocking: true, matches: legacy })
  }
  const code = text(snapshot.sku.sku_code).toUpperCase()
  if (code) {
    const existingCode = (await client.query('SELECT id,sku_code,canonical_name_zh FROM catalog_sku WHERE sku_code=$1', [code])).rows[0]
    if (existingCode) issues.push({ code: 'catalogSkuCodeConflict', label: `新资料库已存在 SKU 编码 ${code}`, blocking: true, matches: [existingCode] })
  }
  return issues
}

function previewItem(snapshot, mapped, sourceHash, migrated, issues) {
  return {
    legacySkuId: snapshot.sku.id,
    sourceHash,
    legacy: {
      skuCode: snapshot.sku.sku_code,
      name: snapshot.sku.chinese_name,
      brand: snapshot.sku.brand,
      category: snapshot.sku.category,
      unit: snapshot.sku.unit,
      lifecycleStatus: snapshot.sku.lifecycle_status,
      updatedAt: snapshot.sku.updated_at,
      identifierCount: identifierCandidates(snapshot).length,
      oeRelationCount: snapshot.oeRelations.length,
      fitmentCount: snapshot.fitments.length,
    },
    target: mapped.input,
    mapping: mapped.mapping,
    issues,
    blocking: issues.some((issue) => issue.blocking),
    migrated: migrated ? {
      catalogSkuId: migrated.catalog_sku_id,
      batchId: migrated.batch_id,
      migratedAt: migrated.migrated_at,
      migratedBy: migrated.migrated_by,
      sourceChanged: migrated.source_hash !== sourceHash,
    } : null,
    recommended: !migrated && !issues.some((issue) => issue.blocking),
  }
}

function actorDetails(actor) {
  if (typeof actor === 'string') return { id: `legacy:${text(actor)}`, name: text(actor), role: '', identityProvider: 'legacy' }
  return { id: text(actor?.id), name: text(actor?.name), role: text(actor?.role), identityProvider: text(actor?.identityProvider) }
}

async function insertPlanEvent(client, planId, action, actor, note = '', payload = {}) {
  const identity = actorDetails(actor)
  await client.query(`INSERT INTO catalog_legacy_migration_plan_event
    (id,plan_id,action,actor_id,actor_name,actor_role,identity_provider,note,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), planId, action, identity.id, identity.name,
    identity.role, identity.identityProvider, text(note), JSON.stringify(payload)])
}

function planView(plan, items = [], events = []) {
  return {
    id: plan.id, state: plan.state, reason: plan.reason, migrateCount: plan.migrate_count, excludeCount: plan.exclude_count,
    version: plan.version, createdBy: plan.created_by, createdById: plan.created_by_id, createdByRole: plan.created_by_role,
    createdAt: plan.created_at, submittedAt: plan.submitted_at, reviewedBy: plan.reviewed_by, reviewedById: plan.reviewed_by_id,
    reviewedByRole: plan.reviewed_by_role, reviewedAt: plan.reviewed_at, reviewNote: plan.review_note,
    committedBatchId: plan.committed_batch_id, committedBy: plan.committed_by, committedById: plan.committed_by_id,
    committedByRole: plan.committed_by_role, committedAt: plan.committed_at,
    items: items.map((item) => ({
      id: item.id, legacySkuId: item.legacy_sku_id, sourceHash: item.source_hash, decision: item.decision,
      exclusionReason: item.exclusion_reason, overrides: item.overrides, preview: item.preview_snapshot, sortOrder: item.sort_order,
    })),
    events: events.map((event) => ({ id: event.id, action: event.action, actorId: event.actor_id, actorName: event.actor_name,
      actorRole: event.actor_role, identityProvider: event.identity_provider, note: event.note, payload: event.payload, createdAt: event.created_at })),
  }
}

async function insertCatalogDraft(client, input, snapshot, sourceHash, batchId, actor) {
  const skuId = randomUUID()
  const evidenceId = randomUUID()
  await client.query(`INSERT INTO catalog_sku
    (id,sku_code,canonical_name_zh,canonical_name_en,brand_code,brand_label,category_code,category_label,unit_code,unit_label,lifecycle_status,completeness_score,verification_level,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,'unverified',$12,$12)`, [
    skuId, input.identity.skuCode, input.identity.nameZh, input.identity.nameEn, input.identity.brandCode, input.identity.brandLabel,
    input.identity.categoryCode, input.identity.categoryLabel, input.identity.unitCode, input.identity.unitLabel, input.completenessScore, actor,
  ])
  const evidence = input.evidence[0]
  await client.query(`INSERT INTO catalog_source_evidence
    (id,sku_id,source_type,source_system,source_record_id,catalog_path,figure_position,original_name,vin_context,raw_payload,confidence,immutable_hash,captured_at,sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,COALESCE($13::timestamptz,now()),0)`, [
    evidenceId, skuId, evidence.sourceType, evidence.sourceSystem, evidence.sourceRecordId, evidence.catalogPath, evidence.figurePosition,
    evidence.originalName, evidence.vinContext, JSON.stringify(evidence.rawPayload), evidence.confidence, evidence.immutableHash, evidence.capturedAt || null,
  ])
  for (const identifier of input.identifiers) {
    await client.query(`INSERT INTO catalog_part_identifier
      (id,sku_id,identifier_type,raw_value,normalized_value,manufacturer_code,is_primary,source_evidence_id,verification_status,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), skuId, identifier.type, identifier.rawValue,
      identifier.normalizedValue, identifier.manufacturerCode, identifier.isPrimary, evidenceId, 'pending', identifier.sortOrder])
  }
  for (const fitment of input.fitments) {
    await client.query(`INSERT INTO catalog_fitment
      (id,sku_id,vehicle_label,years,year_from,year_to,engine_codes,transmission_codes,market_codes,pr_codes,body_styles,drive_types,position,include_conditions,exclude_conditions,source_evidence_id,verification_status,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,'pending',$17)`, [randomUUID(), skuId,
      fitment.vehicleLabel, fitment.years, fitment.yearFrom, fitment.yearTo, fitment.engineCodes, fitment.transmissionCodes, fitment.marketCodes,
      fitment.prCodes, fitment.bodyStyles, fitment.driveTypes, fitment.position, JSON.stringify(fitment.includeConditions), JSON.stringify(fitment.excludeConditions),
      evidenceId, fitment.sortOrder])
  }
  await client.query(`INSERT INTO catalog_change_log (id,sku_id,version,action,summary,snapshot,changed_by)
    VALUES ($1,$2,1,'migrate_legacy',$3::jsonb,$4::jsonb,$5)`, [randomUUID(), skuId, JSON.stringify({
    legacySkuId: snapshot.sku.id, batchId, sourceHash, skuCode: input.identity.skuCode,
    identifierCount: input.identifiers.length, fitmentCount: input.fitments.length, evidenceCount: input.evidence.length,
  }), JSON.stringify(input), actor])
  return skuId
}

async function migrateCandidate(client, candidate, batchId, actor) {
  const legacySkuId = text(candidate?.legacySkuId)
  const expectedHash = text(candidate?.sourceHash)
  await client.query('SELECT id FROM sku WHERE id=$1 FOR SHARE', [legacySkuId])
  const [row] = await loadLegacyRows(client, { legacySkuId })
  if (!row) throw problem('LEGACY_SKU_NOT_FOUND', '旧 SKU 已不存在', 404, { legacySkuId })
  const snapshot = snapshotFromRow(row)
  const sourceHash = hashSnapshot(snapshot)
  if (!expectedHash || sourceHash !== expectedHash) throw problem('LEGACY_SKU_SOURCE_CHANGED', '旧资料已发生变化，请刷新预览后再迁移', 409, { legacySkuId, sourceHash })
  const existing = await migrationState(client, legacySkuId)
  if (existing) return { state: 'skipped', legacySkuId, catalogSkuId: existing.catalog_sku_id, sourceHash, reason: 'already_migrated' }
  const dictionaries = await loadDictionaryConfiguration(client)
  const mapped = mapLegacySku(snapshot, dictionaries, candidate.overrides || {})
  const issues = [...mapped.issues, ...await conflictIssues(client, snapshot, legacySkuId)]
  const blocking = issues.filter((issue) => issue.blocking)
  if (blocking.length) throw problem('LEGACY_SKU_MIGRATION_BLOCKED', '存在阻止迁移的数据问题', 422, { legacySkuId, issues: blocking })
  const catalogSkuId = await insertCatalogDraft(client, mapped.input, snapshot, sourceHash, batchId, actor)
  const mappingSnapshot = { input: mapped.input, mapping: mapped.mapping, issues }
  await client.query(`INSERT INTO catalog_legacy_sku_migration
    (legacy_sku_id,catalog_sku_id,batch_id,source_hash,source_snapshot,mapping_snapshot,migrated_by)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [legacySkuId, catalogSkuId, batchId, sourceHash, JSON.stringify(snapshot), JSON.stringify(mappingSnapshot), actor])
  return { state: 'migrated', legacySkuId, catalogSkuId, sourceHash, mappingSnapshot }
}

async function buildPlanPreflight(client, plan, items) {
  const dictionaries = await loadDictionaryConfiguration(client)
  const rows = await loadLegacyRows(client)
  const rowById = new Map(rows.map((row) => [row.sku.id, row]))
  const checks = []
  for (const item of items.filter((candidate) => candidate.decision === 'migrate')) {
    const issues = []
    const row = rowById.get(item.legacy_sku_id)
    let currentSourceHash = ''
    if (!row) {
      issues.push({ code: 'legacySourceMissing', label: '旧 SKU 已不存在', blocking: true })
    } else {
      const snapshot = snapshotFromRow(row)
      currentSourceHash = hashSnapshot(snapshot)
      if (currentSourceHash !== item.source_hash) issues.push({ code: 'legacySourceChanged', label: '旧资料在方案提交后发生变化', blocking: true })
      const migrated = await migrationState(client, item.legacy_sku_id)
      if (migrated) issues.push({ code: 'legacyAlreadyMigrated', label: '这条旧资料已由其他方案迁移', blocking: true, catalogSkuId: migrated.catalog_sku_id })
      try {
        const mapped = mapLegacySku(snapshot, dictionaries, item.overrides || {})
        issues.push(...mapped.issues, ...await conflictIssues(client, snapshot, item.legacy_sku_id))
      } catch (error) {
        issues.push({ code: error.errorCode || 'legacyMappingInvalid', label: error.message || '字段映射已失效', blocking: true })
      }
    }
    checks.push({
      legacySkuId: item.legacy_sku_id,
      name: item.preview_snapshot?.legacy?.name || '',
      skuCode: item.preview_snapshot?.legacy?.skuCode || '',
      expectedSourceHash: item.source_hash,
      currentSourceHash,
      ready: !issues.some((issue) => issue.blocking),
      issues,
    })
  }
  const blocked = checks.filter((item) => !item.ready).length
  const changed = checks.filter((item) => item.issues.some((issue) => issue.code === 'legacySourceChanged')).length
  const alreadyMigrated = checks.filter((item) => item.issues.some((issue) => issue.code === 'legacyAlreadyMigrated')).length
  return {
    planId: plan.id,
    planVersion: plan.version,
    state: plan.state,
    checkedAt: new Date().toISOString(),
    ready: blocked === 0 && checks.length > 0,
    summary: { total: checks.length, ready: checks.length - blocked, blocked, changed, alreadyMigrated },
    items: checks,
  }
}

export function createCatalogLegacyMigrationRepository(pool) {
  return {
    async preview({ query = '', page = 1, pageSize = 50 } = {}) {
      const client = await pool.connect()
      try {
        const dictionaries = await loadDictionaryConfiguration(client)
        const rows = await loadLegacyRows(client, { query })
        const allItems = []
        for (const row of rows) {
          const snapshot = snapshotFromRow(row)
          const sourceHash = hashSnapshot(snapshot)
          const mapped = mapLegacySku(snapshot, dictionaries)
          const migrated = await migrationState(client, snapshot.sku.id)
          const conflicts = migrated ? [] : await conflictIssues(client, snapshot, snapshot.sku.id)
          allItems.push(previewItem(snapshot, mapped, sourceHash, migrated, [...mapped.issues, ...conflicts]))
        }
        const safePage = Math.max(1, Number(page) || 1)
        const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 50))
        const start = (safePage - 1) * safePageSize
        return {
          items: allItems.slice(start, start + safePageSize),
          page: safePage,
          pageSize: safePageSize,
          total: allItems.length,
          summary: {
            total: allItems.length,
            pending: allItems.filter((item) => !item.migrated).length,
            recommended: allItems.filter((item) => item.recommended).length,
            blocked: allItems.filter((item) => !item.migrated && item.blocking).length,
            migrated: allItems.filter((item) => item.migrated).length,
            sourceChanged: allItems.filter((item) => item.migrated?.sourceChanged).length,
          },
        }
      } finally {
        client.release()
      }
    },

    async commit(rawInput, actor) {
      const selected = Array.isArray(rawInput?.items) ? rawInput.items : []
      if (!selected.length || selected.length > 100) throw problem('INVALID_LEGACY_MIGRATION_SELECTION', '每次请选择 1 至 100 条旧资料', 400)
      if (new Set(selected.map((item) => text(item?.legacySkuId))).size !== selected.length) throw problem('INVALID_LEGACY_MIGRATION_SELECTION', '同一条旧资料不能重复选择', 400)
      const reason = text(rawInput?.reason)
      if (!reason) throw problem('LEGACY_MIGRATION_REASON_REQUIRED', '请填写本次迁移原因', 400)
      const batchId = randomUUID()
      if (rawInput?.atomic === true) {
        return withTransaction(pool, async (client) => {
          const batch = (await client.query(`INSERT INTO catalog_legacy_migration_batch (id,selected_count,reason,created_by)
            VALUES ($1,$2,$3,$4) RETURNING *`, [batchId, selected.length, reason, actor])).rows[0]
          const results = []
          for (const candidate of selected) {
            const result = await migrateCandidate(client, candidate, batchId, actor)
            await client.query(`INSERT INTO catalog_legacy_migration_item
              (id,batch_id,legacy_sku_id,source_hash,state,catalog_sku_id,mapping_snapshot)
              VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), batchId, result.legacySkuId, result.sourceHash,
              result.state, result.catalogSkuId, JSON.stringify(result.mappingSnapshot || {})])
            results.push(result)
          }
          const migrated = results.filter((item) => item.state === 'migrated').length
          const skipped = results.filter((item) => item.state === 'skipped').length
          const summary = { total: selected.length, migrated, skipped, failed: 0 }
          const completed = (await client.query(`UPDATE catalog_legacy_migration_batch SET state='succeeded',migrated_count=$2,skipped_count=$3,
            failed_count=0,summary=$4::jsonb,completed_at=now() WHERE id=$1 RETURNING *`, [batchId, migrated, skipped, JSON.stringify(summary)])).rows[0]
          return { id: batch.id, state: completed.state, reason: batch.reason, createdBy: batch.created_by, createdAt: batch.created_at,
            completedAt: completed.completed_at, summary, results }
        })
      }
      await pool.query(`INSERT INTO catalog_legacy_migration_batch (id,selected_count,reason,created_by) VALUES ($1,$2,$3,$4)`, [batchId, selected.length, reason, actor])
      const results = []
      for (const candidate of selected) {
        const legacySkuId = text(candidate?.legacySkuId)
        const expectedHash = text(candidate?.sourceHash)
        try {
          const result = await withTransaction(pool, (client) => migrateCandidate(client, candidate, batchId, actor))
          await pool.query(`INSERT INTO catalog_legacy_migration_item
            (id,batch_id,legacy_sku_id,source_hash,state,catalog_sku_id,mapping_snapshot)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), batchId, legacySkuId, result.sourceHash, result.state, result.catalogSkuId, JSON.stringify(result.mappingSnapshot || {})])
          results.push(result)
        } catch (error) {
          const failure = { state: 'failed', legacySkuId, error: error.errorCode || 'LEGACY_SKU_MIGRATION_FAILED', message: error.message, details: error.details }
          await pool.query(`INSERT INTO catalog_legacy_migration_item
            (id,batch_id,legacy_sku_id,source_hash,state,error_code,error_message,mapping_snapshot)
            VALUES ($1,$2,$3,$4,'failed',$5,$6,$7::jsonb)`, [randomUUID(), batchId, legacySkuId, expectedHash, failure.error, failure.message, JSON.stringify(error.details || {})])
          results.push(failure)
        }
      }
      const migrated = results.filter((item) => item.state === 'migrated').length
      const skipped = results.filter((item) => item.state === 'skipped').length
      const failed = results.filter((item) => item.state === 'failed').length
      const state = failed ? (migrated || skipped ? 'partial' : 'failed') : 'succeeded'
      const summary = { total: selected.length, migrated, skipped, failed }
      const batch = (await pool.query(`UPDATE catalog_legacy_migration_batch SET state=$2,migrated_count=$3,skipped_count=$4,failed_count=$5,
        summary=$6::jsonb,completed_at=now() WHERE id=$1 RETURNING *`, [batchId, state, migrated, skipped, failed, JSON.stringify(summary)])).rows[0]
      return { id: batch.id, state: batch.state, reason: batch.reason, createdBy: batch.created_by, createdAt: batch.created_at, completedAt: batch.completed_at, summary, results }
    },

    async getBatch(id) {
      const batch = (await pool.query('SELECT * FROM catalog_legacy_migration_batch WHERE id=$1', [id])).rows[0]
      if (!batch) return null
      const items = (await pool.query('SELECT * FROM catalog_legacy_migration_item WHERE batch_id=$1 ORDER BY created_at,id', [id])).rows
      return {
        id: batch.id, state: batch.state, reason: batch.reason, createdBy: batch.created_by, createdAt: batch.created_at,
        completedAt: batch.completed_at, summary: batch.summary, items: items.map((item) => ({
          id: item.id, legacySkuId: item.legacy_sku_id, catalogSkuId: item.catalog_sku_id, sourceHash: item.source_hash,
          state: item.state, error: item.error_code, message: item.error_message, mappingSnapshot: item.mapping_snapshot, createdAt: item.created_at,
        })),
      }
    },

    async createPlan(rawInput, actor) {
      const identity = actorDetails(actor)
      if (!identity.id || !identity.name) throw problem('CATALOG_IDENTITY_REQUIRED', '提交迁移方案需要可信操作人身份', 401)
      const candidates = Array.isArray(rawInput?.items) ? rawInput.items : []
      if (!candidates.length || candidates.length > 100) throw problem('INVALID_LEGACY_MIGRATION_PLAN', '迁移方案需包含 1 至 100 条处理决定', 400)
      const ids = candidates.map((item) => text(item?.legacySkuId))
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw problem('INVALID_LEGACY_MIGRATION_PLAN', '迁移方案中的旧资料无效或重复', 400)
      const reason = text(rawInput?.reason)
      if (!reason) throw problem('LEGACY_MIGRATION_REASON_REQUIRED', '请填写方案说明', 400)
      return withTransaction(pool, async (client) => {
        const dictionaries = await loadDictionaryConfiguration(client)
        const rows = await loadLegacyRows(client)
        const rowById = new Map(rows.map((row) => [row.sku.id, row]))
        const prepared = []
        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index]
          const legacySkuId = ids[index]
          const decision = candidate?.decision === 'exclude' ? 'exclude' : 'migrate'
          const exclusionReason = text(candidate?.exclusionReason)
          if (decision === 'exclude' && !exclusionReason) throw problem('LEGACY_MIGRATION_EXCLUSION_REASON_REQUIRED', '排除旧资料时必须说明原因', 400, { legacySkuId })
          const row = rowById.get(legacySkuId)
          if (!row) throw problem('LEGACY_SKU_NOT_FOUND', '旧 SKU 已不存在', 404, { legacySkuId })
          const snapshot = snapshotFromRow(row)
          const sourceHash = hashSnapshot(snapshot)
          if (sourceHash !== text(candidate?.sourceHash)) throw problem('LEGACY_SKU_SOURCE_CHANGED', '旧资料已发生变化，请刷新预览后再提交', 409, { legacySkuId, sourceHash })
          const existing = await migrationState(client, legacySkuId)
          if (existing && decision === 'migrate') throw problem('LEGACY_SKU_ALREADY_MIGRATED', '旧资料已经迁移，不能重复加入方案', 409, { legacySkuId })
          const overrides = {
            brandCode: text(candidate?.overrides?.brandCode), categoryCode: text(candidate?.overrides?.categoryCode), unitCode: text(candidate?.overrides?.unitCode),
          }
          const mapped = mapLegacySku(snapshot, dictionaries, overrides)
          const issues = [...mapped.issues, ...(decision === 'migrate' ? await conflictIssues(client, snapshot, legacySkuId) : [])]
          if (decision === 'migrate' && issues.some((issue) => issue.blocking)) throw problem('LEGACY_SKU_MIGRATION_BLOCKED', '方案中存在阻止迁移的数据问题', 422, { legacySkuId, issues: issues.filter((issue) => issue.blocking) })
          prepared.push({ legacySkuId, sourceHash, decision, exclusionReason, overrides, preview: previewItem(snapshot, mapped, sourceHash, existing, issues), sortOrder: index })
        }
        if (!prepared.some((item) => item.decision === 'migrate')) throw problem('LEGACY_MIGRATION_EMPTY_SELECTION', '方案至少需要包含一条待迁移资料', 400)
        const planId = randomUUID()
        const migrateCount = prepared.filter((item) => item.decision === 'migrate').length
        const excludeCount = prepared.length - migrateCount
        const plan = (await client.query(`INSERT INTO catalog_legacy_migration_plan
          (id,state,reason,migrate_count,exclude_count,created_by,created_by_id,created_by_role) VALUES ($1,'submitted',$2,$3,$4,$5,$6,$7) RETURNING *`,
        [planId, reason, migrateCount, excludeCount, identity.name, identity.id, identity.role])).rows[0]
        for (const item of prepared) await client.query(`INSERT INTO catalog_legacy_migration_plan_item
          (id,plan_id,legacy_sku_id,source_hash,decision,exclusion_reason,overrides,preview_snapshot,sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [randomUUID(), planId, item.legacySkuId, item.sourceHash,
          item.decision, item.exclusionReason, JSON.stringify(item.overrides), JSON.stringify(item.preview), item.sortOrder])
        await insertPlanEvent(client, planId, 'submitted', identity, reason, { migrateCount, excludeCount })
        const itemRows = (await client.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [planId])).rows
        const events = (await client.query('SELECT * FROM catalog_legacy_migration_plan_event WHERE plan_id=$1 ORDER BY created_at,id', [planId])).rows
        return planView(plan, itemRows, events)
      })
    },

    async listPlans({ state = '', limit = 30 } = {}) {
      const values = []
      const where = text(state) ? `WHERE state=$${values.push(text(state))}` : ''
      const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30))
      const rows = (await pool.query(`SELECT * FROM catalog_legacy_migration_plan ${where} ORDER BY created_at DESC LIMIT $${values.push(safeLimit)}`, values)).rows
      return { items: rows.map((row) => planView(row)), total: rows.length }
    },

    async getPlan(id) {
      const plan = (await pool.query('SELECT * FROM catalog_legacy_migration_plan WHERE id=$1', [id])).rows[0]
      if (!plan) return null
      const items = (await pool.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [id])).rows
      const events = (await pool.query('SELECT * FROM catalog_legacy_migration_plan_event WHERE plan_id=$1 ORDER BY created_at,id', [id])).rows
      let execution = null
      if (plan.committed_batch_id) execution = await this.getBatch(plan.committed_batch_id)
      return { ...planView(plan, items, events), execution }
    },

    async preflightPlan(id) {
      const client = await pool.connect()
      try {
        const plan = (await client.query('SELECT * FROM catalog_legacy_migration_plan WHERE id=$1', [id])).rows[0]
        if (!plan) return null
        const items = (await client.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [id])).rows
        return buildPlanPreflight(client, plan, items)
      } finally {
        client.release()
      }
    },

    async reviewPlan(id, rawInput, actor) {
      const identity = actorDetails(actor)
      const decision = rawInput?.decision === 'reject' ? 'reject' : rawInput?.decision === 'approve' ? 'approve' : ''
      const note = text(rawInput?.note)
      if (!decision) throw problem('INVALID_LEGACY_MIGRATION_REVIEW', '请选择通过或退回', 400)
      if (decision === 'reject' && !note) throw problem('LEGACY_MIGRATION_REVIEW_NOTE_REQUIRED', '退回方案时必须填写原因', 400)
      return withTransaction(pool, async (client) => {
        const plan = (await client.query('SELECT * FROM catalog_legacy_migration_plan WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!plan) throw problem('LEGACY_MIGRATION_PLAN_NOT_FOUND', '迁移方案不存在', 404)
        if (plan.state !== 'submitted') throw problem('LEGACY_MIGRATION_PLAN_STATE_CONFLICT', '只有待审核方案可以审核', 409, { state: plan.state })
        if (Number(rawInput?.expectedVersion) !== plan.version) throw problem('LEGACY_MIGRATION_PLAN_VERSION_CONFLICT', '方案已被其他人更新，请刷新后重试', 409, { currentVersion: plan.version })
        if (identity.id === plan.created_by_id) throw problem('LEGACY_MIGRATION_SELF_REVIEW_FORBIDDEN', '方案提交人不能审核自己的迁移方案', 403)
        const items = (await client.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [id])).rows
        if (decision === 'approve') {
          const preflight = await buildPlanPreflight(client, plan, items)
          if (!preflight.ready) throw problem('LEGACY_MIGRATION_PREFLIGHT_FAILED', '方案复核未通过，请处理变化或冲突后重新提交', 409, { preflight })
        }
        const next = (await client.query(`UPDATE catalog_legacy_migration_plan SET state=$2,reviewed_by=$3,reviewed_by_id=$4,reviewed_by_role=$5,
          reviewed_at=now(),review_note=$6,version=version+1 WHERE id=$1 RETURNING *`,
        [id, decision === 'approve' ? 'approved' : 'rejected', identity.name, identity.id, identity.role, note])).rows[0]
        await insertPlanEvent(client, id, decision === 'approve' ? 'approved' : 'rejected', identity, note)
        const events = (await client.query('SELECT * FROM catalog_legacy_migration_plan_event WHERE plan_id=$1 ORDER BY created_at,id', [id])).rows
        return planView(next, items, events)
      })
    },

    async commitPlan(id, rawInput, actor) {
      const identity = actorDetails(actor)
      const plan = await this.getPlan(id)
      if (!plan) throw problem('LEGACY_MIGRATION_PLAN_NOT_FOUND', '迁移方案不存在', 404)
      if (plan.state !== 'approved') throw problem('LEGACY_MIGRATION_PLAN_STATE_CONFLICT', '只有已批准方案可以正式迁移', 409, { state: plan.state })
      if (Number(rawInput?.expectedVersion) !== plan.version) throw problem('LEGACY_MIGRATION_PLAN_VERSION_CONFLICT', '方案已被其他人更新，请刷新后重试', 409, { currentVersion: plan.version })
      const claimed = await withTransaction(pool, async (client) => {
        const lockedPlan = (await client.query('SELECT * FROM catalog_legacy_migration_plan WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!lockedPlan || lockedPlan.state !== 'approved' || lockedPlan.version !== plan.version) return null
        const items = (await client.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [id])).rows
        const preflight = await buildPlanPreflight(client, lockedPlan, items)
        if (!preflight.ready) throw problem('LEGACY_MIGRATION_PREFLIGHT_FAILED', '执行前复核未通过，未写入任何新资料', 409, { preflight })
        const row = (await client.query(`UPDATE catalog_legacy_migration_plan SET state='committing',version=version+1
          WHERE id=$1 AND state='approved' AND version=$2 RETURNING *`, [id, plan.version])).rows[0]
        if (row) await insertPlanEvent(client, id, 'commit_started', identity, '', { expectedVersion: plan.version })
        return row
      })
      if (!claimed) throw problem('LEGACY_MIGRATION_PLAN_VERSION_CONFLICT', '方案状态已变化，请刷新查看结果', 409)
      try {
        const migratable = plan.items.filter((item) => item.decision === 'migrate')
        const batch = await this.commit({ atomic: true, reason: `已批准方案 ${plan.id}：${plan.reason}`, items: migratable.map((item) => ({ legacySkuId: item.legacySkuId, sourceHash: item.sourceHash, overrides: item.overrides })) }, identity.name)
        return withTransaction(pool, async (client) => {
          const updated = (await client.query(`UPDATE catalog_legacy_migration_plan SET state='committed',committed_batch_id=$2,committed_by=$3,
            committed_by_id=$4,committed_by_role=$5,committed_at=now(),version=version+1
            WHERE id=$1 AND state='committing' AND version=$6 RETURNING *`, [id, batch.id, identity.name, identity.id, identity.role, claimed.version])).rows[0]
          await insertPlanEvent(client, id, 'committed', identity, '', { batchId: batch.id, summary: batch.summary })
          const items = (await client.query('SELECT * FROM catalog_legacy_migration_plan_item WHERE plan_id=$1 ORDER BY sort_order,created_at', [id])).rows
          const events = (await client.query('SELECT * FROM catalog_legacy_migration_plan_event WHERE plan_id=$1 ORDER BY created_at,id', [id])).rows
          return { ...planView(updated, items, events), batch, execution: batch }
        })
      } catch (error) {
        await withTransaction(pool, async (client) => {
          await client.query("UPDATE catalog_legacy_migration_plan SET state='approved',version=version+1 WHERE id=$1 AND state='committing'", [id])
          await insertPlanEvent(client, id, 'commit_failed', identity, error.message, { errorCode: error.errorCode || 'LEGACY_SKU_MIGRATION_FAILED' })
        }).catch(() => {})
        throw error
      }
    },
  }
}
