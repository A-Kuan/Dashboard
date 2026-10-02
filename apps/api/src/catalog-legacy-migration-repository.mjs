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

export function mapLegacySku(snapshot, dictionaries = {}) {
  const sku = snapshot.sku
  const brand = resolveDictionary(dictionaries, 'sku_brand', sku.brand)
  const category = resolveDictionary(dictionaries, 'part_category', sku.category)
  const unit = resolveDictionary(dictionaries, 'unit', sku.unit)
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

async function loadLegacyRows(client, { query = '' } = {}) {
  const term = `%${text(query).toLocaleLowerCase('zh-CN')}%`
  const values = text(query) ? [term] : []
  const where = values.length ? `WHERE lower(concat_ws(' ',s.sku_code,s.chinese_name,s.brand,s.category,s.primary_oe,s.manufacturer_part_number)) LIKE $1` : ''
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
      await pool.query(`INSERT INTO catalog_legacy_migration_batch (id,selected_count,reason,created_by) VALUES ($1,$2,$3,$4)`, [batchId, selected.length, reason, actor])
      const results = []
      for (const candidate of selected) {
        const legacySkuId = text(candidate?.legacySkuId)
        const expectedHash = text(candidate?.sourceHash)
        try {
          const result = await withTransaction(pool, async (client) => {
            await client.query('SELECT id FROM sku WHERE id=$1 FOR SHARE', [legacySkuId])
            const rows = await loadLegacyRows(client)
            const row = rows.find((item) => item.sku.id === legacySkuId)
            if (!row) throw problem('LEGACY_SKU_NOT_FOUND', '旧 SKU 已不存在', 404)
            const snapshot = snapshotFromRow(row)
            const sourceHash = hashSnapshot(snapshot)
            if (!expectedHash || sourceHash !== expectedHash) throw problem('LEGACY_SKU_SOURCE_CHANGED', '旧资料已发生变化，请刷新预览后再迁移', 409, { sourceHash })
            const existing = await migrationState(client, legacySkuId)
            if (existing) return { state: 'skipped', legacySkuId, catalogSkuId: existing.catalog_sku_id, sourceHash, reason: 'already_migrated' }
            const dictionaries = await loadDictionaryConfiguration(client)
            const mapped = mapLegacySku(snapshot, dictionaries)
            const issues = [...mapped.issues, ...await conflictIssues(client, snapshot, legacySkuId)]
            const blocking = issues.filter((issue) => issue.blocking)
            if (blocking.length) throw problem('LEGACY_SKU_MIGRATION_BLOCKED', '存在阻止迁移的数据问题', 422, { issues: blocking })
            const catalogSkuId = await insertCatalogDraft(client, mapped.input, snapshot, sourceHash, batchId, actor)
            const mappingSnapshot = { input: mapped.input, mapping: mapped.mapping, issues }
            await client.query(`INSERT INTO catalog_legacy_sku_migration
              (legacy_sku_id,catalog_sku_id,batch_id,source_hash,source_snapshot,mapping_snapshot,migrated_by)
              VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [legacySkuId, catalogSkuId, batchId, sourceHash, JSON.stringify(snapshot), JSON.stringify(mappingSnapshot), actor])
            return { state: 'migrated', legacySkuId, catalogSkuId, sourceHash, mappingSnapshot }
          })
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
  }
}
