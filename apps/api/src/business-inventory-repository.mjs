import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function roundQuantity(value) { return Math.round(number(value) * 1000) / 1000 }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function generatedNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function requiredQuantity(value, label = '数量') {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) throw problem('INVALID_INVENTORY_QUANTITY', `${label}必须大于 0`)
  return roundQuantity(normalized)
}
function requireVersion(value, current, errorCode, label) {
  const version = Number(value)
  if (!Number.isInteger(version) || version !== current) throw problem(errorCode, `${label}已被其他操作更新，请刷新后重试`, 409, { currentVersion: current })
}
function requestKey(value) {
  const normalized = clean(value)
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return normalized
}
function stockKey(row) {
  if (clean(row.catalog_sku_id)) return `sku:${clean(row.catalog_sku_id)}`
  const oe = clean(row.oe_number).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return oe ? `oe:${oe}` : `inquiry:${clean(row.inquiry_item_id)}`
}

function mapWarehouse(row) {
  return {
    id: row.id, warehouseCode: row.warehouse_code, name: row.name, address: row.address, status: row.status,
    isDefault: row.is_default, notes: row.notes, version: row.version, createdById: row.created_by_id,
    createdByName: row.created_by_name, updatedById: row.updated_by_id, updatedByName: row.updated_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapBalance(row) {
  const onHand = number(row.on_hand_quantity); const reserved = number(row.reserved_quantity)
  return {
    id: row.id, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
    stockKey: row.stock_key, catalogSkuId: row.catalog_sku_id, description: row.description, oeNumber: row.oe_number,
    unit: row.unit, onHandQuantity: onHand, reservedQuantity: reserved, availableQuantity: roundQuantity(onHand - reserved),
    version: row.version, updatedAt: row.updated_at,
  }
}
function mapLot(row) {
  const onHand = number(row.on_hand_quantity); const reserved = number(row.reserved_quantity)
  return {
    id: row.id, lotNo: row.lot_no, warehouseId: row.warehouse_id, goodsReceiptId: row.goods_receipt_id,
    purchaseOrderItemId: row.purchase_order_item_id, stockKey: row.stock_key, catalogSkuId: row.catalog_sku_id,
    description: row.description, oeNumber: row.oe_number, unit: row.unit, unitCost: number(row.unit_cost),
    receivedQuantity: number(row.received_quantity), onHandQuantity: onHand, reservedQuantity: reserved,
    availableQuantity: roundQuantity(onHand - reserved), receivedAt: row.received_at,
  }
}
function mapReceipt(row) {
  return {
    id: row.id, receiptNo: row.receipt_no, sourceRequestId: row.source_request_id, purchaseOrderId: row.purchase_order_id,
    purchaseOrderNo: row.purchase_order_no, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name, status: row.status, note: row.note, createdById: row.created_by_id,
    createdByName: row.created_by_name, createdAt: row.created_at,
  }
}
function mapReservation(row) {
  return {
    id: row.id, reservationNo: row.reservation_no, salesOrderId: row.sales_order_id, salesOrderNo: row.sales_order_no,
    warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
    status: row.status, note: row.note, version: row.version, createdById: row.created_by_id,
    createdByName: row.created_by_name, updatedById: row.updated_by_id, updatedByName: row.updated_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
function mapShipment(row) {
  return {
    id: row.id, shipmentNo: row.shipment_no, sourceRequestId: row.source_request_id, salesOrderId: row.sales_order_id,
    salesOrderNo: row.sales_order_no, reservationId: row.reservation_id, warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, status: row.status, note: row.note,
    createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at,
  }
}
function mapMovement(row) {
  return {
    id: row.id, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, stockKey: row.stock_key,
    inventoryLotId: row.inventory_lot_id, movementType: row.movement_type, onHandDelta: number(row.on_hand_delta),
    reservedDelta: number(row.reserved_delta), referenceType: row.reference_type, referenceId: row.reference_id,
    actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at,
  }
}

async function insertMovement(client, { warehouseId, stockKey: key, lotId, type, onHandDelta = 0, reservedDelta = 0, referenceType, referenceId, actor, note = '', snapshot = {} }) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_inventory_movement
    (id,warehouse_id,stock_key,inventory_lot_id,movement_type,on_hand_delta,reserved_delta,reference_type,reference_id,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, [
    randomUUID(), warehouseId, key, lotId || null, type, onHandDelta, reservedDelta, referenceType, referenceId,
    by.id, by.name, clean(note), JSON.stringify(snapshot),
  ])
}
async function insertOrderEvent(client, orderType, orderId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_order_event
    (id,order_type,sales_order_id,purchase_order_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
    randomUUID(), orderType, orderType === 'sales' ? orderId : null, orderType === 'purchase' ? orderId : null,
    action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot),
  ])
}

export function normalizeWarehouseInput(input = {}) {
  const warehouseCode = clean(input.warehouseCode).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(warehouseCode)) throw problem('INVALID_WAREHOUSE_CODE', '仓库编码必须是 2 至 32 位英文、数字、横线或下划线')
  if (!clean(input.name)) throw problem('INVALID_WAREHOUSE_INPUT', '仓库名称为必填项')
  const status = clean(input.status) || 'active'
  if (!['active', 'inactive'].includes(status)) throw problem('INVALID_WAREHOUSE_STATUS', '仓库状态无效')
  return { warehouseCode, name: clean(input.name), address: clean(input.address), status, isDefault: Boolean(input.isDefault), notes: clean(input.notes) }
}

