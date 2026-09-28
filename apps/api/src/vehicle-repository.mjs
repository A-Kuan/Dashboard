import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function mapCandidate(row) {
  return {
    id: row.id, skuId: row.sku_id || null, partNumber: row.part_number || '', role: row.role,
    source: row.source || '', verificationStatus: row.verification_status,
    sku: row.sku_id ? {
      id: row.sku_id, skuCode: row.sku_code, chineseName: row.chinese_name,
      brand: row.sku_brand, primaryOe: row.primary_oe, imageUrl: row.sku_image_url || '',
      lifecycleStatus: row.sku_lifecycle_status,
    } : null,
  }
}

function mapVehicle(row, children = {}) {
  const requirements = (children.requirements || []).map((item) => ({
    id: item.id, category: item.category, itemCode: item.item_code, itemName: item.item_name,
    position: item.position, side: item.side, quantity: Number(item.quantity), partNumber: item.part_number,
    partNumberType: item.part_number_type, fitmentCondition: item.fitment_condition, source: item.source,
    verificationStatus: item.verification_status,
    candidates: (children.candidates || []).filter((candidate) => candidate.requirement_id === item.id).map(mapCandidate),
  }))
  const packages = (children.packages || []).map((item) => ({
    id: item.id, packageCode: item.package_code, name: item.name, intervalText: item.interval_text,
    description: item.description, lifecycleStatus: item.lifecycle_status,
    items: (children.packageItems || []).filter((entry) => entry.package_id === item.id).map((entry) => ({
      requirementId: entry.requirement_id, quantity: Number(entry.quantity),
    })),
  }))
  return {
    id: row.id, vehicleCode: row.vehicle_code, brand: row.brand, series: row.series,
    platform: row.platform, displayName: row.display_name, displacement: row.displacement,
    engineCode: row.engine_code, transmissionCode: row.transmission_code,
    yearStart: row.year_start, yearEnd: row.year_end, market: row.market, bodyType: row.body_type,
    sampleVin: row.sample_vin || '', productionDate: row.production_date, dataSource: row.data_source,
    verificationStatus: row.verification_status, imageUrl: row.image_url || '', sourceEvidence: row.source_evidence,
    lifecycleStatus: row.lifecycle_status, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
    requirementCount: Number(row.requirement_count ?? requirements.length),
    linkedRequirementCount: Number(row.linked_requirement_count ?? requirements.filter((item) => item.candidates.length).length),
    requirements, packages,
    changeHistory: (children.history || []).map((item) => ({
      id: item.id, version: item.version, action: item.action, details: item.details,
      changedBy: item.changed_by, changedAt: item.changed_at,
    })),
  }
}

