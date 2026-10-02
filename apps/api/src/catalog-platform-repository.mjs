import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function clean(value) { return String(value || '').trim() }
function code(value) { return clean(value).toUpperCase().replace(/\s+/g, '') }
function values(input) { return [...new Set((Array.isArray(input) ? input : clean(input).split(/[,，、]/)).map((item) => clean(item)).filter(Boolean))] }

function error(message, statusCode = 400, errorCode = 'INVALID_PLATFORM_INPUT', details) {
  return Object.assign(new Error(message), { statusCode, errorCode, ...(details ? { details } : {}) })
}

function mapPlatform(row) {
  return {
    id: row.id, platformCode: row.platform_code, brandCode: row.brand_code, brandLabel: row.brand_label,
    seriesCode: row.series_code, seriesLabel: row.series_label, generationLabel: row.generation_label,
    yearFrom: row.year_from, yearTo: row.year_to, marketCodes: row.market_codes || [], bodyStyles: row.body_styles || [],
    aliases: row.aliases || [], lifecycleStatus: row.lifecycle_status, sourceSystem: row.source_system,
    sourceReference: row.source_reference, notes: row.notes, version: row.version, createdBy: row.created_by,
    updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
    fitmentCount: Number(row.fitment_count || 0), openRiskCount: Number(row.open_risk_count || 0),
  }
}

function normalizePlatform(input, existing = {}) {
  const result = {
    platformCode: code(input?.platformCode ?? existing.platformCode),
    brandCode: code(input?.brandCode ?? existing.brandCode),
    brandLabel: clean(input?.brandLabel ?? existing.brandLabel),
    seriesCode: code(input?.seriesCode ?? existing.seriesCode),
    seriesLabel: clean(input?.seriesLabel ?? existing.seriesLabel),
    generationLabel: clean(input?.generationLabel ?? existing.generationLabel),
    yearFrom: input?.yearFrom === '' || input?.yearFrom == null ? existing.yearFrom ?? null : Number(input.yearFrom),
    yearTo: input?.yearTo === '' || input?.yearTo == null ? existing.yearTo ?? null : Number(input.yearTo),
    marketCodes: values(input?.marketCodes ?? existing.marketCodes ?? []),
    bodyStyles: values(input?.bodyStyles ?? existing.bodyStyles ?? []),
    aliases: values(input?.aliases ?? existing.aliases ?? []).map(code),
    lifecycleStatus: clean(input?.lifecycleStatus ?? existing.lifecycleStatus ?? 'draft'),
    sourceSystem: clean(input?.sourceSystem ?? existing.sourceSystem),
    sourceReference: clean(input?.sourceReference ?? existing.sourceReference),
    notes: clean(input?.notes ?? existing.notes),
  }
  result.aliases = result.aliases.filter((alias) => alias !== result.platformCode)
  if (!result.platformCode || !result.brandLabel || !result.seriesLabel) throw error('平台编码、品牌和车系为必填项')
  if (![result.yearFrom, result.yearTo].every((year) => year == null || (Number.isInteger(year) && year >= 1900 && year <= 2200))) throw error('年款必须是 1900 至 2200 的整数')
  if (result.yearFrom && result.yearTo && result.yearFrom > result.yearTo) throw error('起始年款不能晚于结束年款')
  if (!['draft', 'active', 'retired'].includes(result.lifecycleStatus)) throw error('平台状态无效')
  if (result.lifecycleStatus === 'active' && (!result.yearFrom || !result.yearTo || !result.sourceSystem || !result.sourceReference)) {
    throw error('启用平台前必须补齐年款范围和来源依据', 422, 'PLATFORM_ACTIVATION_BLOCKED')
  }
  return result
}

function rangeOverlaps(left, right) {
  return Number.isInteger(left.year_from) && Number.isInteger(left.year_to) && Number.isInteger(right.year_from) && Number.isInteger(right.year_to)
    && left.year_from <= right.year_to && right.year_from <= left.year_to
}

