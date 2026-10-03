import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const caseStatuses = new Set(['requested', 'approved', 'partially_shipped', 'refund_pending', 'completed', 'rejected', 'cancelled'])
const reasonCodes = new Set(['wrong_part', 'quality_issue', 'damaged', 'excess', 'other'])
const refundMethods = new Set(['bank_transfer', 'cash', 'wechat', 'alipay', 'card', 'other'])

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function money(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function quantity(value) { return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000 }
function problem(errorCode, message, statusCode = 400, details) { return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) }) }
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function generatedNumber(prefix) { return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}` }
function requestKey(value) {
  const result = clean(value)
  if (!result || result.length > 128 || /[\u0000-\u001f\u007f]/.test(result)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return result
}
function requiredQuantity(value, label) {
  const result = quantity(value)
  if (!Number.isFinite(result) || result <= 0) throw problem('INVALID_SUPPLIER_RETURN_QUANTITY', `${label}必须大于 0`)
  return result
}
function expectedVersion(value, current) {
  const expected = Number(value)
  if (!Number.isInteger(expected) || expected <= 0) throw problem('EXPECTED_VERSION_REQUIRED', 'expectedVersion 必须是正整数')
  if (expected !== Number(current)) throw problem('SUPPLIER_RETURN_VERSION_CONFLICT', '供应商退货单已被其他人更新，请刷新后重试', 409, { expectedVersion: expected, currentVersion: Number(current) })
}
function payableStatus(row, creditedAmount = number(row.credited_amount), refundedAmount = number(row.refunded_amount)) {
  if (row.status === 'void') return 'void'
  const adjusted = money(number(row.original_amount) - creditedAmount)
  const netPaid = money(number(row.paid_amount) - refundedAmount)
  if (netPaid > adjusted) return 'refund_pending'
  if (netPaid === adjusted) return 'paid'
  if (netPaid > 0) return 'partial'
  return 'open'
}
function mapCase(row) {
  return {
    id: row.id, returnNo: row.return_no, requestKey: row.source_request_id, purchaseOrderId: row.purchase_order_id,
    purchaseOrderNo: row.purchase_order_no, payableId: row.payable_id, payableNo: row.payable_no,
    supplierPartnerId: row.supplier_partner_id, supplierName: row.supplier_name, status: row.status,
    reasonCode: row.reason_code, description: row.description, requestedCreditAmount: number(row.requested_credit_amount),
    approvedCreditAmount: number(row.approved_credit_amount), creditedAmount: number(row.credited_amount), refundedAmount: number(row.refunded_amount),
    version: row.version, createdById: row.created_by_id, createdByName: row.created_by_name,
    updatedById: row.updated_by_id, updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapItem(row) {
  return {
    id: row.id, purchaseOrderItemId: row.purchase_order_item_id, inventoryLotId: row.inventory_lot_id, lotNo: row.lot_no,
    warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
    description: row.description, oeNumber: row.oe_number, unit: row.unit, requestedQuantity: number(row.requested_quantity),
    approvedQuantity: number(row.approved_quantity), shippedQuantity: number(row.shipped_quantity), unitCost: number(row.unit_cost),
    approvedUnitCredit: number(row.approved_unit_credit), creditedAmount: number(row.credited_amount),
  }
}
function mapShipment(row) { return { id: row.id, shipmentNo: row.shipment_no, requestKey: row.source_request_id, caseId: row.case_id, status: row.status, note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at } }
function mapRefund(row) { return { id: row.id, refundNo: row.refund_no, requestKey: row.source_request_id, caseId: row.case_id, payableId: row.payable_id, amount: number(row.amount), refundMethod: row.refund_method, refundedAt: row.refunded_at, referenceNo: row.reference_no, note: row.note, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at } }
function mapEvent(row) { return { id: row.id, action: row.action, fromStatus: row.from_status, toStatus: row.to_status, actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at } }
async function insertCaseEvent(client, caseId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_supplier_return_event
    (id,case_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), caseId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function insertPayableEvent(client, payableId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_payable_event
    (id,payable_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), payableId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}

export function createBusinessSupplierReturnRepository(pool) {
  async function getCase(id, client = pool) {
    const row = (await client.query(`SELECT c.*,p.order_no purchase_order_no,a.payable_no,
      COALESCE((SELECT sum(i.approved_quantity*i.approved_unit_credit) FROM business_supplier_return_item i WHERE i.case_id=c.id),0) approved_credit_amount
      FROM business_supplier_return_case c JOIN business_purchase_order p ON p.id=c.purchase_order_id JOIN business_payable a ON a.id=c.payable_id
      WHERE c.id=$1 OR c.return_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [items, shipments, refunds, events] = await Promise.all([
      client.query(`SELECT i.*,l.lot_no,w.warehouse_code,w.name warehouse_name FROM business_supplier_return_item i
        JOIN business_inventory_lot l ON l.id=i.inventory_lot_id JOIN business_warehouse w ON w.id=i.warehouse_id WHERE i.case_id=$1 ORDER BY i.id`, [row.id]),
      client.query('SELECT * FROM business_supplier_return_shipment WHERE case_id=$1 ORDER BY created_at,id', [row.id]),
      client.query('SELECT * FROM business_supplier_refund WHERE case_id=$1 ORDER BY created_at,id', [row.id]),
      client.query('SELECT * FROM business_supplier_return_event WHERE case_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
    ])
    return { ...mapCase(row), items: items.rows.map(mapItem), shipments: shipments.rows.map(mapShipment), refunds: refunds.rows.map(mapRefund), events: events.rows.map(mapEvent) }
  }

  return {
    getCase,

    async listCases({ query = '', status = '', supplierPartnerId = '', purchaseOrderId = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const state = clean(status); const currentPage = Math.max(1, Math.trunc(Number(page) || 1)); const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
      if (state && !caseStatuses.has(state)) throw problem('INVALID_SUPPLIER_RETURN_STATUS', '供应商退货状态无效')
      const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(c.return_no ILIKE $${values.length} OR p.order_no ILIKE $${values.length} OR c.supplier_name ILIKE $${values.length} OR c.description ILIKE $${values.length})`) }
      if (state) { values.push(state); where.push(`c.status=$${values.length}`) }
      if (clean(supplierPartnerId)) { values.push(clean(supplierPartnerId)); where.push(`c.supplier_partner_id=$${values.length}`) }
      if (clean(purchaseOrderId)) { values.push(clean(purchaseOrderId)); where.push(`c.purchase_order_id=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = number((await pool.query(`SELECT count(*) FROM business_supplier_return_case c JOIN business_purchase_order p ON p.id=c.purchase_order_id ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT c.*,p.order_no purchase_order_no,a.payable_no,
        COALESCE((SELECT sum(i.approved_quantity*i.approved_unit_credit) FROM business_supplier_return_item i WHERE i.case_id=c.id),0) approved_credit_amount
        FROM business_supplier_return_case c JOIN business_purchase_order p ON p.id=c.purchase_order_id JOIN business_payable a ON a.id=c.payable_id ${clause}
        ORDER BY c.updated_at DESC,c.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summaryRows = (await pool.query('SELECT status,count(*)::int count,COALESCE(sum(credited_amount),0) credited_amount,COALESCE(sum(refunded_amount),0) refunded_amount FROM business_supplier_return_case GROUP BY status')).rows
      return { items: rows.map(mapCase), total, page: currentPage, pageSize: size, summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), creditedAmount: number(item.credited_amount), refundedAmount: number(item.refunded_amount) }])) }
    },

    async createCase(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const orderId = clean(rawInput.purchaseOrderId); const reasonCode = clean(rawInput.reasonCode)
      if (!orderId) throw problem('PURCHASE_ORDER_REQUIRED', '供应商退货必须关联采购订单')
      if (!reasonCodes.has(reasonCode)) throw problem('INVALID_SUPPLIER_RETURN_REASON', '供应商退货原因无效')
      const requested = Array.isArray(rawInput.items) ? rawInput.items : []
      if (!requested.length || requested.length > 100) throw problem('INVALID_SUPPLIER_RETURN_ITEMS', '供应商退货必须包含 1 至 100 条明细')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-supplier-return-create:${key}`])
        const existing = (await client.query('SELECT id,purchase_order_id FROM business_supplier_return_case WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedOrder = (await client.query('SELECT id FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1))', [orderId])).rows[0]
          if (!requestedOrder || requestedOrder.id !== existing.purchase_order_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他供应商退货单', 409)
          return { id: existing.id, created: false }
        }
        const order = (await client.query('SELECT * FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [orderId])).rows[0]
        if (!order) throw problem('PURCHASE_ORDER_NOT_FOUND', '采购订单不存在', 404)
        if (!['partially_received', 'received'].includes(order.status)) throw problem('PURCHASE_ORDER_NOT_RETURNABLE', '采购订单尚未到货，不能创建供应商退货', 409)
        const payable = (await client.query('SELECT * FROM business_payable WHERE purchase_order_id=$1 FOR UPDATE', [order.id])).rows[0]
        if (!payable || payable.status === 'void') throw problem('PAYABLE_NOT_RETURNABLE', '采购应付不存在或已作废', 409)
        const seen = new Set(); const items = []
        for (const draft of requested) {
          const lotId = clean(draft.inventoryLotId)
          if (!lotId || seen.has(lotId)) throw problem('INVALID_SUPPLIER_RETURN_ITEMS', '供应商退货明细无效或重复')
          seen.add(lotId)
          const lot = (await client.query(`SELECT l.*,pi.purchase_order_id FROM business_inventory_lot l JOIN business_purchase_order_item pi ON pi.id=l.purchase_order_item_id
            WHERE l.id=$1 FOR UPDATE OF l`, [lotId])).rows[0]
          if (!lot || lot.purchase_order_id !== order.id) throw problem('INVENTORY_LOT_NOT_FOUND', '库存批次不存在或不属于当前采购单', 404)
          const amount = requiredQuantity(draft.quantity, '申请退货数量')
          const committed = number((await client.query(`SELECT COALESCE(sum(CASE WHEN c.status='requested' THEN i.requested_quantity ELSE i.approved_quantity END),0) quantity FROM business_supplier_return_item i
            JOIN business_supplier_return_case c ON c.id=i.case_id WHERE i.inventory_lot_id=$1 AND c.status NOT IN ('rejected','cancelled')`, [lotId])).rows[0].quantity)
          const available = quantity(number(lot.on_hand_quantity) - number(lot.reserved_quantity) - committed)
          if (amount > available) throw problem('SUPPLIER_RETURN_EXCEEDS_AVAILABLE', '申请退货数量超过该批次未锁定可用量', 409, { inventoryLotId: lotId, availableQuantity: Math.max(0, available) })
          items.push({ ...lot, quantity: amount })
        }
        const id = randomUUID(); const returnNo = generatedNumber('SRT'); const by = actorDetails(actor)
        const requestedCredit = money(items.reduce((sum, item) => sum + item.quantity * number(item.unit_cost), 0))
        await client.query(`INSERT INTO business_supplier_return_case
          (id,return_no,source_request_id,purchase_order_id,payable_id,supplier_partner_id,supplier_name,status,reason_code,description,requested_credit_amount,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11,$12,$11,$12)`, [id, returnNo, key, order.id, payable.id, order.supplier_partner_id, order.supplier_name, reasonCode, clean(rawInput.description), requestedCredit, by.id, by.name])
        for (const item of items) await client.query(`INSERT INTO business_supplier_return_item
          (id,case_id,purchase_order_item_id,inventory_lot_id,warehouse_id,description,oe_number,unit,requested_quantity,unit_cost)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), id, item.purchase_order_item_id, item.id, item.warehouse_id, item.description, item.oe_number, item.unit, item.quantity, item.unit_cost])
        await insertCaseEvent(client, id, 'requested', actor, { toStatus: 'requested', note: rawInput.description, snapshot: { purchaseOrderId: order.id, purchaseOrderNo: order.order_no, payableId: payable.id, requestedCreditAmount: requestedCredit, itemCount: items.length } })
        return { id, created: true }
      })
      return { case: await getCase(result.id), created: result.created }
    },

    async reviewCase(id, rawInput = {}, actor) {
      const decision = clean(rawInput.decision)
      if (!['approve', 'reject'].includes(decision)) throw problem('INVALID_SUPPLIER_RETURN_DECISION', '审核结论必须是 approve 或 reject')
      const caseId = await withTransaction(pool, async (client) => {
        const current = (await client.query('SELECT * FROM business_supplier_return_case WHERE id=$1 OR return_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('SUPPLIER_RETURN_NOT_FOUND', '供应商退货单不存在', 404)
        expectedVersion(rawInput.expectedVersion, current.version)
        if (current.status !== 'requested') throw problem('SUPPLIER_RETURN_NOT_REVIEWABLE', '只有待审核供应商退货单可以审核', 409)
        const by = actorDetails(actor)
        if (by.id === current.created_by_id) throw problem('SUPPLIER_RETURN_SELF_REVIEW_FORBIDDEN', '供应商退货申请人不能审核自己的申请', 403)
        if (decision === 'reject') {
          await client.query("UPDATE business_supplier_return_case SET status='rejected',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [current.id, by.id, by.name])
          await insertCaseEvent(client, current.id, 'rejected', actor, { fromStatus: current.status, toStatus: 'rejected', note: rawInput.note })
          return current.id
        }
        const stored = (await client.query('SELECT * FROM business_supplier_return_item WHERE case_id=$1 ORDER BY id FOR UPDATE', [current.id])).rows
        const overrides = new Map((Array.isArray(rawInput.items) ? rawInput.items : []).map((item) => [clean(item.itemId), item]))
        let approvedCount = 0
        for (const item of stored) {
          const draft = overrides.get(item.id) || {}
          const approvedQuantity = draft.approvedQuantity == null ? number(item.requested_quantity) : quantity(draft.approvedQuantity)
          const unitCredit = draft.approvedUnitCredit == null ? number(item.unit_cost) : money(draft.approvedUnitCredit)
          if (!Number.isFinite(approvedQuantity) || approvedQuantity < 0 || approvedQuantity > number(item.requested_quantity)) throw problem('INVALID_APPROVED_SUPPLIER_RETURN_QUANTITY', '核准退货数量不能超过申请数量')
          if (!Number.isFinite(unitCredit) || unitCredit < 0 || unitCredit > number(item.unit_cost)) throw problem('INVALID_APPROVED_SUPPLIER_CREDIT', '核准冲减单价不能超过原采购成本')
          if (approvedQuantity > 0) approvedCount += 1
          await client.query('UPDATE business_supplier_return_item SET approved_quantity=$2,approved_unit_credit=$3 WHERE id=$1', [item.id, approvedQuantity, unitCredit])
        }
        if (!approvedCount) throw problem('SUPPLIER_RETURN_APPROVAL_EMPTY', '至少核准一条供应商退货明细')
        await client.query("UPDATE business_supplier_return_case SET status='approved',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [current.id, by.id, by.name])
        await insertCaseEvent(client, current.id, 'approved', actor, { fromStatus: current.status, toStatus: 'approved', note: rawInput.note })
        return current.id
      })
      return getCase(caseId)
    },

    async shipReturn(id, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const requested = Array.isArray(rawInput.items) ? rawInput.items : []
      if (!requested.length) throw problem('INVALID_SUPPLIER_RETURN_SHIPMENT_ITEMS', '退回供应商必须包含明细')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-supplier-return-shipment:${key}`])
        const existing = (await client.query('SELECT id,case_id FROM business_supplier_return_shipment WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedCase = (await client.query('SELECT id FROM business_supplier_return_case WHERE id=$1 OR return_no=upper(trim($1))', [id])).rows[0]
          if (!requestedCase || requestedCase.id !== existing.case_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他供应商退货出库', 409)
          return { id: existing.id, caseId: existing.case_id, created: false }
        }
        const current = (await client.query('SELECT * FROM business_supplier_return_case WHERE id=$1 OR return_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('SUPPLIER_RETURN_NOT_FOUND', '供应商退货单不存在', 404)
        expectedVersion(rawInput.expectedVersion, current.version)
        if (!['approved', 'partially_shipped'].includes(current.status)) throw problem('SUPPLIER_RETURN_NOT_SHIPPABLE', '只有已核准或部分出库的供应商退货单可以出库', 409)
        const seen = new Set(); const entries = []
        for (const draft of requested) {
          const itemId = clean(draft.itemId)
          if (!itemId || seen.has(itemId)) throw problem('INVALID_SUPPLIER_RETURN_SHIPMENT_ITEMS', '供应商退货出库明细无效或重复')
          seen.add(itemId)
          const item = (await client.query(`SELECT i.*,l.stock_key,l.on_hand_quantity,l.reserved_quantity FROM business_supplier_return_item i
            JOIN business_inventory_lot l ON l.id=i.inventory_lot_id WHERE i.id=$1 AND i.case_id=$2 FOR UPDATE OF i,l`, [itemId, current.id])).rows[0]
          if (!item) throw problem('SUPPLIER_RETURN_ITEM_NOT_FOUND', '供应商退货明细不存在', 404)
          const amount = requiredQuantity(draft.quantity, '退货出库数量')
          const remaining = quantity(number(item.approved_quantity) - number(item.shipped_quantity))
          if (amount > remaining) throw problem('SUPPLIER_RETURN_SHIPMENT_EXCEEDS_APPROVED', '退货出库数量超过尚未出库的核准数量', 409, { itemId, remainingQuantity: remaining })
          const available = quantity(number(item.on_hand_quantity) - number(item.reserved_quantity))
          if (amount > available) throw problem('SUPPLIER_RETURN_STOCK_UNAVAILABLE', '库存已被占用或不足，不能退回供应商', 409, { itemId, availableQuantity: Math.max(0, available) })
          entries.push({ ...item, quantity: amount, credit: money(amount * number(item.approved_unit_credit)) })
        }
        const shipmentId = randomUUID(); const shipmentNo = generatedNumber('SRS'); const by = actorDetails(actor)
        await client.query(`INSERT INTO business_supplier_return_shipment (id,shipment_no,source_request_id,case_id,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shipmentId, shipmentNo, key, current.id, clean(rawInput.note), by.id, by.name])
        let credit = 0
        for (const entry of entries) {
          await client.query(`INSERT INTO business_supplier_return_shipment_item
            (id,shipment_id,supplier_return_item_id,inventory_lot_id,warehouse_id,quantity,credited_amount)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), shipmentId, entry.id, entry.inventory_lot_id, entry.warehouse_id, entry.quantity, entry.credit])
          await client.query('UPDATE business_supplier_return_item SET shipped_quantity=shipped_quantity+$2,credited_amount=credited_amount+$3 WHERE id=$1', [entry.id, entry.quantity, entry.credit])
          await client.query('UPDATE business_inventory_lot SET on_hand_quantity=on_hand_quantity-$2 WHERE id=$1', [entry.inventory_lot_id, entry.quantity])
          await client.query('UPDATE business_inventory_balance SET on_hand_quantity=on_hand_quantity-$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND stock_key=$2', [entry.warehouse_id, entry.stock_key, entry.quantity])
          await client.query(`INSERT INTO business_inventory_movement
            (id,warehouse_id,stock_key,inventory_lot_id,movement_type,on_hand_delta,reserved_delta,reference_type,reference_id,actor_id,actor_name,note,snapshot)
            VALUES ($1,$2,$3,$4,'supplier_return_out',$5,0,'supplier_return_shipment',$6,$7,$8,$9,$10::jsonb)`, [randomUUID(), entry.warehouse_id, entry.stock_key, entry.inventory_lot_id, -entry.quantity, shipmentId, by.id, by.name, clean(rawInput.note), JSON.stringify({ supplierReturnCaseId: current.id, supplierReturnItemId: entry.id, purchaseOrderId: current.purchase_order_id })])
          credit = money(credit + entry.credit)
        }
        const payable = (await client.query('SELECT * FROM business_payable WHERE id=$1 FOR UPDATE', [current.payable_id])).rows[0]
        if (!payable || payable.status === 'void') throw problem('PAYABLE_NOT_RETURNABLE', '采购应付不存在或已作废', 409)
        const creditedAmount = money(number(payable.credited_amount) + credit)
        if (creditedAmount > number(payable.original_amount)) throw problem('SUPPLIER_RETURN_CREDIT_EXCEEDS_PAYABLE', '供应商退货冲减超过应付原额', 409)
        const nextPayableStatus = payableStatus(payable, creditedAmount, number(payable.refunded_amount))
        await client.query('UPDATE business_payable SET credited_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [payable.id, creditedAmount, nextPayableStatus, by.id, by.name])
        await insertPayableEvent(client, payable.id, 'supplier_return_credit_applied', actor, { fromStatus: payable.status, toStatus: nextPayableStatus, note: rawInput.note, snapshot: { supplierReturnCaseId: current.id, returnShipmentId: shipmentId, creditAmount: credit, creditedAmount } })
        const remainingItems = number((await client.query('SELECT count(*) FROM business_supplier_return_item WHERE case_id=$1 AND approved_quantity>shipped_quantity', [current.id])).rows[0].count)
        const nextStatus = remainingItems ? 'partially_shipped' : nextPayableStatus === 'refund_pending' ? 'refund_pending' : 'completed'
        await client.query('UPDATE business_supplier_return_case SET status=$2,credited_amount=credited_amount+$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [current.id, nextStatus, credit, by.id, by.name])
        await insertCaseEvent(client, current.id, remainingItems ? 'return_partially_shipped' : 'return_shipped', actor, { fromStatus: current.status, toStatus: nextStatus, note: rawInput.note, snapshot: { returnShipmentId: shipmentId, shipmentNo, creditAmount: credit, payableId: payable.id, payableStatus: nextPayableStatus } })
        return { id: shipmentId, caseId: current.id, created: true }
      })
      const supplierReturn = await getCase(result.caseId)
      return { shipment: supplierReturn.shipments.find((item) => item.id === result.id), case: supplierReturn, created: result.created }
    },

    async recordRefund(id, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const amount = money(rawInput.amount); const method = clean(rawInput.refundMethod)
      if (!Number.isFinite(amount) || amount <= 0) throw problem('INVALID_SUPPLIER_REFUND_AMOUNT', '供应商退款金额必须大于 0')
      if (!refundMethods.has(method)) throw problem('INVALID_SUPPLIER_REFUND_METHOD', '供应商退款方式无效')
      const refundedAt = rawInput.refundedAt ? new Date(rawInput.refundedAt) : new Date()
      if (Number.isNaN(refundedAt.getTime())) throw problem('INVALID_SUPPLIER_REFUND_DATE', '供应商退款时间无效')
      if (refundedAt.getTime() > Date.now() + 5 * 60 * 1000) throw problem('SUPPLIER_REFUND_DATE_IN_FUTURE', '供应商退款时间不能晚于当前时间')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-supplier-refund:${key}`])
        const existing = (await client.query('SELECT id,case_id FROM business_supplier_refund WHERE source_request_id=$1', [key])).rows[0]
        if (existing) {
          const requestedCase = (await client.query('SELECT id FROM business_supplier_return_case WHERE id=$1 OR return_no=upper(trim($1))', [id])).rows[0]
          if (!requestedCase || requestedCase.id !== existing.case_id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他供应商退款', 409)
          return { id: existing.id, caseId: existing.case_id, created: false }
        }
        const current = (await client.query('SELECT * FROM business_supplier_return_case WHERE id=$1 OR return_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
        if (!current) throw problem('SUPPLIER_RETURN_NOT_FOUND', '供应商退货单不存在', 404)
        if (current.status !== 'refund_pending') throw problem('SUPPLIER_REFUND_NOT_PENDING', '当前供应商退货单没有待退款金额', 409)
        const payable = (await client.query('SELECT * FROM business_payable WHERE id=$1 FOR UPDATE', [current.payable_id])).rows[0]
        const adjusted = money(number(payable.original_amount) - number(payable.credited_amount)); const netPaid = money(number(payable.paid_amount) - number(payable.refunded_amount))
        const refundable = money(netPaid - adjusted); const caseRemaining = money(number(current.credited_amount) - number(current.refunded_amount))
        if (amount > refundable || amount > caseRemaining) throw problem('SUPPLIER_REFUND_EXCEEDS_PENDING', '供应商退款金额超过待退金额', 409, { refundableAmount: Math.min(refundable, caseRemaining) })
        const refundId = randomUUID(); const refundNo = generatedNumber('SRF'); const by = actorDetails(actor)
        await client.query(`INSERT INTO business_supplier_refund
          (id,refund_no,source_request_id,case_id,payable_id,amount,refund_method,refunded_at,reference_no,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [refundId, refundNo, key, current.id, payable.id, amount, method, refundedAt.toISOString(), clean(rawInput.referenceNo), clean(rawInput.note), by.id, by.name])
        const refundedAmount = money(number(payable.refunded_amount) + amount); const nextPayableStatus = payableStatus(payable, number(payable.credited_amount), refundedAmount)
        await client.query('UPDATE business_payable SET refunded_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [payable.id, refundedAmount, nextPayableStatus, by.id, by.name])
        const caseRefunded = money(number(current.refunded_amount) + amount); const nextStatus = caseRefunded === number(current.credited_amount) ? 'completed' : 'refund_pending'
        await client.query('UPDATE business_supplier_return_case SET refunded_amount=$2,status=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1', [current.id, caseRefunded, nextStatus, by.id, by.name])
        await insertPayableEvent(client, payable.id, 'supplier_refund_recorded', actor, { fromStatus: payable.status, toStatus: nextPayableStatus, note: rawInput.note, snapshot: { supplierReturnCaseId: current.id, refundId, refundNo, amount, refundMethod: method, refundedAmount } })
        await insertCaseEvent(client, current.id, 'supplier_refund_recorded', actor, { fromStatus: current.status, toStatus: nextStatus, note: rawInput.note, snapshot: { refundId, refundNo, amount, refundMethod: method, payableId: payable.id, payableStatus: nextPayableStatus } })
        return { id: refundId, caseId: current.id, created: true }
      })
      const supplierReturn = await getCase(result.caseId)
      return { refund: supplierReturn.refunds.find((item) => item.id === result.id), case: supplierReturn, created: result.created }
    },
  }
}
