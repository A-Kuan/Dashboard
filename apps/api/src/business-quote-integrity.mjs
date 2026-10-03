import { createHash, randomUUID } from 'node:crypto'

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function stockKey(item) {
  if (clean(item.catalog_sku_id)) return `sku:${clean(item.catalog_sku_id)}`
  const oe = clean(item.oe_number).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return oe ? `oe:${oe}` : `inquiry:${clean(item.inquiry_item_id)}`
}

function fitmentMatchesVehicle(fitment, vehicle) {
  if (!fitment || fitment.verification_status !== 'verified') return false
  if (vehicle.variant_master_id && fitment.variant_master_id && fitment.variant_master_id !== vehicle.variant_master_id) return false
  if (vehicle.platform_master_id && fitment.platform_master_id !== vehicle.platform_master_id) return false
  if (vehicle.model_year != null && ((fitment.year_from && vehicle.model_year < fitment.year_from) || (fitment.year_to && vehicle.model_year > fitment.year_to))) return false
  if (vehicle.engine_code && fitment.engine_codes?.length && !fitment.engine_codes.includes(vehicle.engine_code)) return false
  return Boolean(fitment.platform_master_id || fitment.variant_master_id)
}

function addReason(reasons, code, lineNo = null, details = {}) {
  reasons.push({ code, ...(lineNo == null ? {} : { lineNo }), details })
}