export function createVehicleRepository(pool) {
  async function children(client, vehicleId) {
    const requirements = await client.query('SELECT * FROM vehicle_part_requirement WHERE vehicle_id=$1 ORDER BY sort_order, created_at', [vehicleId])
    const candidates = await client.query(`SELECT c.*, s.sku_code, s.chinese_name, s.brand AS sku_brand, s.primary_oe,
        s.image_url AS sku_image_url, s.lifecycle_status AS sku_lifecycle_status
        FROM vehicle_part_candidate c LEFT JOIN sku s ON s.id=c.sku_id
        WHERE c.requirement_id IN (SELECT id FROM vehicle_part_requirement WHERE vehicle_id=$1)
        ORDER BY c.sort_order, c.created_at`, [vehicleId])
    const packages = await client.query('SELECT * FROM vehicle_service_package WHERE vehicle_id=$1 ORDER BY sort_order, created_at', [vehicleId])
    const packageItems = await client.query(`SELECT i.* FROM vehicle_service_package_item i
        JOIN vehicle_service_package p ON p.id=i.package_id WHERE p.vehicle_id=$1 ORDER BY i.sort_order`, [vehicleId])
    const history = await client.query('SELECT * FROM vehicle_change_log WHERE vehicle_id=$1 ORDER BY version DESC, changed_at DESC', [vehicleId])
    return { requirements: requirements.rows, candidates: candidates.rows, packages: packages.rows, packageItems: packageItems.rows, history: history.rows }
  }

  async function replaceChildren(client, vehicleId, input) {
    await client.query('DELETE FROM vehicle_service_package WHERE vehicle_id=$1', [vehicleId])
    await client.query('DELETE FROM vehicle_part_requirement WHERE vehicle_id=$1', [vehicleId])
    const requirementIds = new Map()
    for (const requirement of input.requirements) {
      const id = requirement.id || randomUUID()
      requirementIds.set(requirement.id || `index:${requirement.sortOrder}`, id)
      await client.query(`INSERT INTO vehicle_part_requirement
        (id,vehicle_id,category,item_code,item_name,position,side,quantity,part_number,part_number_type,fitment_condition,source,verification_status,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, vehicleId, requirement.category, requirement.itemCode, requirement.itemName, requirement.position,
        requirement.side, requirement.quantity, requirement.partNumber, requirement.partNumberType,
        requirement.fitmentCondition, requirement.source, requirement.verificationStatus, requirement.sortOrder])
      for (const candidate of requirement.candidates) {
        await client.query(`INSERT INTO vehicle_part_candidate
          (id,requirement_id,sku_id,part_number,role,source,verification_status,sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [candidate.id || randomUUID(), id, candidate.skuId, candidate.partNumber, candidate.role,
          candidate.source, candidate.verificationStatus, candidate.sortOrder])
      }
    }
    for (const pack of input.packages) {
      const packageId = pack.id || randomUUID()
      await client.query(`INSERT INTO vehicle_service_package
        (id,vehicle_id,package_code,name,interval_text,description,lifecycle_status,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [packageId, vehicleId, pack.packageCode, pack.name, pack.intervalText, pack.description, pack.lifecycleStatus, pack.sortOrder])
      for (const item of pack.items) {
        const requirementId = requirementIds.get(item.requirementId) || item.requirementId
        if (requirementId) await client.query(`INSERT INTO vehicle_service_package_item
          (package_id,requirement_id,quantity,sort_order) VALUES ($1,$2,$3,$4)`,
        [packageId, requirementId, item.quantity, item.sortOrder])
      }
    }
  }

  async function addHistory(client, vehicleId, version, action, input, actor) {
    await client.query(`INSERT INTO vehicle_change_log (id,vehicle_id,version,action,details,changed_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [randomUUID(), vehicleId, version, action, JSON.stringify({
      vehicleCode: input.vehicleCode, requirementCount: input.requirements.length, packageCount: input.packages.length,
    }), actor])
  }

  return {
    async list(query = '') {
      const term = String(query).trim().toLowerCase()
      const where = term ? `WHERE lower(concat_ws(' ',v.vehicle_code,v.brand,v.series,v.platform,v.display_name,
        v.displacement,v.engine_code,v.transmission_code,v.sample_vin)) LIKE $1 OR EXISTS
        (SELECT 1 FROM vehicle_part_requirement r WHERE r.vehicle_id=v.id AND lower(concat_ws(' ',r.item_name,r.part_number,r.item_code)) LIKE $1)` : ''
      const values = term ? [`%${term}%`] : []
      const { rows } = await pool.query(`SELECT v.*,
        (SELECT count(*)::int FROM vehicle_part_requirement r WHERE r.vehicle_id=v.id) requirement_count,
        (SELECT count(DISTINCT r.id)::int FROM vehicle_part_requirement r JOIN vehicle_part_candidate c ON c.requirement_id=r.id WHERE r.vehicle_id=v.id) linked_requirement_count
        FROM vehicle_variant v ${where} ORDER BY v.updated_at DESC`, values)
      return rows.map((row) => mapVehicle(row))
    },
    async get(id) {
      const { rows } = await pool.query('SELECT * FROM vehicle_variant WHERE id=$1 OR vehicle_code=$1 LIMIT 1', [id])
      if (!rows[0]) return null
      return mapVehicle(rows[0], await children(pool, rows[0].id))
    },
    async codeExists(code, exceptId = null) {
      const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM vehicle_variant WHERE vehicle_code=$1 AND ($2::text IS NULL OR id<>$2)) AS exists', [code, exceptId])
      return rows[0].exists
    },
    async create(input, actor) {
      return withTransaction(pool, async (client) => {
        const id = randomUUID()
        const { rows } = await client.query(`INSERT INTO vehicle_variant
          (id,vehicle_code,brand,series,platform,display_name,displacement,engine_code,transmission_code,year_start,year_end,market,body_type,sample_vin,production_date,data_source,verification_status,image_url,source_evidence,lifecycle_status,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21) RETURNING *`,
        [id,input.vehicleCode,input.brand,input.series,input.platform,input.displayName,input.displacement,input.engineCode,input.transmissionCode,input.yearStart,input.yearEnd,input.market,input.bodyType,input.sampleVin||null,input.productionDate,input.dataSource,input.verificationStatus,input.imageUrl||null,input.sourceEvidence,input.lifecycleStatus,actor])
        await replaceChildren(client, id, input)
        await addHistory(client, id, rows[0].version, '创建车型草稿', input, actor)
        return mapVehicle(rows[0], await children(client, id))
      })
    },
    async update(id, input, actor, action = '保存车型资料') {
      return withTransaction(pool, async (client) => {
        const currentResult = await client.query('SELECT id,version FROM vehicle_variant WHERE id=$1 OR vehicle_code=$1 LIMIT 1 FOR UPDATE', [id])
        const current = currentResult.rows[0]
        if (!current) return null
        if (current.version !== input.version) {
          const error = new Error(`该车型已被其他操作更新（当前版本 v${current.version}），请刷新后再编辑`)
          error.statusCode = 409
          error.errorCode = 'VEHICLE_VERSION_CONFLICT'
          throw error
        }
        const { rows } = await client.query(`UPDATE vehicle_variant SET vehicle_code=$2,brand=$3,series=$4,platform=$5,
          display_name=$6,displacement=$7,engine_code=$8,transmission_code=$9,year_start=$10,year_end=$11,market=$12,
          body_type=$13,sample_vin=$14,production_date=$15,data_source=$16,verification_status=$17,image_url=$18,
          source_evidence=$19,lifecycle_status=$20,updated_by=$21,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
        [current.id,input.vehicleCode,input.brand,input.series,input.platform,input.displayName,input.displacement,input.engineCode,input.transmissionCode,input.yearStart,input.yearEnd,input.market,input.bodyType,input.sampleVin||null,input.productionDate,input.dataSource,input.verificationStatus,input.imageUrl||null,input.sourceEvidence,input.lifecycleStatus,actor])
        await replaceChildren(client, current.id, input)
        await addHistory(client, current.id, rows[0].version, action, input, actor)
        return mapVehicle(rows[0], await children(client, current.id))
      })
    },
    async autoMatch(id, actor = '系统操作员') {
      const inserted = await withTransaction(pool, async (client) => {
        const matches = await client.query(`INSERT INTO vehicle_part_candidate (id,requirement_id,sku_id,part_number,role,source,verification_status,sort_order)
          SELECT concat('candidate-',md5(r.id || ':' || s.id)),r.id,s.id,s.primary_oe,'首选','SKU 主数据','待验证',0
          FROM vehicle_part_requirement r JOIN sku s ON
            regexp_replace(upper(s.primary_oe),'[^A-Z0-9]','','g')=regexp_replace(upper(r.part_number),'[^A-Z0-9]','','g')
            OR EXISTS (SELECT 1 FROM sku_oe_relation oe WHERE oe.sku_id=s.id AND regexp_replace(upper(oe.oe_number),'[^A-Z0-9]','','g')=regexp_replace(upper(r.part_number),'[^A-Z0-9]','','g'))
          WHERE r.vehicle_id=$1 AND r.part_number<>'' ON CONFLICT (requirement_id,sku_id) DO NOTHING RETURNING id`, [id])
        if (!matches.rowCount) return 0
        const updated = await client.query('UPDATE vehicle_variant SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1 RETURNING version', [id, actor])
        await client.query(`INSERT INTO vehicle_change_log (id,vehicle_id,version,action,details,changed_by)
          VALUES ($1,$2,$3,'自动匹配 SKU',$4::jsonb,$5)`, [randomUUID(), id, updated.rows[0].version, JSON.stringify({ matchedCandidateCount: matches.rowCount }), actor])
        return matches.rowCount
      })
      return { ...(await this.get(id)), matchedCandidateCount: inserted }
    },
  }
}
