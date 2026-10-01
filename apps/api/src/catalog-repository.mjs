import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function compactDate() {
  const date = new Date()
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function generatedSkuCode() {
  return `SKU-${compactDate()}-${randomUUID().slice(0, 6).toUpperCase()}`
}

function normalizeSearchIdentifier(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s._/#+()\-]/g, '')
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

function mapReviewEvent(row) {
  return {
    id: row.id, fromStatus: row.from_status, toStatus: row.to_status, action: row.action,
    note: row.note, assignee: row.assignee, changedBy: row.changed_by, changedAt: row.changed_at, skuVersion: row.sku_version,
  }
}

function mapSku(row, children = {}) {
  return {
    id: row.id,
    identity: identityFromRow(row),
    lifecycleStatus: row.lifecycle_status,
    completenessScore: row.completeness_score,
    verificationLevel: row.verification_level,
    reviewAssignee: row.review_assignee || '',
    reviewNote: row.review_note || '',
    reviewSubmittedAt: row.review_submitted_at,
    reviewDueAt: row.review_due_at,
    discontinuedReason: row.discontinued_reason || '',
    qualityIssues: row.quality_issues || [],
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
    reviewEvents: (children.reviewEvents || []).map(mapReviewEvent),
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

function transitionError(message) {
  const error = new Error(message)
  error.statusCode = 409
  error.errorCode = 'INVALID_STATUS_TRANSITION'
  return error
}

const qualityIssueExpression = `ARRAY_REMOVE(ARRAY[
  CASE WHEN s.canonical_name_zh='' AND s.canonical_name_en='' THEN 'identity' END,
  CASE WHEN (s.brand_code='' AND s.brand_label='') OR (s.category_code='' AND s.category_label='') THEN 'classification' END,
  CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_part_identifier qi WHERE qi.sku_id=s.id AND qi.is_primary AND qi.normalized_value<>'') THEN 'primaryIdentifier' END,
  CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_fitment qf WHERE qf.sku_id=s.id) THEN 'fitment' END,
  CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_source_evidence qe WHERE qe.sku_id=s.id AND (qe.source_system<>'' OR qe.source_record_id<>'' OR qe.catalog_path<>'' OR qe.raw_payload<>'{}'::jsonb)) THEN 'evidence' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM catalog_part_identifier own_i
    JOIN catalog_part_identifier other_i ON other_i.normalized_value=own_i.normalized_value AND other_i.sku_id<>own_i.sku_id
    JOIN catalog_sku other_s ON other_s.id=other_i.sku_id AND other_s.lifecycle_status<>'discontinued'
    WHERE own_i.sku_id=s.id AND NOT EXISTS (
      SELECT 1 FROM catalog_identifier_resolution r
      WHERE r.normalized_value=own_i.normalized_value AND r.active
        AND r.resolution_type IN ('shared_reference','separate_scope')
        AND ((r.sku_id_a=own_i.sku_id AND r.sku_id_b=other_i.sku_id) OR (r.sku_id_a=other_i.sku_id AND r.sku_id_b=own_i.sku_id))
    )
  ) THEN 'duplicateIdentifier' END
],NULL)`

export function createCatalogRepository(pool) {
  async function childRows(client, skuId, includeChanges = false) {
    const identifiers = await client.query('SELECT * FROM catalog_part_identifier WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const evidence = await client.query('SELECT * FROM catalog_source_evidence WHERE sku_id=$1 ORDER BY sort_order, captured_at', [skuId])
    const fitments = await client.query('SELECT * FROM catalog_fitment WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const interchanges = await client.query('SELECT * FROM catalog_interchange_relation WHERE sku_id=$1 ORDER BY sort_order, created_at', [skuId])
    const changes = includeChanges ? await client.query('SELECT * FROM catalog_change_log WHERE sku_id=$1 ORDER BY version DESC, changed_at DESC', [skuId]) : null
    const reviewEvents = includeChanges ? await client.query('SELECT * FROM catalog_review_event WHERE sku_id=$1 ORDER BY changed_at DESC', [skuId]) : null
    return { identifiers: identifiers.rows, evidence: evidence.rows, fitments: fitments.rows, interchanges: interchanges.rows, changes: changes?.rows || [], reviewEvents: reviewEvents?.rows || [] }
  }

  async function addChange(client, skuId, version, action, input, actor, details = {}) {
    await client.query(`INSERT INTO catalog_change_log (id,sku_id,version,action,summary,snapshot,changed_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [randomUUID(), skuId, version, action, JSON.stringify({ ...auditSummary(input), ...details }), JSON.stringify(input), actor])
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
    const { rows } = await client.query(`SELECT s.*,${qualityIssueExpression} AS quality_issues
      FROM catalog_sku s WHERE s.id=$1 OR s.sku_code=$1 LIMIT 1`, [id])
    if (!rows[0]) return null
    return mapSku(rows[0], await childRows(client, rows[0].id, includeChanges))
  }

  return {
    async list({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 30))
      const term = String(query || '').trim().toLowerCase()
      const baseClauses = []
      const values = []
      if (term) {
        values.push(`%${term}%`)
        const textParameter = values.length
        values.push(`%${normalizeSearchIdentifier(term)}%`)
        const identifierParameter = values.length
        baseClauses.push(`(lower(concat_ws(' ',s.sku_code,s.canonical_name_zh,s.canonical_name_en,s.brand_label,s.category_label)) LIKE $${textParameter}
          OR EXISTS (SELECT 1 FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.normalized_value LIKE $${identifierParameter})
          OR EXISTS (SELECT 1 FROM catalog_fitment f WHERE f.sku_id=s.id AND lower(f.vehicle_label) LIKE $${textParameter}))`)
      }
      const facetWhere = baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : ''
      const facetValues = [...values]
      const clauses = [...baseClauses]
      if (status) {
        values.push(status)
        clauses.push(`s.lifecycle_status=$${values.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const [count, facets] = await Promise.all([
        pool.query(`SELECT count(*)::int AS total FROM catalog_sku s ${where}`, values),
        pool.query(`SELECT lifecycle_status, count(*)::int AS count FROM catalog_sku s ${facetWhere} GROUP BY lifecycle_status`, facetValues),
      ])
      values.push(safeSize, (safePage - 1) * safeSize)
      const { rows } = await pool.query(`SELECT s.*,
        (SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) AS primary_identifier,
        (SELECT count(*)::int FROM catalog_fitment f WHERE f.sku_id=s.id) AS fitment_count,
        (SELECT source_system FROM catalog_source_evidence e WHERE e.sku_id=s.id ORDER BY e.sort_order LIMIT 1) AS source_system,
        ${qualityIssueExpression} AS quality_issues
        FROM catalog_sku s ${where} ORDER BY s.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
      return {
        items: rows.map((row) => ({ ...mapSku(row), primaryIdentifier: row.primary_identifier || '', fitmentCount: row.fitment_count, sourceSystem: row.source_system || '' })),
        total: count.rows[0].total, page: safePage, pageSize: safeSize,
        statusCounts: Object.fromEntries(facets.rows.map((row) => [row.lifecycle_status, row.count])),
      }
    },

    async findDuplicates(identifier, exceptId = null) {
      const normalized = normalizeSearchIdentifier(identifier)
      if (!normalized) return []
      const { rows } = await pool.query(`SELECT s.id,s.sku_code,s.canonical_name_zh,s.lifecycle_status,i.raw_value,i.identifier_type,i.is_primary
        FROM catalog_part_identifier i JOIN catalog_sku s ON s.id=i.sku_id
        WHERE i.normalized_value=$1 AND ($2::text IS NULL OR s.id<>$2)
        ORDER BY i.is_primary DESC,s.updated_at DESC LIMIT 20`, [normalized, exceptId])
      return rows.map((row) => ({
        skuId: row.id, skuCode: row.sku_code, nameZh: row.canonical_name_zh, lifecycleStatus: row.lifecycle_status,
        rawValue: row.raw_value, identifierType: row.identifier_type, isPrimary: row.is_primary,
      }))
    },

    async findUnresolvedDuplicates(identifier, exceptId) {
      const normalized = normalizeSearchIdentifier(identifier)
      if (!normalized || !exceptId) return []
      const { rows } = await pool.query(`SELECT s.id,s.sku_code,s.canonical_name_zh,s.lifecycle_status,i.raw_value,i.identifier_type,i.is_primary
        FROM catalog_part_identifier i JOIN catalog_sku s ON s.id=i.sku_id
        WHERE i.normalized_value=$1 AND s.id<>$2 AND s.lifecycle_status<>'discontinued'
          AND NOT EXISTS (SELECT 1 FROM catalog_identifier_resolution r WHERE r.normalized_value=i.normalized_value AND r.active
            AND r.resolution_type IN ('shared_reference','separate_scope')
            AND ((r.sku_id_a=$2 AND r.sku_id_b=s.id) OR (r.sku_id_a=s.id AND r.sku_id_b=$2)))
        ORDER BY i.is_primary DESC,s.updated_at DESC LIMIT 20`, [normalized, exceptId])
      return rows.map((row) => ({
        skuId: row.id, skuCode: row.sku_code, nameZh: row.canonical_name_zh, lifecycleStatus: row.lifecycle_status,
        rawValue: row.raw_value, identifierType: row.identifier_type, isPrimary: row.is_primary,
      }))
    },

    async findDuplicatesMany(identifiers = []) {
      const normalized = [...new Set(identifiers.map(normalizeSearchIdentifier).filter(Boolean))]
      if (!normalized.length) return {}
      const { rows } = await pool.query(`SELECT s.id,s.sku_code,s.canonical_name_zh,s.lifecycle_status,i.raw_value,i.normalized_value,i.identifier_type,i.is_primary
        FROM catalog_part_identifier i JOIN catalog_sku s ON s.id=i.sku_id
        WHERE i.normalized_value=ANY($1::text[]) ORDER BY i.is_primary DESC,s.updated_at DESC`, [normalized])
      return rows.reduce((result, row) => {
        result[row.normalized_value] ||= []
        result[row.normalized_value].push({
          skuId: row.id, skuCode: row.sku_code, nameZh: row.canonical_name_zh, lifecycleStatus: row.lifecycle_status,
          rawValue: row.raw_value, identifierType: row.identifier_type, isPrimary: row.is_primary,
        })
        return result
      }, {})
    },

    async identifierConflicts() {
      const { rows } = await pool.query(`SELECT DISTINCT ON (a.normalized_value,a.sku_id,b.sku_id)
        a.normalized_value,a.raw_value AS raw_value_a,b.raw_value AS raw_value_b,
        sa.id AS sku_id_a,sa.sku_code AS sku_code_a,sa.canonical_name_zh AS name_a,sa.brand_label AS brand_a,
        sa.lifecycle_status AS status_a,sa.completeness_score AS completeness_a,sa.version AS version_a,
        sb.id AS sku_id_b,sb.sku_code AS sku_code_b,sb.canonical_name_zh AS name_b,sb.brand_label AS brand_b,
        sb.lifecycle_status AS status_b,sb.completeness_score AS completeness_b,sb.version AS version_b,
        r.id AS resolution_id,r.resolution_type,r.note,r.resolved_by,r.resolved_at
        FROM catalog_part_identifier a
        JOIN catalog_part_identifier b ON b.normalized_value=a.normalized_value AND a.sku_id<b.sku_id
        JOIN catalog_sku sa ON sa.id=a.sku_id AND sa.lifecycle_status<>'discontinued'
        JOIN catalog_sku sb ON sb.id=b.sku_id AND sb.lifecycle_status<>'discontinued'
        LEFT JOIN catalog_identifier_resolution r ON r.normalized_value=a.normalized_value AND r.sku_id_a=a.sku_id AND r.sku_id_b=b.sku_id AND r.active
        ORDER BY a.normalized_value,a.sku_id,b.sku_id,a.is_primary DESC,b.is_primary DESC`)
      return rows.map((row) => ({
        key: `${row.normalized_value}:${row.sku_id_a}:${row.sku_id_b}`,
        normalizedValue: row.normalized_value,
        rawValues: [row.raw_value_a, row.raw_value_b],
        left: { id: row.sku_id_a, skuCode: row.sku_code_a, nameZh: row.name_a, brandLabel: row.brand_a, lifecycleStatus: row.status_a, completenessScore: row.completeness_a, version: row.version_a },
        right: { id: row.sku_id_b, skuCode: row.sku_code_b, nameZh: row.name_b, brandLabel: row.brand_b, lifecycleStatus: row.status_b, completenessScore: row.completeness_b, version: row.version_b },
        resolution: row.resolution_id ? { id: row.resolution_id, type: row.resolution_type, note: row.note, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at } : null,
      }))
    },

    async resolveIdentifierConflict(input, actor = '系统操作员') {
      const allowed = new Set(['shared_reference', 'separate_scope', 'merge_required'])
      const resolutionType = String(input?.resolutionType || '').trim()
      const normalizedValue = normalizeSearchIdentifier(input?.normalizedValue)
      const note = String(input?.note || '').trim()
      const ids = [String(input?.skuIdA || '').trim(), String(input?.skuIdB || '').trim()].sort()
      const expected = new Map([[String(input?.skuIdA || '').trim(), Number(input?.expectedVersionA)], [String(input?.skuIdB || '').trim(), Number(input?.expectedVersionB)]])
      if (!allowed.has(resolutionType)) throw transitionError('不支持的冲突处理结论')
      if (!normalizedValue || !ids[0] || !ids[1] || ids[0] === ids[1]) throw transitionError('冲突资料或编号无效')
      if (!note) throw transitionError('请填写处理依据')
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT id,version FROM catalog_sku WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [ids])
        if (rows.length !== 2) throw transitionError('冲突中的 SKU 已不存在')
        for (const row of rows) if (row.version !== expected.get(row.id)) throw versionConflict(row.version)
        const shared = await client.query(`SELECT 1 FROM catalog_part_identifier a JOIN catalog_part_identifier b
          ON b.normalized_value=a.normalized_value AND b.sku_id=$3 WHERE a.sku_id=$2 AND a.normalized_value=$1 LIMIT 1`, [normalizedValue, ids[0], ids[1]])
        if (!shared.rows.length) throw transitionError('这两条资料已经不存在相同编号')
        const resolutionId = randomUUID()
        const resolution = (await client.query(`INSERT INTO catalog_identifier_resolution
          (id,normalized_value,sku_id_a,sku_id_b,resolution_type,note,resolved_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (normalized_value,sku_id_a,sku_id_b) DO UPDATE SET
          resolution_type=EXCLUDED.resolution_type,note=EXCLUDED.note,resolved_by=EXCLUDED.resolved_by,resolved_at=now(),active=true
          RETURNING *`, [resolutionId, normalizedValue, ids[0], ids[1], resolutionType, note, actor])).rows[0]
        await client.query('UPDATE catalog_sku SET version=version+1,updated_by=$2,updated_at=now() WHERE id=ANY($1::text[])', [ids, actor])
        const updated = []
        for (const skuId of ids) {
          const aggregate = await getWith(client, skuId)
          const counterpartId = ids.find((value) => value !== skuId)
          await addChange(client, skuId, aggregate.version, 'resolve_identifier_conflict', aggregate, actor, { normalizedValue, resolutionType, note, counterpartId })
          updated.push(await getWith(client, skuId, true))
        }
        return {
          id: resolution.id, normalizedValue, resolutionType, note, resolvedBy: actor, resolvedAt: resolution.resolved_at,
          items: updated,
        }
      })
    },

    async qualityQueue({ issue = '', status = '', assignee = '', page = 1, pageSize = 30 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 30))
      const clauses = ["(q.lifecycle_status IN ('draft','review') OR cardinality(q.quality_issues)>0)"]
      const values = []
      if (issue) { values.push(issue); clauses.push(`$${values.length}=ANY(q.quality_issues)`) }
      if (status) { values.push(status); clauses.push(`q.lifecycle_status=$${values.length}`) }
      if (assignee) { values.push(assignee); clauses.push(`q.review_assignee=$${values.length}`) }
      const where = `WHERE ${clauses.join(' AND ')}`
      const cte = `WITH quality AS (SELECT s.*,
        (SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) AS primary_identifier,
        (SELECT count(*)::int FROM catalog_fitment f WHERE f.sku_id=s.id) AS fitment_count,
        (SELECT source_system FROM catalog_source_evidence e WHERE e.sku_id=s.id ORDER BY e.sort_order LIMIT 1) AS source_system,
        ${qualityIssueExpression} AS quality_issues FROM catalog_sku s)`
      const countValues = [...values]
      const [count, statuses, issues] = await Promise.all([
        pool.query(`${cte} SELECT count(*)::int AS total FROM quality q ${where}`, countValues),
        pool.query(`${cte} SELECT lifecycle_status,count(*)::int AS count FROM quality q ${where} GROUP BY lifecycle_status`, countValues),
        pool.query(`${cte} SELECT issue,count(*)::int AS count FROM quality q CROSS JOIN LATERAL unnest(q.quality_issues) issue ${where} GROUP BY issue`, countValues),
      ])
      values.push(safeSize, (safePage - 1) * safeSize)
      const { rows } = await pool.query(`${cte} SELECT q.* FROM quality q ${where}
        ORDER BY CASE q.lifecycle_status WHEN 'review' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
        q.review_due_at NULLS LAST,q.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
      return {
        items: rows.map((row) => ({ ...mapSku(row), primaryIdentifier: row.primary_identifier || '', fitmentCount: row.fitment_count, sourceSystem: row.source_system || '' })),
        total: count.rows[0].total, page: safePage, pageSize: safeSize,
        statusCounts: Object.fromEntries(statuses.rows.map((row) => [row.lifecycle_status, row.count])),
        issueCounts: Object.fromEntries(issues.rows.map((row) => [row.issue, row.count])),
      }
    },

    async metrics({ days = 30 } = {}) {
      const safeDays = Math.min(90, Math.max(7, Number(days) || 30))
      const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000)
      const qualityCte = `WITH quality AS (SELECT s.*,${qualityIssueExpression} AS quality_issues FROM catalog_sku s)`
      const [statuses, issues, completeness, review, imports, activity] = await Promise.all([
        pool.query('SELECT lifecycle_status,count(*)::int AS count FROM catalog_sku GROUP BY lifecycle_status'),
        pool.query(`${qualityCte} SELECT issue,count(*)::int AS count FROM quality q CROSS JOIN LATERAL unnest(q.quality_issues) issue GROUP BY issue`),
        pool.query(`SELECT
          count(*) FILTER (WHERE completeness_score<60)::int AS low,
          count(*) FILTER (WHERE completeness_score>=60 AND completeness_score<100)::int AS medium,
          count(*) FILTER (WHERE completeness_score=100)::int AS complete
          FROM catalog_sku`),
        pool.query(`WITH decisions AS (
          SELECT e.*,(SELECT max(s.changed_at) FROM catalog_review_event s WHERE s.sku_id=e.sku_id AND s.action='submit_review' AND s.changed_at<=e.changed_at) AS submitted_at
          FROM catalog_review_event e WHERE e.action IN ('approve_review','reject_review') AND e.changed_at >= $1)
          SELECT
            (SELECT count(*)::int FROM catalog_review_event WHERE action='submit_review' AND changed_at >= $1) AS submitted,
            count(*) FILTER (WHERE action='approve_review')::int AS approved,
            count(*) FILTER (WHERE action='reject_review')::int AS rejected,
            COALESCE(round((avg(extract(epoch FROM (changed_at-submitted_at))) FILTER (WHERE submitted_at IS NOT NULL)/3600)::numeric,1),0) AS avg_hours,
            (SELECT count(*)::int FROM catalog_sku WHERE lifecycle_status='review' AND review_due_at<now()) AS overdue
          FROM decisions`, [since]),
        pool.query(`SELECT count(*)::int AS batches,COALESCE(sum(total_rows),0)::int AS total_rows,
          COALESCE(sum(imported_rows),0)::int AS imported_rows,COALESCE(sum(failed_rows),0)::int AS failed_rows
          FROM catalog_import_job WHERE created_at >= $1`, [since]),
        pool.query(`WITH clock AS (SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date AS today),
          dates AS (SELECT generate_series(clock.today-($1::int-1),clock.today,'1 day')::date AS day FROM clock),
          events AS (SELECT (changed_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
            count(*) FILTER (WHERE action='create_draft')::int AS created,
            count(*) FILTER (WHERE action='submit_review')::int AS submitted,
            count(*) FILTER (WHERE action='approve_review')::int AS approved,
            count(*) FILTER (WHERE action='reject_review')::int AS rejected
            FROM catalog_change_log,clock WHERE changed_at >= clock.today-($1::int-1) GROUP BY (changed_at AT TIME ZONE 'Asia/Shanghai')::date)
          SELECT to_char(dates.day,'YYYY-MM-DD') AS day,COALESCE(created,0)::int AS created,COALESCE(submitted,0)::int AS submitted,
            COALESCE(approved,0)::int AS approved,COALESCE(rejected,0)::int AS rejected
          FROM dates LEFT JOIN events USING(day) ORDER BY dates.day`, [safeDays]),
      ])
      const importRow = imports.rows[0]
      const attemptedRows = importRow.imported_rows + importRow.failed_rows
      return {
        days: safeDays,
        statusCounts: Object.fromEntries(statuses.rows.map((row) => [row.lifecycle_status, row.count])),
        issueCounts: Object.fromEntries(issues.rows.map((row) => [row.issue, row.count])),
        completeness: completeness.rows[0],
        reviews: review.rows[0],
        imports: { ...importRow, successRate: attemptedRows ? Math.round((importRow.imported_rows / attemptedRows) * 100) : 0 },
        activity: activity.rows.map((row) => ({ ...row, day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day) })),
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
        const current = (await client.query('SELECT id,version,lifecycle_status FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!current) return null
        if (current.version !== expectedVersion) throw versionConflict(current.version)
        const { rows } = await client.query(`UPDATE catalog_sku SET
          sku_code=$2,canonical_name_zh=$3,canonical_name_en=$4,brand_code=$5,brand_label=$6,category_code=$7,category_label=$8,
          unit_code=$9,unit_label=$10,completeness_score=$11,lifecycle_status='draft',verification_level='unverified',
          review_assignee='',review_due_at=NULL,updated_by=$12,updated_at=now(),version=version+1
          WHERE id=$1 RETURNING *`,
        [current.id, input.identity.skuCode, input.identity.nameZh, input.identity.nameEn, input.identity.brandCode, input.identity.brandLabel,
          input.identity.categoryCode, input.identity.categoryLabel, input.identity.unitCode, input.identity.unitLabel, input.completenessScore, actor])
        await replaceChildren(client, current.id, input)
        await addChange(client, current.id, rows[0].version, current.lifecycle_status === 'draft' ? 'update_draft' : 'update_requires_review', input, actor)
        return getWith(client, current.id, true)
      })
    },

    async restore(id, input, expectedVersion, sourceVersion, reason, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT id,version FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!current) return null
        if (current.version !== expectedVersion) throw versionConflict(current.version)
        const source = (await client.query('SELECT version FROM catalog_change_log WHERE sku_id=$1 AND version=$2 LIMIT 1', [current.id, sourceVersion])).rows[0]
        if (!source) {
          const error = new Error(`找不到版本 v${sourceVersion}`)
          error.statusCode = 404
          error.errorCode = 'CATALOG_VERSION_NOT_FOUND'
          throw error
        }
        const { rows } = await client.query(`UPDATE catalog_sku SET
          sku_code=$2,canonical_name_zh=$3,canonical_name_en=$4,brand_code=$5,brand_label=$6,category_code=$7,category_label=$8,
          unit_code=$9,unit_label=$10,completeness_score=$11,lifecycle_status='draft',verification_level='unverified',
          review_assignee='',review_note='',review_submitted_at=NULL,review_due_at=NULL,discontinued_reason='',
          updated_by=$12,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
        [current.id, input.identity.skuCode, input.identity.nameZh, input.identity.nameEn, input.identity.brandCode, input.identity.brandLabel,
          input.identity.categoryCode, input.identity.categoryLabel, input.identity.unitCode, input.identity.unitLabel, input.completenessScore, actor])
        await replaceChildren(client, current.id, input)
        const restored = await getWith(client, current.id)
        await addChange(client, current.id, rows[0].version, 'restore_version', restored, actor, { sourceVersion, reason })
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

    async transition(id, input, actor = '系统操作员') {
      const action = String(input?.action || '').trim()
      const expectedVersion = Number(input?.expectedVersion)
      const note = String(input?.note || '').trim()
      const assignee = String(input?.assignee || '').trim()
      const dueAt = input?.dueAt || null
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw transitionError('expectedVersion 必须是正整数')
      return withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT * FROM catalog_sku WHERE id=$1 OR sku_code=$1 LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!current) return null
        if (current.version !== expectedVersion) throw versionConflict(current.version)
        const transitions = {
          submit_review: { from: 'draft', to: 'review', verification: 'unverified' },
          approve_review: { from: 'review', to: 'verified', verification: 'verified' },
          reject_review: { from: 'review', to: 'draft', verification: 'unverified', needsNote: true },
          discontinue: { from: 'verified', to: 'discontinued', verification: 'verified', needsNote: true },
          reopen: { from: 'discontinued', to: 'draft', verification: 'unverified', needsNote: true },
          assign_review: { from: 'review', to: 'review', verification: current.verification_level, needsAssignee: true },
        }
        const transition = transitions[action]
        if (!transition) throw transitionError('不支持的资料状态操作')
        if (current.lifecycle_status !== transition.from) throw transitionError(`当前状态不能执行 ${action}`)
        if (transition.needsNote && !note) throw transitionError('请填写操作原因')
        if (transition.needsAssignee && !assignee) throw transitionError('请选择审核人')
        const nextAssignee = action === 'submit_review' || action === 'assign_review' ? assignee : action === 'reject_review' || action === 'reopen' ? '' : current.review_assignee
        const nextReviewNote = ['submit_review', 'reject_review', 'approve_review', 'assign_review'].includes(action) ? note : current.review_note
        const discontinuedReason = action === 'discontinue' ? note : action === 'reopen' ? '' : current.discontinued_reason
        const { rows } = await client.query(`UPDATE catalog_sku SET lifecycle_status=$2,verification_level=$3,
          completeness_score=CASE WHEN $4='approve_review' THEN 100 ELSE completeness_score END,
          review_assignee=$5,review_note=$6,
          review_submitted_at=CASE WHEN $4='submit_review' THEN now() ELSE review_submitted_at END,
          review_due_at=CASE WHEN $4='submit_review' THEN COALESCE($7::timestamptz,now()+interval '2 days') WHEN $4 IN ('reject_review','approve_review','reopen') THEN NULL ELSE review_due_at END,
          discontinued_reason=$8,updated_by=$9,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
        [current.id, transition.to, transition.verification, action, nextAssignee, nextReviewNote, dueAt, discontinuedReason, actor])
        const updated = await getWith(client, current.id)
        await client.query(`INSERT INTO catalog_review_event (id,sku_id,from_status,to_status,action,note,assignee,changed_by,sku_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), current.id, current.lifecycle_status, transition.to, action, note, nextAssignee, actor, rows[0].version])
        await addChange(client, current.id, rows[0].version, action, updated, actor)
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
