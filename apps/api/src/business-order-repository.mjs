import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const salesStatuses = new Set(['draft', 'confirmed', 'fulfilling', 'completed', 'cancelled'])
const purchaseStatuses = new Set(['draft', 'submitted', 'confirmed', 'partially_received', 'received', 'cancelled'])
const salesTransitions = {
  draft: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['fulfilling', 'cancelled']),
  fulfilling: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
}
const purchaseTransitions = {
  draft: new Set(['submitted', 'cancelled']),
  submitted: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['cancelled']),
  partially_received: new Set(),
  received: new Set(),
  cancelled: new Set(),
}

function clean(value) { return String(value ?? '').trim() }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function generatedNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function number(value) { return Number(value || 0) }
function expectedVersion(value, current, errorCode, label) {
  const version = Number(value)
  if (!Number.isInteger(version) || version !== current) throw problem(errorCode, `${label}已被其他操作更新，请刷新后重试`, 409, { currentVersion: current })
}
function quantity(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) throw problem('INVALID_RECEIVED_QUANTITY', '本次到货数量必须大于 0')
  return Math.round(normalized * 1000) / 1000
}
function futureDate(days) {
  if (!Number.isInteger(days) || days < 0) return null
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function mapSalesOrder(row) {
  return {
    id: row.id, orderNo: row.order_no, inquiryId: row.inquiry_id, quoteId: row.quote_id,
    customerPartnerId: row.customer_partner_id, customerName: row.customer_name, contactName: row.contact_name,
    contactPhone: row.contact_phone, customerVehicleId: row.customer_vehicle_id, vehicleLabel: row.vehicle_label,
    vin: row.vin, status: row.status, currency: row.currency, subtotal: number(row.subtotal),
    discountAmount: number(row.discount_amount), freightAmount: number(row.freight_amount), totalAmount: number(row.total_amount),
    notes: row.notes, version: row.version, createdById: row.created_by_id, createdByName: row.created_by_name,
    updatedById: row.updated_by_id, updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    itemCount: number(row.item_count), purchaseOrderCount: number(row.purchase_order_count), receivedPurchaseOrderCount: number(row.received_purchase_order_count),
  }
}
function mapSalesItem(row) {
  return {
    id: row.id, salesOrderId: row.sales_order_id, quoteItemId: row.quote_item_id, inquiryItemId: row.inquiry_item_id,
    catalogSkuId: row.catalog_sku_id, fulfillmentSource: row.fulfillment_source, lineNo: row.line_no, description: row.description, oeNumber: row.oe_number,
    quantity: number(row.quantity), unit: row.unit, saleUnitPrice: number(row.sale_unit_price), lineTotal: number(row.line_total),
  }
}
function mapPurchaseOrder(row) {
  return {
    id: row.id, orderNo: row.order_no, inquiryId: row.inquiry_id, salesOrderId: row.sales_order_id,
    salesOrderNo: row.sales_order_no, supplierPartnerId: row.supplier_partner_id, supplierName: row.supplier_name,
    status: row.status, currency: row.currency, subtotal: number(row.subtotal), freightAmount: number(row.freight_amount),
    totalAmount: number(row.total_amount), expectedAt: row.expected_at, notes: row.notes, version: row.version,
    createdById: row.created_by_id, createdByName: row.created_by_name, updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    itemCount: number(row.item_count), receivedItemCount: number(row.received_item_count),
  }
}
function mapPurchaseItem(row) {
  const ordered = number(row.quantity); const received = number(row.received_quantity)
  return {
    id: row.id, purchaseOrderId: row.purchase_order_id, inquiryItemId: row.inquiry_item_id,
    supplierOfferId: row.supplier_offer_id, catalogSkuId: row.catalog_sku_id, lineNo: row.line_no,
    description: row.description, oeNumber: row.oe_number, quantity: ordered, unit: row.unit,
    costUnitPrice: number(row.cost_unit_price), lineTotal: number(row.line_total), receivedQuantity: received,
    remainingQuantity: Math.round((ordered - received) * 1000) / 1000,
  }
}
function mapEvent(row) {
  return {
    id: row.id, orderType: row.order_type, salesOrderId: row.sales_order_id, purchaseOrderId: row.purchase_order_id,
    action: row.action, fromStatus: row.from_status, toStatus: row.to_status, actorId: row.actor_id,
    actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at,
  }
}

async function insertEvent(client, orderType, orderId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_order_event
    (id,order_type,sales_order_id,purchase_order_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
    randomUUID(), orderType, orderType === 'sales' ? orderId : null, orderType === 'purchase' ? orderId : null,
    action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot),
  ])
}

