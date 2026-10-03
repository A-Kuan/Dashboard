import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'
import { evaluateQuoteRisk, readBusinessControls } from './business-quote-policy.mjs'
import { evaluateAndRecordQuoteIntegrity } from './business-quote-integrity.mjs'
import { buildPricingDecision, decisionFingerprint, summarizePriceSamples } from './business-quote-decision.mjs'

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
function requestKey(value) {
  const normalized = clean(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized)) throw problem('INVALID_QUICK_QUOTE_REQUEST_KEY', '快速报价请求编号必须为 8 至 128 位安全字符')
  return normalized
}
function businessStockKey(row) {
  if (clean(row.catalog_sku_id ?? row.catalogSkuId)) return `sku:${clean(row.catalog_sku_id ?? row.catalogSkuId)}`
  const oe = clean(row.oe_number ?? row.oeNumber).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return oe ? `oe:${oe}` : `inquiry:${clean(row.inquiry_item_id ?? row.id)}`
}

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
    vehiclePlatformId: clean(input.vehiclePlatformId) || null, vehicleVariantId: clean(input.vehicleVariantId) || null,
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
    vehiclePlatformId: row.vehicle_platform_id, vehicleVariantId: row.vehicle_variant_id,
    status: row.status, priority: row.priority, assignedTo: row.assigned_to, nextAction: row.next_action,
    nextActionAt: row.next_action_at, notes: row.notes, currency: row.currency,
    quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount), version: row.version,
    createdById: row.created_by_id, createdByName: row.created_by_name, updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    itemCount: Number(row.item_count || 0), offerCount: Number(row.offer_count || 0), quoteCount: Number(row.quote_count || 0),
  }
}
function mapInquiryCustomer(row) {
  return { id: row.id, partnerNo: row.partner_no, name: row.name, shortName: row.short_name, phone: row.phone, status: row.status, version: row.version, contactCount: Number(row.contact_count || 0), vehicleCount: Number(row.vehicle_count || 0) }
}
function mapItem(row) {
  return { id: row.id, inquiryId: row.inquiry_id, lineNo: row.line_no, requirementText: row.requirement_text, oeNumber: row.oe_number, requestedQuantity: Number(row.requested_quantity), unit: row.unit, targetBrand: row.target_brand, catalogSkuId: row.catalog_sku_id, catalogSkuVersion: row.catalog_sku_version, skuCodeSnapshot: row.sku_code_snapshot, skuNameSnapshot: row.sku_name_snapshot, brandSnapshot: row.brand_snapshot, fitmentSnapshot: row.fitment_snapshot || {}, notes: row.notes }
}
function mapOffer(row) {
  return { id: row.id, inquiryId: row.inquiry_id, inquiryItemId: row.inquiry_item_id, supplierName: row.supplier_name, supplierPartnerId: row.supplier_partner_id, brandLabel: row.brand_label, unitPrice: Number(row.unit_price), freightAmount: Number(row.freight_amount), availability: row.availability, leadTimeDays: row.lead_time_days, validUntil: row.valid_until, sourceNote: row.source_note, selected: row.selected, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at }
}
function mapQuote(row) {
  return { id: row.id, inquiryId: row.inquiry_id, quoteNo: row.quote_no, revision: row.revision, lineageId: row.lineage_id, versionNo: row.version_no, predecessorQuoteId: row.predecessor_quote_id, supersededByQuoteId: row.superseded_by_quote_id, changeReason: row.change_reason, state: row.state, creationMode: row.creation_mode, requestKey: row.request_key, currency: row.currency, validUntil: row.valid_until, subtotal: Number(row.subtotal), discountAmount: Number(row.discount_amount), freightAmount: Number(row.freight_amount), totalAmount: Number(row.total_amount), marginAmount: Number(row.margin_amount), marginRate: Number(row.margin_rate), approvalStatus: row.approval_status, riskReasons: row.risk_reasons || [], riskSnapshot: row.risk_snapshot || {}, approvalFingerprint: row.approval_fingerprint, approvedRevision: row.approved_revision, approvedById: row.approved_by_id, approvedByName: row.approved_by_name, approvedAt: row.approved_at, approvalNote: row.approval_note, integrityStatus: row.integrity_status, integrityReasons: row.integrity_reasons || [], integritySnapshot: row.integrity_snapshot || {}, integrityFingerprint: row.integrity_fingerprint, integrityValidatedAt: row.integrity_validated_at, integrityValidatedAction: row.integrity_validated_action, note: row.note, sentAt: row.sent_at, supersededAt: row.superseded_at, acceptedAt: row.accepted_at, createdById: row.created_by_id, createdByName: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function quoteSnapshot(quote, items = []) {
  return {
    id: quote.id, quoteNo: quote.quote_no, lineageId: quote.lineage_id, versionNo: quote.version_no,
    state: quote.state, currency: quote.currency, validUntil: quote.valid_until,
    subtotal: Number(quote.subtotal), discountAmount: Number(quote.discount_amount), freightAmount: Number(quote.freight_amount),
    totalAmount: Number(quote.total_amount), marginAmount: Number(quote.margin_amount), marginRate: Number(quote.margin_rate),
    items: items.map((item) => ({ id: item.id, lineNo: item.line_no, description: item.description, quantity: Number(item.quantity), unit: item.unit, costUnitPrice: Number(item.cost_unit_price), saleUnitPrice: Number(item.sale_unit_price), lineTotal: Number(item.line_total), fulfillmentSource: item.fulfillment_source, fulfillmentWarehouseId: item.fulfillment_warehouse_id, supplierOfferId: item.supplier_offer_id })),
  }
}

async function insertQuoteRevisionEvent(client, quote, action, actor, { fromQuote = null, reason = '', beforeSnapshot = {}, afterSnapshot = {}, changeSet = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_quote_revision_event (id,inquiry_id,lineage_id,from_quote_id,to_quote_id,action,actor_id,actor_name,reason,before_snapshot,after_snapshot,change_set)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb)`, [randomUUID(), quote.inquiry_id, quote.lineage_id, fromQuote?.id || null, quote.id, action, by.id, by.name, clean(reason), JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot), JSON.stringify(changeSet)])
}

function fitmentSnapshot(fitment, { overridden = false, overrideReason = '' } = {}) {
  return fitment ? {
    fitmentId: fitment.id, platformMasterId: fitment.platform_master_id, variantMasterId: fitment.variant_master_id,
    vehicleLabel: fitment.vehicle_label, years: fitment.years, yearFrom: fitment.year_from, yearTo: fitment.year_to,
    engineCodes: fitment.engine_codes || [], verificationStatus: fitment.verification_status, overridden, overrideReason,
  } : { fitmentId: '', overridden, overrideReason }
}

function fitmentMatchesVehicle(fitment, vehicle) {
  if (fitment.verification_status !== 'verified') return false
  if (vehicle.variant_master_id && fitment.variant_master_id && fitment.variant_master_id !== vehicle.variant_master_id) return false
  if (vehicle.platform_master_id && fitment.platform_master_id !== vehicle.platform_master_id) return false
  if (vehicle.model_year != null && ((fitment.year_from && vehicle.model_year < fitment.year_from) || (fitment.year_to && vehicle.model_year > fitment.year_to))) return false
  if (vehicle.engine_code && fitment.engine_codes?.length && !fitment.engine_codes.includes(vehicle.engine_code)) return false
  return Boolean(fitment.platform_master_id || fitment.variant_master_id)
}

async function insertEvent(client, inquiryId, action, actor, { fromStatus = '', toStatus = '', note = '', snapshot = {} } = {}) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_inquiry_event (id,inquiry_id,action,from_status,to_status,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), inquiryId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}

async function insertQuoteApprovalEvent(client, quoteId, action, actor, { fromStatus = '', toStatus, note = '', risk }) {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_quote_approval_event (id,quote_id,action,from_status,to_status,actor_id,actor_name,note,risk_reasons,risk_snapshot,fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`, [randomUUID(), quoteId, action, fromStatus, toStatus, by.id, by.name, clean(note), JSON.stringify(risk.reasons), JSON.stringify(risk.snapshot), risk.fingerprint])
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
    const [items, offers, quotes, quoteItems, events, approvalEvents, revisionEvents, integrityEvents] = await Promise.all([
      client.query('SELECT * FROM business_inquiry_item WHERE inquiry_id=$1 ORDER BY line_no', [inquiry.id]),
      client.query('SELECT * FROM business_supplier_offer WHERE inquiry_id=$1 ORDER BY inquiry_item_id,selected DESC,unit_price,created_at', [inquiry.id]),
      client.query('SELECT * FROM business_quote WHERE inquiry_id=$1 ORDER BY created_at DESC', [inquiry.id]),
      client.query(`SELECT qi.* FROM business_quote_item qi JOIN business_quote q ON q.id=qi.quote_id WHERE q.inquiry_id=$1 ORDER BY q.created_at DESC,qi.line_no`, [inquiry.id]),
      client.query('SELECT * FROM business_inquiry_event WHERE inquiry_id=$1 ORDER BY created_at DESC,id DESC', [inquiry.id]),
      client.query(`SELECT e.* FROM business_quote_approval_event e JOIN business_quote q ON q.id=e.quote_id WHERE q.inquiry_id=$1 ORDER BY e.created_at DESC,e.id DESC`, [inquiry.id]),
      client.query('SELECT * FROM business_quote_revision_event WHERE inquiry_id=$1 ORDER BY created_at DESC,id DESC', [inquiry.id]),
      client.query(`SELECT e.* FROM business_quote_integrity_event e JOIN business_quote q ON q.id=e.quote_id WHERE q.inquiry_id=$1 ORDER BY e.created_at DESC,e.id DESC`, [inquiry.id]),
    ])
    const quoteItemRows = quoteItems.rows
    return {
      ...inquiry,
      items: items.rows.map((row) => ({ ...mapItem(row), offers: offers.rows.filter((offer) => offer.inquiry_item_id === row.id).map(mapOffer) })),
      quotes: quotes.rows.map((row) => ({ ...mapQuote(row), items: quoteItemRows.filter((item) => item.quote_id === row.id).map((item) => ({ id: item.id, quoteId: item.quote_id, inquiryItemId: item.inquiry_item_id, supplierOfferId: item.supplier_offer_id, fulfillmentSource: item.fulfillment_source, fulfillmentWarehouseId: item.fulfillment_warehouse_id, catalogSkuId: item.catalog_sku_id, catalogSkuVersion: item.catalog_sku_version, skuCodeSnapshot: item.sku_code_snapshot, skuNameSnapshot: item.sku_name_snapshot, brandSnapshot: item.brand_snapshot, fitmentSnapshot: item.fitment_snapshot || {}, lineNo: item.line_no, description: item.description, oeNumber: item.oe_number, quantity: Number(item.quantity), unit: item.unit, costUnitPrice: Number(item.cost_unit_price), saleUnitPrice: Number(item.sale_unit_price), lineTotal: Number(item.line_total) })), approvalEvents: approvalEvents.rows.filter((event) => event.quote_id === row.id).map((event) => ({ id: event.id, action: event.action, fromStatus: event.from_status, toStatus: event.to_status, actorId: event.actor_id, actorName: event.actor_name, note: event.note, riskReasons: event.risk_reasons, riskSnapshot: event.risk_snapshot, fingerprint: event.fingerprint, createdAt: event.created_at })), integrityEvents: integrityEvents.rows.filter((event) => event.quote_id === row.id).map((event) => ({ id: event.id, action: event.action, result: event.result, fromStatus: event.from_status, toStatus: event.to_status, actorId: event.actor_id, actorName: event.actor_name, reasons: event.reasons, snapshot: event.snapshot, fingerprint: event.fingerprint, createdAt: event.created_at })) })),
      quoteRevisionEvents: revisionEvents.rows.map((event) => ({ id: event.id, lineageId: event.lineage_id, fromQuoteId: event.from_quote_id, toQuoteId: event.to_quote_id, action: event.action, actorId: event.actor_id, actorName: event.actor_name, reason: event.reason, beforeSnapshot: event.before_snapshot, afterSnapshot: event.after_snapshot, changeSet: event.change_set, createdAt: event.created_at })),
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

    async quoteContext({ customerQuery = '', vehicleQuery = '', skuQuery = '', customerId = '', customerVehicleId = '', platformId = '', variantId = '', pageSize = 20 } = {}) {
      const size = Math.min(50, Math.max(1, Number(pageSize) || 20))
      const customerTerm = clean(customerQuery); const vehicleTerm = clean(vehicleQuery); const skuTerm = clean(skuQuery)
      const customerValues = []; let customerWhere = "p.status='active' AND p.partner_type IN ('customer','both')"
      if (customerTerm) { customerValues.push(`%${customerTerm}%`); customerWhere += ` AND (p.name ILIKE $1 OR p.short_name ILIKE $1 OR p.phone ILIKE $1 OR EXISTS (SELECT 1 FROM business_partner_contact c WHERE c.partner_id=p.id AND (c.name ILIKE $1 OR c.phone ILIKE $1 OR c.wechat ILIKE $1)) OR EXISTS (SELECT 1 FROM business_customer_vehicle v WHERE v.partner_id=p.id AND (v.vin ILIKE $1 OR v.license_plate ILIKE $1 OR v.vehicle_label ILIKE $1)))` }
      customerValues.push(size)
      const customers = (await pool.query(`SELECT p.*,
        (SELECT count(*)::int FROM business_partner_contact c WHERE c.partner_id=p.id) contact_count,
        (SELECT count(*)::int FROM business_customer_vehicle v WHERE v.partner_id=p.id) vehicle_count
        FROM business_partner p WHERE ${customerWhere} ORDER BY p.updated_at DESC LIMIT $${customerValues.length}`, customerValues)).rows.map(mapInquiryCustomer)
      const suppliers = (await pool.query(`SELECT p.id,p.partner_no,p.name,p.short_name,p.phone,p.status,p.version
        FROM business_partner p WHERE p.status='active' AND p.partner_type IN ('supplier','both')
        ORDER BY p.updated_at DESC LIMIT $1`, [size])).rows.map((row) => ({ id: row.id, partnerNo: row.partner_no, name: row.name, shortName: row.short_name, phone: row.phone, status: row.status, version: row.version }))
      const warehouses = (await pool.query("SELECT id,warehouse_code,name,address,is_default FROM business_warehouse WHERE status='active' ORDER BY is_default DESC,name,id LIMIT $1", [size])).rows.map((row) => ({ id: row.id, warehouseCode: row.warehouse_code, name: row.name, address: row.address, isDefault: row.is_default }))

      let customer = null; let selectedVehicle = null
      if (clean(customerId)) {
        const partner = (await pool.query("SELECT * FROM business_partner WHERE id=$1 AND status='active' AND partner_type IN ('customer','both')", [clean(customerId)])).rows[0]
        if (!partner) throw problem('INVALID_QUICK_QUOTE_CUSTOMER', '快速报价选择的客户不存在或不可用', 400)
        const [contacts, vehicles] = await Promise.all([
          pool.query('SELECT * FROM business_partner_contact WHERE partner_id=$1 ORDER BY is_primary DESC,created_at,id', [partner.id]),
          pool.query('SELECT * FROM business_customer_vehicle WHERE partner_id=$1 ORDER BY updated_at DESC,id', [partner.id]),
        ])
        customer = { ...mapInquiryCustomer(partner), contacts: contacts.rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, wechat: row.wechat, isPrimary: row.is_primary })), vehicles: vehicles.rows.map((row) => ({ id: row.id, vehicleLabel: row.vehicle_label, vin: row.vin, licensePlate: row.license_plate, platformCode: row.platform_code, platformMasterId: row.platform_master_id, variantMasterId: row.variant_master_id, engineCode: row.engine_code, modelYear: row.model_year })) }
        if (clean(customerVehicleId)) {
          selectedVehicle = vehicles.rows.find((row) => row.id === clean(customerVehicleId)) || null
          if (!selectedVehicle) throw problem('INVALID_QUICK_QUOTE_VEHICLE', '快速报价选择的客户车辆不存在', 400)
        }
      }

      const vehicleValues = []; const vehicleClauses = ["p.lifecycle_status='active'", "v.lifecycle_status='active'"]
      if (vehicleTerm) { vehicleValues.push(`%${vehicleTerm}%`); vehicleClauses.push(`(p.platform_code ILIKE $${vehicleValues.length} OR p.brand_label ILIKE $${vehicleValues.length} OR p.series_label ILIKE $${vehicleValues.length} OR v.variant_code ILIKE $${vehicleValues.length} OR v.variant_label ILIKE $${vehicleValues.length})`) }
      vehicleValues.push(size)
      const vehicles = (await pool.query(`SELECT v.id,v.variant_code,v.variant_label,v.year_from,v.year_to,v.engine_codes,v.transmission_codes,v.market_codes,v.body_styles,v.drive_types,v.pr_codes,p.id platform_id,p.platform_code,p.brand_label,p.series_label
        FROM catalog_vehicle_variant v JOIN catalog_vehicle_platform p ON p.id=v.platform_id WHERE ${vehicleClauses.join(' AND ')} ORDER BY p.brand_label,p.series_label,v.variant_label LIMIT $${vehicleValues.length}`, vehicleValues)).rows.map((row) => ({ id: row.id, variantCode: row.variant_code, variantLabel: row.variant_label, yearFrom: row.year_from, yearTo: row.year_to, engineCodes: row.engine_codes, transmissionCodes: row.transmission_codes, marketCodes: row.market_codes, bodyStyles: row.body_styles, driveTypes: row.drive_types, prCodes: row.pr_codes, platformId: row.platform_id, platformCode: row.platform_code, brandLabel: row.brand_label, seriesLabel: row.series_label }))
      const platformValues = []; const platformClauses = ["p.lifecycle_status='active'"]
      if (vehicleTerm) { platformValues.push(`%${vehicleTerm}%`); platformClauses.push(`(p.platform_code ILIKE $${platformValues.length} OR p.brand_label ILIKE $${platformValues.length} OR p.series_label ILIKE $${platformValues.length} OR p.generation_label ILIKE $${platformValues.length})`) }
      platformValues.push(size)
      const platforms = (await pool.query(`SELECT p.* FROM catalog_vehicle_platform p WHERE ${platformClauses.join(' AND ')} ORDER BY p.brand_label,p.series_label,p.generation_label LIMIT $${platformValues.length}`, platformValues)).rows.map((row) => ({ id: row.id, platformCode: row.platform_code, brandLabel: row.brand_label, seriesLabel: row.series_label, generationLabel: row.generation_label, yearFrom: row.year_from, yearTo: row.year_to, marketCodes: row.market_codes, bodyStyles: row.body_styles }))

      let vehicleContext = selectedVehicle
      if (!vehicleContext && clean(variantId)) vehicleContext = (await pool.query('SELECT v.id variant_master_id,v.platform_id platform_master_id,v.engine_codes,p.platform_code FROM catalog_vehicle_variant v JOIN catalog_vehicle_platform p ON p.id=v.platform_id WHERE v.id=$1', [clean(variantId)])).rows[0] || null
      if (!vehicleContext && clean(platformId)) vehicleContext = { platform_master_id: clean(platformId), variant_master_id: null, model_year: null, engine_code: '' }
      const normalizedSku = skuTerm.toUpperCase().replace(/[\s._/#+()\-]/g, '')
      const skuValues = []; const skuClauses = ["s.lifecycle_status='verified'", "s.verification_level='verified'"]
      if (skuTerm) {
        skuValues.push(`%${skuTerm}%`, `%${normalizedSku}%`)
        skuClauses.push(`(s.sku_code ILIKE $1 OR s.canonical_name_zh ILIKE $1 OR s.canonical_name_en ILIKE $1 OR s.brand_label ILIKE $1 OR EXISTS (SELECT 1 FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.normalized_value LIKE $2))`)
      }
      skuValues.push(size)
      const skuRows = (await pool.query(`SELECT s.*,
        (SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) primary_oe,
        COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.sort_order,f.created_at) FROM catalog_fitment f WHERE f.sku_id=s.id AND f.verification_status='verified'),'[]'::jsonb) fitments,
        COALESCE((SELECT sum(b.on_hand_quantity) FROM business_inventory_balance b WHERE b.catalog_sku_id=s.id),0)::numeric on_hand_quantity,
        COALESCE((SELECT sum(b.reserved_quantity) FROM business_inventory_balance b WHERE b.catalog_sku_id=s.id),0)::numeric reserved_quantity,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('warehouseId',b.warehouse_id,'warehouseCode',w.warehouse_code,'warehouseName',w.name,'onHandQuantity',b.on_hand_quantity,'reservedQuantity',b.reserved_quantity,'availableQuantity',b.on_hand_quantity-b.reserved_quantity) ORDER BY w.is_default DESC,w.name,b.warehouse_id)
          FROM business_inventory_balance b JOIN business_warehouse w ON w.id=b.warehouse_id WHERE b.catalog_sku_id=s.id AND w.status='active'),'[]'::jsonb) inventory_by_warehouse
        FROM catalog_sku s WHERE ${skuClauses.join(' AND ')} ORDER BY s.updated_at DESC LIMIT $${skuValues.length}`, skuValues)).rows
      const skus = skuRows.map((row) => {
        const fitment = vehicleContext ? row.fitments.find((candidate) => fitmentMatchesVehicle(candidate, vehicleContext)) : null
        return { id: row.id, skuCode: row.sku_code, name: row.canonical_name_zh || row.canonical_name_en, brandLabel: row.brand_label || row.brand_code, categoryLabel: row.category_label || row.category_code, unit: row.unit_label, primaryOe: row.primary_oe || '', version: row.version, onHandQuantity: Number(row.on_hand_quantity), reservedQuantity: Number(row.reserved_quantity), availableQuantity: Number(row.on_hand_quantity) - Number(row.reserved_quantity), inventoryByWarehouse: row.inventory_by_warehouse.map((item) => ({ ...item, onHandQuantity: Number(item.onHandQuantity), reservedQuantity: Number(item.reservedQuantity), availableQuantity: Number(item.availableQuantity) })), fitmentStatus: vehicleContext ? fitment ? 'matched' : 'not_matched' : 'vehicle_required', fitment: fitmentSnapshot(fitment) }
      })
      return { customers, suppliers, warehouses, customer, selectedVehicle: selectedVehicle ? { id: selectedVehicle.id, vehicleLabel: selectedVehicle.vehicle_label, vin: selectedVehicle.vin, licensePlate: selectedVehicle.license_plate, platformCode: selectedVehicle.platform_code, platformMasterId: selectedVehicle.platform_master_id, variantMasterId: selectedVehicle.variant_master_id, engineCode: selectedVehicle.engine_code, modelYear: selectedVehicle.model_year } : null, platforms, vehicles, skus }
    },

    async quoteDecision({ customerId = '', customerVehicleId = '', catalogSkuId = '', quantity: rawQuantity = 1, costUnitPrice: rawCost = null, saleUnitPrice: rawSale = null, lookbackDays: rawLookbackDays = 365 } = {}) {
      const partnerId = clean(customerId); const vehicleId = clean(customerVehicleId); const skuId = clean(catalogSkuId)
      if (!partnerId || !vehicleId || !skuId) throw problem('INVALID_QUOTE_DECISION_CONTEXT', '报价决策必须选择客户、客户车辆和 SKU')
      const requestedQuantity = Number(rawQuantity)
      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || requestedQuantity > 10000) throw problem('INVALID_QUOTE_DECISION_QUANTITY', '报价决策数量必须大于 0 且不超过 10000')
      const lookbackDays = Number(rawLookbackDays)
      if (!Number.isInteger(lookbackDays) || lookbackDays < 30 || lookbackDays > 730) throw problem('INVALID_QUOTE_DECISION_LOOKBACK', '历史参考范围必须为 30 至 730 天')
      const optionalMoney = (value, label) => {
        if (value === '' || value == null) return null
        const normalized = Number(value)
        if (!Number.isFinite(normalized) || normalized < 0 || normalized > 99999999) throw problem('INVALID_BUSINESS_AMOUNT', `${label}必须是有效的非负金额`)
        return Math.round(normalized * 100) / 100
      }
      const costUnitPrice = optionalMoney(rawCost, '参考成本价'); const saleUnitPrice = optionalMoney(rawSale, '拟定销售价')
      const customer = (await pool.query("SELECT * FROM business_partner WHERE id=$1 AND status='active' AND partner_type IN ('customer','both')", [partnerId])).rows[0]
      if (!customer) throw problem('INVALID_QUICK_QUOTE_CUSTOMER', '报价决策选择的客户不存在或不可用', 400)
      const vehicle = (await pool.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2', [vehicleId, partnerId])).rows[0]
      if (!vehicle) throw problem('INVALID_QUICK_QUOTE_VEHICLE', '报价决策选择的客户车辆不存在', 400)
      const sku = (await pool.query(`SELECT s.*,
        (SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) primary_oe,
        COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.sort_order,f.created_at) FROM catalog_fitment f WHERE f.sku_id=s.id AND f.verification_status='verified'),'[]'::jsonb) fitments
        FROM catalog_sku s WHERE s.id=$1 AND s.lifecycle_status='verified' AND s.verification_level='verified'`, [skuId])).rows[0]
      if (!sku) throw problem('INVALID_QUICK_QUOTE_SKU', '报价决策选择的 SKU 不存在或尚未审核', 400)
      const matchedFitment = sku.fitments.find((candidate) => fitmentMatchesVehicle(candidate, vehicle)) || null
      const [configuration, inventoryRows, purchaseRows, offerRows, customerSaleRows, marketSaleRows] = await Promise.all([
        readBusinessControls(pool),
        pool.query(`SELECT b.id,b.warehouse_id,w.warehouse_code,w.name warehouse_name,w.is_default,b.on_hand_quantity,b.reserved_quantity,b.version,b.updated_at,
          (SELECT round((sum(l.on_hand_quantity*l.unit_cost)/NULLIF(sum(l.on_hand_quantity),0))::numeric,2) FROM business_inventory_lot l WHERE l.warehouse_id=b.warehouse_id AND l.catalog_sku_id=b.catalog_sku_id AND l.on_hand_quantity>0) weighted_unit_cost
          FROM business_inventory_balance b JOIN business_warehouse w ON w.id=b.warehouse_id
          WHERE b.catalog_sku_id=$1 AND w.status='active' ORDER BY w.is_default DESC,w.name,b.warehouse_id`, [sku.id]),
        pool.query(`SELECT poi.id reference_id,poi.cost_unit_price,po.order_no reference_no,po.supplier_partner_id,po.supplier_name,po.created_at reference_at
          FROM business_purchase_order_item poi JOIN business_purchase_order po ON po.id=poi.purchase_order_id
          WHERE poi.catalog_sku_id=$1 AND po.status<>'cancelled' AND po.created_at>=now()-($2::int*interval '1 day')
          ORDER BY po.created_at DESC,poi.id DESC LIMIT 20`, [sku.id, lookbackDays]),
        pool.query(`SELECT o.id reference_id,o.unit_price cost_unit_price,i.inquiry_no reference_no,o.supplier_partner_id,o.supplier_name,o.valid_until,o.created_at reference_at,p.status supplier_status
          FROM business_supplier_offer o JOIN business_inquiry_item ii ON ii.id=o.inquiry_item_id JOIN business_inquiry i ON i.id=o.inquiry_id
          LEFT JOIN business_partner p ON p.id=o.supplier_partner_id
          WHERE ii.catalog_sku_id=$1 AND o.created_at>=now()-($2::int*interval '1 day')
          ORDER BY o.created_at DESC,o.id DESC LIMIT 20`, [sku.id, lookbackDays]),
        pool.query(`SELECT soi.id reference_id,so.order_no reference_no,soi.sale_unit_price,so.status,so.created_at reference_at
          FROM business_sales_order_item soi JOIN business_sales_order so ON so.id=soi.sales_order_id
          WHERE soi.catalog_sku_id=$1 AND so.customer_partner_id=$2 AND so.status<>'cancelled' AND so.created_at>=now()-($3::int*interval '1 day')
          ORDER BY so.created_at DESC,soi.id DESC LIMIT 50`, [sku.id, customer.id, lookbackDays]),
        pool.query(`SELECT soi.id reference_id,so.order_no reference_no,so.customer_partner_id,so.customer_name,soi.sale_unit_price,so.status,so.created_at reference_at
          FROM business_sales_order_item soi JOIN business_sales_order so ON so.id=soi.sales_order_id
          WHERE soi.catalog_sku_id=$1 AND so.status<>'cancelled' AND so.created_at>=now()-($2::int*interval '1 day')
          ORDER BY so.created_at DESC,soi.id DESC LIMIT 100`, [sku.id, lookbackDays]),
      ])
      const inventoryOptions = inventoryRows.rows.map((row) => ({
        inventoryBalanceId: row.id, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, isDefault: row.is_default,
        onHandQuantity: Number(row.on_hand_quantity), reservedQuantity: Number(row.reserved_quantity), availableQuantity: Number(row.on_hand_quantity) - Number(row.reserved_quantity),
        weightedUnitCost: row.weighted_unit_cost == null ? null : Number(row.weighted_unit_cost), canFulfillQuantity: Number(row.on_hand_quantity) - Number(row.reserved_quantity) >= requestedQuantity,
        balanceVersion: row.version, updatedAt: row.updated_at,
      }))
      const costReferences = [
        ...purchaseRows.rows.map((row) => ({ referenceType: 'purchase_order', referenceId: row.reference_id, referenceNo: row.reference_no, supplierPartnerId: row.supplier_partner_id, supplierName: row.supplier_name, unitCost: Number(row.cost_unit_price), validUntil: null, supplierStatus: '', referenceAt: row.reference_at, referenceOnly: true })),
        ...offerRows.rows.map((row) => ({ referenceType: 'supplier_offer', referenceId: row.reference_id, referenceNo: row.reference_no, supplierPartnerId: row.supplier_partner_id, supplierName: row.supplier_name, unitCost: Number(row.cost_unit_price), validUntil: row.valid_until, supplierStatus: row.supplier_status || '', referenceAt: row.reference_at, referenceOnly: true })),
      ].sort((a, b) => new Date(b.referenceAt).valueOf() - new Date(a.referenceAt).valueOf()).slice(0, 20)
      const customerSales = customerSaleRows.rows.map((row) => ({ referenceId: row.reference_id, orderNo: row.reference_no, unitPrice: Number(row.sale_unit_price), orderStatus: row.status, referenceAt: row.reference_at }))
      const marketSales = marketSaleRows.rows.map((row) => ({ referenceId: row.reference_id, orderNo: row.reference_no, customerPartnerId: row.customer_partner_id, customerName: row.customer_name, unitPrice: Number(row.sale_unit_price), orderStatus: row.status, referenceAt: row.reference_at }))
      const pricing = buildPricingDecision({ marginControlEnabled: configuration.controls.marginControlEnabled, minimumMarginRate: configuration.controls.minimumMarginRate, quantity: requestedQuantity, costUnitPrice, saleUnitPrice, customerPrices: customerSales.map((row) => row.unitPrice), marketPrices: marketSales.map((row) => row.unitPrice) })
      const warnings = [...pricing.warnings]
      if (!matchedFitment) warnings.unshift('fitment_review_required')
      if (!inventoryOptions.some((option) => option.canFulfillQuantity)) warnings.push('stock_source_unavailable')
      if (!costReferences.length && !inventoryOptions.some((option) => option.weightedUnitCost != null)) warnings.push('cost_history_unavailable')
      const snapshot = {
        customer: { id: customer.id, version: customer.version }, vehicle: { id: vehicle.id, version: vehicle.version, platformMasterId: vehicle.platform_master_id, variantMasterId: vehicle.variant_master_id },
        sku: { id: sku.id, version: sku.version }, fitmentId: matchedFitment?.id || '', requestedQuantity, controlsVersion: configuration.version,
        inventory: inventoryOptions.map((row) => ({ warehouseId: row.warehouseId, balanceVersion: row.balanceVersion, availableQuantity: row.availableQuantity, weightedUnitCost: row.weightedUnitCost })),
        costReferenceIds: costReferences.map((row) => row.referenceId), customerHistory: pricing.customerHistory, marketHistory: pricing.marketHistory, pricing: { costUnitPrice: pricing.costUnitPrice, saleUnitPrice: pricing.saleUnitPrice, marginFloorUnitPrice: pricing.marginFloorUnitPrice, suggestedUnitPrice: pricing.suggestedUnitPrice },
      }
      return {
        generatedAt: new Date().toISOString(), lookbackDays, decisionFingerprint: decisionFingerprint(snapshot),
        customer: { id: customer.id, partnerNo: customer.partner_no, name: customer.name, paymentTermsDays: customer.payment_terms_days, creditLimit: Number(customer.credit_limit), version: customer.version },
        vehicle: { id: vehicle.id, vehicleLabel: vehicle.vehicle_label, vin: vehicle.vin, licensePlate: vehicle.license_plate, platformCode: vehicle.platform_code, platformMasterId: vehicle.platform_master_id, variantMasterId: vehicle.variant_master_id, engineCode: vehicle.engine_code, modelYear: vehicle.model_year, version: vehicle.version },
        sku: { id: sku.id, skuCode: sku.sku_code, name: sku.canonical_name_zh || sku.canonical_name_en, brandLabel: sku.brand_label || sku.brand_code, categoryLabel: sku.category_label || sku.category_code, unit: sku.unit_label, primaryOe: sku.primary_oe || '', version: sku.version },
        fitment: { status: matchedFitment ? 'matched' : 'review_required', evidence: fitmentSnapshot(matchedFitment) },
        fulfillment: { requestedQuantity, inventoryOptions, costReferences, costHistory: summarizePriceSamples(costReferences.map((row) => row.unitCost)), referencesAreReusable: false },
        salesHistory: { customer: customerSales, market: marketSales }, pricing, warnings,
        controls: { version: configuration.version, ...configuration.controls },
        guidance: '历史价格和供应商报价仅作参考；创建报价时仍需确认当前成本、履约来源与适配证据。',
      }
    },

    async createQuickQuote(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey); const customerPartnerId = clean(rawInput.customerPartnerId); const customerVehicleId = clean(rawInput.customerVehicleId)
      const requested = Array.isArray(rawInput.items) ? rawInput.items : []
      if (!customerPartnerId) throw problem('INVALID_QUICK_QUOTE_CUSTOMER', '快速报价必须选择客户或门店')
      if (!customerVehicleId) throw problem('INVALID_QUICK_QUOTE_VEHICLE', '快速报价必须选择客户车辆')
      if (!requested.length || requested.length > 50) throw problem('INVALID_QUICK_QUOTE_ITEMS', '快速报价必须包含 1 至 50 个 SKU')
      const discountAmount = money(rawInput.discountAmount, '优惠金额', { optional: true }); const freightAmount = money(rawInput.freightAmount, '报价运费', { optional: true })
      const by = actorDetails(actor)
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-quick-quote:${key}`])
        const existing = (await client.query('SELECT inquiry_id,id FROM business_quote WHERE request_key=$1', [key])).rows[0]
        if (existing) return { created: false, inquiryId: existing.inquiry_id, quoteId: existing.id }
        const customer = (await client.query("SELECT * FROM business_partner WHERE id=$1 AND partner_type IN ('customer','both') FOR SHARE", [customerPartnerId])).rows[0]
        if (!customer || customer.status !== 'active') throw problem('INVALID_QUICK_QUOTE_CUSTOMER', '快速报价选择的客户不存在或不可用', 400)
        const vehicle = (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2 FOR SHARE', [customerVehicleId, customer.id])).rows[0]
        if (!vehicle) throw problem('INVALID_QUICK_QUOTE_VEHICLE', '快速报价选择的客户车辆不存在', 400)
        if (!vehicle.platform_master_id) throw problem('CUSTOMER_VEHICLE_NOT_STANDARDIZED', '客户车辆尚未关联标准车型平台，不能进行 SKU 快速报价', 409)
        const master = (await client.query(`SELECT p.lifecycle_status platform_status,v.lifecycle_status variant_status
          FROM catalog_vehicle_platform p LEFT JOIN catalog_vehicle_variant v ON v.id=$2 AND v.platform_id=p.id WHERE p.id=$1`, [vehicle.platform_master_id, vehicle.variant_master_id])).rows[0]
        if (!master || master.platform_status !== 'active' || (vehicle.variant_master_id && master.variant_status !== 'active')) throw problem('CUSTOMER_VEHICLE_MASTER_UNAVAILABLE', '客户车辆关联的标准车型当前不可用', 409)
        const contact = (await client.query('SELECT * FROM business_partner_contact WHERE partner_id=$1 ORDER BY is_primary DESC,created_at,id LIMIT 1', [customer.id])).rows[0]
        const inquiryId = randomUUID(); const inquiryNo = generatedNumber('INQ'); const quoteId = randomUUID(); const quoteNo = generatedNumber('QT')
        const normalized = []
        for (const [index, draft] of requested.entries()) {
          const skuId = clean(draft.catalogSkuId)
          if (!skuId) throw problem('INVALID_QUICK_QUOTE_ITEMS', `第 ${index + 1} 项必须选择 SKU`)
          const sku = (await client.query(`SELECT s.*,(SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) primary_oe
            FROM catalog_sku s WHERE s.id=$1 FOR SHARE`, [skuId])).rows[0]
          if (!sku || sku.lifecycle_status !== 'verified' || sku.verification_level !== 'verified') throw problem('QUICK_QUOTE_SKU_UNAVAILABLE', `第 ${index + 1} 项 SKU 不存在或尚未通过审核`, 409, { catalogSkuId: skuId })
          const fitments = (await client.query("SELECT * FROM catalog_fitment WHERE sku_id=$1 AND verification_status='verified' ORDER BY sort_order,created_at", [sku.id])).rows
          const fitment = fitments.find((candidate) => fitmentMatchesVehicle(candidate, vehicle)) || null
          const overrideReason = clean(draft.fitmentOverrideReason)
          if (!fitment && overrideReason.length < 8) throw problem('QUICK_QUOTE_FITMENT_NOT_CONFIRMED', `第 ${index + 1} 项 SKU 与客户车辆没有已核验适配，需停止或填写明确的人工复核原因`, 409, { catalogSkuId: sku.id, customerVehicleId: vehicle.id })
          const requestedQuantity = quantity(draft.quantity); const saleUnitPrice = money(draft.saleUnitPrice, `第 ${index + 1} 项销售单价`); const costUnitPrice = money(draft.costUnitPrice, `第 ${index + 1} 项成本价`)
          const fulfillmentSource = clean(draft.fulfillmentSource)
          if (!['stock', 'purchase'].includes(fulfillmentSource)) throw problem('QUICK_QUOTE_FULFILLMENT_SOURCE_REQUIRED', `第 ${index + 1} 项必须选择现货或采购来源`)
          let supplier = null
          let fulfillmentWarehouse = null
          if (fulfillmentSource === 'stock') {
            const fulfillmentWarehouseId = clean(draft.fulfillmentWarehouseId)
            fulfillmentWarehouse = (await client.query("SELECT * FROM business_warehouse WHERE id=$1 AND status='active' FOR SHARE", [fulfillmentWarehouseId])).rows[0]
            if (!fulfillmentWarehouse) throw problem('QUICK_QUOTE_WAREHOUSE_REQUIRED', `第 ${index + 1} 项现货来源必须选择有效仓库`, 409)
            const available = Number((await client.query(`SELECT COALESCE(sum(on_hand_quantity-reserved_quantity),0)::numeric quantity
              FROM business_inventory_balance WHERE warehouse_id=$1 AND catalog_sku_id=$2`, [fulfillmentWarehouse.id, sku.id])).rows[0].quantity)
            if (available < requestedQuantity) throw problem('QUICK_QUOTE_STOCK_INSUFFICIENT', `第 ${index + 1} 项所选仓库可用库存不足，不能按现货报价`, 409, { catalogSkuId: sku.id, fulfillmentWarehouseId: fulfillmentWarehouse.id, requestedQuantity, availableQuantity: available })
          } else {
            if (clean(draft.fulfillmentWarehouseId)) throw problem('QUICK_QUOTE_PURCHASE_WAREHOUSE_CONFLICT', `第 ${index + 1} 项采购来源不能同时指定现货仓库`)
            const supplierPartnerId = clean(draft.supplierPartnerId)
            supplier = (await client.query("SELECT * FROM business_partner WHERE id=$1 AND status='active' AND partner_type IN ('supplier','both') FOR SHARE", [supplierPartnerId])).rows[0]
            if (!supplier) throw problem('QUICK_QUOTE_SUPPLIER_REQUIRED', `第 ${index + 1} 项采购来源必须选择有效供应商`, 409)
          }
          normalized.push({ id: randomUUID(), sku, fitment: fitmentSnapshot(fitment, { overridden: !fitment, overrideReason }), quantity: requestedQuantity, saleUnitPrice, costUnitPrice, fulfillmentSource, fulfillmentWarehouse, supplier, description: clean(draft.description) || sku.canonical_name_zh || sku.canonical_name_en, unit: clean(draft.unit) || sku.unit_label || '件', lineTotal: Math.round(requestedQuantity * saleUnitPrice * 100) / 100 })
        }
        const subtotal = Math.round(normalized.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100
        if (discountAmount > subtotal + freightAmount) throw problem('INVALID_BUSINESS_AMOUNT', '优惠金额不能大于报价金额')
        const totalAmount = Math.round((subtotal + freightAmount - discountAmount) * 100) / 100
        const marginAmount = Math.round((subtotal - normalized.reduce((sum, item) => sum + item.quantity * item.costUnitPrice, 0) - discountAmount) * 100) / 100
        const currency = clean(rawInput.currency).toUpperCase() || 'CNY'
        const risk = await evaluateQuoteRisk(client, { customerPartnerId: customer.id, currency, totalAmount, marginAmount })
        await client.query(`INSERT INTO business_inquiry (id,inquiry_no,customer_name,customer_partner_id,customer_vehicle_id,contact_name,contact_phone,channel,vehicle_label,vin,vehicle_platform_id,vehicle_variant_id,status,priority,assigned_to,next_action,next_action_at,notes,currency,quote_amount,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'quick_quote',$8,$9,$10,$11,'quoting',$12,$13,$14,$15,$16,$17,$18,$19,$20,$19,$20)`, [inquiryId, inquiryNo, customer.name, customer.id, vehicle.id, contact?.name || '', contact?.phone || customer.phone, vehicle.vehicle_label, vehicle.vin, vehicle.platform_master_id, vehicle.variant_master_id, clean(rawInput.priority) || 'normal', clean(rawInput.assignedTo), clean(rawInput.nextAction) || '复核并发送报价', optionalTimestamp(rawInput.nextActionAt, '下一步时间'), clean(rawInput.note), clean(rawInput.currency).toUpperCase() || 'CNY', totalAmount, by.id, by.name])
        await client.query(`INSERT INTO business_quote (id,inquiry_id,quote_no,lineage_id,version_no,creation_mode,request_key,currency,valid_until,subtotal,discount_amount,freight_amount,total_amount,margin_amount,margin_rate,approval_status,risk_reasons,risk_snapshot,approval_fingerprint,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$1,1,'quick',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19)`, [quoteId, inquiryId, quoteNo, key, currency, optionalDate(rawInput.validUntil, '报价有效期'), subtotal, discountAmount, freightAmount, totalAmount, marginAmount, risk.marginRate, risk.required ? 'pending' : 'not_required', JSON.stringify(risk.reasons), JSON.stringify(risk.snapshot), risk.fingerprint, clean(rawInput.note), by.id, by.name])
        for (const [index, item] of normalized.entries()) {
          const inquiryItemId = randomUUID()
          await client.query(`INSERT INTO business_inquiry_item (id,inquiry_id,line_no,requirement_text,oe_number,requested_quantity,unit,target_brand,catalog_sku_id,catalog_sku_version,sku_code_snapshot,sku_name_snapshot,brand_snapshot,fitment_snapshot,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`, [inquiryItemId, inquiryId, index + 1, item.description, item.sku.primary_oe || '', item.quantity, item.unit, item.sku.brand_label || item.sku.brand_code, item.sku.id, item.sku.version, item.sku.sku_code, item.sku.canonical_name_zh || item.sku.canonical_name_en, item.sku.brand_label || item.sku.brand_code, JSON.stringify(item.fitment), clean(requested[index].notes)])
          let supplierOfferId = null
          if (item.fulfillmentSource === 'purchase') {
            supplierOfferId = randomUUID()
            await client.query(`INSERT INTO business_supplier_offer (id,inquiry_id,inquiry_item_id,supplier_name,supplier_partner_id,brand_label,unit_price,availability,lead_time_days,source_note,selected,created_by_id,created_by_name)
              VALUES ($1,$2,$3,$4,$5,$6,$7,'ordered',$8,'快速报价采购来源',true,$9,$10)`, [supplierOfferId, inquiryId, inquiryItemId, item.supplier.name, item.supplier.id, item.sku.brand_label || item.sku.brand_code, item.costUnitPrice, Number.isInteger(Number(requested[index].leadTimeDays)) ? Number(requested[index].leadTimeDays) : null, by.id, by.name])
          }
          await client.query(`INSERT INTO business_quote_item (id,quote_id,inquiry_item_id,supplier_offer_id,fulfillment_source,fulfillment_warehouse_id,catalog_sku_id,catalog_sku_version,sku_code_snapshot,sku_name_snapshot,brand_snapshot,fitment_snapshot,line_no,description,oe_number,quantity,unit,cost_unit_price,sale_unit_price,line_total)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`, [randomUUID(), quoteId, inquiryItemId, supplierOfferId, item.fulfillmentSource, item.fulfillmentWarehouse?.id || null, item.sku.id, item.sku.version, item.sku.sku_code, item.sku.canonical_name_zh || item.sku.canonical_name_en, item.sku.brand_label || item.sku.brand_code, JSON.stringify(item.fitment), index + 1, item.description, item.sku.primary_oe || '', item.quantity, item.unit, item.costUnitPrice, item.saleUnitPrice, item.lineTotal])
        }
        const createdQuote = (await client.query('SELECT * FROM business_quote WHERE id=$1', [quoteId])).rows[0]
        const createdItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [quoteId])).rows
        await evaluateAndRecordQuoteIntegrity(client, createdQuote, 'created', actor)
        await insertQuoteRevisionEvent(client, createdQuote, 'created', actor, { reason: clean(rawInput.note), afterSnapshot: quoteSnapshot(createdQuote, createdItems) })
        if (risk.required) await insertQuoteApprovalEvent(client, quoteId, 'requested', actor, { toStatus: 'pending', note: clean(rawInput.note), risk })
        await insertEvent(client, inquiryId, 'quick_quote_created', actor, { toStatus: 'quoting', note: clean(rawInput.note), snapshot: { quoteId, quoteNo, requestKey: key, customerPartnerId: customer.id, customerVehicleId: vehicle.id, vehiclePlatformId: vehicle.platform_master_id, vehicleVariantId: vehicle.variant_master_id, itemCount: normalized.length, totalAmount } })
        return { created: true, inquiryId, quoteId }
      })
      return { ...result, inquiry: await get(result.inquiryId) }
    },

    async create(rawInput, actor) {
      const input = normalizeBusinessInquiryInput(rawInput); const by = actorDetails(actor); const id = randomUUID(); const inquiryNo = generatedNumber('INQ')
      await withTransaction(pool, async (client) => {
        let customerName = input.customerName; let vehicleLabel = input.vehicleLabel; let vin = input.vin; let contactName = input.contactName; let contactPhone = input.contactPhone
        let vehiclePlatformId = input.vehiclePlatformId; let vehicleVariantId = input.vehicleVariantId
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
            vehicleLabel = vehicle.vehicle_label; vin = vehicle.vin; vehiclePlatformId = vehicle.platform_master_id; vehicleVariantId = vehicle.variant_master_id
          }
        } else if (input.customerVehicleId) throw problem('INVALID_CUSTOMER_VEHICLE', '关联客户车辆时必须同时选择客户或门店', 400)
        if (vehicleVariantId) {
          const variant = (await client.query(`SELECT v.*,p.id platform_master_id,p.platform_code,p.brand_label,p.series_label,p.lifecycle_status platform_status
            FROM catalog_vehicle_variant v JOIN catalog_vehicle_platform p ON p.id=v.platform_id WHERE v.id=$1`, [vehicleVariantId])).rows[0]
          if (!variant || variant.lifecycle_status !== 'active' || variant.platform_status !== 'active') throw problem('INVALID_INQUIRY_VEHICLE', '关联的标准车型版本不存在或不可用', 409)
          if (vehiclePlatformId && vehiclePlatformId !== variant.platform_master_id) throw problem('INVALID_INQUIRY_VEHICLE', '车型版本不属于所选车型平台', 409)
          vehiclePlatformId = variant.platform_master_id
          vehicleLabel ||= [variant.brand_label, variant.series_label, variant.variant_label].filter(Boolean).join(' ')
        } else if (vehiclePlatformId) {
          const platform = (await client.query('SELECT * FROM catalog_vehicle_platform WHERE id=$1', [vehiclePlatformId])).rows[0]
          if (!platform || platform.lifecycle_status !== 'active') throw problem('INVALID_INQUIRY_VEHICLE', '关联的标准车型平台不存在或不可用', 409)
          vehicleLabel ||= [platform.brand_label, platform.series_label].filter(Boolean).join(' ')
        }
        await client.query(`INSERT INTO business_inquiry (id,inquiry_no,customer_name,customer_partner_id,customer_vehicle_id,contact_name,contact_phone,channel,vehicle_label,vin,vehicle_platform_id,vehicle_variant_id,priority,assigned_to,next_action,next_action_at,notes,currency,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$19,$20)`, [id, inquiryNo, customerName, input.customerPartnerId, input.customerVehicleId, contactName, contactPhone, input.channel, vehicleLabel, vin, vehiclePlatformId, vehicleVariantId, input.priority, input.assignedTo, input.nextAction, input.nextActionAt, input.notes, input.currency, by.id, by.name])
        for (const item of input.items) {
          let sku = null; let fitment = null
          if (item.catalogSkuId) {
            sku = (await client.query(`SELECT s.*,(SELECT raw_value FROM catalog_part_identifier i WHERE i.sku_id=s.id AND i.is_primary ORDER BY i.sort_order LIMIT 1) primary_oe
              FROM catalog_sku s WHERE s.id=$1`, [item.catalogSkuId])).rows[0]
            if (!sku) throw problem('CATALOG_SKU_NOT_FOUND', `第 ${item.lineNo} 项关联的 SKU 不存在`, 400)
            const fitments = (await client.query('SELECT * FROM catalog_fitment WHERE sku_id=$1 ORDER BY verification_status=\'verified\' DESC,sort_order,created_at', [sku.id])).rows
            fitment = fitments.find((candidate) => fitmentMatchesVehicle(candidate, { platform_master_id: vehiclePlatformId, variant_master_id: vehicleVariantId })) || null
          }
          const snapshot = fitmentSnapshot(fitment)
          await client.query(`INSERT INTO business_inquiry_item (id,inquiry_id,line_no,requirement_text,oe_number,requested_quantity,unit,target_brand,catalog_sku_id,catalog_sku_version,sku_code_snapshot,sku_name_snapshot,brand_snapshot,fitment_snapshot,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`, [item.id, id, item.lineNo, item.requirementText, item.oeNumber || sku?.primary_oe || '', item.requestedQuantity, item.unit, item.targetBrand, item.catalogSkuId, sku?.version || null, sku?.sku_code || '', sku?.canonical_name_zh || '', sku?.brand_label || sku?.brand_code || '', JSON.stringify(snapshot), item.notes])
        }
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
          const fulfillmentSource = clean(draft.fulfillmentSource) || (offer ? 'purchase' : 'stock')
          if (!['stock', 'purchase'].includes(fulfillmentSource)) throw problem('INVALID_QUOTE_FULFILLMENT_SOURCE', `第 ${item.line_no} 项履约来源无效`)
          if (fulfillmentSource === 'purchase' && !offer) throw problem('QUOTE_SUPPLIER_SOURCE_REQUIRED', `第 ${item.line_no} 项选择采购时必须关联供应商报价`)
          if (fulfillmentSource === 'stock' && offer) throw problem('QUOTE_STOCK_SOURCE_CONFLICT', `第 ${item.line_no} 项选择现货时不能同时关联供应商报价`)
          let fulfillmentWarehouse = null
          if (fulfillmentSource === 'stock') {
            fulfillmentWarehouse = (await client.query("SELECT * FROM business_warehouse WHERE id=$1 AND status='active' FOR SHARE", [clean(draft.fulfillmentWarehouseId)])).rows[0]
            if (!fulfillmentWarehouse) throw problem('QUOTE_WAREHOUSE_REQUIRED', `第 ${item.line_no} 项选择现货时必须指定有效仓库`)
            const available = Number((await client.query('SELECT COALESCE(on_hand_quantity-reserved_quantity,0)::numeric quantity FROM business_inventory_balance WHERE warehouse_id=$1 AND stock_key=$2', [fulfillmentWarehouse.id, businessStockKey(item)])).rows[0]?.quantity || 0)
            if (available < Number(item.requested_quantity)) throw problem('QUOTE_STOCK_INSUFFICIENT', `第 ${item.line_no} 项所选仓库可用库存不足`, 409, { fulfillmentWarehouseId: fulfillmentWarehouse.id, requestedQuantity: Number(item.requested_quantity), availableQuantity: available })
          } else if (clean(draft.fulfillmentWarehouseId)) throw problem('QUOTE_PURCHASE_WAREHOUSE_CONFLICT', `第 ${item.line_no} 项采购来源不能同时指定现货仓库`)
          const saleUnitPrice = money(draft.saleUnitPrice, `第 ${item.line_no} 项销售单价`)
          const costUnitPrice = offer ? Number(offer.unit_price) : money(draft.costUnitPrice, `第 ${item.line_no} 项成本价`, { optional: true })
          normalized.push({ id: randomUUID(), item, offer, fulfillmentSource, fulfillmentWarehouse, description: clean(draft.description) || item.requirement_text, costUnitPrice, saleUnitPrice, lineTotal: Math.round(Number(item.requested_quantity) * saleUnitPrice * 100) / 100 })
        }
        const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0)
        if (discountAmount > subtotal + freightAmount) throw problem('INVALID_BUSINESS_AMOUNT', '优惠金额不能大于报价金额')
        const totalAmount = Math.round((subtotal + freightAmount - discountAmount) * 100) / 100
        const marginAmount = Math.round((subtotal - normalized.reduce((sum, item) => sum + Number(item.item.requested_quantity) * item.costUnitPrice, 0) - discountAmount) * 100) / 100
        const risk = await evaluateQuoteRisk(client, { customerPartnerId: inquiry.customer_partner_id, currency: inquiry.currency, totalAmount, marginAmount })
        await client.query(`INSERT INTO business_quote (id,inquiry_id,quote_no,lineage_id,version_no,currency,valid_until,subtotal,discount_amount,freight_amount,total_amount,margin_amount,margin_rate,approval_status,risk_reasons,risk_snapshot,approval_fingerprint,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$1,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18)`, [quoteId, inquiryId, quoteNo, inquiry.currency, optionalDate(rawInput.validUntil, '报价有效期'), subtotal, discountAmount, freightAmount, totalAmount, marginAmount, risk.marginRate, risk.required ? 'pending' : 'not_required', JSON.stringify(risk.reasons), JSON.stringify(risk.snapshot), risk.fingerprint, clean(rawInput.note), by.id, by.name])
        for (const entry of normalized) await client.query(`INSERT INTO business_quote_item (id,quote_id,inquiry_item_id,supplier_offer_id,fulfillment_source,fulfillment_warehouse_id,catalog_sku_id,catalog_sku_version,sku_code_snapshot,sku_name_snapshot,brand_snapshot,fitment_snapshot,line_no,description,oe_number,quantity,unit,cost_unit_price,sale_unit_price,line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`, [entry.id, quoteId, entry.item.id, entry.offer?.id || null, entry.fulfillmentSource, entry.fulfillmentWarehouse?.id || null, entry.item.catalog_sku_id, entry.item.catalog_sku_version, entry.item.sku_code_snapshot, entry.item.sku_name_snapshot, entry.item.brand_snapshot, JSON.stringify(entry.item.fitment_snapshot || {}), entry.item.line_no, entry.description, entry.item.oe_number, entry.item.requested_quantity, entry.item.unit, entry.costUnitPrice, entry.saleUnitPrice, entry.lineTotal])
        const createdQuote = (await client.query('SELECT * FROM business_quote WHERE id=$1', [quoteId])).rows[0]
        const createdItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [quoteId])).rows
        await evaluateAndRecordQuoteIntegrity(client, createdQuote, 'created', actor)
        await insertQuoteRevisionEvent(client, createdQuote, 'created', actor, { reason: clean(rawInput.note), afterSnapshot: quoteSnapshot(createdQuote, createdItems) })
        await client.query(`UPDATE business_inquiry SET status='quoting',quote_amount=$2,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1`, [inquiryId, totalAmount, by.id, by.name])
        if (risk.required) await insertQuoteApprovalEvent(client, quoteId, 'requested', actor, { toStatus: 'pending', note: clean(rawInput.note), risk })
        await insertEvent(client, inquiryId, 'quote_created', actor, { fromStatus: inquiry.status, toStatus: 'quoting', note: clean(rawInput.note), snapshot: { quoteId, quoteNo, subtotal, totalAmount, marginAmount } })
      })
      return get(inquiryId)
    },

    async reviseQuote(quoteId, rawInput = {}, actor) {
      const reason = clean(rawInput.reason)
      if (reason.length < 4) throw problem('QUOTE_REVISION_REASON_REQUIRED', '报价修订原因至少需要 4 个字符')
      let inquiryId = ''
      await withTransaction(pool, async (client) => {
        const source = (await client.query('SELECT * FROM business_quote WHERE id=$1 FOR UPDATE', [quoteId])).rows[0]
        if (!source) throw problem('QUOTE_NOT_FOUND', '报价单不存在', 404)
        if (Number(rawInput.expectedRevision) !== source.revision) throw problem('QUOTE_VERSION_CONFLICT', '报价单版本已变化，请刷新后再修订', 409, { currentRevision: source.revision })
        if (['accepted', 'superseded'].includes(source.state)) throw problem('QUOTE_REVISION_STATE_CONFLICT', '已接受或已被替代的报价不能继续修订', 409, { state: source.state })
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [source.inquiry_id])).rows[0]
        if (!inquiry || terminalStatuses.has(inquiry.status)) throw problem('INQUIRY_CLOSED', '关联询价已结束，不能修订报价', 409)
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-quote-lineage:${source.lineage_id}`])
        const latest = (await client.query('SELECT id,version_no FROM business_quote WHERE lineage_id=$1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [source.lineage_id])).rows[0]
        if (!latest || latest.id !== source.id) throw problem('QUOTE_REVISION_NOT_LATEST', '只能基于当前最新报价版本继续修订', 409, { latestQuoteId: latest?.id || '', latestVersionNo: latest?.version_no || 0 })

        const sourceItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no FOR UPDATE', [source.id])).rows
        if (!sourceItems.length) throw problem('QUOTE_ITEMS_NOT_FOUND', '报价单没有明细，不能修订', 409)
        const requested = Array.isArray(rawInput.items) ? rawInput.items : []
        if (requested.length && requested.length !== sourceItems.length) throw problem('INVALID_QUOTE_REVISION_ITEMS', '报价修订必须保留并覆盖原报价全部明细')
        const liveVehicle = inquiry.customer_vehicle_id ? (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2 FOR SHARE', [inquiry.customer_vehicle_id, inquiry.customer_partner_id])).rows[0] : null
        if (inquiry.customer_vehicle_id && !liveVehicle) throw problem('CUSTOMER_VEHICLE_UNAVAILABLE', '客户车辆已不存在或不再属于当前客户，不能修订报价', 409)
        if (liveVehicle && (liveVehicle.platform_master_id !== inquiry.vehicle_platform_id || liveVehicle.variant_master_id !== inquiry.vehicle_variant_id || clean(liveVehicle.vin) !== clean(inquiry.vin))) {
          await client.query(`UPDATE business_inquiry SET vehicle_label=$2,vin=$3,vehicle_platform_id=$4,vehicle_variant_id=$5,version=version+1,updated_at=now() WHERE id=$1`, [inquiry.id, liveVehicle.vehicle_label, liveVehicle.vin, liveVehicle.platform_master_id, liveVehicle.variant_master_id])
          inquiry.vehicle_label = liveVehicle.vehicle_label; inquiry.vin = liveVehicle.vin; inquiry.vehicle_platform_id = liveVehicle.platform_master_id; inquiry.vehicle_variant_id = liveVehicle.variant_master_id
        }
        const revisionVehicle = liveVehicle || { platform_master_id: inquiry.vehicle_platform_id, variant_master_id: inquiry.vehicle_variant_id, engine_code: '', model_year: null }
        const normalized = []
        for (const item of sourceItems) {
          const override = requested.length ? requested.find((candidate) => clean(candidate.sourceQuoteItemId) === item.id || Number(candidate.lineNo) === item.line_no) : null
          if (requested.length && !override) throw problem('INVALID_QUOTE_REVISION_ITEMS', `第 ${item.line_no} 项缺少修订内容`)
          const nextQuantity = override && Object.hasOwn(override, 'quantity') ? quantity(override.quantity) : Number(item.quantity)
          const nextSalePrice = override && Object.hasOwn(override, 'saleUnitPrice') ? money(override.saleUnitPrice, `第 ${item.line_no} 项销售单价`) : Number(item.sale_unit_price)
          const fulfillmentSource = clean(override?.fulfillmentSource) || item.fulfillment_source
          if (!['stock', 'purchase'].includes(fulfillmentSource)) throw problem('INVALID_QUOTE_FULFILLMENT_SOURCE', `第 ${item.line_no} 项履约来源无效`)
          let supplierOffer = null; let fulfillmentWarehouse = null
          if (fulfillmentSource === 'purchase') {
            const supplierOfferId = clean(override?.supplierOfferId) || (item.fulfillment_source === 'purchase' ? item.supplier_offer_id : '')
            supplierOffer = supplierOfferId ? (await client.query(`SELECT *,(valid_until IS NOT NULL AND valid_until<(now() AT TIME ZONE 'Asia/Shanghai')::date) expired
              FROM business_supplier_offer WHERE id=$1 AND inquiry_id=$2 AND inquiry_item_id=$3 FOR SHARE`, [supplierOfferId, inquiry.id, item.inquiry_item_id])).rows[0] : null
            if (!supplierOffer) throw problem('QUOTE_SUPPLIER_SOURCE_REQUIRED', `第 ${item.line_no} 项修订为采购来源时必须选择有效供应商报价`)
            if (supplierOffer.expired) throw problem('QUOTE_SUPPLIER_OFFER_EXPIRED', `第 ${item.line_no} 项供应商报价已过期，请选择新的货源`, 409, { supplierOfferId: supplierOffer.id, validUntil: supplierOffer.valid_until })
          } else {
            const warehouseId = clean(override?.fulfillmentWarehouseId) || (item.fulfillment_source === 'stock' ? item.fulfillment_warehouse_id : '')
            fulfillmentWarehouse = warehouseId ? (await client.query("SELECT * FROM business_warehouse WHERE id=$1 AND status='active' FOR SHARE", [warehouseId])).rows[0] : null
            if (!fulfillmentWarehouse) throw problem('QUOTE_WAREHOUSE_REQUIRED', `第 ${item.line_no} 项修订为现货来源时必须选择有效仓库`)
            const available = Number((await client.query('SELECT COALESCE(on_hand_quantity-reserved_quantity,0)::numeric quantity FROM business_inventory_balance WHERE warehouse_id=$1 AND stock_key=$2', [fulfillmentWarehouse.id, businessStockKey(item)])).rows[0]?.quantity || 0)
            if (available < nextQuantity) throw problem('QUOTE_STOCK_INSUFFICIENT', `第 ${item.line_no} 项所选仓库可用库存不足`, 409, { fulfillmentWarehouseId: fulfillmentWarehouse.id, requestedQuantity: nextQuantity, availableQuantity: available })
          }
          const nextCostPrice = supplierOffer ? Number(supplierOffer.unit_price) : override && Object.hasOwn(override, 'costUnitPrice') ? money(override.costUnitPrice, `第 ${item.line_no} 项成本价`) : Number(item.cost_unit_price)
          let catalogSkuVersion = item.catalog_sku_version; let skuCodeSnapshot = item.sku_code_snapshot; let skuNameSnapshot = item.sku_name_snapshot; let brandSnapshot = item.brand_snapshot; let currentFitmentSnapshot = item.fitment_snapshot || {}
          if (item.catalog_sku_id) {
            const sku = (await client.query('SELECT * FROM catalog_sku WHERE id=$1 FOR SHARE', [item.catalog_sku_id])).rows[0]
            if (!sku || sku.lifecycle_status !== 'verified' || sku.verification_level !== 'verified') throw problem('QUOTE_REVISION_SKU_UNAVAILABLE', `第 ${item.line_no} 项 SKU 已停用或不再是已核验状态`, 409, { catalogSkuId: item.catalog_sku_id })
            catalogSkuVersion = sku.version; skuCodeSnapshot = sku.sku_code; skuNameSnapshot = sku.canonical_name_zh || sku.canonical_name_en; brandSnapshot = sku.brand_label || sku.brand_code
            const fitments = (await client.query("SELECT * FROM catalog_fitment WHERE sku_id=$1 AND verification_status='verified' ORDER BY sort_order,created_at", [sku.id])).rows
            const matchedFitment = fitments.find((candidate) => fitmentMatchesVehicle(candidate, revisionVehicle)) || null
            const overrideReason = clean(override?.fitmentOverrideReason) || clean(item.fitment_snapshot?.overrideReason)
            if (!matchedFitment && overrideReason.length < 8) throw problem('QUOTE_REVISION_FITMENT_REVIEW_REQUIRED', `第 ${item.line_no} 项 SKU 与当前客户车辆没有已核验适配，请停止或填写明确的人工复核原因`, 409, { catalogSkuId: sku.id, customerVehicleId: inquiry.customer_vehicle_id })
            currentFitmentSnapshot = fitmentSnapshot(matchedFitment, { overridden: !matchedFitment, overrideReason })
          }
          normalized.push({
            source: item, id: randomUUID(), quantity: nextQuantity, saleUnitPrice: nextSalePrice, costUnitPrice: nextCostPrice, fulfillmentSource, supplierOffer, fulfillmentWarehouse,
            catalogSkuVersion, skuCodeSnapshot, skuNameSnapshot, brandSnapshot, fitmentSnapshot: currentFitmentSnapshot,
            description: override && Object.hasOwn(override, 'description') ? clean(override.description) || item.description : item.description,
            lineTotal: Math.round(nextQuantity * nextSalePrice * 100) / 100,
          })
        }
        const subtotal = Math.round(normalized.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100
        const discountAmount = Object.hasOwn(rawInput, 'discountAmount') ? money(rawInput.discountAmount, '优惠金额', { optional: true }) : Number(source.discount_amount)
        const freightAmount = Object.hasOwn(rawInput, 'freightAmount') ? money(rawInput.freightAmount, '报价运费', { optional: true }) : Number(source.freight_amount)
        if (discountAmount > subtotal + freightAmount) throw problem('INVALID_BUSINESS_AMOUNT', '优惠金额不能大于报价金额')
        const totalAmount = Math.round((subtotal + freightAmount - discountAmount) * 100) / 100
        const marginAmount = Math.round((subtotal - normalized.reduce((sum, item) => sum + item.quantity * item.costUnitPrice, 0) - discountAmount) * 100) / 100
        const risk = await evaluateQuoteRisk(client, { customerPartnerId: inquiry.customer_partner_id, currency: source.currency, totalAmount, marginAmount })
        const versionNo = Number(source.version_no) + 1
        const rootQuote = (await client.query('SELECT quote_no FROM business_quote WHERE lineage_id=$1 AND version_no=1', [source.lineage_id])).rows[0]
        const newQuoteId = randomUUID(); const newQuoteNo = `${rootQuote?.quote_no || source.quote_no}-R${versionNo}`; const by = actorDetails(actor)
        const validUntil = Object.hasOwn(rawInput, 'validUntil') ? optionalDate(rawInput.validUntil, '报价有效期') : source.valid_until
        await client.query(`INSERT INTO business_quote
          (id,inquiry_id,quote_no,lineage_id,version_no,predecessor_quote_id,change_reason,creation_mode,currency,valid_until,subtotal,discount_amount,freight_amount,total_amount,margin_amount,margin_rate,approval_status,risk_reasons,risk_snapshot,approval_fingerprint,note,created_by_id,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23)`, [newQuoteId, source.inquiry_id, newQuoteNo, source.lineage_id, versionNo, source.id, reason, source.creation_mode, source.currency, validUntil, subtotal, discountAmount, freightAmount, totalAmount, marginAmount, risk.marginRate, risk.required ? 'pending' : 'not_required', JSON.stringify(risk.reasons), JSON.stringify(risk.snapshot), risk.fingerprint, Object.hasOwn(rawInput, 'note') ? clean(rawInput.note) : source.note, by.id, by.name])
        for (const item of normalized) await client.query(`INSERT INTO business_quote_item
          (id,quote_id,inquiry_item_id,supplier_offer_id,fulfillment_source,fulfillment_warehouse_id,catalog_sku_id,catalog_sku_version,sku_code_snapshot,sku_name_snapshot,brand_snapshot,fitment_snapshot,line_no,description,oe_number,quantity,unit,cost_unit_price,sale_unit_price,line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`, [item.id, newQuoteId, item.source.inquiry_item_id, item.supplierOffer?.id || null, item.fulfillmentSource, item.fulfillmentWarehouse?.id || null, item.source.catalog_sku_id, item.catalogSkuVersion, item.skuCodeSnapshot, item.skuNameSnapshot, item.brandSnapshot, JSON.stringify(item.fitmentSnapshot), item.source.line_no, item.description, item.source.oe_number, item.quantity, item.source.unit, item.costUnitPrice, item.saleUnitPrice, item.lineTotal])
        await client.query("UPDATE business_quote SET state='superseded',superseded_by_quote_id=$2,superseded_at=now(),revision=revision+1,updated_at=now() WHERE id=$1", [source.id, newQuoteId])
        const createdQuote = (await client.query('SELECT * FROM business_quote WHERE id=$1', [newQuoteId])).rows[0]
        const createdItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [newQuoteId])).rows
        await evaluateAndRecordQuoteIntegrity(client, createdQuote, 'revised', actor)
        const beforeSnapshot = quoteSnapshot(source, sourceItems); const afterSnapshot = quoteSnapshot(createdQuote, createdItems)
        const changeSet = { totalAmount: { from: Number(source.total_amount), to: totalAmount }, marginAmount: { from: Number(source.margin_amount), to: marginAmount }, validUntil: { from: source.valid_until, to: validUntil }, changedLines: normalized.filter((entry) => Number(entry.source.quantity) !== entry.quantity || Number(entry.source.sale_unit_price) !== entry.saleUnitPrice || Number(entry.source.cost_unit_price) !== entry.costUnitPrice || entry.source.description !== entry.description || entry.source.fulfillment_source !== entry.fulfillmentSource || entry.source.supplier_offer_id !== (entry.supplierOffer?.id || null) || entry.source.fulfillment_warehouse_id !== (entry.fulfillmentWarehouse?.id || null) || Number(entry.source.catalog_sku_version) !== Number(entry.catalogSkuVersion) || JSON.stringify(entry.source.fitment_snapshot || {}) !== JSON.stringify(entry.fitmentSnapshot)).map((entry) => entry.source.line_no) }
        await insertQuoteRevisionEvent(client, createdQuote, 'revised', actor, { fromQuote: source, reason, beforeSnapshot, afterSnapshot, changeSet })
        if (risk.required) await insertQuoteApprovalEvent(client, newQuoteId, 'requested', actor, { toStatus: 'pending', note: reason, risk })
        await client.query(`UPDATE business_inquiry SET status='quoting',quote_amount=$2,next_action='复核并发送修订报价',version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1`, [inquiry.id, totalAmount, by.id, by.name])
        await insertEvent(client, inquiry.id, 'quote_revised', actor, { fromStatus: inquiry.status, toStatus: 'quoting', note: reason, snapshot: { fromQuoteId: source.id, toQuoteId: newQuoteId, lineageId: source.lineage_id, versionNo, totalAmount, changeSet } })
        inquiryId = inquiry.id
      })
      return get(inquiryId)
    },

    async sendQuote(quoteId, rawInput = {}, actor) {
      let inquiryId = ''
      const outcome = await withTransaction(pool, async (client) => {
        const quote = (await client.query('SELECT * FROM business_quote WHERE id=$1 FOR UPDATE', [quoteId])).rows[0]
        if (!quote) throw problem('QUOTE_NOT_FOUND', '报价单不存在', 404)
        if (quote.state !== 'draft') throw problem('QUOTE_STATE_CONFLICT', '只有草稿报价可以发送', 409)
        const latest = (await client.query('SELECT id,version_no FROM business_quote WHERE lineage_id=$1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [quote.lineage_id])).rows[0]
        if (!latest || latest.id !== quote.id) throw problem('QUOTE_NOT_LATEST', '只能发送当前最新报价版本', 409, { latestQuoteId: latest?.id || '', latestVersionNo: latest?.version_no || 0 })
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [quote.inquiry_id])).rows[0]
        if (!inquiry || terminalStatuses.has(inquiry.status)) throw problem('INQUIRY_CLOSED', '关联询价已结束，不能发送报价', 409)
        const expectedRevision = Number(rawInput?.expectedRevision)
        if (!Number.isInteger(expectedRevision) || expectedRevision !== quote.revision) throw problem('QUOTE_VERSION_CONFLICT', '报价单版本已变化，请刷新后再发送', 409, { currentRevision: quote.revision })
        const by = actorDetails(actor); inquiryId = inquiry.id
        const expired = Boolean((await client.query("SELECT valid_until IS NOT NULL AND valid_until<(now() AT TIME ZONE 'Asia/Shanghai')::date expired FROM business_quote WHERE id=$1", [quote.id])).rows[0].expired)
        if (expired) {
          await client.query("UPDATE business_quote SET state='expired',revision=revision+1,updated_at=now() WHERE id=$1", [quote.id])
          const expiredQuote = (await client.query('SELECT * FROM business_quote WHERE id=$1', [quote.id])).rows[0]
          const quoteItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [quote.id])).rows
          await insertQuoteRevisionEvent(client, expiredQuote, 'expired', actor, { fromQuote: quote, reason: '报价有效期已过', beforeSnapshot: quoteSnapshot(quote, quoteItems), afterSnapshot: quoteSnapshot(expiredQuote, quoteItems) })
          return { blocked: false, expired: true, validUntil: quote.valid_until }
        }
        const integrity = await evaluateAndRecordQuoteIntegrity(client, quote, 'send', actor, { incrementRevisionWhenBlocked: true })
        if (integrity.status === 'blocked') return { blocked: false, integrityBlocked: true, integrity }
        const risk = await evaluateQuoteRisk(client, { customerPartnerId: inquiry.customer_partner_id, currency: quote.currency, totalAmount: quote.total_amount, marginAmount: quote.margin_amount })
        if (risk.required && (quote.approval_status !== 'approved' || quote.approval_fingerprint !== risk.fingerprint)) {
          const changed = quote.approval_status !== 'pending' || quote.approval_fingerprint !== risk.fingerprint
          if (changed) {
            const action = quote.approval_status === 'approved' ? 'invalidated' : quote.approval_status === 'rejected' ? 'refreshed' : 'requested'
            await client.query(`UPDATE business_quote SET approval_status='pending',risk_reasons=$2::jsonb,risk_snapshot=$3::jsonb,approval_fingerprint=$4,margin_rate=$5,approved_revision=NULL,approved_by_id='',approved_by_name='',approved_at=NULL,approval_note='',revision=revision+1,updated_at=now() WHERE id=$1`, [quote.id, JSON.stringify(risk.reasons), JSON.stringify(risk.snapshot), risk.fingerprint, risk.marginRate])
            await insertQuoteApprovalEvent(client, quote.id, action, actor, { fromStatus: quote.approval_status, toStatus: 'pending', note: clean(rawInput.note), risk })
          }
          return { blocked: true, currentRevision: quote.revision + (changed ? 1 : 0), risk }
        }
        if (!risk.required && quote.approval_status !== 'not_required') {
          await client.query(`UPDATE business_quote SET approval_status='not_required',risk_reasons='[]'::jsonb,risk_snapshot=$2::jsonb,approval_fingerprint=$3,margin_rate=$4,approved_revision=NULL,approved_by_id='',approved_by_name='',approved_at=NULL,approval_note='',updated_at=now() WHERE id=$1`, [quote.id, JSON.stringify(risk.snapshot), risk.fingerprint, risk.marginRate])
          await insertQuoteApprovalEvent(client, quote.id, 'not_required', actor, { fromStatus: quote.approval_status, toStatus: 'not_required', note: clean(rawInput.note), risk })
        }
        const priorSentQuotes = (await client.query("SELECT * FROM business_quote WHERE inquiry_id=$1 AND state='sent' AND id<>$2 FOR UPDATE", [inquiry.id, quote.id])).rows
        if (priorSentQuotes.length) {
          await client.query("UPDATE business_quote SET state='superseded',superseded_by_quote_id=$2,superseded_at=now(),revision=revision+1,updated_at=now() WHERE inquiry_id=$1 AND state='sent' AND id<>$2", [inquiry.id, quote.id])
          for (const prior of priorSentQuotes) {
            const priorItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [prior.id])).rows
            const afterPrior = { ...prior, state: 'superseded', superseded_by_quote_id: quote.id }
            await client.query(`INSERT INTO business_quote_revision_event (id,inquiry_id,lineage_id,from_quote_id,to_quote_id,action,actor_id,actor_name,reason,before_snapshot,after_snapshot,change_set)
              VALUES ($1,$2,$3,$4,$5,'superseded',$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)`, [randomUUID(), inquiry.id, prior.lineage_id, prior.id, quote.id, by.id, by.name, '发送更新报价后自动替代旧报价', JSON.stringify(quoteSnapshot(prior, priorItems)), JSON.stringify(quoteSnapshot(afterPrior, priorItems)), JSON.stringify({ supersededByQuoteId: quote.id })])
          }
        }
        await client.query(`UPDATE business_quote SET state='sent',revision=revision+1,sent_at=now(),updated_at=now() WHERE id=$1`, [quoteId])
        await client.query(`UPDATE business_inquiry SET status='quoted',next_action=$2,next_action_at=$3,version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1`, [inquiry.id, clean(rawInput.nextAction) || '跟进客户报价反馈', optionalTimestamp(rawInput.nextActionAt, '下一步时间'), by.id, by.name])
        await insertEvent(client, inquiry.id, 'quote_sent', actor, { fromStatus: inquiry.status, toStatus: 'quoted', note: clean(rawInput.note), snapshot: { quoteId, quoteNo: quote.quote_no, totalAmount: Number(quote.total_amount) } })
        return { blocked: false }
      })
      if (outcome.expired) throw problem('QUOTE_EXPIRED', '报价有效期已过，请先创建修订版本', 409, { validUntil: outcome.validUntil })
      if (outcome.integrityBlocked) throw problem('QUOTE_INTEGRITY_BLOCKED', '车型、SKU 适配、货源或库存证据已变化，请复核并在必要时修订报价', 409, { currentRevision: outcome.integrity.currentRevision, integrityReasons: outcome.integrity.reasons, integritySnapshot: outcome.integrity.snapshot })
      if (outcome.blocked) throw problem('QUOTE_APPROVAL_REQUIRED', '报价触发毛利或信用额度风控，需独立审批后才能发送', 409, { currentRevision: outcome.currentRevision, riskReasons: outcome.risk.reasons, riskSnapshot: outcome.risk.snapshot })
      return get(inquiryId)
    },

    async reviewQuoteApproval(quoteId, rawInput = {}, actor) {
      const decision = clean(rawInput.decision)
      if (!['approved', 'rejected'].includes(decision)) throw problem('INVALID_QUOTE_APPROVAL_DECISION', '报价审批结论必须为 approved 或 rejected')
      let inquiryId = ''
      await withTransaction(pool, async (client) => {
        const quote = (await client.query('SELECT * FROM business_quote WHERE id=$1 FOR UPDATE', [quoteId])).rows[0]
        if (!quote) throw problem('QUOTE_NOT_FOUND', '报价单不存在', 404)
        if (Number(rawInput.expectedRevision) !== quote.revision) throw problem('QUOTE_VERSION_CONFLICT', '报价单版本已变化，请刷新后再审批', 409, { currentRevision: quote.revision })
        if (!['draft', 'accepted'].includes(quote.state)) throw problem('QUOTE_APPROVAL_QUOTE_STATE_CONFLICT', '只有当前草稿或成交转单复核中的报价可以审批', 409, { state: quote.state })
        const latest = (await client.query('SELECT id,version_no FROM business_quote WHERE lineage_id=$1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [quote.lineage_id])).rows[0]
        if (!latest || latest.id !== quote.id) throw problem('QUOTE_NOT_LATEST', '只能审批当前最新报价版本', 409, { latestQuoteId: latest?.id || '', latestVersionNo: latest?.version_no || 0 })
        if (quote.approval_status !== 'pending') throw problem('QUOTE_APPROVAL_STATE_CONFLICT', '只有待审批报价可以审核', 409, { approvalStatus: quote.approval_status })
        const by = actorDetails(actor)
        if (by.id === quote.created_by_id) throw problem('QUOTE_APPROVAL_SELF_REVIEW_DENIED', '制单人不能审批自己的报价', 403)
        inquiryId = quote.inquiry_id
        const nextRevision = quote.revision + 1
        if (decision === 'approved') await client.query(`UPDATE business_quote SET approval_status='approved',approved_revision=$2,approved_by_id=$3,approved_by_name=$4,approved_at=now(),approval_note=$5,revision=$2,updated_at=now() WHERE id=$1`, [quote.id, nextRevision, by.id, by.name, clean(rawInput.note)])
        else await client.query(`UPDATE business_quote SET approval_status='rejected',approved_revision=NULL,approved_by_id='',approved_by_name='',approved_at=NULL,approval_note=$3,revision=$2,updated_at=now() WHERE id=$1`, [quote.id, nextRevision, clean(rawInput.note)])
        await insertQuoteApprovalEvent(client, quote.id, decision, actor, { fromStatus: 'pending', toStatus: decision, note: clean(rawInput.note), risk: { reasons: quote.risk_reasons || [], snapshot: quote.risk_snapshot || {}, fingerprint: quote.approval_fingerprint } })
      })
      return get(inquiryId)
    },

    async transition(id, rawInput = {}, actor) {
      const nextStatus = clean(rawInput?.status)
      if (!inquiryStatuses.has(nextStatus)) throw problem('INVALID_INQUIRY_STATUS', '询价状态无效')
      const outcome = await withTransaction(pool, async (client) => {
        const inquiry = (await client.query('SELECT * FROM business_inquiry WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!inquiry) throw problem('INQUIRY_NOT_FOUND', '询价不存在', 404)
        if (Number(rawInput?.expectedVersion) !== inquiry.version) throw problem('INQUIRY_VERSION_CONFLICT', '询价已被其他操作更新，请刷新后重试', 409, { currentVersion: inquiry.version })
        if (!transitions[inquiry.status]?.has(nextStatus)) throw problem('INVALID_INQUIRY_TRANSITION', `不能从 ${inquiry.status} 变更为 ${nextStatus}`, 409)
        const by = actorDetails(actor)
        const nextActionAt = optionalTimestamp(rawInput.nextActionAt, '下一步时间')
        let decidedQuote = null
        if (nextStatus === 'won' || nextStatus === 'lost') {
          decidedQuote = (await client.query("SELECT * FROM business_quote WHERE inquiry_id=$1 AND state='sent' ORDER BY sent_at DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE", [id])).rows[0]
          if (!decidedQuote) throw problem('ACTIVE_SENT_QUOTE_NOT_FOUND', '没有可供客户确认的有效已发送报价', 409)
          if (clean(rawInput.quoteId) && clean(rawInput.quoteId) !== decidedQuote.id) throw problem('QUOTE_NOT_LATEST', '只能确认当前最新已发送报价', 409, { latestQuoteId: decidedQuote.id })
          const expired = Boolean((await client.query("SELECT valid_until IS NOT NULL AND valid_until<(now() AT TIME ZONE 'Asia/Shanghai')::date expired FROM business_quote WHERE id=$1", [decidedQuote.id])).rows[0].expired)
          if (expired) throw problem('QUOTE_EXPIRED', '最新报价已过有效期，请先创建修订版本', 409, { quoteId: decidedQuote.id, validUntil: decidedQuote.valid_until })
          if (nextStatus === 'won') {
            const integrity = await evaluateAndRecordQuoteIntegrity(client, decidedQuote, 'decision', actor, { incrementRevisionWhenBlocked: true })
            if (integrity.status === 'blocked') return { integrityBlocked: true, integrity }
          }
        }
        await client.query(`UPDATE business_inquiry SET status=$2,next_action=$3,next_action_at=$4,version=version+1,updated_by_id=$5,updated_by_name=$6,updated_at=now() WHERE id=$1`, [id, nextStatus, clean(rawInput.nextAction), nextActionAt, by.id, by.name])
        if (decidedQuote) {
          const decisionState = nextStatus === 'won' ? 'accepted' : 'rejected'
          await client.query(`UPDATE business_quote SET state=$2,accepted_at=CASE WHEN $2='accepted' THEN now() ELSE accepted_at END,revision=revision+1,updated_at=now() WHERE id=$1`, [decidedQuote.id, decisionState])
          const decidedItems = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [decidedQuote.id])).rows
          const afterQuote = { ...decidedQuote, state: decisionState }
          await insertQuoteRevisionEvent(client, afterQuote, decisionState, actor, { fromQuote: decidedQuote, reason: clean(rawInput.note), beforeSnapshot: quoteSnapshot(decidedQuote, decidedItems), afterSnapshot: quoteSnapshot(afterQuote, decidedItems) })
        }
        await insertEvent(client, id, 'status_changed', actor, { fromStatus: inquiry.status, toStatus: nextStatus, note: clean(rawInput.note), snapshot: { nextAction: clean(rawInput.nextAction), nextActionAt, quoteId: decidedQuote?.id || '' } })
      })
      if (outcome?.integrityBlocked) throw problem('QUOTE_INTEGRITY_BLOCKED', '车型、SKU 适配、货源或库存证据已变化，请复核并在必要时修订报价后再确认成交', 409, { currentRevision: outcome.integrity.currentRevision, integrityReasons: outcome.integrity.reasons, integritySnapshot: outcome.integrity.snapshot })
      return get(id)
    },
  }
}
