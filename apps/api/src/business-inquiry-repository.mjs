import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const inquiryStatuses = new Set(['new', 'sourcing', 'quoting', 'quoted', 'follow_up', 'won', 'lost', 'cancelled'])
const terminalStatuses = new Set(['won', 'lost', 'cancelled'])
const transitions = {
  new: new Set(['sourcing', 'cancelled']),
  sourcing: new Set(['quoting', 'cancelled']),
  quoting: new Set(['quoted', 'sourcing', 'cancelled']),
  quoted: new Set(['follow_up', 'won', 'lost', 'cancelled']),
  follow_up: new Set(['quoted', 'won', 'lost', 'cancelled']),
  won: new Set([]), lost: new Set(['follow_up']), cancelled: new Set([]),
}

function clean(value) { return String(value ?? '').trim() }
function money(value, label, { optional = false } = {}) {
  if ((value === '' || value == null) && optional) return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw problem('INVALID_BUSINESS_AMOUNT', `${label}必须是大于等于 0 的金额`)
  return Math.round(number * 100) / 100
}
function quantity(value) {
  const number = Number(value ?? 1)
  if (!Number.isFinite(number) || number <= 0) throw problem('INVALID_INQUIRY_QUANTITY', '需求数量必须大于 0')
  return Math.round(number * 1000) / 1000
}
function optionalDate(value, label) {
  const normalized = clean(value)
  if (!normalized) return null
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) throw problem('INVALID_BUSINESS_DATE', `${label}必须是有效日期`)
  return normalized
}
function optionalTimestamp(value, label) {
  const normalized = clean(value)
  if (!normalized) return null
  const date = new Date(normalized)
  if (Number.isNaN(date.valueOf())) throw problem('INVALID_BUSINESS_DATE', `${label}必须是有效时间`)
  return date.toISOString()
}
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function generatedNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }

export function normalizeBusinessInquiryInput(input = {}) {
  const items = Array.isArray(input.items) ? input.items : []
  if (!clean(input.customerName) && !clean(input.customerPartnerId)) throw problem('INVALID_INQUIRY_INPUT', '客户或门店名称为必填项')
  if (!items.length || items.length > 50) throw problem('INVALID_INQUIRY_INPUT', '每条询价必须包含 1 至 50 项需求')
  const vin = clean(input.vin).toUpperCase()
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw problem('INVALID_INQUIRY_VIN', 'VIN 必须是 17 位有效字符')
  const priority = clean(input.priority) || 'normal'
  if (!['normal', 'high', 'urgent'].includes(priority)) throw problem('INVALID_INQUIRY_INPUT', '询价优先级无效')
  return {
    customerName: clean(input.customerName), customerPartnerId: clean(input.customerPartnerId) || null, customerVehicleId: clean(input.customerVehicleId) || null,
    contactName: clean(input.contactName), contactPhone: clean(input.contactPhone),
    channel: clean(input.channel) || 'manual', vehicleLabel: clean(input.vehicleLabel), vin, priority,
    assignedTo: clean(input.assignedTo), nextAction: clean(input.nextAction) || '核对需求并开始询价',
    nextActionAt: optionalTimestamp(input.nextActionAt, '下一步时间'), notes: clean(input.notes), currency: clean(input.currency).toUpperCase() || 'CNY',
    items: items.map((item, index) => {
      if (!clean(item.requirementText)) throw problem('INVALID_INQUIRY_INPUT', `第 ${index + 1} 项需求内容不能为空`)
      return {
        id: randomUUID(), lineNo: index + 1, requirementText: clean(item.requirementText), oeNumber: clean(item.oeNumber).toUpperCase(),
        requestedQuantity: quantity(item.requestedQuantity), unit: clean(item.unit) || '件', targetBrand: clean(item.targetBrand),
        catalogSkuId: clean(item.catalogSkuId) || null, notes: clean(item.notes),
      }
    }),
  }
}

