import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function compactDate() {
  const date = new Date()
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function generatedSkuCode() {
  return `SKU-${compactDate()}-${randomUUID().slice(0, 6).toUpperCase()}`
}

function identityFromRow(row) {
  return {
    skuCode: row.sku_code,
    nameZh: row.canonical_name_zh,
    nameEn: row.canonical_name_en,
    brandCode: row.brand_code,
    brandLabel: row.brand_label,
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    unitCode: row.unit_code,
    unitLabel: row.unit_label,
  }
}

function mapEvidence(row) {
  return {
    id: row.id, intakeId: row.intake_id || '', sourceType: row.source_type, sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id, catalogPath: row.catalog_path, figurePosition: row.figure_position,
    originalName: row.original_name, vinContext: row.vin_context, rawPayload: row.raw_payload || {}, confidence: row.confidence,
    immutableHash: row.immutable_hash, capturedAt: row.captured_at, sortOrder: row.sort_order,
  }
}

function mapIdentifier(row) {
  return {
    id: row.id, type: row.identifier_type, rawValue: row.raw_value, normalizedValue: row.normalized_value,
    manufacturerCode: row.manufacturer_code, isPrimary: row.is_primary, evidenceId: row.source_evidence_id || '',
    verificationStatus: row.verification_status, sortOrder: row.sort_order,
  }
}

function mapFitment(row) {
  return {
    id: row.id, vehiclePlatformId: row.vehicle_platform_id || '', vehicleLabel: row.vehicle_label, years: row.years,
    yearFrom: row.year_from, yearTo: row.year_to, engineCodes: row.engine_codes || [], marketCodes: row.market_codes || [],
    prCodes: row.pr_codes || [], bodyStyles: row.body_styles || [], position: row.position,
    includeConditions: row.include_conditions || {}, excludeConditions: row.exclude_conditions || {},
    evidenceId: row.source_evidence_id || '', verificationStatus: row.verification_status, sortOrder: row.sort_order,
  }
}

function mapInterchange(row) {
  return {
    id: row.id, fromIdentifierId: row.from_identifier_id || '', toIdentifierId: row.to_identifier_id || '',
    relationType: row.relation_type, direction: row.direction, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to, conditions: row.conditions || {}, evidenceId: row.source_evidence_id || '', sortOrder: row.sort_order,
  }
}

function mapChange(row) {
  return { id: row.id, version: row.version, action: row.action, summary: row.summary || {}, snapshot: row.snapshot || {}, changedBy: row.changed_by, changedAt: row.changed_at }
}

function mapSku(row, children = {}) {
  return {
    id: row.id,
    identity: identityFromRow(row),
    lifecycleStatus: row.lifecycle_status,
    completenessScore: row.completeness_score,
    verificationLevel: row.verification_level,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    identifiers: (children.identifiers || []).map(mapIdentifier),
    evidence: (children.evidence || []).map(mapEvidence),
    fitments: (children.fitments || []).map(mapFitment),
    interchanges: (children.interchanges || []).map(mapInterchange),
    changes: (children.changes || []).map(mapChange),
  }
}

function auditSummary(input) {
  return {
    skuCode: input.identity.skuCode,
    nameZh: input.identity.nameZh,
    lifecycleStatus: input.lifecycleStatus,
    completenessScore: input.completenessScore,
    identifierCount: input.identifiers.length,
    fitmentCount: input.fitments.length,
    evidenceCount: input.evidence.length,
  }
}

function versionConflict(currentVersion) {
  const error = new Error(`资料已被其他操作更新（当前版本 v${currentVersion}），请刷新后再编辑`)
  error.statusCode = 409
  error.errorCode = 'CATALOG_VERSION_CONFLICT'
  error.details = { currentVersion }
  return error
}

export function createCatalogRepository(pool) {
  async function childRows(client, skuId, includeChanges = false) {
    const identifiers = await client.query('SELECT * FROM catalog_part_identifier WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const evidence = await client.query('SELECT * FROM catalog_source_evidence WHERE sku_id=$1 ORDER BY sort_order, captured_at', [skuId])
    const fitments = await client.query('SELECT * FROM catalog_fitment WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const interchanges = await client.query('SELECT * FROM catalog_interchange_relation WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const changes = includeChanges ? await client.query('SELECT * FROM catalog_change_log WHERE sku_id=$1 ORDER BY version DESC, changed_at DESC', [skuId]) : null
    return { identifiers: identifiers.rows, evidence: evidence.rows, fitments: fitments.rows, interchanges: interchanges.rows, changes: changes?.rows || [] }
  }

  async function addChange(client, skuId, version, action, input, actor) {
    await client.query(`INSERT INTO catalog_change_log (id,sku_id,version,action,summary,snapshot,changed_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [randomUUID(), skuId, version, action, JSON.stringify(auditSummary(input)), JSON.stringify(input), actor])
  }

  async function replaceChildren(client, skuId, input) {
    await client.query('DELETE FROM catalog_interchange_relation WHERE sku_id=$1', [skuId])
    await client.query('DELETE FROM catalog_fitment WHERE sku_id=$1', [skuId])
    await client.query('DELETE FROM catalog_part_identifier WHERE sku_id=$1', [skuId])
    await client.query('DELETE FROM catalog_source_evidence WHERE sku_id=$1', [skuId])

    const evidenceIds = new Map()
    for (const item of input.evidence) {
      const id = item.id || randomUUID()
      evidenceIds.set(item.clientKey, id)
      evidenceIds.set(id, id)
      await client.query(`INSERT INTO catalog_source_evidence
        (id,sku_id,intake_id,source_type,source_system,source_record_id,catalog_path,figure_position,original_name,vin_context,raw_payload,confidence,immutable_hash,captured_at,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,COALESCE($14::timestamptz,now()),$15)`,
      [id, skuId, item.intakeId || null, item.sourceType, item.sourceSystem, item.sourceRecordId, item.catalogPath,
        item.figurePosition, item.originalName, item.vinContext, JSON.stringify(item.rawPayload), item.confidence,
        item.immutableHash, item.capturedAt || null, item.sortOrder])
    }

    const identifierIds = new Map()
    for (const item of input.identifiers) {
      const id = item.id || randomUUID()
      identifierIds.set(item.clientKey, id)
      identifierIds.set(id, id)
      await client.query(`INSERT INTO catalog_part_identifier
        (id,sku_id,identifier_type,raw_value,normalized_value,manufacturer_code,is_primary,source_evidence_id,verification_status,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, skuId, item.type, item.rawValue, item.normalizedValue, item.manufacturerCode, item.isPrimary,
        evidenceIds.get(item.evidenceKey || item.evidenceId) || null, item.verificationStatus, item.sortOrder])
    }

    for (const item of input.fitments) {
      await client.query(`INSERT INTO catalog_fitment
        (id,sku_id,vehicle_platform_id,vehicle_label,years,year_from,year_to,engine_codes,market_codes,pr_codes,body_styles,position,include_conditions,exclude_conditions,source_evidence_id,verification_status,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17)`,
      [item.id || randomUUID(), skuId, item.vehiclePlatformId || null, item.vehicleLabel, item.years, item.yearFrom, item.yearTo,
        item.engineCodes, item.marketCodes, item.prCodes, item.bodyStyles, item.position, JSON.stringify(item.includeConditions),
        JSON.stringify(item.excludeConditions), evidenceIds.get(item.evidenceKey || item.evidenceId) || null, item.verificationStatus, item.sortOrder])
    }

    for (const item of input.interchanges) {
      await client.query(`INSERT INTO catalog_interchange_relation
        (id,sku_id,from_identifier_id,to_identifier_id,relation_type,direction,effective_from,effective_to,conditions,source_evidence_id,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [item.id || randomUUID(), skuId, identifierIds.get(item.fromIdentifierKey || item.fromIdentifierId) || null,
        identifierIds.get(item.toIdentifierKey || item.toIdentifierId) || null, item.relationType, item.direction,
        item.effectiveFrom || null, item.effectiveTo || null, JSON.stringify(item.conditions),
        evidenceIds.get(item.evidenceKey || item.evidenceId) || null, item.sortOrder])
    }
  }

  async function getWith(client, id, includeChanges = false) {
    const { rows } = await client.query('SELECT * FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1', [id])
    if (!rows[0]) return null
    return mapSku(rows[0], await childRows(client, rows[0].id, includeChanges))
  }

  return {
    async list({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 30))
      const term = String(query || '').trim().toLowerCase()
      const clauses = []
      const values = []
      if (term) {
        values.push(`%${term}%`)
        clauses.push(`(lower(concat_ws(' ',s.sku_code,s.canonical_name_zh,s.canonical_name_en,s.brand_label,s.category_label)) LIKE $${values.length}
          OR EXISTS (SELECT 1 FROM catalog_part_identifier i WHERE i.sku_id=s.id AND lower(i.normalized_value) LIKE $${values.length})
          OR EXISTS (SELECT 1 FROM catalog_fitment f WHERE f.sku_id=s.id AND lower(f.vehicle_label) LIKE $${values.length}))`)
      }
      if (status) {
        values.push(status)
        clauses.push(`s.lifecycle_status=$${values.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const count = await pool.query(`SELECT count(*)::int AS total FROM catalog_sku s ${where}`, values)
      values.push(safeSize, (safePage - 1) * safeSize)
      const { rows } = await pool.query(`SELECT s.*,
        (SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) AS primary_identifier,
        (SELECT count(*)::int FROM catalog_fitment f WHERE f.sku_id=s.id) AS fitment_count,
        (SELECT source_system FROM catalog_source_evidence e WHERE e.sku_id=s.id ORDER BY e.sort_order LIMIT 1) AS source_system
        FROM catalog_sku s ${where} ORDER BY s.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
      return {
        items: rows.map((row) => ({ ...mapSku(row), primaryIdentifier: row.primary_identifier || '', fitmentCount: row.fitment_count, sourceSystem: row.source_system || '' })),
        total: count.rows[0].total, page: safePage, pageSize: safeSize,
      }
    },

    get(id) {
      return getWith(pool, id, true)
    },

    async create(input, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const id = randomUUID()
        input.identity.skuCode ||= generatedSkuCode()
        const { rows } = await client.query(`INSERT INTO catalog_sku
          (id,sku_code,canonical_name_zh,canonical_name_en,brand_code,brand_label,category_code,category_label,unit_code,unit_label,lifecycle_status,completeness_score,verification_level,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [id, input.identity.skuCode, input.identity.nameZh, input.identity.nameEn, input.identity.brandCode, input.identity.brandLabel,
          input.identity.categoryCode, input.identity.categoryLabel, input.identity.unitCode, input.identity.unitLabel,
          input.lifecycleStatus, input.completenessScore, input.verificationLevel, actor])
        await replaceChildren(client, id, input)
        await addChange(client, id, rows[0].version, 'create_draft', input, actor)
        return getWith(client, id, true)
      })
    },

    async update(id, input, expectedVersion, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT id,version FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!current) return null
        if (current.version !== expectedVersion) throw versionConflict(current.version)
        const { rows } = await client.query(`UPDATE catalog_sku SET
          sku_code=$2,canonical_name_zh=$3,canonical_name_en=$4,brand_code=$5,brand_label=$6,category_code=$7,category_label=$8,
          unit_code=$9,unit_label=$10,completeness_score=$11,updated_by=$12,updated_at=now(),version=version+1
          WHERE id=$1 RETURNING *`,
        [current.id, input.identity.skuCode, input.identity.nameZh, input.identity.nameEn, input.identity.brandCode, input.identity.brandLabel,
          input.identity.categoryCode, input.identity.categoryLabel, input.identity.unitCode, input.identity.unitLabel, input.completenessScore, actor])
        await replaceChildren(client, current.id, input)
        await addChange(client, current.id, rows[0].version, 'update_draft', input, actor)
        return getWith(client, current.id, true)
      })
    },

    async verify(id, expectedVersion, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT id,version FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!current) return null
        if (current.version !== expectedVersion) throw versionConflict(current.version)
        const { rows } = await client.query(`UPDATE catalog_sku SET lifecycle_status='verified',verification_level='verified',
          completeness_score=100,updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`, [current.id, actor])
        const aggregate = await getWith(client, current.id)
        await addChange(client, current.id, rows[0].version, 'verify', aggregate, actor)
        return getWith(client, current.id, true)
      })
    },

    async changes(id) {
      const item = await getWith(pool, id)
      if (!item) return null
      const { rows } = await pool.query('SELECT * FROM catalog_change_log WHERE sku_id=$1 ORDER BY version DESC, changed_at DESC', [item.id])
      return rows.map(mapChange)
    },

    async createIntake(input, actor = '系统操作员') {
      const id = randomUUID()
      const { rows } = await pool.query(`INSERT INTO catalog_intake (id,source_type,source_context,raw_payload,created_by)
        VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING *`, [id, input.sourceType, JSON.stringify(input.sourceContext), JSON.stringify(input.rawPayload), actor])
      return { id: rows[0].id, sourceType: rows[0].source_type, state: rows[0].state, sourceContext: rows[0].source_context, rawPayload: rows[0].raw_payload, createdBy: rows[0].created_by, createdAt: rows[0].created_at, version: rows[0].version }
    },

    async getIntake(id) {
      const { rows } = await pool.query('SELECT * FROM catalog_intake WHERE id=$1', [id])
      if (!rows[0]) return null
      const row = rows[0]
      return { id: row.id, sourceType: row.source_type, state: row.state, sourceContext: row.source_context, rawPayload: row.raw_payload, createdBy: row.created_by, createdAt: row.created_at, version: row.version }
    },
  }
}