export function createBusinessInventoryRepository(pool) {
  async function getWarehouse(id, client = pool) {
    const row = (await client.query('SELECT * FROM business_warehouse WHERE id=$1 OR warehouse_code=upper(trim($1)) LIMIT 1', [id])).rows[0]
    return row ? mapWarehouse(row) : null
  }
  async function getReceipt(id, client = pool) {
    const row = (await client.query(`SELECT r.*,po.order_no purchase_order_no,w.warehouse_code,w.name warehouse_name
      FROM business_goods_receipt r JOIN business_purchase_order po ON po.id=r.purchase_order_id JOIN business_warehouse w ON w.id=r.warehouse_id
      WHERE r.id=$1 OR r.receipt_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const items = (await client.query(`SELECT i.*,l.lot_no,l.stock_key,l.catalog_sku_id,l.description,l.oe_number,l.unit,l.on_hand_quantity,l.reserved_quantity,l.received_at
      FROM business_goods_receipt_item i JOIN business_inventory_lot l ON l.id=i.inventory_lot_id WHERE i.goods_receipt_id=$1 ORDER BY l.received_at,l.id`, [row.id])).rows
    return { ...mapReceipt(row), items: items.map((item) => ({ id: item.id, purchaseOrderItemId: item.purchase_order_item_id, inventoryLotId: item.inventory_lot_id, receivedQuantity: number(item.received_quantity), unitCost: number(item.unit_cost), lineTotal: number(item.line_total), lot: mapLot({ ...item, id: item.inventory_lot_id, goods_receipt_id: row.id, purchase_order_item_id: item.purchase_order_item_id, received_quantity: item.received_quantity, unit_cost: item.unit_cost, warehouse_id: row.warehouse_id }) })) }
  }
  async function getReservation(id, client = pool) {
    const row = (await client.query(`SELECT r.*,so.order_no sales_order_no,w.warehouse_code,w.name warehouse_name
      FROM business_stock_reservation r JOIN business_sales_order so ON so.id=r.sales_order_id JOIN business_warehouse w ON w.id=r.warehouse_id
      WHERE r.id=$1 OR r.reservation_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [items, allocations] = await Promise.all([
      client.query('SELECT * FROM business_stock_reservation_item WHERE reservation_id=$1 ORDER BY id', [row.id]),
      client.query(`SELECT a.*,l.lot_no FROM business_stock_reservation_allocation a JOIN business_inventory_lot l ON l.id=a.inventory_lot_id
        WHERE a.reservation_item_id IN (SELECT id FROM business_stock_reservation_item WHERE reservation_id=$1) ORDER BY l.received_at,l.id`, [row.id]),
    ])
    return { ...mapReservation(row), items: items.rows.map((item) => ({ id: item.id, salesOrderItemId: item.sales_order_item_id, stockKey: item.stock_key, requestedQuantity: number(item.requested_quantity), reservedQuantity: number(item.reserved_quantity), shortageQuantity: number(item.shortage_quantity), fulfilledQuantity: number(item.fulfilled_quantity), allocations: allocations.rows.filter((allocation) => allocation.reservation_item_id === item.id).map((allocation) => ({ id: allocation.id, inventoryLotId: allocation.inventory_lot_id, lotNo: allocation.lot_no, quantity: number(allocation.quantity), fulfilledQuantity: number(allocation.fulfilled_quantity) })) })) }
  }
  async function getShipment(id, client = pool) {
    const row = (await client.query(`SELECT s.*,so.order_no sales_order_no,w.warehouse_code,w.name warehouse_name
      FROM business_shipment s JOIN business_sales_order so ON so.id=s.sales_order_id JOIN business_warehouse w ON w.id=s.warehouse_id
      WHERE s.id=$1 OR s.shipment_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const items = (await client.query(`SELECT si.*,l.lot_no,l.stock_key FROM business_shipment_item si JOIN business_inventory_lot l ON l.id=si.inventory_lot_id
      WHERE si.shipment_id=$1 ORDER BY si.sales_order_item_id,l.received_at,l.id`, [row.id])).rows
    return { ...mapShipment(row), items: items.map((item) => ({ id: item.id, salesOrderItemId: item.sales_order_item_id, inventoryLotId: item.inventory_lot_id, lotNo: item.lot_no, stockKey: item.stock_key, quantity: number(item.quantity) })) }
  }

  async function listWarehouses() {
    return { items: (await pool.query('SELECT * FROM business_warehouse ORDER BY is_default DESC,status,name,id')).rows.map(mapWarehouse) }
  }
  async function createWarehouse(rawInput, actor) {
    const input = normalizeWarehouseInput(rawInput); const by = actorDetails(actor); const id = randomUUID()
    await withTransaction(pool, async (client) => {
      if (input.isDefault) await client.query('UPDATE business_warehouse SET is_default=false,version=version+1,updated_by_id=$1,updated_by_name=$2,updated_at=now() WHERE is_default=true', [by.id, by.name])
      await client.query(`INSERT INTO business_warehouse
        (id,warehouse_code,name,address,status,is_default,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9)`, [id, input.warehouseCode, input.name, input.address, input.status, input.isDefault, input.notes, by.id, by.name])
    })
    return getWarehouse(id)
  }
  async function updateWarehouse(id, rawInput, actor) {
    await withTransaction(pool, async (client) => {
      const current = (await client.query('SELECT * FROM business_warehouse WHERE id=$1 OR warehouse_code=upper(trim($1)) FOR UPDATE', [id])).rows[0]
      if (!current) throw problem('WAREHOUSE_NOT_FOUND', '仓库不存在', 404)
      requireVersion(rawInput.expectedVersion, current.version, 'WAREHOUSE_VERSION_CONFLICT', '仓库')
      const input = normalizeWarehouseInput({ warehouseCode: current.warehouse_code, name: rawInput.name ?? current.name, address: rawInput.address ?? current.address, status: rawInput.status ?? current.status, isDefault: rawInput.isDefault ?? current.is_default, notes: rawInput.notes ?? current.notes })
      const stockCount = number((await client.query('SELECT count(*) FROM business_inventory_balance WHERE warehouse_id=$1 AND (on_hand_quantity>0 OR reserved_quantity>0)', [current.id])).rows[0].count)
      if (input.status === 'inactive' && stockCount > 0) throw problem('WAREHOUSE_HAS_STOCK', '仓库仍有库存或占用，不能停用', 409)
      const by = actorDetails(actor)
      if (input.isDefault) await client.query('UPDATE business_warehouse SET is_default=false,version=version+1,updated_by_id=$1,updated_by_name=$2,updated_at=now() WHERE is_default=true AND id<>$3', [by.id, by.name, current.id])
      await client.query(`UPDATE business_warehouse SET name=$2,address=$3,status=$4,is_default=$5,notes=$6,version=version+1,updated_by_id=$7,updated_by_name=$8,updated_at=now() WHERE id=$1`, [current.id, input.name, input.address, input.status, input.isDefault, input.notes, by.id, by.name])
    })
    return getWarehouse(id)
  }

  async function listBalances({ warehouseId = '', query = '', page = 1, pageSize = 50 } = {}) {
    const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(200, Math.max(1, Number(pageSize) || 50)); const values = []; const where = []
    if (clean(warehouseId)) { values.push(clean(warehouseId)); where.push(`b.warehouse_id=$${values.length}`) }
    if (clean(query)) { values.push(`%${clean(query)}%`); where.push(`(b.stock_key ILIKE $${values.length} OR b.description ILIKE $${values.length} OR b.oe_number ILIKE $${values.length})`) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = number((await pool.query(`SELECT count(*) FROM business_inventory_balance b ${clause}`, values)).rows[0].count)
    values.push(size, (currentPage - 1) * size)
    const rows = (await pool.query(`SELECT b.*,w.warehouse_code,w.name warehouse_name FROM business_inventory_balance b JOIN business_warehouse w ON w.id=b.warehouse_id ${clause}
      ORDER BY b.updated_at DESC,b.id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
    return { items: rows.map(mapBalance), total, page: currentPage, pageSize: size }
  }
  async function listMovements({ warehouseId = '', stockKey: key = '', page = 1, pageSize = 50 } = {}) {
    const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(200, Math.max(1, Number(pageSize) || 50)); const values = []; const where = []
    if (clean(warehouseId)) { values.push(clean(warehouseId)); where.push(`m.warehouse_id=$${values.length}`) }
    if (clean(key)) { values.push(clean(key)); where.push(`m.stock_key=$${values.length}`) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = number((await pool.query(`SELECT count(*) FROM business_inventory_movement m ${clause}`, values)).rows[0].count)
    values.push(size, (currentPage - 1) * size)
    const rows = (await pool.query(`SELECT m.*,w.warehouse_code FROM business_inventory_movement m JOIN business_warehouse w ON w.id=m.warehouse_id ${clause}
      ORDER BY m.created_at DESC,m.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
    return { items: rows.map(mapMovement), total, page: currentPage, pageSize: size }
  }

  async function receivePurchaseOrder(purchaseOrderId, rawInput = {}, actor) {
    const key = requestKey(rawInput.requestKey); const requested = Array.isArray(rawInput.items) ? rawInput.items : []
    if (!clean(rawInput.warehouseId)) throw problem('WAREHOUSE_REQUIRED', '收货仓库为必填项')
    if (!requested.length) throw problem('INVALID_RECEIPT_ITEMS', '请至少填写一项本次到货数量')
    const seen = new Set()
    for (const item of requested) {
      if (!clean(item.itemId) || seen.has(clean(item.itemId))) throw problem('INVALID_RECEIPT_ITEMS', '到货明细无效或重复')
      seen.add(clean(item.itemId))
    }
    const result = await withTransaction(pool, async (client) => {
      const existing = (await client.query('SELECT id,purchase_order_id FROM business_goods_receipt WHERE source_request_id=$1', [key])).rows[0]
      if (existing) {
        const requestedOrder = (await client.query('SELECT id FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1))', [purchaseOrderId])).rows[0]
        if (!requestedOrder || existing.purchase_order_id !== requestedOrder.id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他采购收货', 409)
        return { id: existing.id, created: false }
      }
      const warehouse = (await client.query('SELECT * FROM business_warehouse WHERE id=$1 FOR UPDATE', [clean(rawInput.warehouseId)])).rows[0]
      if (!warehouse || warehouse.status !== 'active') throw problem('WAREHOUSE_UNAVAILABLE', '收货仓库不存在或已停用', 409)
      const order = (await client.query('SELECT * FROM business_purchase_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [purchaseOrderId])).rows[0]
      if (!order) throw problem('PURCHASE_ORDER_NOT_FOUND', '采购订单不存在', 404)
      requireVersion(rawInput.expectedVersion, order.version, 'PURCHASE_ORDER_VERSION_CONFLICT', '采购订单')
      if (!['confirmed', 'partially_received'].includes(order.status)) throw problem('PURCHASE_ORDER_NOT_RECEIVABLE', '只有已确认或部分到货的采购单可以登记到货', 409)
      const items = (await client.query('SELECT * FROM business_purchase_order_item WHERE purchase_order_id=$1 ORDER BY line_no FOR UPDATE', [order.id])).rows
      const receiptId = randomUUID(); const receiptNo = generatedNumber('GR'); const by = actorDetails(actor)
      await client.query(`INSERT INTO business_goods_receipt (id,receipt_no,source_request_id,purchase_order_id,warehouse_id,note,created_by_id,created_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [receiptId, receiptNo, key, order.id, warehouse.id, clean(rawInput.note), by.id, by.name])
      const receiptSnapshot = []
      for (const draft of requested) {
        const item = items.find((candidate) => candidate.id === clean(draft.itemId))
        if (!item) throw problem('PURCHASE_ORDER_ITEM_NOT_FOUND', '采购单明细不存在', 404)
        const increment = requiredQuantity(draft.receivedQuantity ?? draft.quantity, '本次到货数量')
        const next = roundQuantity(number(item.received_quantity) + increment)
        if (next > number(item.quantity)) throw problem('RECEIPT_EXCEEDS_ORDERED_QUANTITY', `第 ${item.line_no} 项到货数量超过采购数量`, 409, { itemId: item.id, orderedQuantity: number(item.quantity), receivedQuantity: number(item.received_quantity), attemptedQuantity: increment })
        const itemStockKey = stockKey(item); const lotId = randomUUID(); const lotNo = generatedNumber('LOT')
        await client.query(`INSERT INTO business_inventory_lot
          (id,lot_no,warehouse_id,goods_receipt_id,purchase_order_item_id,stock_key,catalog_sku_id,description,oe_number,unit,unit_cost,received_quantity,on_hand_quantity)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, [lotId, lotNo, warehouse.id, receiptId, item.id, itemStockKey, item.catalog_sku_id, item.description, item.oe_number, item.unit, item.cost_unit_price, increment])
        await client.query(`INSERT INTO business_goods_receipt_item (id,goods_receipt_id,purchase_order_item_id,inventory_lot_id,received_quantity,unit_cost,line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), receiptId, item.id, lotId, increment, item.cost_unit_price, Math.round(increment * number(item.cost_unit_price) * 100) / 100])
        await client.query(`INSERT INTO business_inventory_balance
          (id,warehouse_id,stock_key,catalog_sku_id,description,oe_number,unit,on_hand_quantity,reserved_quantity)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
          ON CONFLICT (warehouse_id,stock_key) DO UPDATE SET on_hand_quantity=business_inventory_balance.on_hand_quantity+EXCLUDED.on_hand_quantity,
          description=EXCLUDED.description,oe_number=EXCLUDED.oe_number,catalog_sku_id=COALESCE(EXCLUDED.catalog_sku_id,business_inventory_balance.catalog_sku_id),version=business_inventory_balance.version+1,updated_at=now()`, [randomUUID(), warehouse.id, itemStockKey, item.catalog_sku_id, item.description, item.oe_number, item.unit, increment])
        await client.query('UPDATE business_purchase_order_item SET received_quantity=$2 WHERE id=$1', [item.id, next])
        item.received_quantity = next
        await insertMovement(client, { warehouseId: warehouse.id, stockKey: itemStockKey, lotId, type: 'receipt', onHandDelta: increment, referenceType: 'goods_receipt', referenceId: receiptId, actor, note: rawInput.note, snapshot: { purchaseOrderId: order.id, purchaseOrderItemId: item.id, receiptNo, lotNo, unitCost: number(item.cost_unit_price) } })
        receiptSnapshot.push({ purchaseOrderItemId: item.id, inventoryLotId: lotId, receivedQuantity: increment, accumulatedQuantity: next })
      }
      const fullyReceived = items.every((item) => number(item.received_quantity) >= number(item.quantity)); const nextStatus = fullyReceived ? 'received' : 'partially_received'
      await client.query('UPDATE business_purchase_order SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [order.id, nextStatus, by.id, by.name])
      await insertOrderEvent(client, 'purchase', order.id, 'goods_received', actor, { fromStatus: order.status, toStatus: nextStatus, note: rawInput.note, snapshot: { receiptId, receiptNo, warehouseId: warehouse.id, items: receiptSnapshot } })
      if (fullyReceived) {
        const sales = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 FOR UPDATE', [order.sales_order_id])).rows[0]
        const outstanding = number((await client.query("SELECT count(*) FROM business_purchase_order WHERE sales_order_id=$1 AND id<>$2 AND status<>'received'", [sales.id, order.id])).rows[0].count)
        if (sales.status === 'confirmed' && outstanding === 0) {
          await client.query("UPDATE business_sales_order SET status='fulfilling',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [sales.id, by.id, by.name])
          await insertOrderEvent(client, 'sales', sales.id, 'purchasing_completed', actor, { fromStatus: 'confirmed', toStatus: 'fulfilling', snapshot: { finalPurchaseOrderId: order.id, finalGoodsReceiptId: receiptId } })
        }
      }
      return { id: receiptId, created: true }
    })
    return { receipt: await getReceipt(result.id), created: result.created }
  }

  async function reserveSalesOrder(salesOrderId, rawInput = {}, actor) {
    const requested = Array.isArray(rawInput.items) ? rawInput.items : []
    if (!clean(rawInput.warehouseId)) throw problem('WAREHOUSE_REQUIRED', '预留仓库为必填项')
    if (!requested.length) throw problem('INVALID_RESERVATION_ITEMS', '请至少填写一项预留数量')
    const result = await withTransaction(pool, async (client) => {
      const sales = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [salesOrderId])).rows[0]
      if (!sales) throw problem('SALES_ORDER_NOT_FOUND', '销售订单不存在', 404)
      if (!['confirmed', 'fulfilling'].includes(sales.status)) throw problem('SALES_ORDER_NOT_RESERVABLE', '只有已确认或履约中的销售订单可以预留库存', 409)
      const warehouse = (await client.query('SELECT * FROM business_warehouse WHERE id=$1 FOR UPDATE', [clean(rawInput.warehouseId)])).rows[0]
      if (!warehouse || warehouse.status !== 'active') throw problem('WAREHOUSE_UNAVAILABLE', '预留仓库不存在或已停用', 409)
      const salesItems = (await client.query(`SELECT soi.*,
        COALESCE((SELECT sum(si.quantity) FROM business_shipment_item si JOIN business_shipment s ON s.id=si.shipment_id WHERE si.sales_order_item_id=soi.id),0) shipped_quantity
        FROM business_sales_order_item soi WHERE soi.sales_order_id=$1 ORDER BY soi.line_no FOR UPDATE`, [sales.id])).rows
      const normalized = []
      const seen = new Set()
      for (const draft of requested) {
        const itemId = clean(draft.itemId ?? draft.salesOrderItemId)
        if (!itemId || seen.has(itemId)) throw problem('INVALID_RESERVATION_ITEMS', '预留明细无效或重复')
        seen.add(itemId)
        const item = salesItems.find((candidate) => candidate.id === itemId)
        if (!item) throw problem('SALES_ORDER_ITEM_NOT_FOUND', '销售订单明细不存在', 404)
        const requestedQuantity = requiredQuantity(draft.quantity, '预留数量'); const remaining = roundQuantity(number(item.quantity) - number(item.shipped_quantity))
        if (requestedQuantity > remaining) throw problem('RESERVATION_EXCEEDS_ORDER_QUANTITY', `第 ${item.line_no} 项预留数量超过未出库数量`, 409)
        normalized.push({ item, requestedQuantity, stockKey: stockKey(item) })
      }
      const existing = (await client.query("SELECT * FROM business_stock_reservation WHERE sales_order_id=$1 AND warehouse_id=$2 AND status='active' FOR UPDATE", [sales.id, warehouse.id])).rows[0]
      const existingItems = existing ? (await client.query('SELECT * FROM business_stock_reservation_item WHERE reservation_id=$1 FOR UPDATE', [existing.id])).rows : []
      const pending = []
      for (const entry of normalized) {
        const current = existingItems.find((item) => item.sales_order_item_id === entry.item.id)
        if (!current) pending.push(entry)
        else if (number(current.requested_quantity) !== entry.requestedQuantity) throw problem('RESERVATION_ITEM_ALREADY_EXISTS', `第 ${entry.item.line_no} 项已按其他数量锁定，请先释放原预留`, 409, { salesOrderItemId: entry.item.id, reservedRequestQuantity: number(current.requested_quantity) })
      }
      if (existing && !pending.length) return { id: existing.id, created: false, extended: false }
      const reservationId = existing?.id || randomUUID(); const reservationNo = existing?.reservation_no || generatedNumber('RSV'); const by = actorDetails(actor)
      if (!existing) await client.query(`INSERT INTO business_stock_reservation
        (id,reservation_no,sales_order_id,warehouse_id,note,created_by_id,created_by_name,updated_by_id,updated_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$7)`, [reservationId, reservationNo, sales.id, warehouse.id, clean(rawInput.note), by.id, by.name])
      for (const entry of pending) {
        const balance = (await client.query('SELECT * FROM business_inventory_balance WHERE warehouse_id=$1 AND stock_key=$2 FOR UPDATE', [warehouse.id, entry.stockKey])).rows[0]
        const available = balance ? roundQuantity(number(balance.on_hand_quantity) - number(balance.reserved_quantity)) : 0
        if (!rawInput.allowPartial && available < entry.requestedQuantity) throw problem('INSUFFICIENT_AVAILABLE_STOCK', `第 ${entry.item.line_no} 项可用库存不足`, 409, { salesOrderItemId: entry.item.id, requestedQuantity: entry.requestedQuantity, availableQuantity: available })
        const reservedQuantity = Math.min(available, entry.requestedQuantity); const shortageQuantity = roundQuantity(entry.requestedQuantity - reservedQuantity); const reservationItemId = randomUUID()
        await client.query(`INSERT INTO business_stock_reservation_item
          (id,reservation_id,sales_order_item_id,stock_key,requested_quantity,reserved_quantity,shortage_quantity)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [reservationItemId, reservationId, entry.item.id, entry.stockKey, entry.requestedQuantity, reservedQuantity, shortageQuantity])
        let remaining = reservedQuantity
        if (remaining > 0) {
          const lots = (await client.query(`SELECT * FROM business_inventory_lot WHERE warehouse_id=$1 AND stock_key=$2 AND on_hand_quantity>reserved_quantity
            ORDER BY received_at,id FOR UPDATE`, [warehouse.id, entry.stockKey])).rows
          for (const lot of lots) {
            if (remaining <= 0) break
            const take = Math.min(roundQuantity(number(lot.on_hand_quantity) - number(lot.reserved_quantity)), remaining)
            if (take <= 0) continue
            await client.query('UPDATE business_inventory_lot SET reserved_quantity=reserved_quantity+$2 WHERE id=$1', [lot.id, take])
            await client.query(`INSERT INTO business_stock_reservation_allocation (id,reservation_item_id,inventory_lot_id,quantity) VALUES ($1,$2,$3,$4)`, [randomUUID(), reservationItemId, lot.id, take])
            await insertMovement(client, { warehouseId: warehouse.id, stockKey: entry.stockKey, lotId: lot.id, type: 'reserve', reservedDelta: take, referenceType: 'stock_reservation', referenceId: reservationId, actor, note: rawInput.note, snapshot: { salesOrderId: sales.id, salesOrderItemId: entry.item.id } })
            remaining = roundQuantity(remaining - take)
          }
          if (remaining !== 0) throw problem('INVENTORY_ALLOCATION_CONFLICT', '库存批次数量与汇总库存不一致，请检查库存流水', 409)
          await client.query('UPDATE business_inventory_balance SET reserved_quantity=reserved_quantity+$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND stock_key=$2', [warehouse.id, entry.stockKey, reservedQuantity])
        }
      }
      if (existing) await client.query('UPDATE business_stock_reservation SET version=version+1,note=CASE WHEN $2<>\'\' THEN $2 ELSE note END,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [reservationId, clean(rawInput.note), by.id, by.name])
      return { id: reservationId, created: !existing, extended: Boolean(existing) }
    })
    return { reservation: await getReservation(result.id), created: result.created, extended: result.extended }
  }

  async function releaseReservation(id, rawInput = {}, actor) {
    await withTransaction(pool, async (client) => {
      const reservation = (await client.query('SELECT * FROM business_stock_reservation WHERE id=$1 OR reservation_no=upper(trim($1)) FOR UPDATE', [id])).rows[0]
      if (!reservation) throw problem('RESERVATION_NOT_FOUND', '库存预留不存在', 404)
      requireVersion(rawInput.expectedVersion, reservation.version, 'RESERVATION_VERSION_CONFLICT', '库存预留')
      if (reservation.status !== 'active') throw problem('RESERVATION_NOT_RELEASABLE', '只有生效中的预留可以释放', 409)
      const allocations = (await client.query(`SELECT a.*,ri.stock_key FROM business_stock_reservation_allocation a
        JOIN business_stock_reservation_item ri ON ri.id=a.reservation_item_id WHERE ri.reservation_id=$1 FOR UPDATE OF a`, [reservation.id])).rows
      const releasedByStock = new Map()
      for (const allocation of allocations) {
        const remaining = roundQuantity(number(allocation.quantity) - number(allocation.fulfilled_quantity))
        if (remaining <= 0) continue
        const lot = (await client.query('SELECT * FROM business_inventory_lot WHERE id=$1 FOR UPDATE', [allocation.inventory_lot_id])).rows[0]
        await client.query('UPDATE business_inventory_lot SET reserved_quantity=reserved_quantity-$2 WHERE id=$1', [lot.id, remaining])
        releasedByStock.set(allocation.stock_key, roundQuantity((releasedByStock.get(allocation.stock_key) || 0) + remaining))
        await insertMovement(client, { warehouseId: reservation.warehouse_id, stockKey: allocation.stock_key, lotId: lot.id, type: 'release', reservedDelta: -remaining, referenceType: 'stock_reservation', referenceId: reservation.id, actor, note: rawInput.note })
      }
      for (const [key, amount] of releasedByStock) await client.query('UPDATE business_inventory_balance SET reserved_quantity=reserved_quantity-$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND stock_key=$2', [reservation.warehouse_id, key, amount])
      const by = actorDetails(actor)
      await client.query("UPDATE business_stock_reservation SET status='released',version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1", [reservation.id, by.id, by.name])
    })
    return getReservation(id)
  }

  async function shipSalesOrder(salesOrderId, rawInput = {}, actor) {
    const key = requestKey(rawInput.requestKey); const requested = Array.isArray(rawInput.items) ? rawInput.items : []
    if (!clean(rawInput.reservationId)) throw problem('RESERVATION_REQUIRED', '出库必须关联库存预留')
    if (!requested.length) throw problem('INVALID_SHIPMENT_ITEMS', '请至少填写一项出库数量')
    const result = await withTransaction(pool, async (client) => {
      const existing = (await client.query('SELECT id,sales_order_id FROM business_shipment WHERE source_request_id=$1', [key])).rows[0]
      if (existing) {
        const requestedOrder = (await client.query('SELECT id FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1))', [salesOrderId])).rows[0]
        if (!requestedOrder || existing.sales_order_id !== requestedOrder.id) throw problem('REQUEST_KEY_CONFLICT', 'requestKey 已用于其他销售出库', 409)
        return { id: existing.id, created: false }
      }
      const sales = (await client.query('SELECT * FROM business_sales_order WHERE id=$1 OR order_no=upper(trim($1)) FOR UPDATE', [salesOrderId])).rows[0]
      if (!sales) throw problem('SALES_ORDER_NOT_FOUND', '销售订单不存在', 404)
      if (!['confirmed', 'fulfilling'].includes(sales.status)) throw problem('SALES_ORDER_NOT_SHIPPABLE', '只有已确认或履约中的销售订单可以出库', 409)
      const reservation = (await client.query('SELECT * FROM business_stock_reservation WHERE id=$1 AND sales_order_id=$2 FOR UPDATE', [clean(rawInput.reservationId), sales.id])).rows[0]
      if (!reservation || reservation.status !== 'active') throw problem('RESERVATION_NOT_ACTIVE', '关联的库存预留不存在或已结束', 409)
      requireVersion(rawInput.expectedReservationVersion, reservation.version, 'RESERVATION_VERSION_CONFLICT', '库存预留')
      const reservationItems = (await client.query('SELECT * FROM business_stock_reservation_item WHERE reservation_id=$1 FOR UPDATE', [reservation.id])).rows
      const seen = new Set(); const normalized = []
      for (const draft of requested) {
        const itemId = clean(draft.itemId ?? draft.salesOrderItemId)
        if (!itemId || seen.has(itemId)) throw problem('INVALID_SHIPMENT_ITEMS', '出库明细无效或重复')
        seen.add(itemId)
        const item = reservationItems.find((candidate) => candidate.sales_order_item_id === itemId)
        if (!item) throw problem('RESERVATION_ITEM_NOT_FOUND', '销售明细未在当前预留中', 404)
        const shipmentQuantity = requiredQuantity(draft.quantity, '出库数量'); const remaining = roundQuantity(number(item.reserved_quantity) - number(item.fulfilled_quantity))
        if (shipmentQuantity > remaining) throw problem('SHIPMENT_EXCEEDS_RESERVED_QUANTITY', '出库数量超过已预留数量', 409, { salesOrderItemId: itemId, reservedRemainingQuantity: remaining })
        normalized.push({ item, quantity: shipmentQuantity })
      }
      const shipmentId = randomUUID(); const shipmentNo = generatedNumber('SHP'); const by = actorDetails(actor)
      await client.query(`INSERT INTO business_shipment
        (id,shipment_no,source_request_id,sales_order_id,reservation_id,warehouse_id,note,created_by_id,created_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [shipmentId, shipmentNo, key, sales.id, reservation.id, reservation.warehouse_id, clean(rawInput.note), by.id, by.name])
      for (const entry of normalized) {
        const allocations = (await client.query(`SELECT a.*,l.stock_key FROM business_stock_reservation_allocation a JOIN business_inventory_lot l ON l.id=a.inventory_lot_id
          WHERE a.reservation_item_id=$1 AND a.quantity>a.fulfilled_quantity ORDER BY l.received_at,l.id FOR UPDATE OF a,l`, [entry.item.id])).rows
        let remaining = entry.quantity
        for (const allocation of allocations) {
          if (remaining <= 0) break
          const take = Math.min(roundQuantity(number(allocation.quantity) - number(allocation.fulfilled_quantity)), remaining)
          if (take <= 0) continue
          await client.query('UPDATE business_stock_reservation_allocation SET fulfilled_quantity=fulfilled_quantity+$2 WHERE id=$1', [allocation.id, take])
          await client.query('UPDATE business_inventory_lot SET on_hand_quantity=on_hand_quantity-$2,reserved_quantity=reserved_quantity-$2 WHERE id=$1', [allocation.inventory_lot_id, take])
          await client.query(`INSERT INTO business_shipment_item (id,shipment_id,sales_order_item_id,inventory_lot_id,quantity) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), shipmentId, entry.item.sales_order_item_id, allocation.inventory_lot_id, take])
          await insertMovement(client, { warehouseId: reservation.warehouse_id, stockKey: allocation.stock_key, lotId: allocation.inventory_lot_id, type: 'ship', onHandDelta: -take, reservedDelta: -take, referenceType: 'shipment', referenceId: shipmentId, actor, note: rawInput.note, snapshot: { salesOrderId: sales.id, salesOrderItemId: entry.item.sales_order_item_id, shipmentNo } })
          remaining = roundQuantity(remaining - take)
        }
        if (remaining !== 0) throw problem('RESERVATION_ALLOCATION_CONFLICT', '预留批次数量与预留汇总不一致，请检查库存流水', 409)
        await client.query('UPDATE business_stock_reservation_item SET fulfilled_quantity=fulfilled_quantity+$2 WHERE id=$1', [entry.item.id, entry.quantity])
        await client.query('UPDATE business_inventory_balance SET on_hand_quantity=on_hand_quantity-$3,reserved_quantity=reserved_quantity-$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND stock_key=$2', [reservation.warehouse_id, entry.item.stock_key, entry.quantity])
        entry.item.fulfilled_quantity = roundQuantity(number(entry.item.fulfilled_quantity) + entry.quantity)
      }
      const reservationFulfilled = reservationItems.every((item) => number(item.shortage_quantity) === 0 && number(item.fulfilled_quantity) >= number(item.reserved_quantity))
      const reservationStatus = reservationFulfilled ? 'fulfilled' : 'active'
      await client.query('UPDATE business_stock_reservation SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [reservation.id, reservationStatus, by.id, by.name])
      const unshipped = number((await client.query(`SELECT count(*) FROM business_sales_order_item soi WHERE soi.sales_order_id=$1
        AND soi.quantity>COALESCE((SELECT sum(si.quantity) FROM business_shipment_item si JOIN business_shipment s ON s.id=si.shipment_id WHERE si.sales_order_item_id=soi.id),0)`, [sales.id])).rows[0].count)
      const nextSalesStatus = unshipped === 0 ? 'completed' : 'fulfilling'
      if (sales.status !== nextSalesStatus) {
        await client.query('UPDATE business_sales_order SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [sales.id, nextSalesStatus, by.id, by.name])
        await insertOrderEvent(client, 'sales', sales.id, unshipped === 0 ? 'shipment_completed' : 'shipment_posted', actor, { fromStatus: sales.status, toStatus: nextSalesStatus, note: rawInput.note, snapshot: { shipmentId, shipmentNo, reservationId: reservation.id } })
      } else await insertOrderEvent(client, 'sales', sales.id, 'shipment_posted', actor, { fromStatus: sales.status, toStatus: sales.status, note: rawInput.note, snapshot: { shipmentId, shipmentNo, reservationId: reservation.id } })
      return { id: shipmentId, created: true }
    })
    return { shipment: await getShipment(result.id), created: result.created }
  }

  return {
    listWarehouses, getWarehouse, createWarehouse, updateWarehouse,
    listBalances, listMovements, getReceipt, receivePurchaseOrder,
    getReservation, reserveSalesOrder, releaseReservation,
    getShipment, shipSalesOrder,
  }
}