function mapInquiry(row) {
  return {
    id: row.id, inquiryNo: row.inquiry_no, customerName: row.customer_name, customerPartnerId: row.customer_partner_id, customerVehicleId: row.customer_vehicle_id, contactName: row.contact_name,
    contactPhone: row.contact_phone, channel: row.channel, vehicleLabel: row.vehicle_label, vin: row.vin,
    status: row.status, priority: row.priority, assignedTo: row.assigned_to, nextAction: row.next_action,
    nextActionAt: row.next_action_at, notes: row.notes, currency: row.currency,
    quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount), version: row.version,
    createdById: row.created_by_id, createdByName: row.created_by_name, updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    itemCount: Number(row.item_count || 0), offerCount: Number(row.offer_count || 0), quoteCount: Number(row.quote_count || 0),
  }
}
function mapItem(row) {
  return { id: row.id, inquiryId: row.inquiry_id, lineNo: row.line_no, requirementText: row.requirement_text, oeNumber: row.oe_number, requestedQuantity: Number(row.requested_quantity), unit: row.unit, targetBrand: row.target_brand, catalogSkuId: row.catalog_sku_id, notes: row.notes }
}
function mapOffer(row) {
  return { id: row.id, inquiryId: row.inquiry_id, inquiryItemId: row.inquiry_item_id, supplierName: row.supplier_name, supplierPartnerId: row.supplier_partner_id, brandLabel: row.brand_label, unitPrice: Number(row.unit_price), freightAmount: Number(row.freight_amount), availability: row.availability, leadTimeDays: row.lead_time_days, validUntil: row.valid_until, sourceNote: row.source_note, selected: row.selected, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at }
}
function mapQuote(row) {
  return { id: row.id, inquiryId: row.inquiry_id, quoteNo: row.quote_no, revision: row.revision, state: row.state, currency: row.currency, validUntil: row.valid_until, subtotal: Number(row.subtotal), discountAmount: Number(row.discount_amount), freightAmount: Number(row.freight_amount), totalAmount: Number(row.total_amount), marginAmount: Number(row.margin_amount), note: row.note, sentAt: row.sent_at, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at }
}

async function insertEvent(client, inquiryId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_inquiry_event (id,inquiry_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), inquiryId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}

