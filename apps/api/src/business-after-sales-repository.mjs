import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const caseStatuses = new Set(['requested', 'approved', 'partially_received', 'refund_pending', 'completed', 'rejected', 'cancelled'])
const reasonCodes = new Set(['wrong_part', 'fitment_issue', 'quality_issue', 'damaged', 'customer_changed_mind', 'other'])
const refundMethods = new Set(['bank_transfer', 'cash', 'wechat', 'alipay', 'card', 'other'])

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function roundQuantity(value) { return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000 }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function generatedNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function normalizeRequestKey(value) {
  const normalized = clean(value)
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return normalized
}
function requiredQuantity(value, label = '数量') {
  const result = roundQuantity(value)
  if (!Number.isFinite(result) || result <= 0) throw problem('INVALID_AFTER_SALES_QUANTITY', `${label}必须大于 0`)
  return result
}
function expectedVersion(value, current) {
  const expected = Number(value)
  if (!Number.isInteger(expected) || expected <= 0) throw problem('EXPECTED_VERSION_REQUIRED', 'expectedVersion 必须是正整数')
  if (expected !== Number(current)) throw problem('AFTER_SALES_VERSION_CONFLICT', '售后单已被其他人更新，请刷新后重试', 409, { expectedVersion: expected, currentVersion: Number(current) })
}
function eventRow(row) {
  return { id: row.id, action: row.action, fromStatus: row.from_status, toStatus: row.to_status, actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at }
}
function mapCase(row) {
  return {
    id: row.id, caseNo: row.case_no, requestKey: row.source_request_id, salesOrderId: row.sales_order_id,
    salesOrderNo: row.sales_order_no, customerPartnerId: row.customer_partner_id, customerName: row.customer_name,
    caseType: row.case_type, status: row.status, reasonCode: row.reason_code, description: row.description,
    requestedRefundAmount: number(row.requested_refund_amount), approvedRefundAmount: number(row.approved_refund_amount),
    creditedAmount: number(row.credited_amount), refundedAmount: number(row.refunded_amount), version: row.version,
    createdById: row.created_by_id, createdByName: row.created_by_name, updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapItem(row) {
  return {
    id: row.id, salesOrderItemId: row.sales_order_item_id, shipmentItemId: row.shipment_item_id,
    shipmentId: row.shipment_id, shipmentNo: row.shipment_no, inventoryLotId: row.inventory_lot_id,
    warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
    description: row.description, oeNumber: row.oe_number, unit: row.unit,
    requestedQuantity: number(row.requested_quantity), approvedQuantity: number(row.approved_quantity),
    receivedQuantity: number(row.received_quantity), saleUnitPrice: number(row.sale_unit_price),
    approvedUnitRefund: number(row.approved_unit_refund), creditedAmount: number(row.credited_amount),
  }
}
function mapReturnReceipt(row) {
  return { id: row.id, receiptNo: row.receipt_no, requestKey: row.source_request_id, caseId: row.case_id, status: row.status, note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at }
}
function mapRefund(row) {
  return { id: row.id, refundNo: row.refund_no, requestKey: row.source_request_id, caseId: row.case_id, receivableId: row.receivable_id, amount: number(row.amount), refundMethod: row.refund_method, refundedAt: row.refunded_at, referenceNo: row.reference_no, note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at }
}
function nextReceivableStatus(row, creditedAmount = number(row.credited_amount), refundedAmount = number(row.refunded_amount)) {
  if (row.status === 'void') return 'void'
  const adjusted = roundMoney(number(row.original_amount) - creditedAmount)
  const netPaid = roundMoney(number(row.paid_amount) - refundedAmount)
  if (netPaid > adjusted) return 'refund_pending'
  if (netPaid === adjusted) return 'paid'
  if (netPaid > 0) return 'partial'
  return 'open'
}
async function insertCaseEvent(client, caseId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_after_sales_event
    (id,case_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), caseId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function insertReceivableEvent(client, receivableId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_receivable_event
    (id,receivable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), receivableId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function insertReturnMovement(client, { item, receiptId, caseId, quantity, actor, note }) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_inventory_movement
    (id,warehouse_id,stock_key,inventory_lot_id,movement_type,on_hand_delta,reserved_delta,reference_type,reference_id,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,'return_in',$5,0,'return_receipt',$6,$7,$8,$9,$10::jsonb)`, [
    randomUUID(), item.warehouse_id, item.stock_key, item.inventory_lot_id, quantity, receiptId, by.id, by.name, clean(note),
    JSON.stringify({ afterSalesCaseId: caseId, afterSalesItemId: item.id, salesOrderItemId: item.sales_order_item_id, shipmentItemId: item.shipment_item_id }),
  ])
}

export function createBusinessAfterSalesRepository(pool) {
  async function getCase(id, client = pool) {
    const row = (await client.query(`SELECT c.*,s.order_no sales_order_no,
      COALESCE((SELECT sum(i.approved_quantity*i.approved_unit_refund) FROM business_after_sales_item i WHERE i.case_id=c.id),0) approved_refund_amount
      FROM business_after_sales_case c JOIN business_sales_order s ON s.id=c.sales_order_id
      WHERE c.id=$1 OR c.case_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [items, receipts, refunds, events] = await Promise.all([
      client.query(`SELECT i.*,sh.id shipment_id,sh.shipment_no,w.warehouse_code,w.name warehouse_name
        FROM business_after_sales_item i JOIN business_shipment_item si ON si.id=i.shipment_item_id
        JOIN business_shipment sh ON sh.id=si.shipment_id JOIN business_warehouse w ON w.id=i.warehouse_id
        WHERE i.case_id=$1 ORDER BY i.id`, [row.id]),
      client.query('SELECT * FROM business_return_receipt WHERE case_id=$1 ORDER BY created_at,id', [row.id]),
      client.query('SELECT * FROM business_refund WHERE case_id=$1 ORDER BY created_at,id', [row.id]),
      client.query('SELECT * FROM business_after_sales_event WHERE case_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
    ])
    return { ...mapCase(row), items: items.rows.map(mapItem), returnReceipts: receipts.rows.map(mapReturnReceipt), refunds: refunds.rows.map(mapRefund), events: events.rows.map(eventRow) }
  }

  return {
    getCase,

    async listCases({ query = '', status = '', customerPartnerId = '', salesOrderId = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const state = clean(status); const currentPage = Math.max(1, Math.trunc(Number(page) || 1)); const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
      if (state && !caseStatuses.has(state)) throw problem('INVALID_AFTER_SALES_STATUS', '售后状态无效')
      const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(c.case_no ILIKE $${values.length} OR s.order_no ILIKE $${values.length} OR c.customer_name ILIKE $${values.length} OR c.description ILIKE $${values.length})`) }
      if (state) { values.push(state); where.push(`c.status=$${values.length}`) }
      if (clean(customerPartnerId)) { values.push(clean(customerPartnerId)); where.push(`c.customer_partner_id=$${values.length}`) }
      if (clean(salesOrderId)) { values.push(clean(salesOrderId)); where.push(`c.sales_order_id=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = number((await pool.query(`SELECT count(*) FROM business_after_sales_case c JOIN business_sales_order s ON s.id=c.sales_order_id ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT c.*,s.order_no sales_order_no,
        COALESCE((SELECT sum(i.approved_quantity*i.approved_unit_refund) FROM business_after_sales_item i WHERE i.case_id=c.id),0) approved_refund_amount
        FROM business_after_sales_case c JOIN business_sales_order s ON s.id=c.sales_order_id ${clause}
        ORDER BY c.updated_at DESC,c.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summaryRows = (await pool.query('SELECT status,count(*)::int count,COALESCE(sum(credited_amount),0) credited_amount,COALESCE(sum(refunded_amount),0) refunded_amount FROM business_after_sales_case GROUP BY status')).rows
      return { items: rows.map(mapCase), total, page: currentPage, pageSize: size, summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), creditedAmount: number(item.credited_amount), refundedAmount: number(item.refunded_amount) }])) }
    },

    async createCase(rawInput = {}, actor) {
      const key = normalizeRequestKey(rawInput.requestKey); const salesOrderId = clean(rawInput.salesOrderId)
      const reasonCode = clean(rawInput.reasonCode)
      if (!salesOrderId) throw problem('SALES_ORDER_REQUIRED', '售后单必须关联销售订单')
      if (!reasonCodes.has(reasonCode)) throw problem('INVALID_AFTER_SALES_REASON', '售后原因无效')
      const requested = Array.isArray(rawInput.items) ? rawInput.items : []
      if (!requested.length || requested.length > 100) throw problem('INVALID_AFTER_SALES_ITEMS', '售后单必须包含 1 至 100 条退货明细')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-after-sales-create:${key}`])
        const existing = (await client.query('SELECT id,sales_order_id FROM business_after_sales_case WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedOrder = (await client.query('SELECT id FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1))', [salesOrderId])).rows[0]
          if (!requestedOrder || requestedOrder.id !== existing.sales_order_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他售后单', 409)
          return { id: existing.id, created: false }
        }
        const order = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [salesOrderId])).rows[0]
        if (!order) throw problem('SALES_ORDER_NOT_FOUND', '销售订单不存在', 404)
        if (!['fulfilling', 'completed'].includes(order.status)) throw problem('SALES_ORDER_NOT_RETURNABLE', '销售订单尚未出库，不能创建退货售后', 409)
        const seen = new Set(); const items = []
        for (const draft of requested) {
          const shipmentItemId = clean(draft.shipmentItemId)
          if (!shipmentItemId || seen.has(shipmentItemId)) throw problem('INVALID_AFTER_SALES_ITEMS', '退货明细无效或重复')
          seen.add(shipmentItemId)
          const row = (await client.query(`SELECT si.*,sh.sales_order_id,sh.shipment_no,sh.warehouse_id,soi.description,soi.oe_number,soi.unit,soi.sale_unit_price,l.stock_key
            FROM business_shipment_item si JOIN business_shipment sh ON sh.id=si.shipment_id
            JOIN business_sales_order_item soi ON soi.id=si.sales_order_item_id JOIN business_inventory_lot l ON l.id=si.inventory_lot_id
            WHERE si.id=$1 FOR UPDATE OF si`, [shipmentItemId])).rows[0]
          if (!row || row.sales_order_id !== order.id) throw problem('SHIPMENT_ITEM_NOT_FOUND', '出库明细不存在或不属于当前订单', 404)
          const quantity = requiredQuantity(draft.quantity, '申请退货数量')
          const committed = number((await client.query(`SELECT COALESCE(sum(CASE WHEN c.status='requested' THEN i.requested_quantity ELSE i.approved_quantity END),0) quantity FROM business_after_sales_item i
            JOIN business_after_sales_case c ON c.id=i.case_id WHERE i.shipment_item_id=$1 AND c.status NOT IN ('rejected','cancelled')`, [shipmentItemId])).rows[0].quantity)
          if (roundQuantity(committed + quantity) > number(row.quantity)) throw problem('RETURN_QUANTITY_EXCEEDS_SHIPPED', '申请退货数量超过该出库批次尚可退数量', 409, { shipmentItemId, shippedQuantity: number(row.quantity), committedReturnQuantity: committed })
          items.push({ ...row, quantity })
        }
        const id = randomUUID(); const caseNo = generatedNumber('AS'); const by = actorDetails(actor)
        const requestedRefundAmount = roundMoney(items.reduce((sum, item) => sum + item.quantity * number(item.sale_unit_price), 0))
        await client.query(`INSERT INTO business_after_sales_case
          (id,case_no,source_request_id,sales_order_id,customer_partner_id,customer_name,case_type,status,reason_code,description,requested_refund_amount,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,'return_refund','requested',$7,$8,$9,$10,$11,$10,$11)`, [id, caseNo, key, order.id, order.customer_partner_id, order.customer_name, reasonCode, clean(rawInput.description), requestedRefundAmount, by.id, by.name])
        for (const item of items) await client.query(`INSERT INTO business_after_sales_item
          (id,case_id,sales_order_item_id,shipment_item_id,inventory_lot_id,warehouse_id,description,oe_number,unit,requested_quantity,sale_unit_price)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), id, item.sales_order_item_id, item.id, item.inventory_lot_id, item.warehouse_id, item.description, item.oe_number, item.unit, item.quantity, item.sale_unit_price])
        await insertCaseEvent(client, id, 'requested', actor, { toStatus: 'requested', note: rawInput.description, snapshot: { salesOrderId: order.id, salesOrderNo: order.order_no, requestedRefundAmount, itemCount: items.length } })
        return { id, created: true }
      })
      return { case: await getCase(result.id), created: result.created }
    },

    async reviewCase(id, rawInput = {}, actor) {
      const decision = clean(rawInput.decision)
      if (!['approve', 'reject'].includes(decision)) throw problem('INVALID_AFTER_SALES_DECISION', '审核结论必须是 approve 或 reject')
      const caseId = await withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT * FROM business_after_sales_case WHERE id=$1 OR case_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('AFTER_SALES_NOT_FOUND', '售后单不存在', 404)
        expectedVersion(rawInput.expectedVersion, current.version)
        if (current.status !== 'requested') throw problem('AFTER_SALES_NOT_REVIEWABLE', '只有待审核售后单可以审核', 409)
        const by = actorDetails(actor)
        if (by.id === current.created_by_id) throw problem('AFTER_SALES_SELF_REVIEW_FORBIDDEN', '售后申请人不能审核自己的申请', 403)
        if (decision === 'reject') {
          await client.query("UPDATE business_after_sales_case SET status='rejected',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [current.id, by.id, by.name])
          await insertCaseEvent(client, current.id, 'rejected', actor, { fromStatus: current.status, toStatus: 'rejected', note: rawInput.note })
          return current.id
        }
        const stored = (await client.query('SELECT * FROM business_after_sales_item WHERE case_id=$1 ORDER BY id FOR UPDATE', [current.id])).rows
        const overrides = new Map((Array.isArray(rawInput.items) ? rawInput.items : []).map((item) => [clean(item.itemId), item]))
        let approvedCount = 0
        for (const item of stored) {
          const draft = overrides.get(item.id) || {}
          const quantity = draft.approvedQuantity == null ? number(item.requested_quantity) : roundQuantity(draft.approvedQuantity)
          const unitRefund = draft.approvedUnitRefund == null ? number(item.sale_unit_price) : roundMoney(draft.approvedUnitRefund)
          if (!Number.isFinite(quantity) || quantity < 0 || quantity > number(item.requested_quantity)) throw problem('INVALID_APPROVED_RETURN_QUANTITY', '核准退货数量不能超过申请数量')
          if (!Number.isFinite(unitRefund) || unitRefund < 0 || unitRefund > number(item.sale_unit_price)) throw problem('INVALID_APPROVED_REFUND_PRICE', '核准退款单价不能超过销售单价')
          if (quantity > 0) approvedCount += 1
          await client.query('UPDATE business_after_sales_item SET approved_quantity=$2,approved_unit_refund=$3 WHERE id=$1', [item.id, quantity, unitRefund])
        }
        if (!approvedCount) throw problem('AFTER_SALES_APPROVAL_EMPTY', '至少核准一条退货明细')
        await client.query("UPDATE business_after_sales_case SET status='approved',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [current.id, by.id, by.name])
        await insertCaseEvent(client, current.id, 'approved', actor, { fromStatus: current.status, toStatus: 'approved', note: rawInput.note })
        return current.id
      })
      return getCase(caseId)
    },

    async receiveReturn(id, rawInput = {}, actor) {
      const key = normalizeRequestKey(rawInput.requestKey); const requested = Array.isArray(rawInput.items) ? rawInput.items : []
      if (!requested.length) throw problem('INVALID_RETURN_RECEIPT_ITEMS', '退货入库必须包含明细')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-return-receipt:${key}`])
        const existing = (await client.query('SELECT id,case_id FROM business_return_receipt WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedCase = (await client.query('SELECT id FROM business_after_sales_case WHERE id=$1 OR case_no=upper(trim($1))', [id])).rows[0]
          if (!requestedCase || requestedCase.id !== existing.case_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他退货入库', 409)
          return { id: existing.id, caseId: existing.case_id, created: false }
        }
        const current = (await client.query('SELECT * FROM business_after_sales_case WHERE id=$1 OR case_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('AFTER_SALES_NOT_FOUND', '售后单不存在', 404)
        expectedVersion(rawInput.expectedVersion, current.version)
        if (!['approved', 'partially_received'].includes(current.status)) throw problem('AFTER_SALES_NOT_RECEIVABLE', '只有已核准或部分入库的售后单可以退货入库', 409)
        const seen = new Set(); const entries = []
        for (const draft of requested) {
          const itemId = clean(draft.itemId)
          if (!itemId || seen.has(itemId)) throw problem('INVALID_RETURN_RECEIPT_ITEMS', '退货入库明细无效或重复')
          seen.add(itemId)
          const item = (await client.query(`SELECT i.*,l.stock_key,l.on_hand_quantity,l.reserved_quantity
            FROM business_after_sales_item i JOIN business_inventory_lot l ON l.id=i.inventory_lot_id
            WHERE i.id=$1 AND i.case_id=$2 FOR UPDATE OF i,l`, [itemId, current.id])).rows[0]
          if (!item) throw problem('AFTER_SALES_ITEM_NOT_FOUND', '售后明细不存在', 404)
          const quantity = requiredQuantity(draft.quantity, '退货入库数量')
          const remaining = roundQuantity(number(item.approved_quantity) - number(item.received_quantity))
          if (quantity > remaining) throw problem('RETURN_RECEIPT_EXCEEDS_APPROVED', '退货入库数量超过尚未入库的核准数量', 409, { itemId, remainingQuantity: remaining })
          entries.push({ ...item, quantity, credit: roundMoney(quantity * number(item.approved_unit_refund)) })
        }
        const receiptId = randomUUID(); const receiptNo = generatedNumber('RTN'); const by = actorDetails(actor)
        await client.query(`INSERT INTO business_return_receipt (id,receipt_no,source_request_id,case_id,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [receiptId, receiptNo, key, current.id, clean(rawInput.note), by.id, by.name])
        let credit = 0
        for (const entry of entries) {
          await client.query(`INSERT INTO business_return_receipt_item
            (id,return_receipt_id,after_sales_item_id,inventory_lot_id,warehouse_id,quantity,credited_amount)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), receiptId, entry.id, entry.inventory_lot_id, entry.warehouse_id, entry.quantity, entry.credit])
          await client.query('UPDATE business_after_sales_item SET received_quantity=received_quantity+$2,credited_amount=credited_amount+$3 WHERE id=$1', [entry.id, entry.quantity, entry.credit])
          await client.query('UPDATE business_inventory_lot SET on_hand_quantity=on_hand_quantity+$2 WHERE id=$1', [entry.inventory_lot_id, entry.quantity])
          await client.query('UPDATE business_inventory_balance SET on_hand_quantity=on_hand_quantity+$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND stock_key=$2', [entry.warehouse_id, entry.stock_key, entry.quantity])
          await insertReturnMovement(client, { item: entry, receiptId, caseId: current.id, quantity: entry.quantity, actor, note: rawInput.note })
          credit = roundMoney(credit + entry.credit)
        }
        const receivable = (await client.query('SELECT * FROM business_receivable WHERE sales_order_id=$1 FOR UPDATE', [current.sales_order_id])).rows[0]
        if (!receivable) throw problem('RECEIVABLE_NOT_FOUND', '销售订单应收单不存在', 409)
        if (receivable.status === 'void') throw problem('RECEIVABLE_VOID', '已作废应收单不能处理退货退款', 409)
        const creditedAmount = roundMoney(number(receivable.credited_amount) + credit)
        if (creditedAmount > number(receivable.original_amount)) throw problem('RETURN_CREDIT_EXCEEDS_RECEIVABLE', '退货冲减金额超过应收原额', 409)
        const receivableStatus = nextReceivableStatus(receivable, creditedAmount, number(receivable.refunded_amount))
        await client.query('UPDATE business_receivable SET credited_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [receivable.id, creditedAmount, receivableStatus, by.id, by.name])
        await insertReceivableEvent(client, receivable.id, 'return_credit_applied', actor, { fromStatus: receivable.status, toStatus: receivableStatus, note: rawInput.note, snapshot: { afterSalesCaseId: current.id, returnReceiptId: receiptId, creditAmount: credit, creditedAmount } })
        const remainingItems = number((await client.query('SELECT count(*) FROM business_after_sales_item WHERE case_id=$1 AND approved_quantity>received_quantity', [current.id])).rows[0].count)
        const nextStatus = remainingItems ? 'partially_received' : receivableStatus === 'refund_pending' ? 'refund_pending' : 'completed'
        await client.query('UPDATE business_after_sales_case SET status=$2,credited_amount=credited_amount+$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [current.id, nextStatus, credit, by.id, by.name])
        await insertCaseEvent(client, current.id, remainingItems ? 'return_partially_received' : 'return_received', actor, { fromStatus: current.status, toStatus: nextStatus, note: rawInput.note, snapshot: { returnReceiptId: receiptId, receiptNo, creditAmount: credit, receivableId: receivable.id, receivableStatus } })
        return { id: receiptId, caseId: current.id, created: true }
      })
      const afterSalesCase = await getCase(result.caseId)
      return { returnReceipt: afterSalesCase.returnReceipts.find((item) => item.id === result.id), case: afterSalesCase, created: result.created }
    },

    async recordRefund(id, rawInput = {}, actor) {
      const key = normalizeRequestKey(rawInput.requestKey); const amount = roundMoney(rawInput.amount)
      const method = clean(rawInput.refundMethod)
      if (!Number.isFinite(amount) || amount <= 0) throw problem('INVALID_REFUND_AMOUNT', '退款金额必须大于 0')
      if (!refundMethods.has(method)) throw problem('INVALID_REFUND_METHOD', '退款方式无效')
      const refundedAt = rawInput.refundedAt ? new Date(rawInput.refundedAt) : new Date()
      if (Number.isNaN(refundedAt.getTime())) throw problem('INVALID_REFUND_DATE', '退款时间无效')
      if (refundedAt.getTime() > Date.now() + 5 * 60 * 1000) throw problem('REFUND_DATE_IN_FUTURE', '退款时间不能晚于当前时间')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-refund:${key}`])
        const existing = (await client.query('SELECT id,case_id FROM business_refund WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedCase = (await client.query('SELECT id FROM business_after_sales_case WHERE id=$1 OR case_no=upper(trim($1))', [id])).rows[0]
          if (!requestedCase || requestedCase.id !== existing.case_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他退款', 409)
          return { id: existing.id, caseId: existing.case_id, created: false }
        }
        const current = (await client.query('SELECT * FROM business_after_sales_case WHERE id=$1 OR case_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('AFTER_SALES_NOT_FOUND', '售后单不存在', 404)
        if (current.status !== 'refund_pending') throw problem('AFTER_SALES_REFUND_NOT_PENDING', '当前售后单没有待退金额', 409)
        const receivable = (await client.query('SELECT * FROM business_receivable WHERE sales_order_id=$1 FOR UPDATE', [current.sales_order_id])).rows[0]
        if (!receivable) throw problem('RECEIVABLE_NOT_FOUND', '销售订单应收单不存在', 409)
        const adjustedAmount = roundMoney(number(receivable.original_amount) - number(receivable.credited_amount))
        const netPaid = roundMoney(number(receivable.paid_amount) - number(receivable.refunded_amount))
        const refundableExcess = roundMoney(Math.max(0, netPaid - adjustedAmount))
        const caseRemaining = roundMoney(number(current.credited_amount) - number(current.refunded_amount))
        const maxRefund = Math.min(refundableExcess, caseRemaining)
        if (amount > maxRefund) throw problem('REFUND_EXCEEDS_AVAILABLE', '退款金额超过当前可退金额', 409, { refundableAmount: maxRefund })
        const refundId = randomUUID(); const refundNo = generatedNumber('RFD'); const by = actorDetails(actor)
        await client.query(`INSERT INTO business_refund
          (id,refund_no,source_request_id,case_id,receivable_id,amount,refund_method,refunded_at,reference_no,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [refundId, refundNo, key, current.id, receivable.id, amount, method, refundedAt.toISOString(), clean(rawInput.referenceNo), clean(rawInput.note), by.id, by.name])
        const refundedAmount = roundMoney(number(receivable.refunded_amount) + amount)
        const receivableStatus = nextReceivableStatus(receivable, number(receivable.credited_amount), refundedAmount)
        await client.query('UPDATE business_receivable SET refunded_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [receivable.id, refundedAmount, receivableStatus, by.id, by.name])
        const caseRefunded = roundMoney(number(current.refunded_amount) + amount)
        const nextStatus = receivableStatus === 'refund_pending' ? 'refund_pending' : 'completed'
        await client.query('UPDATE business_after_sales_case SET refunded_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [current.id, caseRefunded, nextStatus, by.id, by.name])
        await insertReceivableEvent(client, receivable.id, 'refund_recorded', actor, { fromStatus: receivable.status, toStatus: receivableStatus, note: rawInput.note, snapshot: { afterSalesCaseId: current.id, refundId, refundNo, amount, refundMethod: method, refundedAmount } })
        await insertCaseEvent(client, current.id, 'refund_recorded', actor, { fromStatus: current.status, toStatus: nextStatus, note: rawInput.note, snapshot: { refundId, refundNo, amount, refundMethod: method, receivableId: receivable.id, receivableStatus } })
        return { id: refundId, caseId: current.id, created: true }
      })
      const afterSalesCase = await getCase(result.caseId)
      return { refund: afterSalesCase.refunds.find((item) => item.id === result.id), case: afterSalesCase, created: result.created }
    },
  }
}