function normalizedPosition(value) { return clean(value).toLowerCase().replace(/\s+/g, '') }
function scopeSignature(row) {
  return JSON.stringify([row.engine_codes || [], row.market_codes || [], row.pr_codes || [], row.body_styles || [], row.include_conditions || {}, row.exclude_conditions || {}])
}
function platformKey(row) { return row.platform_id || code(row.vehicle_platform_id) }
function samePosition(left, right) {
  const a = normalizedPosition(left.position)
  const b = normalizedPosition(right.position)
  return !a || !b || a === b
}
function conflictKey(type, left, right) {
  return `${type}:${[left.id, right.id].sort().join(':')}`
}
function side(row) {
  return {
    fitmentId: row.id, skuId: row.sku_id, skuCode: row.sku_code, skuName: row.canonical_name_zh || '未命名零件',
    skuVersion: row.sku_version, primaryOe: row.primary_oe || '', vehicleLabel: row.vehicle_label,
    platformCode: row.platform_code || row.vehicle_platform_id || '', years: row.years,
    yearFrom: row.year_from, yearTo: row.year_to, position: row.position, engineCodes: row.engine_codes || [],
    marketCodes: row.market_codes || [], prCodes: row.pr_codes || [], includeConditions: row.include_conditions || {},
    excludeConditions: row.exclude_conditions || {}, verificationStatus: row.verification_status,
  }
}