export function createBusinessInquiryRepository(pool) {
  async function get(id, client = pool) {
    const inquiryRow = (await client.query(`SELECT i.*,
      (SELECT count(*)::int FROM business_inquiry_item x WHERE x.inquiry_id=i.id) item_count,
      (SELECT count(*)::int FROM business_supplier_offer x WHERE x.inquiry_id=i.id) offer_count,
      (SELECT count(*)::int FROM business_quote x WHERE x.inquiry_id=i.id) quote_count
      FROM business_inquiry i WHERE i.id=$1 OR i.inquiry_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!inquiryRow) return null
    const inquiry = mapInquiry(inquiryRow)
    const [items, offers, quotes, quoteItems, events] = await Promise.all([
      client.query('SELECT * FROM business_inquiry_item WHERE inquiry_id=$1 ORDER BY line_no', [inquiry.id]),
      client.query('SELECT * FROM business_supplier_offer WHERE inquiry_id=$1 ORDER BY inquiry_item_id,selected DESC,unit_price,created_at', [inquiry.id]),
      client.query('SELECT * FROM business_quote WHERE inquiry_id=$1 ORDER BY created_at DESC', [inquiry.id]),
      client.query(`SELECT qi.* FROM business_quote_item qi JOIN business_quote q ON q.id=qi.quote_id WHERE q.inquiry_id=$1 ORDER BY q.created_at DESC,qi.line_no`, [inquiry.id]),
      client.query('SELECT * FROM business_inquiry_event WHERE inquiry_id=$1 ORDER BY created_at DESC,id DESC', [inquiry.id]),
    ])
    const quoteItemRows = quoteItems.rows
    return {
      ...inquiry,
      items: items.rows.map((row) => ({ ...mapItem(row), offers: offers.rows.filter((offer) => offer.inquiry_item_id === row.id).map(mapOffer) })),
      quotes: quotes.rows.map((row) => ({ ...mapQuote(row), items: quoteItemRows.filter((item) => item.quote_id === row.id).map((item) => ({ id: item.id, quoteId: item.quote_id, inquiryItemId: item.inquiry_item_id, supplierOfferId: item.supplier_offer_id, lineNo: item.line_no, description: item.description, oeNumber: item.oe_number, quantity: Number(item.quantity), unit: item.unit, costUnitPrice: Number(item.cost_unit_price), saleUnitPrice: Number(item.sale_unit_price), lineTotal: Number(item.line_total) })) })),
      events: events.rows.map((row) => ({ id: row.id, action: row.action, fromStatus: row.from_status, toStatus: row.to_status, actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, createdAt: row.created_at })),
    }
  }

  return {
    async list({ query = '', status = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(100, Math.max(1, Number(pageSize) || 30))
      if (status && !inquiryStatuses.has(status)) throw problem('INVALID_INQUIRY_STATUS', '询价状态无效')
      const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(i.inquiry_no ILIKE $${values.length} OR i.customer_name ILIKE $${values.length} OR i.vehicle_label ILIKE $${values.length} OR i.vin ILIKE $${values.length} OR EXISTS (SELECT 1 FROM business_inquiry_item x WHERE x.inquiry_id=i.id AND (x.requirement_text ILIKE $${values.length} OR x.oe_number ILIKE $${values.length})))`) }
      if (status) { values.push(status); where.push(`i.status=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*) FROM business_inquiry i ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT i.*,
        (SELECT count(*)::int FROM business_inquiry_item x WHERE x.inquiry_id=i.id) item_count,
        (SELECT count(*)::int FROM business_supplier_offer x WHERE x.inquiry_id=i.id) offer_count,
        (SELECT count(*)::int FROM business_quote x WHERE x.inquiry_id=i.id) quote_count
        FROM business_inquiry i ${clause} ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,i.updated_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summaryRows = (await pool.query(`SELECT status,count(*)::int count,COALESCE(sum(quote_amount),0)::numeric amount FROM business_inquiry GROUP BY status`)).rows
      const summary = Object.fromEntries(summaryRows.map((row) => [row.status, { count: Number(row.count), amount: Number(row.amount) }]))
      return { items: rows.map(mapInquiry), total, page: currentPage, pageSize: size, summary }
    },

    get,

    async create(rawInput, actor) {
      const input = normalizeBusinessInquiryInput(rawInput); const by = actorDetails(actor); const id = randomUUID(); const inquiryNo = generatedNumber('INQ')
      await withTransaction(pool, async (client) => {
        let customerName = input.customerName; let vehicleLabel = input.vehicleLabel; let vin = input.vin; let contactName = input.contactName; let contactPhone = input.contactPhone
        if (input.customerPartnerId) {
          const partner = (await client.query('SELECT * FROM business_partner WHERE id=$1', [input.customerPartnerId])).rows[0]
          if (!partner || !['customer', 'both'].includes(partner.partner_type)) throw problem('INVALID_CUSTOMER_PARTNER', '关联的客户或门店不存在', 400)
          if (partner.status !== 'active') throw problem('CUSTOMER_PARTNER_UNAVAILABLE', '关联的客户或门店当前不可用', 409)
          customerName = partner.name
          if (!contactName || !contactPhone) {
            const contact = (await client.query('SELECT * FROM business_partner_contact WHERE partner_id=$1 ORDER BY is_primary DESC,created_at,id LIMIT 1', [partner.id])).rows[0]
            contactName ||= contact?.name || ''
            contactPhone ||= contact?.phone || partner.phone
          }
          if (input.customerVehicleId) {
            const vehicle = (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2', [input.customerVehicleId, partner.id])).rows[0]
            if (!vehicle) throw problem('INVALID_CUSTOMER_VEHICLE', '关联的客户车辆不存在', 400)
            vehicleLabel = vehicle.vehicle_label; vin = vehicle.vin
          }
        } else if (input.customerVehicleId) throw problem('INVALID_CUSTOMER_VEHICLE', '关联客户车辆时必须同时选择客户或门店', 400)
        await client.query(`INSERT INTO business_inquiry (id,inquiry_no,customer_name,customer_partner_id,customer_vehicle_id,contact_name,contact_phone,channel,vehicle_label,vin,priority,assigned_to,next_action,next_action_at,notes,currency,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$17,$18)`, [id, inquiryNo, customerName, input.customerPartnerId, input.customerVehicleId, contactName, contactPhone, input.channel, vehicleLabel, vin, input.priority, input.assignedTo, input.nextAction, input.nextActionAt, input.notes, input.currency, by.id, by.name])
        for (const item of input.items) await client.query(`INSERT INTO business_inquiry_item (id,inquiry_id,line_no,requirement_text,oe_number,requested_quantity,unit,target_brand,catalog_sku_id,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [item.id, id, item.lineNo, item.requirementText, item.oeNumber, item.requestedQuantity, item.unit, item.targetBrand, item.catalogSkuId, item.notes])
        await insertEvent(client, id, 'created', actor, { toStatus: 'new', note: input.notes, snapshot: { inquiryNo, itemCount: input.items.length } })
      })
      return get(id)
    },

    async addOffer(inquiryId, inquiryItemId, rawInput = {}, actor) {
      let supplierName = clean(rawInput?.supplierName); const supplierPartnerId = clean(rawInput?.supplierPartnerId) || null
      if (!supplierName && !supplierPartnerId) throw problem('INVALID_SUPPLIER_OFFER', '供应商名称为必填项')
      const availability = clean(rawInput?.availability) || 'unknown'
      if (!['in_stock', 'ordered', 'backorder', 'unknown'].includes(availability)) throw problem('INVALID_SUPPLIER_OFFER', '供货状态无效')
      const unitPrice = money(rawInput?.unitPrice, '供应商单价'); const freightAmount = money(rawInput?.freightAmount, '运费', { optional: true })
      const leadTimeDays = rawInput?.leadTimeDays === '' || rawInput?.leadTimeDays == null ? null : Number(rawInput.leadTimeDays)
      if (leadTimeDays != null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) throw problem('INVALID_SUPPLIER_OFFER', '到货天数必须是大于等于 0 的整数')
      const by = actorDetails(actor); const offerId = randomUUID()
      await withTransaction(pool, async (client) => {
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [inquiryId])).rows[0]
        if (!inquiry) throw problem('INQUIRY_NOT_FOUND', '询价不存在', 404)
        if (terminalStatuses.has(inquiry.status)) throw problem('INQUIRY_CLOSED', '已结束的询价不能继续录入供应商报价', 409)
        const item = (await client.query('SELECT id FROM business_inquiry_item WHERE id=$1 AND inquiry_id=$2', [inquiryItemId, inquiryId])).rows[0]
        if (!item) throw problem('INQUIRY_ITEM_NOT_FOUND', '询价需求项不存在', 404)
        if (supplierPartnerId) {
          const partner = (await client.query('SELECT * FROM business_partner WHERE id=$1', [supplierPartnerId])).rows[0]
          if (!partner || !['supplier', 'both'].includes(partner.partner_type)) throw problem('INVALID_SUPPLIER_PARTNER', '关联的供应商不存在', 400)
          if (partner.status !== 'active') throw problem('SUPPLIER_PARTNER_UNAVAILABLE', '关联的供应商当前不可用', 409)
          supplierName = partner.name
        }
        if (rawInput?.selected) await client.query('UPDATE business_supplier_offer SET selected=false WHERE inquiry_item_id=$1', [inquiryItemId])
        await client.query(`INSERT INTO business_supplier_offer (id,inquiry_id,inquiry_item_id,supplier_name,supplier_partner_id,brand_label,unit_price,freight_amount,availability,lead_time_days,valid_until,source_note,selected,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [offerId, inquiryId, inquiryItemId, supplierName, supplierPartnerId, clean(rawInput.brandLabel), unitPrice, freightAmount, availability, leadTimeDays, optionalDate(rawInput.validUntil, '供应商报价有效期'), clean(rawInput.sourceNote), Boolean(rawInput.selected), by.id, by.name])
        const nextStatus = inquiry.status === 'new' ? 'sourcing' : inquiry.status
        await client.query('UPDATE business_inquiry SET status=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1', [inquiryId, nextStatus, by.id, by.name])
        await insertEvent(client, inquiryId, 'supplier_offer_added', actor, { fromStatus: inquiry.status, toStatus: nextStatus, note: supplierName, snapshot: { offerId, inquiryItemId, unitPrice, availability } })
      })
      return get(inquiryId)
    },

    async createQuote(inquiryId, rawInput = {}, actor) {
      const requested = Array.isArray(rawInput?.items) ? rawInput.items : []
      const discountAmount = money(rawInput?.discountAmount, '优惠金额', { optional: true }); const freightAmount = money(rawInput?.freightAmount, '报价运费', { optional: true })
      const by = actorDetails(actor); const quoteId = randomUUID(); const quoteNo = generatedNumber('QT')
      await withTransaction(pool, async (client) => {
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [inquiryId])).rows[0]
        if (!inquiry) throw problem('INQUIRY_NOT_FOUND', '询价不存在', 404)
        if (terminalStatuses.has(inquiry.status)) throw problem('INQUIRY_CLOSED', '已结束的询价不能生成报价', 409)
        const itemRows = (await client.query('SELECT * FROM business_inquiry_item WHERE inquiry_id=$1 ORDER BY line_no', [inquiryId])).rows
        if (!requested.length || requested.length !== itemRows.length) throw problem('INVALID_QUOTE_ITEMS', '报价必须覆盖当前询价的全部需求项')
        const normalized = []
        for (const item of itemRows) {
          const draft = requested.find((candidate) => candidate.inquiryItemId === item.id)
          if (!draft) throw problem('INVALID_QUOTE_ITEMS', `第 ${item.line_no} 项需求缺少报价`)
          let offer = null
          if (clean(draft.supplierOfferId)) {
            offer = (await client.query('SELECT * FROM business_supplier_offer WHERE id=$1 AND inquiry_id=$2 AND inquiry_item_id=$3', [draft.supplierOfferId, inquiryId, item.id])).rows[0]
            if (!offer) throw problem('INVALID_QUOTE_ITEMS', `第 ${item.line_no} 项选择的供应商报价无效`)
          }
          const saleUnitPrice = money(draft.saleUnitPrice, `第 ${item.line_no} 项销售单价`)
          const costUnitPrice = offer ? Number(offer.unit_price) : money(draft.costUnitPrice, `第 ${item.line_no} 项成本价`, { optional: true })
          normalized.push({ id: randomUUID(), item, offer, description: clean(draft.description) || item.requirement_text, costUnitPrice, saleUnitPrice, lineTotal: Math.round(Number(item.requested_quantity) * saleUnitPrice * 100) / 100 })
        }
        const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0)
        if (discountAmount > subtotal + freightAmount) throw problem('INVALID_BUSINESS_AMOUNT', '优惠金额不能大于报价金额')
        const totalAmount = Math.round((subtotal + freightAmount - discountAmount) * 100) / 100
        const marginAmount = Math.round((subtotal - normalized.reduce((sum, item) => sum + Number(item.item.requested_quantity) * item.costUnitPrice, 0) - discountAmount) * 100) / 100
        await client.query(`INSERT INTO business_quote (id,inquiry_id,quote_no,currency,valid_until,subtotal,discount_amount,freight_amount,total_amount,margin_amount,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [quoteId, inquiryId, quoteNo, inquiry.currency, optionalDate(rawInput.validUntil, '报价有效期'), subtotal, discountAmount, freightAmount, totalAmount, marginAmount, clean(rawInput.note), by.id, by.name])
        for (const entry of normalized) await client.query(`INSERT INTO business_quote_item (id,quote_id,inquiry_item_id,supplier_offer_id,line_no,description,oe_number,quantity,unit,cost_unit_price,sale_unit_price,line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [entry.id, quoteId, entry.item.id, entry.offer?.id || null, entry.item.line_no, entry.description, entry.item.oe_number, entry.item.requested_quantity, entry.item.unit, entry.costUnitPrice, entry.saleUnitPrice, entry.lineTotal])
        await client.query(`UPDATE business_inquiry SET status='quoting',quote_amount=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1`, [inquiryId, totalAmount, by.id, by.name])
        await insertEvent(client, inquiryId, 'quote_created', actor, { fromStatus: inquiry.status, toStatus: 'quoting', note: clean(rawInput.note), snapshot: { quoteId, quoteNo, subtotal, totalAmount, marginAmount } })
      })
      return get(inquiryId)
    },

    async sendQuote(quoteId, rawInput = {}, actor) {
      let inquiryId = ''
      await withTransaction(pool, async (client) => {
        const quote = (await client.query('SELECT * FROM business_quote WHERE id=$1 FOR UPDATE', [quoteId])).rows[0]
        if (!quote) throw problem('QUOTE_NOT_FOUND', '报价单不存在', 404)
        if (quote.state !== 'draft') throw problem('QUOTE_STATE_CONFLICT', '只有草稿报价可以发送', 409)
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [quote.inquiry_id])).rows[0]
        if (!inquiry || terminalStatuses.has(inquiry.status)) throw problem('INQUIRY_CLOSED', '关联询价已结束，不能发送报价', 409)
        const expectedRevision = Number(rawInput?.expectedRevision)
        if (!Number.isInteger(expectedRevision) || expectedRevision !== quote.revision) throw problem('QUOTE_VERSION_CONFLICT', '报价单版本已变化，请刷新后再发送', 409, { currentRevision: quote.revision })
        const by = actorDetails(actor); inquiryId = inquiry.id
        await client.query(`UPDATE business_quote SET state='sent',revision=revision+1,sent_at=now(),updated_at=now() WHERE id=$1`, [quoteId])
        await client.query(`UPDATE business_inquiry SET status='quoted',next_action=$2,next_action_at=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1`, [inquiry.id, clean(rawInput.nextAction) || '跟进客户报价反馈', optionalTimestamp(rawInput.nextActionAt, '下一步时间'), by.id, by.name])
        await insertEvent(client, inquiry.id, 'quote_sent', actor, { fromStatus: inquiry.status, toStatus: 'quoted', note: clean(rawInput.note), snapshot: { quoteId, quoteNo: quote.quote_no, totalAmount: Number(quote.total_amount) } })
      })
      return get(inquiryId)
    },

    async transition(id, rawInput = {}, actor) {
      const nextStatus = clean(rawInput?.status)
      if (!inquiryStatuses.has(nextStatus)) throw problem('INVALID_INQUIRY_STATUS', '询价状态无效')
      await withTransaction(pool, async (client) => {
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!inquiry) throw problem('INQUIRY_NOT_FOUND', '询价不存在', 404)
        if (Number(rawInput?.expectedVersion) !== inquiry.version) throw problem('INQUIRY_VERSION_CONFLICT', '询价已被其他操作更新，请刷新后重试', 409, { currentVersion: inquiry.version })
        if (!transitions[inquiry.status]?.has(nextStatus)) throw problem('INVALID_INQUIRY_TRANSITION', `不能从 ${inquiry.status} 变更为 ${nextStatus}`, 409)
        const by = actorDetails(actor)
        const nextActionAt = optionalTimestamp(rawInput.nextActionAt, '下一步时间')
        await client.query(`UPDATE business_inquiry SET status=$2,next_action=$3,next_action_at=$4,version=version+1,updated_by_id=$5,updated_by_name=$6,updated_at=now() WHERE id=$1`, [id, nextStatus, clean(rawInput.nextAction), nextActionAt, by.id, by.name])
        if (nextStatus === 'won' || nextStatus === 'lost') await client.query(`UPDATE business_quote SET state=$2,revision=revision+1,updated_at=now() WHERE id=(SELECT id FROM business_quote WHERE inquiry_id=$1 AND state='sent' ORDER BY sent_at DESC,created_at DESC LIMIT 1)`, [id, nextStatus === 'won' ? 'accepted' : 'rejected'])
        await insertEvent(client, id, 'status_changed', actor, { fromStatus: inquiry.status, toStatus: nextStatus, note: clean(rawInput.note), snapshot: { nextAction: clean(rawInput.nextAction), nextActionAt } })
      })
      return get(id)
    },
  }
}
