import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const partnerTypes = new Set(['customer', 'supplier', 'both'])
const partnerStatuses = new Set(['active', 'inactive', 'blocked'])

function clean(value) { return String(value ?? '').trim() }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function requestKey(value) {
  const normalized = clean(value)
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return normalized
}
function phoneDigits(value) { return clean(value).replace(/\D/g, '') }
function decodeTimelineCursor(value) {
  const cursor = clean(value)
  if (!cursor) return { occurredAt: null, id: null }
  try {
    const [occurredAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!id || !occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('invalid cursor')
    return { occurredAt: new Date(occurredAt).toISOString(), id: String(id) }
  } catch {
    throw problem('INVALID_CUSTOMER_TIMELINE_CURSOR', '客户动态游标无效')
  }
}
function encodeTimelineCursor(item) {
  return Buffer.from(JSON.stringify([item.occurredAt, item.id])).toString('base64url')
}
function money(value, label) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number < 0) throw problem('INVALID_PARTNER_AMOUNT', `${label}必须是大于等于 0 的金额`)
  return Math.round(number * 100) / 100
}
function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0)
  if (!Number.isInteger(number) || number < 0) throw problem('INVALID_PARTNER_INPUT', `${label}必须是大于等于 0 的整数`)
  return number
}
function normalizeEmail(value) {
  const email = clean(value).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem('INVALID_PARTNER_EMAIL', '邮箱格式无效')
  return email
}
function normalizeVin(value) {
  const vin = clean(value).toUpperCase()
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw problem('INVALID_PARTNER_VIN', 'VIN 必须是 17 位有效字符')
  return vin
}
function normalizeContact(input = {}) {
  if (!clean(input.name)) throw problem('INVALID_PARTNER_CONTACT', '联系人姓名为必填项')
  return { name: clean(input.name), roleTitle: clean(input.roleTitle), phone: clean(input.phone), wechat: clean(input.wechat), email: normalizeEmail(input.email), isPrimary: Boolean(input.isPrimary), notes: clean(input.notes) }
}
function normalizeVehicle(input = {}) {
  const platformMasterId = clean(input.platformMasterId) || null
  const variantMasterId = clean(input.variantMasterId) || null
  if (!clean(input.vehicleLabel) && !platformMasterId && !variantMasterId) throw problem('INVALID_CUSTOMER_VEHICLE', '车辆名称或标准车型为必填项')
  const modelYear = input.modelYear === '' || input.modelYear == null ? null : Number(input.modelYear)
  if (modelYear != null && (!Number.isInteger(modelYear) || modelYear < 1950 || modelYear > 2200)) throw problem('INVALID_CUSTOMER_VEHICLE', '车辆年款无效')
  return { vehicleLabel: clean(input.vehicleLabel), vin: normalizeVin(input.vin), licensePlate: clean(input.licensePlate).toUpperCase(), platformCode: clean(input.platformCode).toUpperCase(), platformMasterId, variantMasterId, engineCode: clean(input.engineCode).toUpperCase(), modelYear, notes: clean(input.notes) }
}
export function normalizeBusinessPartnerInput(input = {}, { partial = false } = {}) {
  const result = {}
  if (!partial || input.partnerType !== undefined) {
    result.partnerType = clean(input.partnerType) || 'customer'
    if (!partnerTypes.has(result.partnerType)) throw problem('INVALID_PARTNER_INPUT', '合作方类型无效')
  }
  if (!partial || input.name !== undefined) {
    result.name = clean(input.name)
    if (!result.name) throw problem('INVALID_PARTNER_INPUT', '客户、门店或供应商名称为必填项')
  }
  if (!partial || input.status !== undefined) {
    result.status = clean(input.status) || 'active'
    if (!partnerStatuses.has(result.status)) throw problem('INVALID_PARTNER_INPUT', '合作方状态无效')
  }
  for (const [source, target] of [['shortName', 'shortName'], ['taxId', 'taxId'], ['phone', 'phone'], ['address', 'address'], ['notes', 'notes']]) if (!partial || input[source] !== undefined) result[target] = clean(input[source])
  if (!partial || input.email !== undefined) result.email = normalizeEmail(input.email)
  if (!partial || input.paymentTermsDays !== undefined) result.paymentTermsDays = nonNegativeInteger(input.paymentTermsDays, '账期天数')
  if (!partial || input.creditLimit !== undefined) result.creditLimit = money(input.creditLimit, '信用额度')
  return result
}
function generatedNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `BP-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
function mapPartner(row) {
  return {
    id: row.id, partnerNo: row.partner_no, partnerType: row.partner_type, name: row.name, shortName: row.short_name,
    taxId: row.tax_id, phone: row.phone, email: row.email, address: row.address, status: row.status,
    paymentTermsDays: row.payment_terms_days, creditLimit: Number(row.credit_limit), notes: row.notes, version: row.version,
    createdById: row.created_by_id, createdByName: row.created_by_name, updatedById: row.updated_by_id, updatedByName: row.updated_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at, contactCount: Number(row.contact_count || 0), vehicleCount: Number(row.vehicle_count || 0),
  }
}
function mapContact(row) {
  return { id: row.id, partnerId: row.partner_id, name: row.name, roleTitle: row.role_title, phone: row.phone, wechat: row.wechat, email: row.email, isPrimary: row.is_primary, notes: row.notes, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
}
function mapVehicle(row) {
  return { id: row.id, partnerId: row.partner_id, vehicleLabel: row.vehicle_label, vin: row.vin, licensePlate: row.license_plate, platformCode: row.platform_code, platformMasterId: row.platform_master_id, variantMasterId: row.variant_master_id, engineCode: row.engine_code, modelYear: row.model_year, notes: row.notes, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
}
async function insertEvent(client, partnerId, action, actor, snapshot = {}, note = '') {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_partner_event (id,partner_id,action,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), partnerId, action, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function lockPartner(client, id, expectedVersion) {
  const row = (await client.query('SELECT * FROM business_partner WHERE id=$1 OR partner_no=upper(trim($1)) LIMIT 1 FOR UPDATE', [id])).rows[0]
  if (!row) throw problem('PARTNER_NOT_FOUND', '客户或供应商不存在', 404)
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== row.version) throw problem('PARTNER_VERSION_CONFLICT', '客户或供应商资料已变化，请刷新后重试', 409, { currentVersion: row.version })
  return row
}

async function resolveVehicleMaster(client, vehicle) {
  if (vehicle.variantMasterId) {
    const variant = (await client.query(`SELECT v.*,p.platform_code,p.brand_label,p.series_label,p.year_from AS platform_year_from,p.year_to AS platform_year_to,p.lifecycle_status AS platform_status
      FROM catalog_vehicle_variant v JOIN catalog_vehicle_platform p ON p.id=v.platform_id WHERE v.id=$1`, [vehicle.variantMasterId])).rows[0]
    if (!variant) throw problem('CUSTOMER_VEHICLE_VARIANT_NOT_FOUND', '关联的标准车型版本不存在', 400)
    if (variant.lifecycle_status !== 'active' || variant.platform_status !== 'active') throw problem('CUSTOMER_VEHICLE_VARIANT_UNAVAILABLE', '关联的标准车型版本当前不可用', 409)
    if (vehicle.platformMasterId && vehicle.platformMasterId !== variant.platform_id) throw problem('CUSTOMER_VEHICLE_MASTER_MISMATCH', '车型版本不属于所选车型平台', 409)
    if (vehicle.modelYear != null && ((variant.year_from && vehicle.modelYear < variant.year_from) || (variant.year_to && vehicle.modelYear > variant.year_to))) throw problem('CUSTOMER_VEHICLE_YEAR_MISMATCH', '车辆年款超出标准车型版本范围', 409)
    return {
      ...vehicle,
      platformMasterId: variant.platform_id,
      platformCode: variant.platform_code,
      vehicleLabel: vehicle.vehicleLabel || [variant.brand_label, variant.series_label, variant.variant_label].filter(Boolean).join(' '),
      engineCode: vehicle.engineCode || (variant.engine_codes?.length === 1 ? variant.engine_codes[0] : ''),
    }
  }
  if (vehicle.platformMasterId) {
    const platform = (await client.query('SELECT * FROM catalog_vehicle_platform WHERE id=$1', [vehicle.platformMasterId])).rows[0]
    if (!platform) throw problem('CUSTOMER_VEHICLE_PLATFORM_NOT_FOUND', '关联的标准车型平台不存在', 400)
    if (platform.lifecycle_status !== 'active') throw problem('CUSTOMER_VEHICLE_PLATFORM_UNAVAILABLE', '关联的标准车型平台当前不可用', 409)
    if (vehicle.modelYear != null && ((platform.year_from && vehicle.modelYear < platform.year_from) || (platform.year_to && vehicle.modelYear > platform.year_to))) throw problem('CUSTOMER_VEHICLE_YEAR_MISMATCH', '车辆年款超出标准车型平台范围', 409)
    return { ...vehicle, platformCode: platform.platform_code, vehicleLabel: vehicle.vehicleLabel || [platform.brand_label, platform.series_label].filter(Boolean).join(' ') }
  }
  return vehicle
}

export function createBusinessPartnerRepository(pool) {
  async function get(id, client = pool) {
    const row = (await client.query(`SELECT p.*,
      (SELECT count(*)::int FROM business_partner_contact c WHERE c.partner_id=p.id) contact_count,
      (SELECT count(*)::int FROM business_customer_vehicle v WHERE v.partner_id=p.id) vehicle_count
      FROM business_partner p WHERE p.id=$1 OR p.partner_no=upper(trim($1)) LIMIT 1`, [id])).rows[0]
    if (!row) return null
    const [contacts, vehicles, events] = await Promise.all([
      client.query('SELECT * FROM business_partner_contact WHERE partner_id=$1 ORDER BY is_primary DESC,created_at,id', [row.id]),
      client.query('SELECT * FROM business_customer_vehicle WHERE partner_id=$1 ORDER BY updated_at DESC,id', [row.id]),
      client.query('SELECT * FROM business_partner_event WHERE partner_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
    ])
    return { ...mapPartner(row), contacts: contacts.rows.map(mapContact), vehicles: vehicles.rows.map(mapVehicle), events: events.rows.map((event) => ({ id: event.id, action: event.action, actorId: event.actor_id, actorName: event.actor_name, note: event.note, snapshot: event.snapshot, createdAt: event.created_at })) }
  }

  async function customer360(id, { pageSize = 30, cursor = '' } = {}) {
    const customer = await get(id)
    if (!customer) return null
    if (!['customer', 'both'].includes(customer.partnerType)) throw problem('PARTNER_NOT_CUSTOMER', '该合作方不是客户', 409)
    const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
    const position = decodeTimelineCursor(cursor)
    const [summaryResult, nextActionsResult, quickQuoteDraftsResult, timelineResult] = await Promise.all([
      pool.query(`SELECT
        (SELECT count(*)::int FROM business_quick_quote_draft d WHERE d.customer_partner_id=$1 AND d.status IN ('active','submitting')) active_quick_quote_draft_count,
        (SELECT count(*)::int FROM business_quick_quote_draft d WHERE d.customer_partner_id=$1 AND d.status='submitted') submitted_quick_quote_draft_count,
        (SELECT count(*)::int FROM business_inquiry i WHERE i.customer_partner_id=$1) inquiry_count,
        (SELECT count(*)::int FROM business_inquiry i WHERE i.customer_partner_id=$1 AND i.status NOT IN ('won','lost','cancelled')) open_inquiry_count,
        (SELECT count(*)::int FROM business_inquiry i WHERE i.customer_partner_id=$1 AND i.status='won') won_inquiry_count,
        (SELECT count(*)::int FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_partner_id=$1) quote_count,
        (SELECT count(*)::int FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_partner_id=$1 AND q.state='sent') pending_quote_count,
        (SELECT COALESCE(sum(q.total_amount),0) FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_partner_id=$1 AND q.state='sent') pending_quote_amount,
        (SELECT count(*)::int FROM business_sales_order s WHERE s.customer_partner_id=$1) sales_order_count,
        (SELECT count(*)::int FROM business_sales_order s WHERE s.customer_partner_id=$1 AND s.status NOT IN ('completed','cancelled')) open_sales_order_count,
        (SELECT count(*)::int FROM business_sales_order s WHERE s.customer_partner_id=$1 AND s.status='completed') completed_sales_order_count,
        (SELECT COALESCE(sum(s.total_amount),0) FROM business_sales_order s WHERE s.customer_partner_id=$1 AND s.status='completed') completed_sales_amount,
        (SELECT count(*)::int FROM business_purchase_order p JOIN business_sales_order s ON s.id=p.sales_order_id WHERE s.customer_partner_id=$1 AND p.status NOT IN ('received','cancelled')) open_purchase_order_count,
        (SELECT count(*)::int FROM business_shipment sh JOIN business_sales_order s ON s.id=sh.sales_order_id WHERE s.customer_partner_id=$1) shipment_count,
        (SELECT count(*)::int FROM business_receivable r WHERE r.customer_partner_id=$1 AND r.status<>'void') receivable_count,
        (SELECT COALESCE(sum(r.paid_amount-r.refunded_amount),0) FROM business_receivable r WHERE r.customer_partner_id=$1 AND r.status<>'void') collected_amount,
        (SELECT COALESCE(sum(GREATEST((r.original_amount-r.credited_amount)-(r.paid_amount-r.refunded_amount),0)),0) FROM business_receivable r WHERE r.customer_partner_id=$1 AND r.status IN ('open','partial')) outstanding_amount,
        (SELECT count(*)::int FROM business_receivable r WHERE r.customer_partner_id=$1 AND r.status IN ('open','partial') AND r.due_at<current_date) overdue_receivable_count,
        (SELECT COALESCE(sum(GREATEST((r.original_amount-r.credited_amount)-(r.paid_amount-r.refunded_amount),0)),0) FROM business_receivable r WHERE r.customer_partner_id=$1 AND r.status IN ('open','partial') AND r.due_at<current_date) overdue_amount,
        (SELECT count(*)::int FROM business_after_sales_case a WHERE a.customer_partner_id=$1) after_sales_count,
        (SELECT count(*)::int FROM business_after_sales_case a WHERE a.customer_partner_id=$1 AND a.status NOT IN ('completed','rejected','cancelled')) open_after_sales_count,
        (SELECT COALESCE(sum(a.credited_amount),0) FROM business_after_sales_case a WHERE a.customer_partner_id=$1) after_sales_credited_amount,
        (SELECT COALESCE(sum(a.refunded_amount),0) FROM business_after_sales_case a WHERE a.customer_partner_id=$1) refunded_amount`, [customer.id]),
      pool.query(`SELECT id,inquiry_no,status,priority,next_action,next_action_at,vehicle_label,customer_vehicle_id,quote_amount,currency,updated_at
        FROM business_inquiry WHERE customer_partner_id=$1 AND next_action<>'' AND status NOT IN ('won','lost','cancelled')
        ORDER BY next_action_at ASC NULLS LAST,updated_at DESC,id LIMIT 10`, [customer.id]),
      pool.query(`SELECT d.id,d.draft_no,d.status,d.customer_vehicle_id,d.payload,d.submission_error,d.version,d.updated_at,v.vehicle_label
        FROM business_quick_quote_draft d LEFT JOIN business_customer_vehicle v ON v.id=d.customer_vehicle_id
        WHERE d.customer_partner_id=$1 AND d.status IN ('active','submitting') ORDER BY d.updated_at DESC,d.id LIMIT 10`, [customer.id]),
      pool.query(`WITH timeline AS (
        SELECT 'partner:'||e.id timeline_id,'partner' entity_type,e.partner_id entity_id,NULL::text parent_id,e.action,e.action status,
          '客户资料更新' title,NULL::numeric amount,''::text currency,e.actor_id,e.actor_name,e.note,e.snapshot,e.created_at occurred_at
        FROM business_partner_event e WHERE e.partner_id=$1
        UNION ALL
        SELECT 'quote-draft:'||e.id,'quick_quote_draft',d.id,NULL::text,e.action,d.status,d.draft_no,NULL::numeric,
          COALESCE(NULLIF(d.payload->>'currency',''),'CNY'),e.actor_id,e.actor_name,''::text,e.snapshot,e.created_at
        FROM business_quick_quote_draft_event e JOIN business_quick_quote_draft d ON d.id=e.draft_id WHERE d.customer_partner_id=$1
        UNION ALL
        SELECT 'inquiry:'||e.id,'inquiry',i.id,NULL::text,e.action,COALESCE(NULLIF(e.to_status,''),i.status),i.inquiry_no,
          i.quote_amount,i.currency,e.actor_id,e.actor_name,e.note,e.snapshot,e.created_at
        FROM business_inquiry_event e JOIN business_inquiry i ON i.id=e.inquiry_id WHERE i.customer_partner_id=$1
        UNION ALL
        SELECT 'quote:'||q.id,'quote',q.id,q.inquiry_id,'quote_'||q.state,q.state,q.quote_no,q.total_amount,q.currency,
          q.created_by_id,q.created_by_name,q.note,jsonb_build_object('revision',q.revision,'inquiryId',q.inquiry_id),COALESCE(q.sent_at,q.created_at)
        FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_partner_id=$1
        UNION ALL
        SELECT 'order:'||e.id,e.order_type||'_order',COALESCE(e.sales_order_id,e.purchase_order_id),
          CASE WHEN e.order_type='purchase' THEN p.sales_order_id ELSE NULL END,e.action,COALESCE(NULLIF(e.to_status,''),CASE WHEN e.order_type='sales' THEN s.status ELSE p.status END),
          CASE WHEN e.order_type='sales' THEN s.order_no ELSE p.order_no END,
          CASE WHEN e.order_type='sales' THEN s.total_amount ELSE p.total_amount END,
          CASE WHEN e.order_type='sales' THEN s.currency ELSE p.currency END,e.actor_id,e.actor_name,e.note,e.snapshot,e.created_at
        FROM business_order_event e
        LEFT JOIN business_sales_order s ON s.id=e.sales_order_id
        LEFT JOIN business_purchase_order p ON p.id=e.purchase_order_id
        LEFT JOIN business_sales_order ps ON ps.id=p.sales_order_id
        WHERE COALESCE(s.customer_partner_id,ps.customer_partner_id)=$1
        UNION ALL
        SELECT 'receipt:'||r.id,'goods_receipt',r.id,p.sales_order_id,'received',r.status,r.receipt_no,
          (SELECT COALESCE(sum(ri.line_total),0) FROM business_goods_receipt_item ri WHERE ri.goods_receipt_id=r.id),p.currency,
          r.created_by_id,r.created_by_name,r.note,jsonb_build_object('purchaseOrderId',r.purchase_order_id,'warehouseId',r.warehouse_id),r.created_at
        FROM business_goods_receipt r JOIN business_purchase_order p ON p.id=r.purchase_order_id JOIN business_sales_order s ON s.id=p.sales_order_id
        WHERE s.customer_partner_id=$1
        UNION ALL
        SELECT 'shipment:'||sh.id,'shipment',sh.id,sh.sales_order_id,'shipped',sh.status,sh.shipment_no,NULL::numeric,s.currency,
          sh.created_by_id,sh.created_by_name,sh.note,jsonb_build_object('warehouseId',sh.warehouse_id,'reservationId',sh.reservation_id),sh.created_at
        FROM business_shipment sh JOIN business_sales_order s ON s.id=sh.sales_order_id WHERE s.customer_partner_id=$1
        UNION ALL
        SELECT 'receivable:'||e.id,'receivable',r.id,r.sales_order_id,e.action,COALESCE(NULLIF(e.to_status,''),r.status),r.receivable_no,
          CASE WHEN e.action='payment_recorded' THEN NULLIF(e.snapshot->>'amount','')::numeric ELSE r.original_amount END,r.currency,
          e.actor_id,e.actor_name,e.note,e.snapshot,e.created_at
        FROM business_receivable_event e JOIN business_receivable r ON r.id=e.receivable_id WHERE r.customer_partner_id=$1
        UNION ALL
        SELECT 'after-sales:'||e.id,'after_sales',a.id,a.sales_order_id,e.action,COALESCE(NULLIF(e.to_status,''),a.status),a.case_no,
          CASE WHEN e.action='refund_recorded' THEN NULLIF(e.snapshot->>'amount','')::numeric
            WHEN e.action IN ('return_received','return_partially_received') THEN NULLIF(e.snapshot->>'creditAmount','')::numeric
            ELSE a.requested_refund_amount END,s.currency,
          e.actor_id,e.actor_name,e.note,e.snapshot,e.created_at
        FROM business_after_sales_event e JOIN business_after_sales_case a ON a.id=e.case_id
        JOIN business_sales_order s ON s.id=a.sales_order_id WHERE a.customer_partner_id=$1
      ) SELECT * FROM timeline
        WHERE ($2::timestamptz IS NULL OR (occurred_at,timeline_id)<($2::timestamptz,$3::text))
        ORDER BY occurred_at DESC,timeline_id DESC LIMIT $4`, [customer.id, position.occurredAt, position.id, size + 1]),
    ])
    const summaryRow = summaryResult.rows[0]
    const timelineRows = timelineResult.rows.slice(0, size).map((row) => ({
      id: row.timeline_id, entityType: row.entity_type, entityId: row.entity_id, parentId: row.parent_id,
      action: row.action, status: row.status, title: row.title, amount: row.amount == null ? null : Number(row.amount), currency: row.currency,
      actorId: row.actor_id, actorName: row.actor_name, note: row.note, snapshot: row.snapshot, occurredAt: row.occurred_at,
    }))
    return {
      customer,
      summary: {
        activeQuickQuoteDraftCount: summaryRow.active_quick_quote_draft_count, submittedQuickQuoteDraftCount: summaryRow.submitted_quick_quote_draft_count,
        inquiryCount: summaryRow.inquiry_count, openInquiryCount: summaryRow.open_inquiry_count, wonInquiryCount: summaryRow.won_inquiry_count,
        quoteCount: summaryRow.quote_count, pendingQuoteCount: summaryRow.pending_quote_count, pendingQuoteAmount: Number(summaryRow.pending_quote_amount),
        salesOrderCount: summaryRow.sales_order_count, openSalesOrderCount: summaryRow.open_sales_order_count,
        completedSalesOrderCount: summaryRow.completed_sales_order_count, completedSalesAmount: Number(summaryRow.completed_sales_amount),
        openPurchaseOrderCount: summaryRow.open_purchase_order_count, shipmentCount: summaryRow.shipment_count,
        receivableCount: summaryRow.receivable_count, collectedAmount: Number(summaryRow.collected_amount), outstandingAmount: Number(summaryRow.outstanding_amount),
        overdueReceivableCount: summaryRow.overdue_receivable_count, overdueAmount: Number(summaryRow.overdue_amount),
        afterSalesCount: summaryRow.after_sales_count, openAfterSalesCount: summaryRow.open_after_sales_count,
        afterSalesCreditedAmount: Number(summaryRow.after_sales_credited_amount), refundedAmount: Number(summaryRow.refunded_amount),
      },
      quickQuoteDrafts: quickQuoteDraftsResult.rows.map((row) => ({ id: row.id, draftNo: row.draft_no, status: row.status, customerVehicleId: row.customer_vehicle_id, vehicleLabel: row.vehicle_label || '', payload: row.payload || {}, submissionError: row.submission_error || {}, version: row.version, updatedAt: row.updated_at })),
      nextActions: nextActionsResult.rows.map((row) => ({ id: row.id, inquiryNo: row.inquiry_no, status: row.status, priority: row.priority, nextAction: row.next_action, nextActionAt: row.next_action_at, vehicleLabel: row.vehicle_label, customerVehicleId: row.customer_vehicle_id, quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount), currency: row.currency, updatedAt: row.updated_at })),
      timeline: { items: timelineRows, nextCursor: timelineResult.rows.length > size && timelineRows.length ? encodeTimelineCursor(timelineRows.at(-1)) : null },
    }
  }

  return {
    async list({ query = '', partnerType = '', status = '', page = 1, pageSize = 30 } = {}) {
      const q = clean(query); const type = clean(partnerType); const state = clean(status)
      if (type && !partnerTypes.has(type)) throw problem('INVALID_PARTNER_INPUT', '合作方类型无效')
      if (state && !partnerStatuses.has(state)) throw problem('INVALID_PARTNER_INPUT', '合作方状态无效')
      const currentPage = Math.max(1, Number(page) || 1); const size = Math.min(100, Math.max(1, Number(pageSize) || 30)); const where = []; const values = []
      if (q) { values.push(`%${q}%`); where.push(`(p.partner_no ILIKE $${values.length} OR p.name ILIKE $${values.length} OR p.short_name ILIKE $${values.length} OR p.phone ILIKE $${values.length} OR p.tax_id ILIKE $${values.length} OR EXISTS (SELECT 1 FROM business_partner_contact c WHERE c.partner_id=p.id AND (c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.wechat ILIKE $${values.length})) OR EXISTS (SELECT 1 FROM business_customer_vehicle v WHERE v.partner_id=p.id AND (v.vin ILIKE $${values.length} OR v.license_plate ILIKE $${values.length} OR v.vehicle_label ILIKE $${values.length})))`) }
      if (type) { values.push(type); where.push(`(p.partner_type=$${values.length} OR p.partner_type='both')`) }
      if (state) { values.push(state); where.push(`p.status=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*) FROM business_partner p ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT p.*,
        (SELECT count(*)::int FROM business_partner_contact c WHERE c.partner_id=p.id) contact_count,
        (SELECT count(*)::int FROM business_customer_vehicle v WHERE v.partner_id=p.id) vehicle_count
        FROM business_partner p ${clause} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,p.updated_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summary = (await pool.query('SELECT partner_type,status,count(*)::int count FROM business_partner GROUP BY partner_type,status')).rows
      return { items: rows.map(mapPartner), total, page: currentPage, pageSize: size, summary }
    },

    get,

    customer360,

    async onboardQuickQuoteCustomer(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const customerInput = normalizeBusinessPartnerInput({ ...(rawInput.customer || {}), partnerType: 'customer' })
      const customerPhone = phoneDigits(customerInput.phone)
      if (customerPhone.length < 7) throw problem('QUICK_QUOTE_CUSTOMER_PHONE_REQUIRED', '首次快速报价建档需要有效联系电话')
      const contact = clean(rawInput.customer?.contactName) ? normalizeContact({
        name: rawInput.customer.contactName,
        roleTitle: rawInput.customer.contactRoleTitle,
        phone: rawInput.customer.contactPhone || customerInput.phone,
        wechat: rawInput.customer.wechat,
        email: rawInput.customer.contactEmail,
        isPrimary: true,
      }) : null
      const vehicleDraft = normalizeVehicle(rawInput.vehicle || {})
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-onboarding:${key}`])
        const existingRequest = (await client.query('SELECT * FROM business_customer_onboarding_request WHERE request_key=$1', [key])).rows[0]
        if (existingRequest) return { partnerId: existingRequest.partner_id, vehicleId: existingRequest.customer_vehicle_id, createdPartner: existingRequest.created_partner, createdVehicle: existingRequest.created_vehicle, matchedBy: existingRequest.matched_by, created: false }
        const vehicle = await resolveVehicleMaster(client, vehicleDraft)
        if (!vehicle.platformMasterId) throw problem('CUSTOMER_VEHICLE_NOT_STANDARDIZED', '首次快速报价车辆必须关联标准车型平台', 409)
        const identities = [`phone:${customerPhone}`]
        if (vehicle.vin) identities.push(`vin:${vehicle.vin}`)
        else if (vehicle.licensePlate) identities.push(`plate:${vehicle.licensePlate}`)
        for (const identity of identities.sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-identity:${identity}`])

        let partner = null; let customerVehicle = null; let matchedBy = 'created'; let createdPartner = false; let createdVehicle = false
        if (vehicle.vin) {
          const match = (await client.query(`SELECT v.*,p.partner_type,p.status partner_status FROM business_customer_vehicle v
            JOIN business_partner p ON p.id=v.partner_id WHERE v.vin=$1 FOR UPDATE OF v,p`, [vehicle.vin])).rows[0]
          if (match) { customerVehicle = match; partner = match; matchedBy = 'vin' }
        }
        if (!customerVehicle && vehicle.licensePlate) {
          const matches = (await client.query(`SELECT v.*,p.partner_type,p.status partner_status FROM business_customer_vehicle v
            JOIN business_partner p ON p.id=v.partner_id WHERE upper(v.license_plate)=upper($1) FOR UPDATE OF v,p`, [vehicle.licensePlate])).rows
          if (matches.length > 1) throw problem('CUSTOMER_VEHICLE_MATCH_AMBIGUOUS', '该车牌关联了多条客户车辆，请先整理客户资料', 409, { vehicleIds: matches.map((item) => item.id) })
          if (matches.length === 1) { customerVehicle = matches[0]; partner = matches[0]; matchedBy = 'license_plate' }
        }
        if (customerVehicle) {
          if (!['customer', 'both'].includes(partner.partner_type) || partner.partner_status !== 'active') throw problem('QUICK_QUOTE_CUSTOMER_UNAVAILABLE', '匹配到的客户当前不可用于快速报价', 409, { partnerId: partner.partner_id })
          if (customerVehicle.platform_master_id !== vehicle.platformMasterId || (vehicle.variantMasterId && customerVehicle.variant_master_id !== vehicle.variantMasterId)) throw problem('CUSTOMER_VEHICLE_MASTER_CONFLICT', 'VIN 或车牌已建档，但关联的标准车型不同，请先复核车辆资料', 409, { partnerId: partner.partner_id, customerVehicleId: customerVehicle.id })
          partner = { id: partner.partner_id }
        } else {
          const candidates = (await client.query(`SELECT p.* FROM business_partner p
            WHERE p.partner_type IN ('customer','both') AND (regexp_replace(p.phone,'[^0-9]','','g')=$1 OR EXISTS (SELECT 1 FROM business_partner_contact c WHERE c.partner_id=p.id AND regexp_replace(c.phone,'[^0-9]','','g')=$1))
            ORDER BY p.updated_at DESC FOR UPDATE OF p`, [customerPhone])).rows
          if (candidates.length > 1) throw problem('QUICK_QUOTE_CUSTOMER_MATCH_AMBIGUOUS', '该联系电话匹配多个客户，请先选择或合并客户资料', 409, { partnerIds: candidates.map((item) => item.id) })
          if (candidates.length === 1) {
            partner = candidates[0]; matchedBy = 'phone'
            if (partner.status !== 'active') throw problem('QUICK_QUOTE_CUSTOMER_UNAVAILABLE', '联系电话匹配到的客户当前不可用', 409, { partnerId: partner.id })
          } else {
            const by = actorDetails(actor); const partnerNo = generatedNumber(); partner = { id: randomUUID() }
            await client.query(`INSERT INTO business_partner (id,partner_no,partner_type,name,short_name,tax_id,phone,email,address,status,payment_terms_days,credit_limit,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
              VALUES ($1,$2,'customer',$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$12,$13)`, [partner.id, partnerNo, customerInput.name, customerInput.shortName, customerInput.taxId, customerInput.phone, customerInput.email, customerInput.address, customerInput.paymentTermsDays, customerInput.creditLimit, customerInput.notes, by.id, by.name])
            if (contact) await client.query(`INSERT INTO business_partner_contact (id,partner_id,name,role_title,phone,wechat,email,is_primary,notes)
              VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`, [randomUUID(), partner.id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.notes])
            await insertEvent(client, partner.id, 'quick_quote_customer_created', actor, { partnerNo, requestKey: key, phone: customerInput.phone }, customerInput.notes)
            createdPartner = true
          }
          customerVehicle = { id: randomUUID() }
          await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,platform_master_id,variant_master_id,engine_code,model_year,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [customerVehicle.id, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.platformMasterId, vehicle.variantMasterId, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
          if (!createdPartner) {
            const by = actorDetails(actor)
            await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
          }
          await insertEvent(client, partner.id, 'quick_quote_vehicle_added', actor, { vehicleId: customerVehicle.id, requestKey: key, matchedBy, vin: vehicle.vin, licensePlate: vehicle.licensePlate, platformMasterId: vehicle.platformMasterId, variantMasterId: vehicle.variantMasterId })
          createdVehicle = true
        }
        const by = actorDetails(actor)
        await client.query(`INSERT INTO business_customer_onboarding_request
          (request_key,partner_id,customer_vehicle_id,created_partner,created_vehicle,matched_by,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [key, partner.id, customerVehicle.id, createdPartner, createdVehicle, matchedBy, by.id, by.name])
        return { partnerId: partner.id, vehicleId: customerVehicle.id, createdPartner, createdVehicle, matchedBy, created: true }
      })
      const partner = await get(result.partnerId)
      return { ...result, customer: partner, vehicle: partner.vehicles.find((item) => item.id === result.vehicleId) }
    },

    async create(rawInput = {}, actor) {
      const input = normalizeBusinessPartnerInput(rawInput); const contacts = Array.isArray(rawInput.contacts) ? rawInput.contacts.map(normalizeContact) : []; const vehicles = Array.isArray(rawInput.vehicles) ? rawInput.vehicles.map(normalizeVehicle) : []
      if (contacts.filter((contact) => contact.isPrimary).length > 1) throw problem('INVALID_PARTNER_CONTACT', '只能设置一个主联系人')
      if (vehicles.length && input.partnerType === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆')
      const id = randomUUID(); const partnerNo = generatedNumber(); const by = actorDetails(actor)
      await withTransaction(pool, async (client) => {
        await client.query(`INSERT INTO business_partner (id,partner_no,partner_type,name,short_name,tax_id,phone,email,address,status,payment_terms_days,credit_limit,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15)`, [id, partnerNo, input.partnerType, input.name, input.shortName, input.taxId, input.phone, input.email, input.address, input.status, input.paymentTermsDays, input.creditLimit, input.notes, by.id, by.name])
        for (const contact of contacts) await client.query(`INSERT INTO business_partner_contact (id,partner_id,name,role_title,phone,wechat,email,is_primary,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.isPrimary, contact.notes])
        for (const draft of vehicles) {
          const vehicle = await resolveVehicleMaster(client, draft)
          await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,platform_master_id,variant_master_id,engine_code,model_year,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.platformMasterId, vehicle.variantMasterId, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
        }
        await insertEvent(client, id, 'created', actor, { partnerNo, partnerType: input.partnerType, contactCount: contacts.length, vehicleCount: vehicles.length }, input.notes)
      })
      return get(id)
    },

    async update(id, rawInput = {}, actor) {
      const input = normalizeBusinessPartnerInput(rawInput, { partial: true }); const fields = Object.keys(input)
      if (!fields.length) throw problem('INVALID_PARTNER_INPUT', '没有可更新的客户或供应商字段')
      await withTransaction(pool, async (client) => {
        const current = await lockPartner(client, id, rawInput.expectedVersion)
        if (input.partnerType === 'supplier' && current.partner_type !== 'supplier') {
          const vehicleCount = Number((await client.query('SELECT count(*) FROM business_customer_vehicle WHERE partner_id=$1', [current.id])).rows[0].count)
          if (vehicleCount) throw problem('PARTNER_HAS_CUSTOMER_VEHICLES', '存在客户车辆时不能改为纯供应商', 409)
        }
        const columns = { partnerType: 'partner_type', name: 'name', shortName: 'short_name', taxId: 'tax_id', phone: 'phone', email: 'email', address: 'address', status: 'status', paymentTermsDays: 'payment_terms_days', creditLimit: 'credit_limit', notes: 'notes' }
        const values = [current.id]; const assignments = fields.map((field) => { values.push(input[field]); return `${columns[field]}=$${values.length}` })
        const by = actorDetails(actor); values.push(by.id, by.name)
        await client.query(`UPDATE business_partner SET ${assignments.join(',')},version=version+1,updated_by_id=$${values.length - 1},updated_by_name=$${values.length},updated_at=now() WHERE id=$1`, values)
        await insertEvent(client, current.id, 'updated', actor, { fields, fromVersion: current.version, toVersion: current.version + 1 }, rawInput.note)
      })
      return get(id)
    },

    async addContact(partnerId, rawInput = {}, actor) {
      const contact = normalizeContact(rawInput); const contactId = randomUUID()
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        if (contact.isPrimary) await client.query('UPDATE business_partner_contact SET is_primary=false,version=version+1,updated_at=now() WHERE partner_id=$1 AND is_primary', [partner.id])
        await client.query(`INSERT INTO business_partner_contact (id,partner_id,name,role_title,phone,wechat,email,is_primary,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [contactId, partner.id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.isPrimary, contact.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'contact_added', actor, { contactId, name: contact.name, isPrimary: contact.isPrimary })
      })
      return get(partnerId)
    },

    async updateContact(partnerId, contactId, rawInput = {}, actor) {
      const contact = normalizeContact(rawInput)
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        const current = (await client.query('SELECT * FROM business_partner_contact WHERE id=$1 AND partner_id=$2 FOR UPDATE', [contactId, partner.id])).rows[0]
        if (!current) throw problem('PARTNER_CONTACT_NOT_FOUND', '联系人不存在', 404)
        if (Number(rawInput.expectedVersion) !== current.version) throw problem('PARTNER_CONTACT_VERSION_CONFLICT', '联系人资料已变化，请刷新后重试', 409, { currentVersion: current.version })
        if (contact.isPrimary) await client.query('UPDATE business_partner_contact SET is_primary=false,version=version+1,updated_at=now() WHERE partner_id=$1 AND id<>$2 AND is_primary', [partner.id, contactId])
        await client.query(`UPDATE business_partner_contact SET name=$3,role_title=$4,phone=$5,wechat=$6,email=$7,is_primary=$8,notes=$9,version=version+1,updated_at=now() WHERE id=$1 AND partner_id=$2`, [contactId, partner.id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.isPrimary, contact.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'contact_updated', actor, { contactId, fromVersion: current.version, toVersion: current.version + 1 })
      })
      return get(partnerId)
    },

    async addVehicle(partnerId, rawInput = {}, actor) {
      const draft = normalizeVehicle(rawInput); const vehicleId = randomUUID()
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        if (partner.partner_type === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆', 409)
        const vehicle = await resolveVehicleMaster(client, draft)
        await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,platform_master_id,variant_master_id,engine_code,model_year,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [vehicleId, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.platformMasterId, vehicle.variantMasterId, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'vehicle_added', actor, { vehicleId, vehicleLabel: vehicle.vehicleLabel, vin: vehicle.vin, platformMasterId: vehicle.platformMasterId, variantMasterId: vehicle.variantMasterId })
      })
      return get(partnerId)
    },

    async updateVehicle(partnerId, vehicleId, rawInput = {}, actor) {
      const draft = normalizeVehicle(rawInput)
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        if (partner.partner_type === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆', 409)
        const current = (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2 FOR UPDATE', [vehicleId, partner.id])).rows[0]
        if (!current) throw problem('CUSTOMER_VEHICLE_NOT_FOUND', '客户车辆不存在', 404)
        if (Number(rawInput.expectedVersion) !== current.version) throw problem('CUSTOMER_VEHICLE_VERSION_CONFLICT', '车辆资料已变化，请刷新后重试', 409, { currentVersion: current.version })
        const vehicle = await resolveVehicleMaster(client, {
          ...draft,
          platformMasterId: rawInput.platformMasterId === undefined ? current.platform_master_id : draft.platformMasterId,
          variantMasterId: rawInput.variantMasterId === undefined ? current.variant_master_id : draft.variantMasterId,
        })
        await client.query(`UPDATE business_customer_vehicle SET vehicle_label=$3,vin=$4,license_plate=$5,platform_code=$6,platform_master_id=$7,variant_master_id=$8,engine_code=$9,model_year=$10,notes=$11,version=version+1,updated_at=now() WHERE id=$1 AND partner_id=$2`, [vehicleId, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.platformMasterId, vehicle.variantMasterId, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'vehicle_updated', actor, { vehicleId, fromVersion: current.version, toVersion: current.version + 1, platformMasterId: vehicle.platformMasterId, variantMasterId: vehicle.variantMasterId })
      })
      return get(partnerId)
    },
  }
}