export function createCatalogPlatformRepository(pool) {
  async function ensureKeysAvailable(client, value, exceptId = '') {
    const keys = [...new Set([value.platformCode, ...value.aliases])]
    const { rows } = await client.query(`SELECT id,platform_code FROM catalog_vehicle_platform
      WHERE ($2='' OR id<>$2) AND (platform_code=ANY($1::text[]) OR aliases && $1::text[]) LIMIT 1`, [keys, exceptId])
    if (rows[0]) throw error(`平台编码或别名已被 ${rows[0].platform_code} 使用`, 409, 'PLATFORM_ALIAS_CONFLICT', { platformId: rows[0].id, platformCode: rows[0].platform_code })
  }

  async function get(id, client = pool) {
    const { rows } = await client.query(`SELECT p.*,
      (SELECT count(*)::int FROM catalog_fitment f WHERE f.platform_master_id=p.id OR upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases)) AS fitment_count,
      (SELECT count(*)::int FROM catalog_fitment f WHERE (f.platform_master_id=p.id OR upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases))
        AND ((f.year_from IS NOT NULL AND p.year_from IS NOT NULL AND f.year_from<p.year_from) OR (f.year_to IS NOT NULL AND p.year_to IS NOT NULL AND f.year_to>p.year_to))) AS open_risk_count
      FROM catalog_vehicle_platform p WHERE p.id=$1 OR p.platform_code=upper(trim($1)) OR upper(trim($1))=ANY(p.aliases) LIMIT 1`, [id])
    if (!rows[0]) return null
    const history = await client.query('SELECT id,version,action,snapshot,changed_by,changed_at FROM catalog_vehicle_platform_change_event WHERE platform_id=$1 ORDER BY version DESC,changed_at DESC', [rows[0].id])
    return { ...mapPlatform(rows[0]), history: history.rows.map((row) => ({ id: row.id, version: row.version, action: row.action, snapshot: row.snapshot, changedBy: row.changed_by, changedAt: row.changed_at })) }
  }

  async function rawConflictRows(client = pool) {
    return (await client.query(`SELECT f.*,s.sku_code,s.canonical_name_zh,s.version AS sku_version,
      p.id AS platform_id,p.platform_code,p.lifecycle_status AS platform_status,p.year_from AS platform_year_from,p.year_to AS platform_year_to,
      (SELECT normalized_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) AS primary_oe
      FROM catalog_fitment f JOIN catalog_sku s ON s.id=f.sku_id AND s.lifecycle_status<>'discontinued'
      LEFT JOIN catalog_vehicle_platform p ON p.id=f.platform_master_id OR upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases)
      ORDER BY f.created_at,f.id`)).rows
  }

  async function detectConflicts(client = pool) {
    const rows = await rawConflictRows(client)
    const resolutions = (await client.query('SELECT * FROM catalog_fitment_scope_resolution WHERE active')).rows
    const resolutionByKey = new Map(resolutions.map((item) => [item.conflict_key, item]))
    const conflicts = []
    for (const row of rows) {
      const platform = row.platform_id ? { id: row.platform_id, platformCode: row.platform_code, status: row.platform_status, yearFrom: row.platform_year_from, yearTo: row.platform_year_to } : null
      if (!platform) conflicts.push({ key: `unrecognized_platform:${row.id}`, type: 'unrecognized_platform', severity: 'blocking', title: '平台编码未纳入主数据', explanation: `${row.vehicle_platform_id || '空编码'} 无法匹配车型平台`, platform: null, left: side(row), right: null, resolution: null })
      else if (platform.status !== 'active') conflicts.push({ key: `inactive_platform:${row.id}:${platform.id}`, type: 'inactive_platform', severity: 'blocking', title: '车型平台尚未启用', explanation: `${platform.platformCode} 当前为${platform.status === 'retired' ? '已停用' : '草稿'}状态`, platform, left: side(row), right: null, resolution: null })
      if (platform && ((row.year_from && platform.yearFrom && row.year_from < platform.yearFrom) || (row.year_to && platform.yearTo && row.year_to > platform.yearTo))) {
        conflicts.push({ key: `year_outside_platform:${row.id}:${platform.id}`, type: 'year_outside_platform', severity: 'blocking', title: '适配年款超出平台边界', explanation: `适配 ${row.year_from || '?'}–${row.year_to || '?'}，平台主数据 ${platform.yearFrom || '?'}–${platform.yearTo || '?'}`, platform, left: side(row), right: null, resolution: null })
      }
      const include = clean(row.include_conditions?.note).toLowerCase()
      const exclude = clean(row.exclude_conditions?.note).toLowerCase()
      if (include && exclude && include === exclude) conflicts.push({ key: `self_condition:${row.id}`, type: 'self_condition', severity: 'blocking', title: '包含与排除条件相同', explanation: '同一条适配同时包含并排除相同条件', platform, left: side(row), right: null, resolution: null })
    }
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i]
      const right = rows[j]
      if (!platformKey(left) || platformKey(left) !== platformKey(right) || !rangeOverlaps(left, right) || !samePosition(left, right)) continue
      let type = ''
      if (left.sku_id === right.sku_id && scopeSignature(left) !== scopeSignature(right)) type = 'overlapping_scope'
      else if (left.sku_id !== right.sku_id && left.primary_oe && left.primary_oe === right.primary_oe) type = 'shared_oe_scope'
      if (!type) continue
      const key = conflictKey(type, left, right)
      const resolution = resolutionByKey.get(key)
      conflicts.push({
        key, type, severity: 'blocking',
        title: type === 'overlapping_scope' ? '同 SKU 适配范围重叠' : '同 OE 在同平台出现多条资料',
        explanation: type === 'overlapping_scope' ? '年款与位置重叠，但发动机、PR 码或条件不一致' : '相同主 OE 在重叠年款与位置下对应不同 SKU',
        platform: left.platform_id ? { id: left.platform_id, platformCode: left.platform_code, status: left.platform_status, yearFrom: left.platform_year_from, yearTo: left.platform_year_to } : null,
        left: side(left), right: side(right),
        resolution: resolution ? { id: resolution.id, resolutionType: resolution.resolution_type, note: resolution.note, resolvedBy: resolution.resolved_by, resolvedAt: resolution.resolved_at } : null,
      })
    }
    return conflicts
  }

  return {
    async list({ query = '', status = '' } = {}) {
      const clauses = []
      const params = []
      if (status) { params.push(status); clauses.push(`p.lifecycle_status=$${params.length}`) }
      if (clean(query)) { params.push(`%${clean(query).toLowerCase()}%`); clauses.push(`lower(concat_ws(' ',p.platform_code,p.brand_label,p.series_label,p.generation_label,array_to_string(p.aliases,' '))) LIKE $${params.length}`) }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const { rows } = await pool.query(`SELECT p.*,
        (SELECT count(*)::int FROM catalog_fitment f WHERE f.platform_master_id=p.id OR upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases)) AS fitment_count,
        (SELECT count(*)::int FROM catalog_fitment f WHERE (f.platform_master_id=p.id OR upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases))
          AND ((f.year_from IS NOT NULL AND p.year_from IS NOT NULL AND f.year_from<p.year_from) OR (f.year_to IS NOT NULL AND p.year_to IS NOT NULL AND f.year_to>p.year_to))) AS open_risk_count
        FROM catalog_vehicle_platform p ${where} ORDER BY CASE p.lifecycle_status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,p.brand_label,p.series_label,p.platform_code`, params)
      const counts = await pool.query('SELECT lifecycle_status,count(*)::int AS count FROM catalog_vehicle_platform GROUP BY lifecycle_status')
      return { items: rows.map(mapPlatform), total: rows.length, statusCounts: Object.fromEntries(counts.rows.map((row) => [row.lifecycle_status, row.count])) }
    },
    get,
    async create(input, actor) {
      const value = normalizePlatform(input)
      return withTransaction(pool, async (client) => {
        const id = randomUUID()
        await client.query("SELECT pg_advisory_xact_lock(hashtext('catalog_vehicle_platform_keys'))")
        await ensureKeysAvailable(client, value)
        let row
        try {
          row = (await client.query(`INSERT INTO catalog_vehicle_platform
            (id,platform_code,brand_code,brand_label,series_code,series_label,generation_label,year_from,year_to,market_codes,body_styles,aliases,lifecycle_status,source_system,source_reference,notes,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *`,
          [id, value.platformCode, value.brandCode, value.brandLabel, value.seriesCode, value.seriesLabel, value.generationLabel,
            value.yearFrom, value.yearTo, value.marketCodes, value.bodyStyles, value.aliases, value.lifecycleStatus,
            value.sourceSystem, value.sourceReference, value.notes, actor])).rows[0]
        } catch (reason) {
          if (reason.code === '23505') throw error('平台编码已存在', 409, 'PLATFORM_CODE_EXISTS')
          throw reason
        }
        await client.query('INSERT INTO catalog_vehicle_platform_change_event (id,platform_id,version,action,snapshot,changed_by) VALUES ($1,$2,1,$3,$4::jsonb,$5)', [randomUUID(), id, 'create', JSON.stringify(mapPlatform(row)), actor])
        await client.query('UPDATE catalog_fitment SET platform_master_id=$1 WHERE platform_master_id IS NULL AND upper(trim(vehicle_platform_id))=ANY($2::text[])', [id, [value.platformCode, ...value.aliases]])
        return get(id, client)
      })
    },
    async update(id, input, actor) {
      const expectedVersion = Number(input?.expectedVersion)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw error('expectedVersion 必须是正整数')
      return withTransaction(pool, async (client) => {
        const locked = (await client.query('SELECT id FROM catalog_vehicle_platform WHERE id=$1 OR platform_code=upper(trim($1)) OR upper(trim($1))=ANY(aliases) LIMIT 1 FOR UPDATE', [id])).rows[0]
        if (!locked) return null
        const current = await get(locked.id, client)
        if (current.version !== expectedVersion) throw error(`平台资料已更新（当前 v${current.version}）`, 409, 'PLATFORM_VERSION_CONFLICT', { currentVersion: current.version })
        const value = normalizePlatform(input, current)
        await client.query("SELECT pg_advisory_xact_lock(hashtext('catalog_vehicle_platform_keys'))")
        await ensureKeysAvailable(client, value, current.id)
        let row
        try {
          row = (await client.query(`UPDATE catalog_vehicle_platform SET platform_code=$2,brand_code=$3,brand_label=$4,series_code=$5,
            series_label=$6,generation_label=$7,year_from=$8,year_to=$9,market_codes=$10,body_styles=$11,aliases=$12,
            lifecycle_status=$13,source_system=$14,source_reference=$15,notes=$16,version=version+1,updated_by=$17,updated_at=now()
            WHERE id=$1 RETURNING *`, [current.id, value.platformCode, value.brandCode, value.brandLabel, value.seriesCode,
            value.seriesLabel, value.generationLabel, value.yearFrom, value.yearTo, value.marketCodes, value.bodyStyles,
            value.aliases, value.lifecycleStatus, value.sourceSystem, value.sourceReference, value.notes, actor])).rows[0]
        } catch (reason) {
          if (reason.code === '23505') throw error('平台编码已存在', 409, 'PLATFORM_CODE_EXISTS')
          throw reason
        }
        await client.query('INSERT INTO catalog_vehicle_platform_change_event (id,platform_id,version,action,snapshot,changed_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), current.id, row.version, 'update', JSON.stringify(mapPlatform(row)), actor])
        await client.query('UPDATE catalog_fitment SET platform_master_id=$1 WHERE upper(trim(vehicle_platform_id))=ANY($2::text[])', [current.id, [value.platformCode, ...value.aliases]])
        return get(current.id, client)
      })
    },
    async conflicts({ state = 'open', query = '', skuId = '' } = {}) {
      const all = await detectConflicts()
      const term = clean(query).toLowerCase()
      const isResolved = (item) => item.resolution && item.resolution.resolutionType !== 'correction_required'
      const items = all.filter((item) => (state === 'resolved' ? isResolved(item) : state === 'open' ? !isResolved(item) : true)
        && (!skuId || item.left.skuId === skuId || item.right?.skuId === skuId)
        && (!term || JSON.stringify(item).toLowerCase().includes(term)))
      return { items, total: items.length, counts: { open: all.filter((item) => !isResolved(item)).length, resolved: all.filter(isResolved).length, blocking: all.filter((item) => !isResolved(item) && item.severity === 'blocking').length } }
    },
    async resolveConflict(input, actor) {
      const key = clean(input?.conflictKey)
      const resolutionType = clean(input?.resolutionType)
      const note = clean(input?.note)
      if (!['accepted_overlap', 'same_application', 'correction_required'].includes(resolutionType)) throw error('请选择有效处理结论')
      if (!note) throw error('请填写冲突处理依据')
      const current = (await detectConflicts()).find((item) => item.key === key && item.right)
      if (!current) throw error('冲突已不存在，请刷新后重试', 409, 'FITMENT_CONFLICT_STALE')
      return withTransaction(pool, async (client) => {
        const ids = [current.left.skuId, current.right.skuId].sort()
        const locked = (await client.query('SELECT id,version FROM catalog_sku WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [ids])).rows
        for (const sku of locked) {
          const expected = Number(sku.id === current.left.skuId ? input.expectedVersionA : input.expectedVersionB)
          if (!Number.isInteger(expected) || sku.version !== expected) throw error(`SKU 资料已更新（当前 v${sku.version}）`, 409, 'CATALOG_VERSION_CONFLICT', { currentVersion: sku.version, skuId: sku.id })
        }
        const snapshot = { ...current, resolution: undefined }
        const result = (await client.query(`INSERT INTO catalog_fitment_scope_resolution
          (id,conflict_key,conflict_type,fitment_id_a,fitment_id_b,sku_id_a,sku_id_b,platform_id,resolution_type,note,conflict_snapshot,resolved_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
          ON CONFLICT (conflict_key) DO UPDATE SET resolution_type=excluded.resolution_type,note=excluded.note,
            conflict_snapshot=excluded.conflict_snapshot,active=true,resolved_by=excluded.resolved_by,resolved_at=now() RETURNING *`,
        [randomUUID(), key, current.type, current.left.fitmentId, current.right.fitmentId, current.left.skuId,
          current.right.skuId, current.platform?.id || null, resolutionType, note, JSON.stringify(snapshot), actor])).rows[0]
        return { id: result.id, conflictKey: result.conflict_key, resolutionType: result.resolution_type, note: result.note, resolvedBy: result.resolved_by, resolvedAt: result.resolved_at }
      })
    },
  }
}
