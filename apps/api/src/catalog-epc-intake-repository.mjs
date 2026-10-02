import { createHash, randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function compactDate() {
  const date = new Date()
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function evidenceHash(preview, item) {
  return createHash('sha256').update(JSON.stringify({
    sourceType: 'vin_epc', sourceSystem: preview.source_system, sourceRecordId: item.source_record_id,
    catalogPath: preview.catalog_path, figurePosition: item.figure_position, originalName: item.original_name,
    vinContext: preview.vin, rawPayload: item.raw_payload,
  })).digest('hex')
}

function mapItem(row) {
  return {
    id: row.id, rowNumber: row.row_number, sourceRecordId: row.source_record_id, oe: row.raw_oe,
    normalizedOe: row.normalized_oe, originalName: row.original_name, figurePosition: row.figure_position,
    vehicleContext: row.vehicle_context || {}, rawPayload: row.raw_payload || {}, matchState: row.match_state,
    matchedSkuId: row.matched_sku_id || '', matchCandidates: row.match_candidates || [], platformMatch: row.platform_match || {},
    variantCandidates: row.variant_candidates || [], decisionState: row.decision_state, resultingSkuId: row.resulting_sku_id || '',
  }
}

async function getPreview(client, id) {
  const preview = (await client.query('SELECT * FROM catalog_epc_preview WHERE id=$1', [id])).rows[0]
  if (!preview) return null
  const items = (await client.query('SELECT * FROM catalog_epc_preview_item WHERE preview_id=$1 ORDER BY row_number', [id])).rows.map(mapItem)
  const decisions = (await client.query('SELECT * FROM catalog_epc_publish_decision WHERE preview_id=$1 ORDER BY decided_at', [id])).rows.map((row) => ({
    id: row.id, itemId: row.item_id, decisionType: row.decision_type, targetSkuId: row.target_sku_id || '', decidedBy: row.decided_by, decidedAt: row.decided_at,
  }))
  return {
    id: preview.id, intakeId: preview.intake_id, state: preview.state, vin: preview.vin, sourceSystem: preview.source_system,
    catalogPath: preview.catalog_path, summary: preview.summary || {}, version: preview.version, createdBy: preview.created_by,
    createdAt: preview.created_at, updatedAt: preview.updated_at, items, decisions,
  }
}

function overlapCount(left = [], right = []) {
  const accepted = new Set(right)
  return left.filter((value) => accepted.has(value)).length
}

function variantScore(item, variant) {
  let score = 0
  const reasons = []
  if (item.variantCode && item.variantCode === variant.variant_code) { score += 50; reasons.push('版本编码一致') }
  const dimensions = [
    ['engineCodes', 'engine_codes', '发动机'], ['transmissionCodes', 'transmission_codes', '变速箱'], ['marketCodes', 'market_codes', '市场'],
    ['prCodes', 'pr_codes', 'PR 码'], ['bodyStyles', 'body_styles', '车身'], ['driveTypes', 'drive_types', '驱动'],
  ]
  for (const [source, target, label] of dimensions) {
    const count = overlapCount(item[source], variant[target] || [])
    if (count) { score += count * 8; reasons.push(`${label}条件匹配`) }
  }
  if (item.yearFrom && item.yearTo && (!variant.year_from || item.yearFrom >= variant.year_from) && (!variant.year_to || item.yearTo <= variant.year_to)) { score += 12; reasons.push('年款范围覆盖') }
  return { score, reasons }
}

export function createCatalogEpcIntakeRepository(pool) {
  return {
    async createPreview(input, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const intakeId = randomUUID()
        const previewId = randomUUID()
        await client.query(`INSERT INTO catalog_intake (id,source_type,state,source_context,raw_payload,created_by)
          VALUES ($1,'vin_epc','received',$2::jsonb,$3::jsonb,$4)`, [intakeId, JSON.stringify({ vin: input.vin, sourceSystem: input.sourceSystem, catalogPath: input.catalogPath, ...input.sourceContext }), JSON.stringify({ items: input.items }), actor])
        const prepared = []
        for (let index = 0; index < input.items.length; index += 1) {
          const item = input.items[index]
          const matches = (await client.query(`SELECT s.id,s.sku_code,s.canonical_name_zh,s.lifecycle_status,s.version
            FROM catalog_part_identifier i JOIN catalog_sku s ON s.id=i.sku_id
            WHERE i.normalized_value=$1 AND s.lifecycle_status<>'discontinued' ORDER BY s.updated_at DESC`, [item.normalizedOe])).rows
          const platform = item.platformCode ? (await client.query(`SELECT * FROM catalog_vehicle_platform
            WHERE lifecycle_status='active' AND (platform_code=$1 OR $1=ANY(aliases)) LIMIT 1`, [item.platformCode])).rows[0] : null
          const variants = platform ? (await client.query(`SELECT * FROM catalog_vehicle_variant WHERE platform_id=$1 AND lifecycle_status='active'`, [platform.id])).rows : []
          const scored = variants.map((variant) => ({ id: variant.id, code: variant.variant_code, label: variant.variant_label, ...variantScore(item, variant) }))
            .filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
          const matchState = matches.length === 1 ? 'exact' : matches.length > 1 ? 'ambiguous' : 'new'
          prepared.push({ item, matches, platform, scored, matchState })
        }
        const summary = {
          total: prepared.length, exact: prepared.filter((item) => item.matchState === 'exact').length,
          new: prepared.filter((item) => item.matchState === 'new').length, ambiguous: prepared.filter((item) => item.matchState === 'ambiguous').length,
          platformMatched: prepared.filter((item) => item.platform).length,
        }
        await client.query(`INSERT INTO catalog_epc_preview (id,intake_id,vin,source_system,catalog_path,summary,created_by)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [previewId, intakeId, input.vin, input.sourceSystem, input.catalogPath, JSON.stringify(summary), actor])
        for (let index = 0; index < prepared.length; index += 1) {
          const { item, matches, platform, scored, matchState } = prepared[index]
          await client.query(`INSERT INTO catalog_epc_preview_item
            (id,preview_id,row_number,source_record_id,raw_oe,normalized_oe,original_name,figure_position,vehicle_context,raw_payload,match_state,matched_sku_id,match_candidates,platform_match,variant_candidates)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)`, [
            randomUUID(), previewId, index + 1, item.sourceRecordId, item.rawOe, item.normalizedOe, item.originalName, item.figurePosition,
            JSON.stringify({ platformCode: item.platformCode, variantCode: item.variantCode, vehicleLabel: item.vehicleLabel, yearFrom: item.yearFrom, yearTo: item.yearTo, engineCodes: item.engineCodes, transmissionCodes: item.transmissionCodes, marketCodes: item.marketCodes, prCodes: item.prCodes, bodyStyles: item.bodyStyles, driveTypes: item.driveTypes, position: item.position }),
            JSON.stringify(item.rawPayload), matchState, matches.length === 1 ? matches[0].id : null,
            JSON.stringify(matches.map((match) => ({ id: match.id, skuCode: match.sku_code, name: match.canonical_name_zh, status: match.lifecycle_status, version: match.version }))),
            JSON.stringify(platform ? { id: platform.id, code: platform.platform_code, label: `${platform.brand_label} ${platform.series_label} ${platform.generation_label}`.trim(), yearFrom: platform.year_from, yearTo: platform.year_to } : {}),
            JSON.stringify(scored),
          ])
        }
        return getPreview(client, previewId)
      })
    },

    get(id) { return getPreview(pool, id) },

    async list({ state = '', page = 1, pageSize = 20 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
      const params = []
      const where = state ? (params.push(state), `WHERE p.state=$${params.length}`) : ''
      params.push(safeSize, (safePage - 1) * safeSize)
      const rows = (await pool.query(`SELECT p.*,
        count(i.id)::int AS item_total,
        count(i.id) FILTER (WHERE i.decision_state='pending')::int AS item_pending,
        count(i.id) FILTER (WHERE i.decision_state<>'pending')::int AS item_processed
        FROM catalog_epc_preview p LEFT JOIN catalog_epc_preview_item i ON i.preview_id=p.id
        ${where} GROUP BY p.id ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows
      const totalParams = state ? [state] : []
      const total = Number((await pool.query(`SELECT count(*)::int AS total FROM catalog_epc_preview p ${where}`, totalParams)).rows[0].total)
      return { items: rows.map((row) => ({
        id: row.id, state: row.state, vin: row.vin, sourceSystem: row.source_system, catalogPath: row.catalog_path,
        summary: row.summary, progress: { total: row.item_total, pending: row.item_pending, processed: row.item_processed },
        version: row.version, createdBy: row.created_by, createdAt: row.created_at,
      })), total, page: safePage, pageSize: safeSize }
    },

    async commit(id, input, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const preview = (await client.query('SELECT * FROM catalog_epc_preview WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!preview) return null
        if (preview.version !== input.expectedVersion) {
          const error = new Error(`预览已更新（当前版本 v${preview.version}），请刷新后重试`)
          error.statusCode = 409
          error.errorCode = 'EPC_PREVIEW_VERSION_CONFLICT'
          throw error
        }
        const itemRows = (await client.query('SELECT * FROM catalog_epc_preview_item WHERE preview_id=$1 FOR UPDATE', [id])).rows
        const byId = new Map(itemRows.map((item) => [item.id, item]))
        for (const decision of input.decisions) {
          const item = byId.get(decision.itemId)
          if (!item) {
            const error = new Error('所选 EPC 记录不属于当前预览')
            error.statusCode = 400
            error.errorCode = 'INVALID_EPC_PREVIEW_DECISION'
            throw error
          }
          if (item.decision_state !== 'pending') {
            const error = new Error(`第 ${item.row_number} 行已经处理，不能重复写入`)
            error.statusCode = 409
            error.errorCode = 'EPC_PREVIEW_ITEM_ALREADY_COMMITTED'
            throw error
          }
          let targetSkuId = null
          const evidenceId = randomUUID()
          const hash = evidenceHash(preview, item)
          if (decision.action === 'create_sku') {
            targetSkuId = randomUUID()
            const skuCode = `SKU-${compactDate()}-${randomUUID().slice(0, 6).toUpperCase()}`
            const vehicle = item.vehicle_context || {}
            const hasFitment = Boolean(vehicle.vehicleLabel && (item.platform_match?.id || vehicle.platformCode))
            await client.query(`INSERT INTO catalog_sku
              (id,sku_code,canonical_name_zh,unit_code,unit_label,lifecycle_status,completeness_score,verification_level,created_by,updated_by)
              VALUES ($1,$2,$3,'piece','件','draft',$4,'unverified',$5,$5)`, [targetSkuId, skuCode, item.original_name, hasFitment ? 80 : 60, actor])
            await client.query(`INSERT INTO catalog_source_evidence
              (id,sku_id,intake_id,source_type,source_system,source_record_id,catalog_path,figure_position,original_name,vin_context,raw_payload,confidence,immutable_hash)
              VALUES ($1,$2,$3,'vin_epc',$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11)`, [evidenceId, targetSkuId, preview.intake_id, preview.source_system, item.source_record_id, preview.catalog_path, item.figure_position, item.original_name, preview.vin, JSON.stringify(item.raw_payload), hash])
            await client.query(`INSERT INTO catalog_part_identifier
              (id,sku_id,identifier_type,raw_value,normalized_value,is_primary,source_evidence_id,verification_status)
              VALUES ($1,$2,'oe',$3,$4,true,$5,'pending')`, [randomUUID(), targetSkuId, item.raw_oe, item.normalized_oe, evidenceId])
            if (hasFitment) {
              const bestVariant = (item.variant_candidates || [])[0]
              await client.query(`INSERT INTO catalog_fitment
                (id,sku_id,vehicle_platform_id,platform_master_id,variant_master_id,vehicle_label,years,year_from,year_to,engine_codes,transmission_codes,market_codes,pr_codes,body_styles,drive_types,position,source_evidence_id,verification_status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending')`, [randomUUID(), targetSkuId, vehicle.platformCode || null, item.platform_match?.id || null, bestVariant?.score >= 50 ? bestVariant.id : null, vehicle.vehicleLabel, vehicle.yearFrom && vehicle.yearTo ? `${vehicle.yearFrom}-${vehicle.yearTo}` : '', vehicle.yearFrom, vehicle.yearTo, vehicle.engineCodes || [], vehicle.transmissionCodes || [], vehicle.marketCodes || [], vehicle.prCodes || [], vehicle.bodyStyles || [], vehicle.driveTypes || [], vehicle.position || '', evidenceId])
            }
            await client.query(`INSERT INTO catalog_change_log (id,sku_id,version,action,summary,snapshot,changed_by)
              VALUES ($1,$2,1,'create_draft',$3::jsonb,$4::jsonb,$5)`, [randomUUID(), targetSkuId, JSON.stringify({ source: 'epc_preview', previewId: id, originalName: item.original_name, oe: item.raw_oe }), JSON.stringify({ sourceSnapshot: item }), actor])
          } else if (decision.action === 'attach_evidence') {
            const allowedTargets = new Set((item.match_candidates || []).map((candidate) => candidate.id))
            if (!allowedTargets.has(decision.targetSkuId)) {
              const error = new Error('目标 SKU 不在当前匹配候选中')
              error.statusCode = 409
              error.errorCode = 'EPC_TARGET_SKU_NOT_MATCHED'
              throw error
            }
            const target = (await client.query('SELECT * FROM catalog_sku WHERE id=$1 FOR UPDATE', [decision.targetSkuId])).rows[0]
            if (!target || target.lifecycle_status === 'discontinued') {
              const error = new Error('目标 SKU 不存在或已停用')
              error.statusCode = 409
              error.errorCode = 'EPC_TARGET_SKU_UNAVAILABLE'
              throw error
            }
            targetSkuId = target.id
            const duplicate = (await client.query('SELECT id FROM catalog_source_evidence WHERE sku_id=$1 AND immutable_hash=$2 LIMIT 1', [targetSkuId, hash])).rows[0]
            if (!duplicate) await client.query(`INSERT INTO catalog_source_evidence
              (id,sku_id,intake_id,source_type,source_system,source_record_id,catalog_path,figure_position,original_name,vin_context,raw_payload,confidence,immutable_hash)
              VALUES ($1,$2,$3,'vin_epc',$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11)`, [evidenceId, targetSkuId, preview.intake_id, preview.source_system, item.source_record_id, preview.catalog_path, item.figure_position, item.original_name, preview.vin, JSON.stringify(item.raw_payload), hash])
            const updated = (await client.query(`UPDATE catalog_sku SET lifecycle_status='draft',verification_level='unverified',updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1 RETURNING version`, [targetSkuId, actor])).rows[0]
            await client.query(`INSERT INTO catalog_change_log (id,sku_id,version,action,summary,snapshot,changed_by)
              VALUES ($1,$2,$3,'attach_epc_evidence',$4::jsonb,$5::jsonb,$6)`, [randomUUID(), targetSkuId, updated.version, JSON.stringify({ previewId: id, sourceRecordId: item.source_record_id, oe: item.raw_oe, manualFieldsPreserved: true }), JSON.stringify({ sourceSnapshot: item }), actor])
          }
          await client.query(`INSERT INTO catalog_epc_publish_decision (id,preview_id,item_id,decision_type,target_sku_id,source_snapshot,write_snapshot,decided_by)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`, [randomUUID(), id, item.id, decision.action, targetSkuId, JSON.stringify(item), JSON.stringify({ resultingSkuId: targetSkuId, manualFieldsPreserved: decision.action === 'attach_evidence' }), actor])
          await client.query('UPDATE catalog_epc_preview_item SET decision_state=$2,resulting_sku_id=$3 WHERE id=$1', [item.id, decision.action === 'create_sku' ? 'created' : decision.action === 'attach_evidence' ? 'attached' : 'skipped', targetSkuId])
        }
        const remaining = Number((await client.query("SELECT count(*)::int AS total FROM catalog_epc_preview_item WHERE preview_id=$1 AND decision_state='pending'", [id])).rows[0].total)
        const nextState = remaining ? 'partial' : 'completed'
        await client.query("UPDATE catalog_epc_preview SET state=$2,version=version+1,updated_at=now() WHERE id=$1", [id, nextState])
        await client.query('UPDATE catalog_intake SET state=$2,version=version+1,updated_at=now() WHERE id=$1', [preview.intake_id, nextState])
        return getPreview(client, id)
      })
    },
  }
}
