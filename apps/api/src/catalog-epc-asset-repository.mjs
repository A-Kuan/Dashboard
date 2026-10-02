import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function assetError(message, statusCode, errorCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.errorCode = errorCode
  return error
}

export function mapCatalogEpcAsset(row, attempts) {
  if (!row) return null
  return {
    id: row.id,
    intakeId: row.intake_id,
    type: row.asset_type,
    sourceUrl: row.source_url,
    sourceRecordId: row.source_record_id,
    figureCode: row.figure_code,
    title: row.title,
    declaredContentType: row.declared_content_type,
    expectedChecksum: row.expected_checksum,
    metadata: row.metadata || {},
    state: row.state,
    storageKey: row.storage_key,
    contentType: row.content_type,
    byteSize: Number(row.byte_size || 0),
    checksumSha256: row.checksum_sha256,
    attempts: Number(row.attempts || 0),
    error: row.last_error_code ? { code: row.last_error_code, message: row.last_error_message } : null,
    contentUrl: row.state === 'stored' ? `/api/v2/catalog/epc-assets/${encodeURIComponent(row.id)}/content` : '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mirroredAt: row.mirrored_at,
    verifiedAt: row.verified_at,
    version: row.version,
    ...(attempts ? { attemptHistory: attempts.map(mapAttempt) } : {}),
  }
}

function mapAttempt(row) {
  return {
    id: row.id, operation: row.operation, state: row.state,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    checksumSha256: row.checksum_sha256, byteSize: Number(row.byte_size || 0),
    createdBy: row.created_by, startedAt: row.started_at, completedAt: row.completed_at,
  }
}

export async function insertCatalogEpcAssets(client, intakeId, assets = [], actor = '系统操作员') {
  for (const asset of assets) {
    await client.query(`INSERT INTO catalog_epc_asset
      (id,intake_id,asset_type,source_url,source_record_id,figure_code,title,declared_content_type,expected_checksum,metadata,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`, [
      randomUUID(), intakeId, asset.type, asset.sourceUrl, asset.sourceRecordId || '', asset.figureCode || '', asset.title || '',
      asset.contentType || '', asset.checksum || '', JSON.stringify(asset.metadata || {}), actor,
    ])
  }
}

