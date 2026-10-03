import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const receivableStatuses = new Set(['open', 'partial', 'paid', 'refund_pending', 'void'])
const payableStatuses = new Set(['open', 'partial', 'paid', 'refund_pending', 'void'])
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
  const creditedAmount = number(row.credited_amount); const refundedAmount = number(row.refunded_amount)
  const adjustedAmount = Math.round((originalAmount - creditedAmount) * 100) / 100
  const netCollectedAmount = Math.round((paidAmount - refundedAmount) * 100) / 100
  return {
    id: row.id, receivableNo: row.receivable_no, salesOrderId: row.sales_order_id, salesOrderNo: row.sales_order_no,
    salesOrderStatus: row.sales_order_status, customerPartnerId: row.customer_partner_id, customerName: row.customer_name,
    status: row.status, currency: row.currency, originalAmount, creditedAmount, adjustedAmount, paidAmount, refundedAmount, netCollectedAmount,
    outstandingAmount: Math.max(0, Math.round((adjustedAmount - netCollectedAmount) * 100) / 100),
    refundableAmount: Math.max(0, Math.round((netCollectedAmount - adjustedAmount) * 100) / 100), paymentTermsDays: row.payment_terms_days,
    dueAt: row.due_at, overdue: ['open', 'partial'].includes(row.status) && String(row.due_at) < new Date().toISOString().slice(0, 10),
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
function mapPayable(row) {
  const originalAmount = number(row.original_amount); const paidAmount = number(row.paid_amount)
  const creditedAmount = number(row.credited_amount); const refundedAmount = number(row.refunded_amount)
  const adjustedAmount = Math.round((originalAmount - creditedAmount) * 100) / 100
  const netPaidAmount = Math.round((paidAmount - refundedAmount) * 100) / 100
  return {
    id: row.id, payableNo: row.payable_no, purchaseOrderId: row.purchase_order_id, purchaseOrderNo: row.purchase_order_no,
    purchaseOrderStatus: row.purchase_order_status, salesOrderId: row.sales_order_id, salesOrderNo: row.sales_order_no,
    supplierPartnerId: row.supplier_partner_id, supplierName: row.supplier_name, status: row.status, currency: row.currency,
    originalAmount, creditedAmount, adjustedAmount, paidAmount, refundedAmount, netPaidAmount,
    outstandingAmount: Math.max(0, Math.round((adjustedAmount - netPaidAmount) * 100) / 100),
    refundableAmount: Math.max(0, Math.round((netPaidAmount - adjustedAmount) * 100) / 100),
    paymentTermsDays: row.payment_terms_days, dueAt: row.due_at,
    overdue: ['open', 'partial'].includes(row.status) && String(row.due_at) < new Date().toISOString().slice(0, 10),
    version: row.version, createdById: row.created_by_id, createdByName: row.created_by_name,
    updatedById: row.updated_by_id, updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapSupplierPayment(row) {
  return { id: row.id, paymentNo: row.payment_no, requestKey: row.source_request_id, payableId: row.payable_id, amount: number(row.amount), paymentMethod: row.payment_method, paidAt: row.paid_at, referenceNo: row.reference_no, note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at }
}
async function insertEvent(client, receivableId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_receivable_event
    (id,receivable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), receivableId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function insertPayableEvent(client, payableId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_payable_event
    (id,payable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), payableId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
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

  async function getPayable(id, client = pool) {
    const row = (await client.query(`SELECT a.*,p.order_no purchase_order_no,p.status purchase_order_status,s.order_no sales_order_no
      FROM business_payable a JOIN business_purchase_order p ON p.id=a.purchase_order_id JOIN business_sales_order s ON s.id=a.sales_order_id
      WHERE a.id=$1 OR a.payable_no=upper(trim($1)) OR p.id=$1 OR p.order_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [payments, events] = await Promise.all([
      client.query('SELECT * FROM business_supplier_payment WHERE payable_id=$1 ORDER BY paid_at DESC,id DESC', [row.id]),
      client.query('SELECT * FROM business_payable_event WHERE payable_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
    ])
    return { ...mapPayable(row), payments: payments.rows.map(mapSupplierPayment), events: events.rows.map(mapEvent) }
  }

  return {
    getReceivable,
    getPayable,

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
      const summaryRows = (await pool.query(`SELECT status,count(*)::int count,COALESCE(sum(original_amount),0) original_amount,
        COALESCE(sum(credited_amount),0) credited_amount,COALESCE(sum(paid_amount),0) paid_amount,COALESCE(sum(refunded_amount),0) refunded_amount,
        COALESCE(sum(GREATEST((original_amount-credited_amount)-(paid_amount-refunded_amount),0)),0) outstanding_amount
        FROM business_receivable GROUP BY status`)).rows
      const overdue = (await pool.query("SELECT count(*)::int count,COALESCE(sum(GREATEST((original_amount-credited_amount)-(paid_amount-refunded_amount),0)),0) amount FROM business_receivable WHERE status IN ('open','partial') AND due_at<current_date")).rows[0]
      return {
        items: rows.map(mapReceivable), total, page: currentPage, pageSize: size,
        summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), originalAmount: number(item.original_amount), creditedAmount: number(item.credited_amount), paidAmount: number(item.paid_amount), refundedAmount: number(item.refunded_amount), outstandingAmount: number(item.outstanding_amount) }])),
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
        if (receivable.status === 'refund_pending') throw problem('RECEIVABLE_REFUND_PENDING', '应收单存在待退款，不能继续收款', 409)
        const adjustedAmount = Math.round((number(receivable.original_amount) - number(receivable.credited_amount)) * 100) / 100
        const netCollected = Math.round((number(receivable.paid_amount) - number(receivable.refunded_amount)) * 100) / 100
        const outstanding = Math.round((adjustedAmount - netCollected) * 100) / 100
        if (amount > outstanding) throw problem('PAYMENT_EXCEEDS_OUTSTANDING', '收款金额不能超过未收金额', 409, { outstandingAmount: outstanding })
        const paidAmount = Math.round((number(receivable.paid_amount) + amount) * 100) / 100
        const nextNetCollected = Math.round((paidAmount - number(receivable.refunded_amount)) * 100) / 100
        const nextStatus = nextNetCollected === adjustedAmount ? 'paid' : 'partial'
        const paymentId = randomUUID(); const paymentNo = generatedNumber('PAY')
        await client.query(`INSERT INTO business_payment
          (id,payment_no,source_request_id,receivable_id,amount,payment_method,paid_at,reference_no,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [paymentId, paymentNo, key, receivable.id, amount, method, paidAt, clean(rawInput.referenceNo), clean(rawInput.note), by.id, by.name])
        await client.query(`UPDATE business_receivable SET paid_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1`, [receivable.id, paidAmount, nextStatus, by.id, by.name])
        await insertEvent(client, receivable.id, 'payment_recorded', actor, { fromStatus: receivable.status, toStatus: nextStatus, note: rawInput.note, snapshot: { paymentId, paymentNo, amount, paymentMethod: method, paidAt, paidAmount, outstandingAmount: Math.round((adjustedAmount - nextNetCollected) * 100) / 100 } })
        return { paymentId, receivableId: receivable.id, created: true }
      })
      const receivable = await getReceivable(result.receivableId)
      return { created: result.created, payment: receivable.payments.find((item) => item.id === result.paymentId), receivable }
    },

    async listPayables({ query = '', status = '', supplierPartnerId = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const state = clean(status); const currentPage = Math.max(1, Math.trunc(Number(page) || 1)); const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
      if (state && !payableStatuses.has(state)) throw problem('INVALID_PAYABLE_STATUS', '应付状态无效')
      const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(a.payable_no ILIKE $${values.length} OR p.order_no ILIKE $${values.length} OR s.order_no ILIKE $${values.length} OR a.supplier_name ILIKE $${values.length})`) }
      if (state) { values.push(state); where.push(`a.status=$${values.length}`) }
      if (clean(supplierPartnerId)) { values.push(clean(supplierPartnerId)); where.push(`a.supplier_partner_id=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = number((await pool.query(`SELECT count(*) FROM business_payable a JOIN business_purchase_order p ON p.id=a.purchase_order_id JOIN business_sales_order s ON s.id=a.sales_order_id ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT a.*,p.order_no purchase_order_no,p.status purchase_order_status,s.order_no sales_order_no
        FROM business_payable a JOIN business_purchase_order p ON p.id=a.purchase_order_id JOIN business_sales_order s ON s.id=a.sales_order_id ${clause}
        ORDER BY CASE WHEN a.status IN ('open','partial') AND a.due_at<current_date THEN 0 WHEN a.status IN ('open','partial') THEN 1 ELSE 2 END,a.due_at,a.updated_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summaryRows = (await pool.query(`SELECT status,count(*)::int count,COALESCE(sum(original_amount),0) original_amount,COALESCE(sum(credited_amount),0) credited_amount,COALESCE(sum(paid_amount),0) paid_amount,COALESCE(sum(refunded_amount),0) refunded_amount,COALESCE(sum(GREATEST((original_amount-credited_amount)-(paid_amount-refunded_amount),0)),0) outstanding_amount FROM business_payable GROUP BY status`)).rows
      const overdue = (await pool.query("SELECT count(*)::int count,COALESCE(sum(GREATEST((original_amount-credited_amount)-(paid_amount-refunded_amount),0)),0) amount FROM business_payable WHERE status IN ('open','partial') AND due_at<current_date")).rows[0]
      return { items: rows.map(mapPayable), total, page: currentPage, pageSize: size, summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), originalAmount: number(item.original_amount), creditedAmount: number(item.credited_amount), paidAmount: number(item.paid_amount), refundedAmount: number(item.refunded_amount), outstandingAmount: number(item.outstanding_amount) }])), overdue: { count: number(overdue.count), amount: number(overdue.amount) } }
    },

    async recordSupplierPayment(id, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const amount = paymentAmount(rawInput.amount); const method = clean(rawInput.paymentMethod)
      if (!paymentMethods.has(method)) throw problem('INVALID_PAYMENT_METHOD', '付款方式无效')
      const paidAt = paymentDate(rawInput.paidAt); const by = actorDetails(actor)
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-supplier-payment:${key}`])
        const existing = (await client.query('SELECT id,payable_id FROM business_supplier_payment WHERE source_request_id=$1', [key])).rows[0]
        if (existing) return { paymentId: existing.id, payableId: existing.payable_id, created: false }
        const payable = (await client.query(`SELECT a.*,p.status purchase_order_status FROM business_payable a JOIN business_purchase_order p ON p.id=a.purchase_order_id
          WHERE a.id=$1 OR a.payable_no=upper(trim($1)) OR p.id=$1 OR p.order_no=upper(trim($1)) LIMIT 1 FOR UPDATE OF a`, [id])).rows[0]
        if (!payable) throw problem('PAYABLE_NOT_FOUND', '应付单不存在', 404)
        if (payable.status === 'void' || payable.purchase_order_status === 'cancelled') throw problem('PAYABLE_VOID', '已作废应付单不能付款', 409)
        if (payable.status === 'refund_pending') throw problem('PAYABLE_REFUND_PENDING', '应付单存在待收供应商退款，不能继续付款', 409)
        if (!['confirmed', 'partially_received', 'received'].includes(payable.purchase_order_status)) throw problem('PURCHASE_ORDER_NOT_PAYABLE', '采购单确认后才能登记付款', 409)
        const adjustedAmount = Math.round((number(payable.original_amount) - number(payable.credited_amount)) * 100) / 100
        const netPaid = Math.round((number(payable.paid_amount) - number(payable.refunded_amount)) * 100) / 100
        const outstanding = Math.round((adjustedAmount - netPaid) * 100) / 100
        if (amount > outstanding) throw problem('SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING', '付款金额不能超过未付金额', 409, { outstandingAmount: outstanding })
        const paidAmount = Math.round((number(payable.paid_amount) + amount) * 100) / 100; const nextNetPaid = Math.round((paidAmount - number(payable.refunded_amount)) * 100) / 100; const nextStatus = nextNetPaid === adjustedAmount ? 'paid' : 'partial'
        const paymentId = randomUUID(); const paymentNo = generatedNumber('SPAY')
        await client.query(`INSERT INTO business_supplier_payment
          (id,payment_no,source_request_id,payable_id,amount,payment_method,paid_at,reference_no,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [paymentId, paymentNo, key, payable.id, amount, method, paidAt, clean(rawInput.referenceNo), clean(rawInput.note), by.id, by.name])
        await client.query('UPDATE business_payable SET paid_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [payable.id, paidAmount, nextStatus, by.id, by.name])
        await insertPayableEvent(client, payable.id, 'supplier_payment_recorded', actor, { fromStatus: payable.status, toStatus: nextStatus, note: rawInput.note, snapshot: { paymentId, paymentNo, amount, paymentMethod: method, paidAt, paidAmount, outstandingAmount: Math.round((adjustedAmount - nextNetPaid) * 100) / 100 } })
        return { paymentId, payableId: payable.id, created: true }
      })
      const payable = await getPayable(result.payableId)
      return { created: result.created, payment: payable.payments.find((item) => item.id === result.paymentId), payable }
    },
  }
}
