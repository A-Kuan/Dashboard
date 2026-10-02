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

    async list({ state = '', connectorId = '', page = 1, pageSize = 20 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
      const values = []
      const filters = []
      if (state) { values.push(state); filters.push(`state=$${values.length}`) }
      if (connectorId) { values.push(connectorId); filters.push(`connector_id=$${values.length}`) }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*)::int AS total FROM catalog_epc_connector_run ${where}`, values)).rows[0].total)
      values.push(safeSize, (safePage - 1) * safeSize)
      const rows = (await pool.query(`SELECT * FROM catalog_epc_connector_run ${where}
        ORDER BY started_at DESC,id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      return { items: rows.map(mapRun), total, page: safePage, pageSize: safeSize }
    },
  }
}