export function createCatalogEpcAssetRepository(pool) {
  async function get(id, includeAttempts = false, client = pool) {
    const row = (await client.query('SELECT * FROM catalog_epc_asset WHERE id=$1', [id])).rows[0]
    if (!row) return null
    const attempts = includeAttempts ? (await client.query('SELECT * FROM catalog_epc_asset_attempt WHERE asset_id=$1 ORDER BY started_at DESC,id', [id])).rows : null
    return mapCatalogEpcAsset(row, attempts)
  }

  return {
    get(id, includeAttempts = true) { return get(id, includeAttempts) },

    async list({ intakeId = '', state = '', page = 1, pageSize = 50 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 50))
      const values = []
      const filters = []
      if (intakeId) { values.push(intakeId); filters.push(`intake_id=$${values.length}`) }
      if (state) { values.push(state); filters.push(`state=$${values.length}`) }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*)::int AS total FROM catalog_epc_asset ${where}`, values)).rows[0].total)
      const summaryRows = (await pool.query(`SELECT state,count(*)::int AS count FROM catalog_epc_asset ${intakeId ? 'WHERE intake_id=$1' : ''} GROUP BY state`, intakeId ? [intakeId] : [])).rows
      const summary = { total: 0, pending: 0, mirroring: 0, stored: 0, failed: 0, corrupt: 0 }
      for (const item of summaryRows) { summary[item.state] = Number(item.count); summary.total += Number(item.count) }
      values.push(safeSize, (safePage - 1) * safeSize)
      const rows = (await pool.query(`SELECT * FROM catalog_epc_asset ${where} ORDER BY created_at,id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      return { items: rows.map((row) => mapCatalogEpcAsset(row)), total, summary, page: safePage, pageSize: safeSize }
    },

    async startMirror(id, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const row = (await client.query('SELECT * FROM catalog_epc_asset WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!row) return null
        if (row.state === 'mirroring') throw assetError('资源正在托管，请稍后刷新', 409, 'EPC_ASSET_MIRROR_IN_PROGRESS')
        if (row.state === 'stored') throw assetError('资源已托管，请使用完整性校验', 409, 'EPC_ASSET_ALREADY_STORED')
        const attemptId = randomUUID()
        const updated = (await client.query(`UPDATE catalog_epc_asset SET state='mirroring',attempts=attempts+1,last_error_code='',last_error_message='',updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`, [id])).rows[0]
        await client.query(`INSERT INTO catalog_epc_asset_attempt (id,asset_id,operation,state,created_by) VALUES ($1,$2,'mirror','running',$3)`, [attemptId, id, actor])
        return { asset: mapCatalogEpcAsset(updated), attemptId }
      })
    },

    async finishMirror(id, attemptId, result) {
      return withTransaction(pool, async (client) => {
        const attempt = (await client.query(`UPDATE catalog_epc_asset_attempt SET state='succeeded',checksum_sha256=$3,byte_size=$4,completed_at=now()
          WHERE id=$1 AND asset_id=$2 AND operation='mirror' AND state='running' RETURNING *`, [attemptId, id, result.checksumSha256, result.byteSize])).rows[0]
        if (!attempt) throw assetError('资源托管尝试已结束', 409, 'EPC_ASSET_ATTEMPT_FINISHED')
        const row = (await client.query(`UPDATE catalog_epc_asset SET state='stored',storage_key=$2,content_type=$3,byte_size=$4,checksum_sha256=$5,
          last_error_code='',last_error_message='',mirrored_at=now(),verified_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
        [id, result.storageKey, result.contentType, result.byteSize, result.checksumSha256])).rows[0]
        return mapCatalogEpcAsset(row)
      })
    },

    async failMirror(id, attemptId, errorCode, errorMessage) {
      return withTransaction(pool, async (client) => {
        const attempt = (await client.query(`UPDATE catalog_epc_asset_attempt SET state='failed',error_code=$3,error_message=$4,completed_at=now()
          WHERE id=$1 AND asset_id=$2 AND operation='mirror' AND state='running' RETURNING id`, [attemptId, id, errorCode, errorMessage])).rows[0]
        if (!attempt) return get(id, false, client)
        const row = (await client.query(`UPDATE catalog_epc_asset SET state='failed',last_error_code=$2,last_error_message=$3,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`, [id, errorCode, errorMessage])).rows[0]
        return mapCatalogEpcAsset(row)
      })
    },

    async startVerify(id, actor = '系统操作员') {
      return withTransaction(pool, async (client) => {
        const row = (await client.query('SELECT * FROM catalog_epc_asset WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!row) return null
        if (!row.storage_key) throw assetError('资源尚未托管，无法校验', 409, 'EPC_ASSET_NOT_STORED')
        const running = (await client.query("SELECT id FROM catalog_epc_asset_attempt WHERE asset_id=$1 AND operation='verify' AND state='running' LIMIT 1", [id])).rows[0]
        if (running) throw assetError('资源正在校验，请稍后刷新', 409, 'EPC_ASSET_VERIFY_IN_PROGRESS')
        const attemptId = randomUUID()
        await client.query(`INSERT INTO catalog_epc_asset_attempt (id,asset_id,operation,state,created_by) VALUES ($1,$2,'verify','running',$3)`, [attemptId, id, actor])
        return { asset: mapCatalogEpcAsset(row), attemptId }
      })
    },

    async finishVerify(id, attemptId, result) {
      return withTransaction(pool, async (client) => {
        const attempt = (await client.query(`UPDATE catalog_epc_asset_attempt SET state='succeeded',checksum_sha256=$3,byte_size=$4,completed_at=now()
          WHERE id=$1 AND asset_id=$2 AND operation='verify' AND state='running' RETURNING *`, [attemptId, id, result.checksumSha256, result.byteSize])).rows[0]
        if (!attempt) throw assetError('资源校验尝试已结束', 409, 'EPC_ASSET_ATTEMPT_FINISHED')
        const row = (await client.query(`UPDATE catalog_epc_asset SET state='stored',byte_size=$2,checksum_sha256=$3,last_error_code='',last_error_message='',verified_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`, [id, result.byteSize, result.checksumSha256])).rows[0]
        return mapCatalogEpcAsset(row)
      })
    },

    async failVerify(id, attemptId, errorCode, errorMessage) {
      return withTransaction(pool, async (client) => {
        const attempt = (await client.query(`UPDATE catalog_epc_asset_attempt SET state='failed',error_code=$3,error_message=$4,completed_at=now()
          WHERE id=$1 AND asset_id=$2 AND operation='verify' AND state='running' RETURNING id`, [attemptId, id, errorCode, errorMessage])).rows[0]
        if (!attempt) return get(id, false, client)
        const row = (await client.query(`UPDATE catalog_epc_asset SET state='corrupt',last_error_code=$2,last_error_message=$3,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`, [id, errorCode, errorMessage])).rows[0]
        return mapCatalogEpcAsset(row)
      })
    },
  }
}
