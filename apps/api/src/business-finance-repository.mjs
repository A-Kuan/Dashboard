import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const receivableStatuses = new Set(['open', 'partial', 'paid', 'void'])
const paymentMethods = new Set(['bank_transfer', 'cash', 'wechat', 'alipay', 'card', 'other'])

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function generatedNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function requestKey(value) {
  const normalized = clean(value)
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return normalized
}
function paymentAmount(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) throw problem('INVALID_PAYMENT_AMOUNT', '收款金额必须大于 0')
  return Math.round(amount * 100) / 100
}
function paymentDate(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) throw problem('INVALID_PAYMENT_DATE', '收款时间无效')
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw problem('PAYMENT_DATE_IN_FUTURE', '收款时间不能晚于当前时间')
  return date.toISOString()
}
function mapReceivable(row) {
  const originalAmount = number(row.original_amount); const paidAmount = number(row.paid_amount)
  return {
    id: row.id, receivableNo: row.receivable_no, salesOrderId: row.sales_order_id, salesOrderNo: row.sales_order_no,
    salesOrderStatus: row.sales_order_status, customerPartnerId: row.customer_partner_id, customerName: row.customer_name,
    status: row.status, currency: row.currency, originalAmount, paidAmount,
    outstandingAmount: Math.round((originalAmount - paidAmount) * 100) / 100, paymentTermsDays: row.payment_terms_days,
    dueAt: row.due_at, overdue: !['paid', 'void'].includes(row.status) && String(row.due_at) < new Date().toISOString().slice(0, 10),
    version: row.version, createdById: row.created_by_id, createdByName: row.created_by_name,
    updatedById: row.updated_by_id, updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapPayment(row) {
  return {
    id: row.id, paymentNo: row.payment_no, requestKey: row.source_request_id, receivableId: row.receivable_id,
    amount: number(row.amount), paymentMethod: row.payment_method, paidAt: row.paid_at, referenceNo: row.reference_no,
    note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at,
  }
}
function mapEvent(row) {
  return { id: row.id, action: row.action, fromStatus: row.from_status, toStatus: row.to_status, actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at }
}
async function insertEvent(client, receivableId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_receivable_event
    (id,receivable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), receivableId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}

export function createBusinessFinanceRepository(pool) {
  async function getReceivable(id, client = pool) {
    const row = (await client.query(`SELECT r.*,s.order_no sales_order_no,s.status sales_order_status
      FROM business_receivable r JOIN business_sales_order s ON s.id=r.sales_order_id
      WHERE r.id=$1 OR r.receivable_no=upper(trim($1)) OR s.id=$1 OR s.order_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [payments, events] = await Promise.all([
      client.query('SELECT * FROM business_payment WHERE receivable_id=$1 ORDER BY paid_at DESC,id DESC', [row.id]),
      client.query('SELECT * FROM business_receivable_event WHERE receivable_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
    ])
    return { ...mapReceivable(row), payments: payments.rows.map(mapPayment), events: events.rows.map(mapEvent) }
  }

  return {
    getReceivable,

    async listReceivables({ query = '', status = '', customerPartnerId = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const state = clean(status); const currentPage = Math.max(1, Math.trunc(Number(page) || 1)); const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
      if (state && !receivableStatuses.has(state)) throw problem('INVALID_RECEIVABLE_STATUS', '应收状态无效')
      const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(r.receivable_no ILIKE $${values.length} OR s.order_no ILIKE $${values.length} OR r.customer_name ILIKE $${values.length})`) }
      if (state) { values.push(state); where.push(`r.status=$${values.length}`) }
      if (clean(customerPartnerId)) { values.push(clean(customerPartnerId)); where.push(`r.customer_partner_id=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = number((await pool.query(`SELECT count(*) FROM business_receivable r JOIN business_sales_order s ON s.id=r.sales_order_id ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT r.*,s.order_no sales_order_no,s.status sales_order_status
        FROM business_receivable r JOIN business_sales_order s ON s.id=r.sales_order_id ${clause}
        ORDER BY CASE WHEN r.status IN ('open','partial') AND r.due_at<current_date THEN 0 WHEN r.status IN ('open','partial') THEN 1 ELSE 2 END,r.due_at,r.updated_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summaryRows = (await pool.query(`SELECT status,count(*)::int count,COALESCE(sum(original_amount),0) original_amount,COALESCE(sum(paid_amount),0) paid_amount,
        COALESCE(sum(original_amount-paid_amount),0) outstanding_amount FROM business_receivable GROUP BY status`)).rows
      const overdue = (await pool.query("SELECT count(*)::int count,COALESCE(sum(original_amount-paid_amount),0) amount FROM business_receivable WHERE status IN ('open','partial') AND due_at<current_date")).rows[0]
      return {
        items: rows.map(mapReceivable), total, page: currentPage, pageSize: size,
        summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), originalAmount: number(item.original_amount), paidAmount: number(item.paid_amount), outstandingAmount: number(item.outstanding_amount) }])),
        overdue: { count: number(overdue.count), amount: number(overdue.amount) },
      }
    },

    async recordPayment(id, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const amount = paymentAmount(rawInput.amount)
      const method = clean(rawInput.paymentMethod)
      if (!paymentMethods.has(method)) throw problem('INVALID_PAYMENT_METHOD', '收款方式无效')
      const paidAt = paymentDate(rawInput.paidAt); const by = actorDetails(actor)
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-payment:${key}`])
        const existing = (await client.query('SELECT id,receivable_id FROM business_payment WHERE source_request_id=$1', [key])).rows[0]
        if (existing) return { paymentId: existing.id, receivableId: existing.receivable_id, created: false }
        const receivable = (await client.query(`SELECT r.*,s.status sales_order_status FROM business_receivable r JOIN business_sales_order s ON s.id=r.sales_order_id
          WHERE r.id=$1 OR r.receivable_no=upper(trim($1)) OR s.id=$1 OR s.order_no=upper(trim($1)) LIMIT 1 FOR UPDATE OF r`, [id])).rows[0]
        if (!receivable) throw problem('RECEIVABLE_NOT_FOUND', '应收单不存在', 404)
        if (receivable.status === 'void' || receivable.sales_order_status === 'cancelled') throw problem('RECEIVABLE_VOID', '已作废应收单不能收款', 409)
        const outstanding = Math.round((number(receivable.original_amount) - number(receivable.paid_amount)) * 100) / 100
        if (amount > outstanding) throw problem('PAYMENT_EXCEEDS_OUTSTANDING', '收款金额不能超过未收金额', 409, { outstandingAmount: outstanding })
        const paidAmount = Math.round((number(receivable.paid_amount) + amount) * 100) / 100
        const nextStatus = paidAmount === number(receivable.original_amount) ? 'paid' : 'partial'
        const paymentId = randomUUID(); const paymentNo = generatedNumber('PAY')
        await client.query(`INSERT INTO business_payment
          (id,payment_no,source_request_id,receivable_id,amount,payment_method,paid_at,reference_no,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [paymentId, paymentNo, key, receivable.id, amount, method, paidAt, clean(rawInput.referenceNo), clean(rawInput.note), by.id, by.name])
        await client.query(`UPDATE business_receivable SET paid_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1`, [receivable.id, paidAmount, nextStatus, by.id, by.name])
        await insertEvent(client, receivable.id, 'payment_recorded', actor, { fromStatus: receivable.status, toStatus: nextStatus, note: rawInput.note, snapshot: { paymentId, paymentNo, amount, paymentMethod: method, paidAt, paidAmount, outstandingAmount: Math.round((number(receivable.original_amount) - paidAmount) * 100) / 100 } })
        return { paymentId, receivableId: receivable.id, created: true }
      })
      const receivable = await getReceivable(result.receivableId)
      return { created: result.created, payment: receivable.payments.find((item) => item.id === result.paymentId), receivable }
    },
  }
}
