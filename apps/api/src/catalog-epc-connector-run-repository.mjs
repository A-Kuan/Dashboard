import { randomUUID } from 'node:crypto'

function mapRun(row) {
  if (!row) return null
  return {
    id: row.id,
    connectorId: row.connector_id,
    state: row.state,
    requestContext: row.request_context || {},
    responseSummary: row.response_summary || {},
    previewId: row.preview_id || '',
    retryOf: row.retry_of || '',
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

export function createCatalogEpcConnectorRunRepository(pool) {
  return {
    async start({ connectorId, requestContext, retryOf = '' }, actor = '系统操作员') {
      const row = (await pool.query(`INSERT INTO catalog_epc_connector_run
        (id,connector_id,request_context,retry_of,created_by)
        VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`, [randomUUID(), connectorId, JSON.stringify(requestContext), retryOf || null, actor])).rows[0]
      return mapRun(row)
    },

    async succeed(id, { previewId, responseSummary }) {
      const row = (await pool.query(`UPDATE catalog_epc_connector_run
        SET state='succeeded',preview_id=$2,response_summary=$3::jsonb,error_code='',error_message='',completed_at=now()
        WHERE id=$1 AND state='running' RETURNING *`, [id, previewId, JSON.stringify(responseSummary || {})])).rows[0]
      return mapRun(row)
    },

    async fail(id, { errorCode, errorMessage }) {
      const row = (await pool.query(`UPDATE catalog_epc_connector_run
        SET state='failed',error_code=$2,error_message=$3,completed_at=now()
        WHERE id=$1 AND state='running' RETURNING *`, [id, errorCode || 'EPC_CONNECTOR_FAILED', errorMessage || '采集失败'])).rows[0]
      return mapRun(row)
    },

    async get(id) {
      return mapRun((await pool.query('SELECT * FROM catalog_epc_connector_run WHERE id=$1', [id])).rows[0])
    },

    async list({ state = '', connectorId = '', query = '', from = '', to = '', page = 1, pageSize = 20 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
      const baseValues = []
      const baseFilters = []
      if (connectorId) { baseValues.push(connectorId); baseFilters.push(`connector_id=$${baseValues.length}`) }
      if (query) {
        baseValues.push(`%${String(query).trim()}%`)
        baseFilters.push(`(connector_id ILIKE $${baseValues.length} OR request_context->>'vin' ILIKE $${baseValues.length} OR request_context->>'catalogPath' ILIKE $${baseValues.length} OR request_context->>'groupCode' ILIKE $${baseValues.length})`)
      }
      if (from) { baseValues.push(from); baseFilters.push(`started_at >= $${baseValues.length}::date`) }
      if (to) { baseValues.push(to); baseFilters.push(`started_at < ($${baseValues.length}::date + interval '1 day')`) }
      const values = [...baseValues]
      const filters = [...baseFilters]
      if (state) { values.push(state); filters.push(`state=$${values.length}`) }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*)::int AS total FROM catalog_epc_connector_run ${where}`, values)).rows[0].total)
      const summaryWhere = baseFilters.length ? `WHERE ${baseFilters.join(' AND ')}` : ''
      const summaryRows = (await pool.query(`SELECT state,count(*)::int AS count FROM catalog_epc_connector_run ${summaryWhere} GROUP BY state`, baseValues)).rows
      const summary = { total: 0, running: 0, succeeded: 0, failed: 0 }
      for (const item of summaryRows) { summary[item.state] = Number(item.count); summary.total += Number(item.count) }
      values.push(safeSize, (safePage - 1) * safeSize)
      const rows = (await pool.query(`SELECT * FROM catalog_epc_connector_run ${where}
        ORDER BY started_at DESC,id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      return { items: rows.map(mapRun), total, summary, page: safePage, pageSize: safeSize }
    },
  }
}