export function createBusinessOrderRepository(pool) {
  async function getSalesOrder(id, client = pool) {
    const row = (await client.query(`SELECT so.*,
      (SELECT count(*)::int FROM business_sales_order_item x WHERE x.sales_order_id=so.id) item_count,
      (SELECT count(*)::int FROM business_purchase_order x WHERE x.sales_order_id=so.id) purchase_order_count,
      (SELECT count(*)::int FROM business_purchase_order x WHERE x.sales_order_id=so.id AND x.status='received') received_purchase_order_count
      FROM business_sales_order so WHERE so.id=$1 OR so.order_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [items, purchaseOrders, events] = await Promise.all([
      client.query('SELECT * FROM business_sales_order_item WHERE sales_order_id=$1 ORDER BY line_no', [row.id]),
      client.query(`SELECT po.*,so.order_no sales_order_no,
        (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id) item_count,
        (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id AND x.received_quantity=x.quantity) received_item_count
        FROM business_purchase_order po JOIN business_sales_order so ON so.id=po.sales_order_id WHERE po.sales_order_id=$1 ORDER BY po.created_at,po.id`, [row.id]),
      client.query("SELECT * FROM business_order_event WHERE sales_order_id=$1 ORDER BY created_at DESC,id DESC", [row.id]),
    ])
    return { ...mapSalesOrder(row), items: items.rows.map(mapSalesItem), purchaseOrders: purchaseOrders.rows.map(mapPurchaseOrder), events: events.rows.map(mapEvent) }
  }

  async function getPurchaseOrder(id, client = pool) {
    const row = (await client.query(`SELECT po.*,so.order_no sales_order_no,
      (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id) item_count,
      (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id AND x.received_quantity=x.quantity) received_item_count
      FROM business_purchase_order po JOIN business_sales_order so ON so.id=po.sales_order_id
      WHERE po.id=$1 OR po.order_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [items, events] = await Promise.all([
      client.query('SELECT * FROM business_purchase_order_item WHERE purchase_order_id=$1 ORDER BY line_no', [row.id]),
      client.query("SELECT * FROM business_order_event WHERE purchase_order_id=$1 ORDER BY created_at DESC,id DESC", [row.id]),
    ])
    return { ...mapPurchaseOrder(row), items: items.rows.map(mapPurchaseItem), events: events.rows.map(mapEvent) }
  }

  async function listSalesOrders({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
    const q = clean(query); const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(100, Math.max(1, Number(pageSize) || 30))
    if (status && !salesStatuses.has(status)) throw problem('INVALID_SALES_ORDER_STATUS', '销售订单状态无效')
    const where = []; const values = []
    if (q) { values.push(`%${q}%`); where.push(`(so.order_no ILIKE $${values.length} OR so.customer_name ILIKE $${values.length} OR so.vehicle_label ILIKE $${values.length} OR so.vin ILIKE $${values.length} OR EXISTS (SELECT 1 FROM business_sales_order_item x WHERE x.sales_order_id=so.id AND (x.description ILIKE $${values.length} OR x.oe_number ILIKE $${values.length})))`) }
    if (status) { values.push(status); where.push(`so.status=$${values.length}`) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = number((await pool.query(`SELECT count(*) FROM business_sales_order so ${clause}`, values)).rows[0].count)
    values.push(size, (currentPage - 1) * size)
    const rows = (await pool.query(`SELECT so.*,
      (SELECT count(*)::int FROM business_sales_order_item x WHERE x.sales_order_id=so.id) item_count,
      (SELECT count(*)::int FROM business_purchase_order x WHERE x.sales_order_id=so.id) purchase_order_count,
      (SELECT count(*)::int FROM business_purchase_order x WHERE x.sales_order_id=so.id AND x.status='received') received_purchase_order_count
      FROM business_sales_order so ${clause} ORDER BY so.updated_at DESC,so.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
    const summaryRows = (await pool.query('SELECT status,count(*)::int count,COALESCE(sum(total_amount),0)::numeric amount FROM business_sales_order GROUP BY status')).rows
    return { items: rows.map(mapSalesOrder), total, page: currentPage, pageSize: size, summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), amount: number(item.amount) }])) }
  }

  async function listPurchaseOrders({ query = '', status = '', supplierPartnerId = '', page = 1, pageSize = 30 } = {}) {
    const q = clean(query); const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(100, Math.max(1, Number(pageSize) || 30))
    if (status && !purchaseStatuses.has(status)) throw problem('INVALID_PURCHASE_ORDER_STATUS', '采购订单状态无效')
    const where = []; const values = []
    if (q) { values.push(`%${q}%`); where.push(`(po.order_no ILIKE $${values.length} OR po.supplier_name ILIKE $${values.length} OR so.order_no ILIKE $${values.length} OR EXISTS (SELECT 1 FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id AND (x.description ILIKE $${values.length} OR x.oe_number ILIKE $${values.length})))`) }
    if (status) { values.push(status); where.push(`po.status=$${values.length}`) }
    if (clean(supplierPartnerId)) { values.push(clean(supplierPartnerId)); where.push(`po.supplier_partner_id=$${values.length}`) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = number((await pool.query(`SELECT count(*) FROM business_purchase_order po JOIN business_sales_order so ON so.id=po.sales_order_id ${clause}`, values)).rows[0].count)
    values.push(size, (currentPage - 1) * size)
    const rows = (await pool.query(`SELECT po.*,so.order_no sales_order_no,
      (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id) item_count,
      (SELECT count(*)::int FROM business_purchase_order_item x WHERE x.purchase_order_id=po.id AND x.received_quantity=x.quantity) received_item_count
      FROM business_purchase_order po JOIN business_sales_order so ON so.id=po.sales_order_id ${clause}
      ORDER BY po.updated_at DESC,po.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
    const summaryRows = (await pool.query('SELECT status,count(*)::int count,COALESCE(sum(total_amount),0)::numeric amount FROM business_purchase_order GROUP BY status')).rows
    return { items: rows.map(mapPurchaseOrder), total, page: currentPage, pageSize: size, summary: Object.fromEntries(summaryRows.map((item) => [item.status, { count: number(item.count), amount: number(item.amount) }])) }
  }

  async function convertInquiry(inquiryId, actor) {
    const by = actorDetails(actor)
    const result = await withTransaction(pool, async (client) => {
      const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 OR inquiry_no=upper(trim($1)) FOR UPDATE', [inquiryId])).rows[0]
      if (!inquiry) throw problem('INQUIRY_NOT_FOUND', '询价不存在', 404)
      const existing = (await client.query('SELECT id FROM business_sales_order WHERE inquiry_id=$1', [inquiry.id])).rows[0]
      if (existing) {
        const purchaseOrderIds = (await client.query('SELECT id FROM business_purchase_order WHERE sales_order_id=$1 ORDER BY created_at,id', [existing.id])).rows.map((row) => row.id)
        return { salesOrderId: existing.id, purchaseOrderIds, created: false }
      }
      if (inquiry.status !== 'won') throw problem('INQUIRY_NOT_WON', '只有已成交的询价可以转为订单', 409)
      const quote = (await client.query("SELECT * FROM business_quote WHERE inquiry_id=$1 AND state='accepted' ORDER BY sent_at DESC NULLS LAST,created_at DESC LIMIT 1 FOR UPDATE", [inquiry.id])).rows[0]
      if (!quote) throw problem('ACCEPTED_QUOTE_NOT_FOUND', '未找到客户已接受的报价单', 409)
      const quoteItems = (await client.query(`SELECT qi.*,ii.catalog_sku_id,offer.supplier_name,offer.supplier_partner_id,offer.unit_price offer_unit_price,
        offer.freight_amount offer_freight_amount,offer.lead_time_days
        FROM business_quote_item qi
        JOIN business_inquiry_item ii ON ii.id=qi.inquiry_item_id
        LEFT JOIN business_supplier_offer offer ON offer.id=qi.supplier_offer_id
        WHERE qi.quote_id=$1 ORDER BY qi.line_no`, [quote.id])).rows
      if (!quoteItems.length) throw problem('QUOTE_ITEMS_NOT_FOUND', '成交报价单没有明细，无法生成订单', 409)
      const missingSource = quoteItems.find((item) => item.fulfillment_source === 'purchase' && (!item.supplier_offer_id || !item.supplier_name))
      if (missingSource) throw problem('ORDER_SUPPLIER_SOURCE_REQUIRED', `报价第 ${missingSource.line_no} 项未关联有效供应商报价，无法生成采购单`, 409, { lineNo: missingSource.line_no })

      const salesOrderId = randomUUID(); const salesOrderNo = generatedNumber('SO')
      await client.query(`INSERT INTO business_sales_order
        (id,order_no,inquiry_id,quote_id,customer_partner_id,customer_name,contact_name,contact_phone,customer_vehicle_id,vehicle_label,vin,status,currency,subtotal,discount_amount,freight_amount,total_amount,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15,$16,$17,$18,$19,$18,$19)`, [
        salesOrderId, salesOrderNo, inquiry.id, quote.id, inquiry.customer_partner_id, inquiry.customer_name, inquiry.contact_name,
        inquiry.contact_phone, inquiry.customer_vehicle_id, inquiry.vehicle_label, inquiry.vin, quote.currency, quote.subtotal,
        quote.discount_amount, quote.freight_amount, quote.total_amount, quote.note, by.id, by.name,
      ])
      for (const item of quoteItems) await client.query(`INSERT INTO business_sales_order_item
        (id,sales_order_id,quote_item_id,inquiry_item_id,catalog_sku_id,fulfillment_source,line_no,description,oe_number,quantity,unit,sale_unit_price,line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
        randomUUID(), salesOrderId, item.id, item.inquiry_item_id, item.catalog_sku_id, item.fulfillment_source, item.line_no, item.description,
        item.oe_number, item.quantity, item.unit, item.sale_unit_price, item.line_total,
      ])

      const groups = new Map()
      for (const item of quoteItems.filter((entry) => entry.fulfillment_source === 'purchase')) {
        const key = item.supplier_partner_id || `name:${item.supplier_name}`
        if (!groups.has(key)) groups.set(key, { supplierPartnerId: item.supplier_partner_id, supplierName: item.supplier_name, items: [] })
        groups.get(key).items.push(item)
      }
      const purchaseOrderIds = []
      for (const group of groups.values()) {
        const purchaseOrderId = randomUUID(); const purchaseOrderNo = generatedNumber('PO')
        const subtotal = Math.round(group.items.reduce((sum, item) => sum + number(item.quantity) * number(item.offer_unit_price), 0) * 100) / 100
        const freightAmount = Math.round(group.items.reduce((sum, item) => sum + number(item.offer_freight_amount), 0) * 100) / 100
        const leadTimes = group.items.map((item) => item.lead_time_days).filter((value) => Number.isInteger(value))
        const expectedAt = leadTimes.length ? futureDate(Math.max(...leadTimes)) : null
        await client.query(`INSERT INTO business_purchase_order
          (id,order_no,inquiry_id,sales_order_id,supplier_partner_id,supplier_name,status,currency,subtotal,freight_amount,total_amount,expected_at,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$13,$14)`, [
          purchaseOrderId, purchaseOrderNo, inquiry.id, salesOrderId, group.supplierPartnerId, group.supplierName,
          quote.currency, subtotal, freightAmount, subtotal + freightAmount, expectedAt, `由 ${inquiry.inquiry_no} 成交自动生成`, by.id, by.name,
        ])
        for (const [index, item] of group.items.entries()) await client.query(`INSERT INTO business_purchase_order_item
          (id,purchase_order_id,inquiry_item_id,supplier_offer_id,catalog_sku_id,line_no,description,oe_number,quantity,unit,cost_unit_price,line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
          randomUUID(), purchaseOrderId, item.inquiry_item_id, item.supplier_offer_id, item.catalog_sku_id, index + 1,
          item.description, item.oe_number, item.quantity, item.unit, item.offer_unit_price,
          Math.round(number(item.quantity) * number(item.offer_unit_price) * 100) / 100,
        ])
        await insertEvent(client, 'purchase', purchaseOrderId, 'created_from_inquiry', actor, { toStatus: 'draft', snapshot: { inquiryId: inquiry.id, inquiryNo: inquiry.inquiry_no, salesOrderId, supplierName: group.supplierName, itemCount: group.items.length, totalAmount: subtotal + freightAmount } })
        purchaseOrderIds.push(purchaseOrderId)
      }
      await insertEvent(client, 'sales', salesOrderId, 'created_from_inquiry', actor, { toStatus: 'draft', snapshot: { inquiryId: inquiry.id, inquiryNo: inquiry.inquiry_no, quoteId: quote.id, quoteNo: quote.quote_no, stockItemCount: quoteItems.filter((item) => item.fulfillment_source === 'stock').length, purchaseItemCount: quoteItems.filter((item) => item.fulfillment_source === 'purchase').length, purchaseOrderCount: purchaseOrderIds.length, totalAmount: number(quote.total_amount) } })
      await client.query(`INSERT INTO business_inquiry_event (id,inquiry_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
        VALUES ($1,$2,'converted_to_order',$3,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), inquiry.id, inquiry.status, by.id, by.name, salesOrderNo, JSON.stringify({ salesOrderId, salesOrderNo, purchaseOrderIds })])
      return { salesOrderId, purchaseOrderIds, created: true }
    })
    return { salesOrder: await getSalesOrder(result.salesOrderId), purchaseOrders: await Promise.all((result.purchaseOrderIds || []).map((id) => getPurchaseOrder(id))), created: result.created }
  }

  async function transitionSalesOrder(id, rawInput = {}, actor) {
    await withTransaction(pool, async (client) => {
      const order = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
      if (!order) throw problem('SALES_ORDER_NOT_FOUND', '销售订单不存在', 404)
      expectedVersion(rawInput.expectedVersion, order.version, 'SALES_ORDER_VERSION_CONFLICT', '销售订单')
      const nextStatus = clean(rawInput.status)
      if (!salesStatuses.has(nextStatus)) throw problem('INVALID_SALES_ORDER_STATUS', '销售订单状态无效')
      if (!salesTransitions[order.status]?.has(nextStatus)) throw problem('INVALID_SALES_ORDER_TRANSITION', `不能从 ${order.status} 变更为 ${nextStatus}`, 409)
      const purchaseRows = (await client.query('SELECT * FROM business_purchase_order WHERE sales_order_id=$1 FOR UPDATE', [order.id])).rows
      if (nextStatus === 'fulfilling' && purchaseRows.some((item) => item.status !== 'received')) throw problem('PURCHASE_NOT_RECEIVED', '全部采购单到货后才能进入履约交付', 409)
      if (nextStatus === 'completed') {
        const unshipped = number((await client.query(`SELECT count(*) FROM business_sales_order_item soi WHERE soi.sales_order_id=$1
          AND soi.quantity>COALESCE((SELECT sum(si.quantity) FROM business_shipment_item si JOIN business_shipment s ON s.id=si.shipment_id WHERE si.sales_order_item_id=soi.id),0)`, [order.id])).rows[0].count)
        if (unshipped > 0) throw problem('SALES_ORDER_NOT_FULLY_SHIPPED', '全部销售明细出库后才能完成订单', 409)
      }
      if (nextStatus === 'cancelled') {
        const received = number((await client.query('SELECT COALESCE(sum(received_quantity),0) quantity FROM business_purchase_order_item WHERE purchase_order_id=ANY($1::text[])', [purchaseRows.map((item) => item.id)])).rows[0]?.quantity)
        if (received > 0) throw problem('ORDER_HAS_RECEIPTS', '已有到货记录的订单不能直接取消，请先处理退货', 409)
        for (const purchase of purchaseRows.filter((item) => item.status !== 'cancelled')) {
          await client.query("UPDATE business_purchase_order SET status='cancelled',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [purchase.id, actorDetails(actor).id, actorDetails(actor).name])
          await insertEvent(client, 'purchase', purchase.id, 'cancelled_with_sales_order', actor, { fromStatus: purchase.status, toStatus: 'cancelled', note: clean(rawInput.note) })
        }
      }
      const by = actorDetails(actor)
      await client.query('UPDATE business_sales_order SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [order.id, nextStatus, by.id, by.name])
      await insertEvent(client, 'sales', order.id, 'status_changed', actor, { fromStatus: order.status, toStatus: nextStatus, note: clean(rawInput.note) })
    })
    return getSalesOrder(id)
  }

  async function transitionPurchaseOrder(id, rawInput = {}, actor) {
    await withTransaction(pool, async (client) => {
      const order = (await client.query('SELECT * FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
      if (!order) throw problem('PURCHASE_ORDER_NOT_FOUND', '采购订单不存在', 404)
      expectedVersion(rawInput.expectedVersion, order.version, 'PURCHASE_ORDER_VERSION_CONFLICT', '采购订单')
      const nextStatus = clean(rawInput.status)
      if (!purchaseStatuses.has(nextStatus)) throw problem('INVALID_PURCHASE_ORDER_STATUS', '采购订单状态无效')
      if (!purchaseTransitions[order.status]?.has(nextStatus)) throw problem('INVALID_PURCHASE_ORDER_TRANSITION', `不能从 ${order.status} 变更为 ${nextStatus}`, 409)
      if (nextStatus === 'submitted') {
        const sales = (await client.query('SELECT status FROM business_sales_order WHERE id=$1', [order.sales_order_id])).rows[0]
        if (!sales || sales.status !== 'confirmed') throw problem('SALES_ORDER_NOT_CONFIRMED', '销售订单确认后才能提交采购单', 409)
      }
      if (nextStatus === 'cancelled') {
        const received = number((await client.query('SELECT COALESCE(sum(received_quantity),0) quantity FROM business_purchase_order_item WHERE purchase_order_id=$1', [order.id])).rows[0].quantity)
        if (received > 0) throw problem('PURCHASE_ORDER_HAS_RECEIPTS', '已有到货记录的采购单不能直接取消', 409)
      }
      const by = actorDetails(actor)
      await client.query('UPDATE business_purchase_order SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [order.id, nextStatus, by.id, by.name])
      await insertEvent(client, 'purchase', order.id, 'status_changed', actor, { fromStatus: order.status, toStatus: nextStatus, note: clean(rawInput.note) })
    })
    return getPurchaseOrder(id)
  }

  async function receivePurchaseOrder(id, rawInput = {}, actor) {
    const requested = Array.isArray(rawInput.items) ? rawInput.items : []
    if (!requested.length) throw problem('INVALID_RECEIPT_ITEMS', '请至少填写一项本次到货数量')
    const seen = new Set()
    for (const item of requested) {
      if (!clean(item.itemId) || seen.has(clean(item.itemId))) throw problem('INVALID_RECEIPT_ITEMS', '到货明细无效或重复')
      seen.add(clean(item.itemId))
    }
    await withTransaction(pool, async (client) => {
      const order = (await client.query('SELECT * FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
      if (!order) throw problem('PURCHASE_ORDER_NOT_FOUND', '采购订单不存在', 404)
      expectedVersion(rawInput.expectedVersion, order.version, 'PURCHASE_ORDER_VERSION_CONFLICT', '采购订单')
      if (!['confirmed', 'partially_received'].includes(order.status)) throw problem('PURCHASE_ORDER_NOT_RECEIVABLE', '只有已确认或部分到货的采购单可以登记到货', 409)
      const items = (await client.query('SELECT * FROM business_purchase_order_item WHERE purchase_order_id=$1 ORDER BY line_no FOR UPDATE', [order.id])).rows
      const receivedSnapshot = []
      for (const draft of requested) {
        const item = items.find((candidate) => candidate.id === clean(draft.itemId))
        if (!item) throw problem('PURCHASE_ORDER_ITEM_NOT_FOUND', '采购单明细不存在', 404)
        const increment = quantity(draft.receivedQuantity ?? draft.quantity)
        const next = Math.round((number(item.received_quantity) + increment) * 1000) / 1000
        if (next > number(item.quantity)) throw problem('RECEIPT_EXCEEDS_ORDERED_QUANTITY', `第 ${item.line_no} 项到货数量超过采购数量`, 409, { itemId: item.id, orderedQuantity: number(item.quantity), receivedQuantity: number(item.received_quantity), attemptedQuantity: increment })
        item.received_quantity = next
        await client.query('UPDATE business_purchase_order_item SET received_quantity=$2 WHERE id=$1', [item.id, next])
        receivedSnapshot.push({ itemId: item.id, lineNo: item.line_no, receivedQuantity: increment, accumulatedQuantity: next })
      }
      const fullyReceived = items.every((item) => number(item.received_quantity) >= number(item.quantity))
      const nextStatus = fullyReceived ? 'received' : 'partially_received'; const by = actorDetails(actor)
      await client.query('UPDATE business_purchase_order SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [order.id, nextStatus, by.id, by.name])
      await insertEvent(client, 'purchase', order.id, 'items_received', actor, { fromStatus: order.status, toStatus: nextStatus, note: clean(rawInput.note), snapshot: { items: receivedSnapshot } })
      if (fullyReceived) {
        const sales = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 FOR UPDATE', [order.sales_order_id])).rows[0]
        const outstanding = number((await client.query("SELECT count(*) FROM business_purchase_order WHERE sales_order_id=$1 AND id<>$2 AND status<>'received'", [sales.id, order.id])).rows[0].count)
        if (sales.status === 'confirmed' && outstanding === 0) {
          await client.query("UPDATE business_sales_order SET status='fulfilling',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [sales.id, by.id, by.name])
          await insertEvent(client, 'sales', sales.id, 'purchasing_completed', actor, { fromStatus: 'confirmed', toStatus: 'fulfilling', snapshot: { finalPurchaseOrderId: order.id } })
        }
      }
    })
    return getPurchaseOrder(id)
  }

  return {
    listSalesOrders,
    getSalesOrder,
    listPurchaseOrders,
    getPurchaseOrder,
    convertInquiry,
    transitionSalesOrder,
    transitionPurchaseOrder,
    receivePurchaseOrder,
  }
}