export async function evaluateQuoteIntegrity(client, quoteId, { action = 'send' } = {}) {
  const quote = (await client.query(`SELECT q.*,i.customer_partner_id,i.customer_vehicle_id,i.vehicle_platform_id,i.vehicle_variant_id,i.vin inquiry_vin
    FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE q.id=$1`, [quoteId])).rows[0]
  if (!quote) return null
  const items = (await client.query('SELECT * FROM business_quote_item WHERE quote_id=$1 ORDER BY line_no', [quote.id])).rows
  const reasons = []
  const customer = quote.customer_partner_id ? (await client.query('SELECT id,status,version FROM business_partner WHERE id=$1', [quote.customer_partner_id])).rows[0] : null
  if (quote.customer_partner_id && (!customer || customer.status !== 'active')) addReason(reasons, 'customer_unavailable', null, { customerPartnerId: quote.customer_partner_id, status: customer?.status || 'missing' })

  const customerVehicle = quote.customer_vehicle_id ? (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1', [quote.customer_vehicle_id])).rows[0] : null
  if (quote.customer_vehicle_id && (!customerVehicle || customerVehicle.partner_id !== quote.customer_partner_id)) addReason(reasons, 'customer_vehicle_unavailable', null, { customerVehicleId: quote.customer_vehicle_id })
  const vehicle = customerVehicle || { platform_master_id: quote.vehicle_platform_id, variant_master_id: quote.vehicle_variant_id, vin: quote.inquiry_vin, engine_code: '', model_year: null, version: null }
  if (customerVehicle && (customerVehicle.platform_master_id !== quote.vehicle_platform_id || customerVehicle.variant_master_id !== quote.vehicle_variant_id || clean(customerVehicle.vin) !== clean(quote.inquiry_vin))) addReason(reasons, 'customer_vehicle_changed', null, { customerVehicleId: customerVehicle.id, vehicleVersion: customerVehicle.version, inquiryPlatformId: quote.vehicle_platform_id, currentPlatformId: customerVehicle.platform_master_id, inquiryVariantId: quote.vehicle_variant_id, currentVariantId: customerVehicle.variant_master_id, inquiryVin: quote.inquiry_vin, currentVin: customerVehicle.vin })

  const itemSnapshots = []
  for (const item of items) {
    const itemReasons = []
    let sku = null; let fitment = null; let offer = null; let warehouse = null; let availableQuantity = null
    if (item.catalog_sku_id) {
      sku = (await client.query('SELECT id,sku_code,version,lifecycle_status,verification_level FROM catalog_sku WHERE id=$1', [item.catalog_sku_id])).rows[0] || null
      if (!sku || sku.lifecycle_status !== 'verified' || sku.verification_level !== 'verified') itemReasons.push({ code: 'sku_unavailable', details: { catalogSkuId: item.catalog_sku_id, lifecycleStatus: sku?.lifecycle_status || 'missing', verificationLevel: sku?.verification_level || 'missing' } })
      else if (Number(item.catalog_sku_version) !== Number(sku.version)) itemReasons.push({ code: 'sku_version_changed', details: { catalogSkuId: sku.id, quotedVersion: item.catalog_sku_version, currentVersion: sku.version } })
      const evidence = item.fitment_snapshot || {}
      if (evidence.overridden) {
        if (clean(evidence.overrideReason).length < 8) itemReasons.push({ code: 'fitment_override_invalid', details: { catalogSkuId: item.catalog_sku_id } })
      } else if (!vehicle.platform_master_id) itemReasons.push({ code: 'vehicle_not_standardized', details: { customerVehicleId: quote.customer_vehicle_id || '' } })
      else if (!clean(evidence.fitmentId)) itemReasons.push({ code: 'fitment_evidence_missing', details: { catalogSkuId: item.catalog_sku_id } })
      else {
        fitment = (await client.query('SELECT * FROM catalog_fitment WHERE id=$1 AND sku_id=$2', [evidence.fitmentId, item.catalog_sku_id])).rows[0] || null
        if (!fitmentMatchesVehicle(fitment, vehicle)) itemReasons.push({ code: 'fitment_changed', details: { catalogSkuId: item.catalog_sku_id, fitmentId: evidence.fitmentId } })
      }
    }
    if (item.fulfillment_source === 'purchase') {
      offer = item.supplier_offer_id ? (await client.query(`SELECT o.*,p.status supplier_status,
        (o.valid_until IS NOT NULL AND o.valid_until<(now() AT TIME ZONE 'Asia/Shanghai')::date) expired
        FROM business_supplier_offer o LEFT JOIN business_partner p ON p.id=o.supplier_partner_id
        WHERE o.id=$1 AND o.inquiry_id=$2 AND o.inquiry_item_id=$3`, [item.supplier_offer_id, quote.inquiry_id, item.inquiry_item_id])).rows[0] : null
      if (!offer) itemReasons.push({ code: 'supplier_offer_unavailable', details: { supplierOfferId: item.supplier_offer_id || '' } })
      else {
        if (offer.supplier_partner_id && offer.supplier_status !== 'active') itemReasons.push({ code: 'supplier_unavailable', details: { supplierPartnerId: offer.supplier_partner_id, status: offer.supplier_status || 'missing' } })
        if (offer.expired) itemReasons.push({ code: 'supplier_offer_expired', details: { supplierOfferId: offer.id, validUntil: offer.valid_until } })
        if (Math.abs(number(offer.unit_price) - number(item.cost_unit_price)) >= 0.005) itemReasons.push({ code: 'supplier_cost_changed', details: { supplierOfferId: offer.id, quotedCost: number(item.cost_unit_price), currentCost: number(offer.unit_price) } })
      }
    } else if (item.fulfillment_source === 'stock') {
      warehouse = item.fulfillment_warehouse_id ? (await client.query("SELECT id,status FROM business_warehouse WHERE id=$1", [item.fulfillment_warehouse_id])).rows[0] : null
      if (!warehouse || warehouse.status !== 'active') itemReasons.push({ code: 'warehouse_unavailable', details: { fulfillmentWarehouseId: item.fulfillment_warehouse_id || '', status: warehouse?.status || 'missing' } })
      else {
        availableQuantity = number((await client.query('SELECT COALESCE(on_hand_quantity-reserved_quantity,0)::numeric quantity FROM business_inventory_balance WHERE warehouse_id=$1 AND stock_key=$2', [warehouse.id, stockKey(item)])).rows[0]?.quantity)
        if (availableQuantity < number(item.quantity)) itemReasons.push({ code: 'stock_unavailable', details: { fulfillmentWarehouseId: warehouse.id, requestedQuantity: number(item.quantity), availableQuantity } })
      }
    }
    for (const reason of itemReasons) addReason(reasons, reason.code, item.line_no, reason.details)
    itemSnapshots.push({ lineNo: item.line_no, quoteItemId: item.id, catalogSkuId: item.catalog_sku_id, quotedSkuVersion: item.catalog_sku_version, currentSkuVersion: sku?.version || null, fitmentId: item.fitment_snapshot?.fitmentId || '', fitmentOverridden: Boolean(item.fitment_snapshot?.overridden), fulfillmentSource: item.fulfillment_source, fulfillmentWarehouseId: item.fulfillment_warehouse_id, supplierOfferId: item.supplier_offer_id, supplierOfferValidUntil: offer?.valid_until || null, availableQuantity, reasons: itemReasons.map((reason) => reason.code) })
  }
  const snapshot = { action, customerPartnerId: quote.customer_partner_id, customerStatus: customer?.status || '', customerVehicleId: quote.customer_vehicle_id, vehicleVersion: customerVehicle?.version || null, vehiclePlatformId: vehicle.platform_master_id || null, vehicleVariantId: vehicle.variant_master_id || null, vin: clean(vehicle.vin), items: itemSnapshots }
  const fingerprint = createHash('sha256').update(JSON.stringify({ reasons, snapshot })).digest('hex')
  return { status: reasons.length ? 'blocked' : 'valid', reasons, snapshot, fingerprint }
}

export async function evaluateAndRecordQuoteIntegrity(client, quote, action, actor, { incrementRevisionWhenBlocked = false } = {}) {
  const result = await evaluateQuoteIntegrity(client, quote.id, { action })
  if (!result) return null
  const changed = quote.integrity_status !== result.status || quote.integrity_fingerprint !== result.fingerprint
  const incrementRevision = incrementRevisionWhenBlocked && result.status === 'blocked' && changed
  await client.query(`UPDATE business_quote SET integrity_status=$2,integrity_reasons=$3::jsonb,integrity_snapshot=$4::jsonb,integrity_fingerprint=$5,integrity_validated_at=now(),integrity_validated_action=$6,revision=revision+$7,updated_at=now() WHERE id=$1`, [quote.id, result.status, JSON.stringify(result.reasons), JSON.stringify(result.snapshot), result.fingerprint, action, incrementRevision ? 1 : 0])
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_quote_integrity_event (id,quote_id,action,result,from_status,to_status,actor_id,actor_name,reasons,snapshot,fingerprint)
    VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8::jsonb,$9::jsonb,$10)`, [randomUUID(), quote.id, action, result.status, quote.integrity_status || 'pending', by.id, by.name, JSON.stringify(result.reasons), JSON.stringify(result.snapshot), result.fingerprint])
  return { ...result, changed, currentRevision: Number(quote.revision) + (incrementRevision ? 1 : 0) }
}
