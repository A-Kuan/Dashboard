import { createHash, randomUUID } from 'node:crypto'
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
    mergedIntoPartnerId: row.merged_into_partner_id || null, mergedAt: row.merged_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at, contactCount: Number(row.contact_count || 0), vehicleCount: Number(row.vehicle_count || 0),
  }
}
function mapContact(row) {
  return { id: row.id, partnerId: row.partner_id, name: row.name, roleTitle: row.role_title, phone: row.phone, wechat: row.wechat, email: row.email, isPrimary: row.is_primary, notes: row.notes, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
}
function mapVehicle(row) {
  return { id: row.id, partnerId: row.partner_id, vehicleLabel: row.vehicle_label, vin: row.vin, licensePlate: row.license_plate, platformCode: row.platform_code, platformMasterId: row.platform_master_id, variantMasterId: row.variant_master_id, engineCode: row.engine_code, modelYear: row.model_year, notes: row.notes, version: row.version, mergedIntoVehicleId: row.merged_into_vehicle_id || null, mergedAt: row.merged_at || null, createdAt: row.created_at, updatedAt: row.updated_at }
}
async function insertEvent(client, partnerId, action, actor, snapshot = {}, note = '') {
  const by = actorDetails(actor)
  await client.query(`INSERT INTO business_partner_event (id,partner_id,action,actor_id,actor_name,note,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), partnerId, action, by.id, by.name, clean(note), JSON.stringify(snapshot)])
}
async function lockPartner(client, id, expectedVersion) {
  const row = (await client.query('SELECT * FROM business_partner WHERE id=$1 OR partner_no=upper(trim($1)) LIMIT 1 FOR UPDATE', [id])).rows[0]
  if (!row) throw problem('PARTNER_NOT_FOUND', '客户或供应商不存在', 404)
  if (row.merged_into_partner_id) throw problem('PARTNER_ALREADY_MERGED', '该客户已合并，不能继续修改', 409, { mergedIntoPartnerId: row.merged_into_partner_id })
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

function normalizedOnboardingInput(rawInput = {}) {
  const customer = normalizeBusinessPartnerInput({ ...(rawInput.customer || {}), partnerType: 'customer' })
  const customerPhone = phoneDigits(customer.phone)
  if (customerPhone.length < 7) throw problem('QUICK_QUOTE_CUSTOMER_PHONE_REQUIRED', '首次快速报价建档需要有效联系电话')
  const contact = clean(rawInput.customer?.contactName) ? normalizeContact({
    name: rawInput.customer.contactName,
    roleTitle: rawInput.customer.contactRoleTitle,
    phone: rawInput.customer.contactPhone || customer.phone,
    wechat: rawInput.customer.wechat,
    email: rawInput.customer.contactEmail,
    isPrimary: true,
  }) : null
  return {
    customer,
    customerPhone,
    contact,
    vehicleDraft: normalizeVehicle(rawInput.vehicle || {}),
    selectedPartnerId: clean(rawInput.customerPartnerId || rawInput.customer?.partnerId),
    confirmCreateNewCustomer: rawInput.confirmCreateNewCustomer === true,
  }
}

function onboardingPartner(row) {
  if (!row) return null
  return { id: row.id, partnerNo: row.partner_no, partnerType: row.partner_type, name: row.name, shortName: row.short_name, phone: row.phone, taxId: row.tax_id, status: row.status, version: row.version, mergedIntoPartnerId: row.merged_into_partner_id || null }
}

function onboardingVehicle(row) {
  if (!row) return null
  return { id: row.id, partnerId: row.partner_id, vehicleLabel: row.vehicle_label, vin: row.vin, licensePlate: row.license_plate, platformMasterId: row.platform_master_id, variantMasterId: row.variant_master_id, version: row.version, mergedIntoVehicleId: row.merged_into_vehicle_id || null }
}

function uniqueRows(rows) {
  return [...new Map(rows.filter(Boolean).map((row) => [row.id, row])).values()]
}

function onboardingFingerprint(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

async function buildOnboardingPreflight(client, rawInput = {}, { lock = false } = {}) {
  const input = normalizedOnboardingInput(rawInput)
  const vehicle = await resolveVehicleMaster(client, input.vehicleDraft)
  if (!vehicle.platformMasterId) throw problem('CUSTOMER_VEHICLE_NOT_STANDARDIZED', '首次快速报价车辆必须关联标准车型平台', 409)
  const partnerLock = lock ? ' FOR UPDATE OF p' : ''
  const vehicleLock = lock ? ' FOR UPDATE OF v,p' : ''
  const vinMatches = vehicle.vin ? (await client.query(`SELECT v.*,p.partner_no,p.name,p.short_name,p.phone,p.tax_id,p.partner_type,p.status partner_status,p.version partner_version
    FROM business_customer_vehicle v JOIN business_partner p ON p.id=v.partner_id WHERE v.vin=$1 AND v.merged_into_vehicle_id IS NULL ORDER BY v.id${vehicleLock}`, [vehicle.vin])).rows : []
  const plateMatches = vehicle.licensePlate ? (await client.query(`SELECT v.*,p.partner_no,p.name,p.short_name,p.phone,p.tax_id,p.partner_type,p.status partner_status,p.version partner_version
    FROM business_customer_vehicle v JOIN business_partner p ON p.id=v.partner_id WHERE upper(v.license_plate)=upper($1) AND v.merged_into_vehicle_id IS NULL ORDER BY v.id${vehicleLock}`, [vehicle.licensePlate])).rows : []
  const phoneMatches = (await client.query(`SELECT p.* FROM business_partner p
    WHERE p.partner_type IN ('customer','both') AND (regexp_replace(p.phone,'[^0-9]','','g')=$1 OR EXISTS (SELECT 1 FROM business_partner_contact c WHERE c.partner_id=p.id AND regexp_replace(c.phone,'[^0-9]','','g')=$1))
    ORDER BY p.updated_at DESC,p.id${partnerLock}`, [input.customerPhone])).rows
  const taxMatches = input.customer.taxId ? (await client.query(`SELECT p.* FROM business_partner p
    WHERE p.partner_type IN ('customer','both') AND upper(trim(p.tax_id))=upper(trim($1)) ORDER BY p.updated_at DESC,p.id${partnerLock}`, [input.customer.taxId])).rows : []
  const nameMatches = (await client.query(`SELECT p.* FROM business_partner p
    WHERE p.partner_type IN ('customer','both') AND (lower(trim(p.name))=lower(trim($1)) OR ($2<>'' AND lower(trim(p.short_name))=lower(trim($2))))
    ORDER BY p.updated_at DESC,p.id${partnerLock}`, [input.customer.name, input.customer.shortName])).rows
  const selectedPartner = input.selectedPartnerId ? (await client.query(`SELECT p.* FROM business_partner p WHERE p.id=$1 OR p.partner_no=upper(trim($1)) LIMIT 1${partnerLock}`, [input.selectedPartnerId])).rows[0] : null

  const conflicts = []
  const warnings = []
  const matchedVehicles = uniqueRows([...vinMatches, ...plateMatches])
  if (vinMatches.length > 1) conflicts.push({ code: 'duplicate_vin', message: '同一 VIN 关联了多条客户车辆，必须先整理车辆资料', vehicleIds: vinMatches.map((row) => row.id) })
  if (plateMatches.length > 1) conflicts.push({ code: 'duplicate_license_plate', message: '同一车牌关联了多条客户车辆，必须先整理车辆资料', vehicleIds: plateMatches.map((row) => row.id) })
  if (matchedVehicles.length > 1) conflicts.push({ code: 'vehicle_identity_conflict', message: 'VIN 与车牌指向不同客户车辆，必须先复核', vehicleIds: matchedVehicles.map((row) => row.id) })
  const matchedVehicle = matchedVehicles.length === 1 ? matchedVehicles[0] : null
  if (matchedVehicle && (matchedVehicle.platform_master_id !== vehicle.platformMasterId || (vehicle.variantMasterId && matchedVehicle.variant_master_id !== vehicle.variantMasterId))) {
    conflicts.push({ code: 'vehicle_master_conflict', message: '已建档车辆关联的标准车型与本次选择不同', vehicleId: matchedVehicle.id, currentPlatformMasterId: matchedVehicle.platform_master_id, requestedPlatformMasterId: vehicle.platformMasterId })
  }

  const identityMatches = uniqueRows([...phoneMatches, ...taxMatches])
  if (input.selectedPartnerId && !selectedPartner) conflicts.push({ code: 'selected_customer_not_found', message: '指定客户不存在', partnerId: input.selectedPartnerId })

  let targetPartner = selectedPartner || null
  let matchedBy = selectedPartner ? 'selected_customer' : ''
  if (!targetPartner && matchedVehicle) {
    targetPartner = { id: matchedVehicle.partner_id, partner_no: matchedVehicle.partner_no, name: matchedVehicle.name, short_name: matchedVehicle.short_name, phone: matchedVehicle.phone, tax_id: matchedVehicle.tax_id, status: matchedVehicle.partner_status, version: matchedVehicle.partner_version, partner_type: matchedVehicle.partner_type }
    matchedBy = vinMatches.length ? 'vin' : 'license_plate'
  }
  if (!targetPartner && identityMatches.length === 1) {
    targetPartner = identityMatches[0]
    matchedBy = taxMatches.some((row) => row.id === targetPartner.id) ? 'tax_id' : 'phone'
  }
  if (!targetPartner && phoneMatches.length > 1) conflicts.push({ code: 'duplicate_phone', message: '联系电话匹配多个客户，必须明确选择或合并客户资料', partnerIds: phoneMatches.map((row) => row.id) })
  if (!targetPartner && taxMatches.length > 1) conflicts.push({ code: 'duplicate_tax_id', message: '税号匹配多个客户，必须明确选择或整理客户资料', partnerIds: taxMatches.map((row) => row.id) })
  if (!targetPartner && identityMatches.length > 1) conflicts.push({ code: 'customer_identity_conflict', message: '电话与税号指向不同客户，必须先复核', partnerIds: identityMatches.map((row) => row.id) })
  if (targetPartner && (!['customer', 'both'].includes(targetPartner.partner_type) || targetPartner.status !== 'active')) conflicts.push({ code: 'customer_unavailable', message: '匹配或指定的客户当前不可用于快速报价', partnerId: targetPartner.id, status: targetPartner.status })
  if (matchedVehicle && targetPartner && matchedVehicle.partner_id !== targetPartner.id) conflicts.push({ code: 'vehicle_customer_conflict', message: '车辆归属与本次客户选择不一致', vehiclePartnerId: matchedVehicle.partner_id, selectedPartnerId: targetPartner.id })
  if (targetPartner && phoneMatches.length && !phoneMatches.some((row) => row.id === targetPartner.id)) conflicts.push({ code: 'input_phone_customer_conflict', message: '本次联系电话指向另一客户', partnerIds: phoneMatches.map((row) => row.id), selectedPartnerId: targetPartner.id })
  if (targetPartner && taxMatches.length && !taxMatches.some((row) => row.id === targetPartner.id)) conflicts.push({ code: 'input_tax_customer_conflict', message: '本次税号指向另一客户', partnerIds: taxMatches.map((row) => row.id), selectedPartnerId: targetPartner.id })
  if (targetPartner && phoneMatches.length > 1 && phoneMatches.some((row) => row.id === targetPartner.id)) warnings.push({ code: 'shared_phone_resolved_by_customer', message: '联系电话由多个客户共用，已按明确客户或车辆归属处理', partnerIds: phoneMatches.map((row) => row.id) })
  if (targetPartner && taxMatches.length > 1 && taxMatches.some((row) => row.id === targetPartner.id)) warnings.push({ code: 'shared_tax_id_resolved_by_customer', message: '税号存在多条候选，已按明确客户或车辆归属处理', partnerIds: taxMatches.map((row) => row.id) })

  const nameCandidates = uniqueRows(nameMatches).filter((row) => !targetPartner || row.id !== targetPartner.id)
  const pendingNameReview = !targetPartner && nameCandidates.length > 0 && !input.confirmCreateNewCustomer
  if (pendingNameReview) warnings.push({ code: 'same_name_customer_review', message: '存在同名客户，请选择已有客户或明确确认新建', partnerIds: nameCandidates.map((row) => row.id) })
  if (!targetPartner && nameCandidates.length > 0 && input.confirmCreateNewCustomer) warnings.push({ code: 'same_name_customer_confirmed', message: '已确认同名但仍新建独立客户', partnerIds: nameCandidates.map((row) => row.id) })

  const action = matchedVehicle ? 'reuse_vehicle' : targetPartner ? 'add_vehicle' : 'create_customer'
  if (!matchedBy) matchedBy = 'created'
  const snapshot = {
    input: { customer: input.customer, contact: input.contact, vehicle, selectedPartnerId: input.selectedPartnerId, confirmCreateNewCustomer: input.confirmCreateNewCustomer },
    action,
    matchedBy,
    targetPartner: onboardingPartner(targetPartner),
    targetVehicle: onboardingVehicle(matchedVehicle),
    candidates: {
      phone: phoneMatches.map(onboardingPartner),
      taxId: taxMatches.map(onboardingPartner),
      name: nameCandidates.map(onboardingPartner),
      vehicles: matchedVehicles.map(onboardingVehicle),
    },
    conflicts,
    warnings,
  }
  return { ready: conflicts.length === 0 && !pendingNameReview, action, matchedBy, targetCustomer: snapshot.targetPartner, targetVehicle: snapshot.targetVehicle, candidates: snapshot.candidates, conflicts, warnings, normalized: snapshot.input, fingerprint: onboardingFingerprint(snapshot), _snapshot: snapshot }
}

const customerMergeFields = [
  { key: 'name', column: 'name', label: '客户名称', requiredChoice: true },
  { key: 'shortName', column: 'short_name', label: '客户简称' },
  { key: 'taxId', column: 'tax_id', label: '税号', requiredChoice: true },
  { key: 'phone', column: 'phone', label: '联系电话', requiredChoice: true },
  { key: 'email', column: 'email', label: '邮箱' },
  { key: 'address', column: 'address', label: '地址' },
  { key: 'paymentTermsDays', column: 'payment_terms_days', label: '账期天数', requiredChoice: true },
  { key: 'creditLimit', column: 'credit_limit', label: '信用额度', requiredChoice: true },
  { key: 'notes', column: 'notes', label: '备注' },
]

function mergeFieldValue(row, field) {
  const value = row[field.column]
  return field.key === 'creditLimit' ? Number(value) : value
}

function normalizeMergeChoices(raw = {}) {
  const choices = {}
  for (const field of customerMergeFields) {
    const value = clean(raw[field.key])
    if (value && !['survivor', 'retired'].includes(value)) throw problem('INVALID_CUSTOMER_MERGE_FIELD_CHOICE', `${field.label}的保留来源无效`)
    if (value) choices[field.key] = value
  }
  return choices
}

async function countWhere(client, table, column, id) {
  return Number((await client.query(`SELECT count(*) FROM ${table} WHERE ${column}=$1`, [id])).rows[0].count)
}

async function buildCustomerMergePreview(client, rawInput = {}, { lock = false } = {}) {
  const survivorId = clean(rawInput.survivorPartnerId)
  const retiredId = clean(rawInput.retiredPartnerId)
  if (!survivorId || !retiredId || survivorId === retiredId) throw problem('INVALID_CUSTOMER_MERGE_PAIR', '必须选择两个不同的客户，并明确保留客户与退役客户')
  const choices = normalizeMergeChoices(rawInput.fieldChoices)
  const ids = [survivorId, retiredId].sort()
  const rows = (await client.query(`SELECT * FROM business_partner WHERE id=ANY($1::text[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [ids])).rows
  const survivor = rows.find((row) => row.id === survivorId || row.partner_no === survivorId.toUpperCase()) || rows.find((row) => row.id === survivorId)
  const retired = rows.find((row) => row.id === retiredId || row.partner_no === retiredId.toUpperCase()) || rows.find((row) => row.id === retiredId)
  if (!survivor || !retired) throw problem('CUSTOMER_MERGE_PARTNER_NOT_FOUND', '待合并客户不存在', 404, { survivorFound: Boolean(survivor), retiredFound: Boolean(retired) })

  const conflicts = []
  if (!['customer', 'both'].includes(survivor.partner_type) || survivor.status !== 'active' || survivor.merged_into_partner_id) conflicts.push({ code: 'survivor_unavailable', message: '保留客户必须是未合并的启用客户', partnerId: survivor.id })
  if (retired.partner_type !== 'customer') conflicts.push({ code: 'retired_not_customer_only', message: '退役记录必须是纯客户；兼具供应商身份的合作方不能通过客户合并处理', partnerId: retired.id, partnerType: retired.partner_type })
  if (retired.merged_into_partner_id) conflicts.push({ code: 'retired_already_merged', message: '退役客户已经合并到其他客户', partnerId: retired.id, mergedIntoPartnerId: retired.merged_into_partner_id })

  const contactsResult = await client.query('SELECT * FROM business_partner_contact WHERE partner_id=ANY($1::text[]) ORDER BY partner_id,id', [[survivor.id, retired.id]])
  const vehiclesResult = await client.query('SELECT * FROM business_customer_vehicle WHERE partner_id=ANY($1::text[]) ORDER BY partner_id,id', [[survivor.id, retired.id]])
  const duplicatePlateResult = await client.query(`SELECT rv.id retired_vehicle_id,sv.id survivor_vehicle_id,rv.license_plate
    FROM business_customer_vehicle rv JOIN business_customer_vehicle sv ON sv.partner_id=$1
      AND rv.partner_id=$2 AND rv.merged_into_vehicle_id IS NULL AND sv.merged_into_vehicle_id IS NULL
      AND rv.license_plate<>'' AND upper(rv.license_plate)=upper(sv.license_plate)
    ORDER BY rv.id,sv.id`, [survivor.id, retired.id])
  if (duplicatePlateResult.rows.length) conflicts.push({ code: 'duplicate_vehicle_plate', message: '两个客户存在相同车牌的车辆，需先复核车辆资料', vehicles: duplicatePlateResult.rows.map((row) => ({ retiredVehicleId: row.retired_vehicle_id, survivorVehicleId: row.survivor_vehicle_id, licensePlate: row.license_plate })) })

  const directImpactDefinitions = [
    ['contacts', 'business_partner_contact', 'partner_id'],
    ['vehicles', 'business_customer_vehicle', 'partner_id'],
    ['partnerEvents', 'business_partner_event', 'partner_id'],
    ['inquiries', 'business_inquiry', 'customer_partner_id'],
    ['salesOrders', 'business_sales_order', 'customer_partner_id'],
    ['receivables', 'business_receivable', 'customer_partner_id'],
    ['afterSalesCases', 'business_after_sales_case', 'customer_partner_id'],
    ['quickQuoteDrafts', 'business_quick_quote_draft', 'customer_partner_id'],
    ['onboardingRequests', 'business_customer_onboarding_request', 'partner_id'],
  ]
  const impact = {}
  for (const [key, table, column] of directImpactDefinitions) impact[key] = await countWhere(client, table, column, retired.id)
  impact.mergedAliases = await countWhere(client, 'business_partner', 'merged_into_partner_id', retired.id)
  impact.quotes = Number((await client.query('SELECT count(*) FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_partner_id=$1', [retired.id])).rows[0].count)
  impact.purchaseOrders = Number((await client.query('SELECT count(*) FROM business_purchase_order p JOIN business_sales_order s ON s.id=p.sales_order_id WHERE s.customer_partner_id=$1', [retired.id])).rows[0].count)
  const supplierImpact = {
    supplierOffers: await countWhere(client, 'business_supplier_offer', 'supplier_partner_id', retired.id),
    purchaseOrders: await countWhere(client, 'business_purchase_order', 'supplier_partner_id', retired.id),
    payables: await countWhere(client, 'business_payable', 'supplier_partner_id', retired.id),
    supplierReturns: await countWhere(client, 'business_supplier_return_case', 'supplier_partner_id', retired.id),
  }
  if (Object.values(supplierImpact).some(Boolean)) conflicts.push({ code: 'retired_has_supplier_history', message: '退役客户仍有供应商业务引用，不能按客户资料合并', supplierImpact })

  const differences = []
  const requiredChoices = []
  const resolved = {}
  for (const field of customerMergeFields) {
    const survivorValue = mergeFieldValue(survivor, field)
    const retiredValue = mergeFieldValue(retired, field)
    const differs = String(survivorValue ?? '') !== String(retiredValue ?? '')
    let source = choices[field.key]
    if (!source) {
      if ((survivorValue === '' || survivorValue == null) && retiredValue !== '' && retiredValue != null) source = 'retired'
      else source = 'survivor'
    }
    if (differs) differences.push({ field: field.key, label: field.label, survivorValue, retiredValue, selectedSource: source })
    if (differs && field.requiredChoice && survivorValue !== '' && survivorValue != null && retiredValue !== '' && retiredValue != null && !choices[field.key]) requiredChoices.push(field.key)
    resolved[field.key] = source === 'retired' ? retiredValue : survivorValue
  }

  const snapshot = {
    survivor: onboardingPartner(survivor),
    retired: onboardingPartner(retired),
    fieldChoices: choices,
    resolved,
    differences,
    requiredChoices,
    impact,
    supplierImpact,
    contacts: contactsResult.rows.map((row) => ({ id: row.id, partnerId: row.partner_id, name: row.name, phone: row.phone, wechat: row.wechat, email: row.email, isPrimary: row.is_primary, version: row.version })),
    vehicles: vehiclesResult.rows.map(onboardingVehicle),
    conflicts,
  }
  return {
    ready: conflicts.length === 0 && requiredChoices.length === 0,
    survivor: snapshot.survivor,
    retired: snapshot.retired,
    differences,
    requiredChoices,
    resolved,
    impact,
    supplierImpact,
    conflicts,
    fingerprint: onboardingFingerprint(snapshot),
    _snapshot: snapshot,
    _survivor: survivor,
    _retired: retired,
  }
}

function vehicleStandardSnapshot(row) {
  return {
    platformCode: row.platform_code,
    platformMasterId: row.platform_master_id,
    variantMasterId: row.variant_master_id,
    engineCode: row.engine_code,
    modelYear: row.model_year,
  }
}

function normalizeVehicleMergeChoices(raw = {}) {
  const choices = {}
  for (const [key, label] of [['vehicleLabel', '车辆名称'], ['licensePlate', '车牌'], ['standardVehicle', '标准车型'], ['notes', '备注']]) {
    const value = clean(raw[key])
    if (value && !['survivor', 'retired'].includes(value)) throw problem('INVALID_CUSTOMER_VEHICLE_MERGE_FIELD_CHOICE', `${label}的保留来源无效`)
    if (value) choices[key] = value
  }
  return choices
}

function vehicleMergeValue(survivor, retired, key, choices) {
  const source = choices[key] || 'survivor'
  return source === 'retired' ? retired : survivor
}

async function buildCustomerVehicleMergePreview(client, rawInput = {}, { lock = false } = {}) {
  const survivorId = clean(rawInput.survivorVehicleId)
  const retiredId = clean(rawInput.retiredVehicleId)
  if (!survivorId || !retiredId || survivorId === retiredId) throw problem('INVALID_CUSTOMER_VEHICLE_MERGE_PAIR', '必须选择同一客户的两辆不同车辆，并明确保留车辆与退役车辆')
  const choices = normalizeVehicleMergeChoices(rawInput.fieldChoices)
  const rows = (await client.query(`SELECT v.*,p.partner_no,p.name partner_name,p.status partner_status,p.merged_into_partner_id
    FROM business_customer_vehicle v JOIN business_partner p ON p.id=v.partner_id
    WHERE v.id=ANY($1::text[]) ORDER BY v.id${lock ? ' FOR UPDATE OF v,p' : ''}`, [[survivorId, retiredId]])).rows
  const survivor = rows.find((row) => row.id === survivorId)
  const retired = rows.find((row) => row.id === retiredId)
  if (!survivor || !retired) throw problem('CUSTOMER_VEHICLE_MERGE_NOT_FOUND', '待合并车辆不存在', 404, { survivorFound: Boolean(survivor), retiredFound: Boolean(retired) })

  const conflicts = []
  if (survivor.partner_id !== retired.partner_id) conflicts.push({ code: 'vehicle_owner_mismatch', message: '两辆车不属于同一客户，不能静默改变客户归属', survivorPartnerId: survivor.partner_id, retiredPartnerId: retired.partner_id })
  if (survivor.partner_status !== 'active' || survivor.merged_into_partner_id) conflicts.push({ code: 'vehicle_customer_unavailable', message: '保留车辆所属客户当前不可用', partnerId: survivor.partner_id })
  if (survivor.merged_into_vehicle_id) conflicts.push({ code: 'survivor_vehicle_already_merged', message: '保留车辆已经合并到其他车辆', vehicleId: survivor.id, mergedIntoVehicleId: survivor.merged_into_vehicle_id })
  if (retired.merged_into_vehicle_id) conflicts.push({ code: 'retired_vehicle_already_merged', message: '退役车辆已经合并到其他车辆', vehicleId: retired.id, mergedIntoVehicleId: retired.merged_into_vehicle_id })
  if (survivor.vin && retired.vin && survivor.vin !== retired.vin) conflicts.push({ code: 'vehicle_vin_conflict', message: '两辆车的 VIN 不同，不能作为重复车辆合并', survivorVin: survivor.vin, retiredVin: retired.vin })

  const differences = []
  const requiredChoices = []
  const resolved = {}
  for (const [key, column, label] of [['vehicleLabel', 'vehicle_label', '车辆名称'], ['licensePlate', 'license_plate', '车牌']]) {
    const survivorValue = survivor[column]
    const retiredValue = retired[column]
    const differs = String(survivorValue || '') !== String(retiredValue || '')
    let source = choices[key]
    if (!source) source = !survivorValue && retiredValue ? 'retired' : 'survivor'
    if (differs) differences.push({ field: key, label, survivorValue, retiredValue, selectedSource: source })
    if (differs && survivorValue && retiredValue && !choices[key]) requiredChoices.push(key)
    resolved[key] = source === 'retired' ? retiredValue : survivorValue
  }
  resolved.vin = survivor.vin || retired.vin
  const survivorStandard = vehicleStandardSnapshot(survivor)
  const retiredStandard = vehicleStandardSnapshot(retired)
  const standardsDiffer = JSON.stringify(survivorStandard) !== JSON.stringify(retiredStandard)
  const survivorHasStandard = Boolean(survivor.platform_master_id || survivor.variant_master_id || survivor.platform_code || survivor.engine_code || survivor.model_year)
  const retiredHasStandard = Boolean(retired.platform_master_id || retired.variant_master_id || retired.platform_code || retired.engine_code || retired.model_year)
  let standardSource = choices.standardVehicle
  if (!standardSource) standardSource = !survivorHasStandard && retiredHasStandard ? 'retired' : 'survivor'
  if (standardsDiffer) differences.push({ field: 'standardVehicle', label: '标准车型', survivorValue: survivorStandard, retiredValue: retiredStandard, selectedSource: standardSource })
  if (standardsDiffer && survivorHasStandard && retiredHasStandard && !choices.standardVehicle) requiredChoices.push('standardVehicle')
  Object.assign(resolved, vehicleMergeValue(survivorStandard, retiredStandard, 'standardVehicle', { standardVehicle: standardSource }))
  const survivorNotes = clean(survivor.notes)
  const retiredNotes = clean(retired.notes)
  let notesSource = choices.notes
  if (!notesSource) notesSource = !survivorNotes && retiredNotes ? 'retired' : 'survivor'
  if (survivorNotes !== retiredNotes) differences.push({ field: 'notes', label: '备注', survivorValue: survivorNotes, retiredValue: retiredNotes, selectedSource: notesSource })
  resolved.notes = notesSource === 'retired' ? retiredNotes : survivorNotes

  const impact = {
    inquiries: await countWhere(client, 'business_inquiry', 'customer_vehicle_id', retired.id),
    salesOrders: await countWhere(client, 'business_sales_order', 'customer_vehicle_id', retired.id),
    onboardingRequests: await countWhere(client, 'business_customer_onboarding_request', 'customer_vehicle_id', retired.id),
    quickQuoteDrafts: await countWhere(client, 'business_quick_quote_draft', 'customer_vehicle_id', retired.id),
    mergedAliases: await countWhere(client, 'business_customer_vehicle', 'merged_into_vehicle_id', retired.id),
  }
  impact.quotes = Number((await client.query('SELECT count(*) FROM business_quote q JOIN business_inquiry i ON i.id=q.inquiry_id WHERE i.customer_vehicle_id=$1', [retired.id])).rows[0].count)
  const snapshot = {
    partner: { id: survivor.partner_id, partnerNo: survivor.partner_no, name: survivor.partner_name, status: survivor.partner_status },
    survivor: mapVehicle(survivor),
    retired: mapVehicle(retired),
    fieldChoices: choices,
    resolved,
    differences,
    requiredChoices,
    impact,
    conflicts,
  }
  return {
    ready: conflicts.length === 0 && requiredChoices.length === 0,
    partner: snapshot.partner,
    survivor: snapshot.survivor,
    retired: snapshot.retired,
    differences,
    requiredChoices,
    resolved,
    impact,
    conflicts,
    fingerprint: onboardingFingerprint(snapshot),
    _snapshot: snapshot,
    _survivor: survivor,
    _retired: retired,
  }
}

export function createBusinessPartnerRepository(pool) {
  async function get(id, client = pool) {
    const row = (await client.query(`SELECT p.*,
      (SELECT count(*)::int FROM business_partner_contact c WHERE c.partner_id=p.id) contact_count,
      (SELECT count(*)::int FROM business_customer_vehicle v WHERE v.partner_id=p.id AND v.merged_into_vehicle_id IS NULL) vehicle_count
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
      if (q) { values.push(`%${q}%`); where.push(`(p.partner_no ILIKE $${values.length} OR p.name ILIKE $${values.length} OR p.short_name ILIKE $${values.length} OR p.phone ILIKE $${values.length} OR p.tax_id ILIKE $${values.length} OR EXISTS (SELECT 1 FROM business_partner_contact c WHERE c.partner_id=p.id AND (c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.wechat ILIKE $${values.length})) OR EXISTS (SELECT 1 FROM business_customer_vehicle v WHERE v.partner_id=p.id AND v.merged_into_vehicle_id IS NULL AND (v.vin ILIKE $${values.length} OR v.license_plate ILIKE $${values.length} OR v.vehicle_label ILIKE $${values.length})))`) }
      if (type) { values.push(type); where.push(`(p.partner_type=$${values.length} OR p.partner_type='both')`) }
      if (state) { values.push(state); where.push(`p.status=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number((await pool.query(`SELECT count(*) FROM business_partner p ${clause}`, values)).rows[0].count)
      values.push(size, (currentPage - 1) * size)
      const rows = (await pool.query(`SELECT p.*,
        (SELECT count(*)::int FROM business_partner_contact c WHERE c.partner_id=p.id) contact_count,
        (SELECT count(*)::int FROM business_customer_vehicle v WHERE v.partner_id=p.id AND v.merged_into_vehicle_id IS NULL) vehicle_count
        FROM business_partner p ${clause} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,p.updated_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows
      const summary = (await pool.query('SELECT partner_type,status,count(*)::int count FROM business_partner GROUP BY partner_type,status')).rows
      return { items: rows.map(mapPartner), total, page: currentPage, pageSize: size, summary }
    },

    get,

    customer360,

    async previewQuickQuoteCustomerOnboarding(rawInput = {}) {
      const preflight = await buildOnboardingPreflight(pool, rawInput)
      const { _snapshot, ...result } = preflight
      return result
    },

    async onboardQuickQuoteCustomer(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-onboarding:${key}`])
        const existingRequest = (await client.query('SELECT * FROM business_customer_onboarding_request WHERE request_key=$1', [key])).rows[0]
        if (existingRequest) return { partnerId: existingRequest.partner_id, vehicleId: existingRequest.customer_vehicle_id, createdPartner: existingRequest.created_partner, createdVehicle: existingRequest.created_vehicle, matchedBy: existingRequest.matched_by, decisionFingerprint: existingRequest.decision_fingerprint, created: false }
        const input = normalizedOnboardingInput(rawInput)
        const identities = [`phone:${input.customerPhone}`]
        if (input.customer.taxId) identities.push(`tax:${input.customer.taxId.toUpperCase()}`)
        if (input.vehicleDraft.vin) identities.push(`vin:${input.vehicleDraft.vin}`)
        if (input.vehicleDraft.licensePlate) identities.push(`plate:${input.vehicleDraft.licensePlate}`)
        if (input.selectedPartnerId) identities.push(`partner:${input.selectedPartnerId}`)
        for (const identity of identities.sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-identity:${identity}`])

        const preflight = await buildOnboardingPreflight(client, rawInput, { lock: true })
        const submittedFingerprint = clean(rawInput.previewFingerprint)
        const publicPreflight = Object.fromEntries(Object.entries(preflight).filter(([key]) => key !== '_snapshot'))
        if (!submittedFingerprint) throw problem('CUSTOMER_ONBOARDING_PREVIEW_REQUIRED', '首次报价建档必须先完成客户与车辆预检', 409, { preflight: publicPreflight })
        if (submittedFingerprint !== preflight.fingerprint) throw problem('CUSTOMER_ONBOARDING_PREVIEW_STALE', '客户或车辆资料已变化，请刷新预检结果后再提交', 409, { preflight: publicPreflight })
        if (!preflight.ready) throw problem('CUSTOMER_ONBOARDING_REVIEW_REQUIRED', '客户与车辆预检存在冲突或待确认候选，不能直接建档', 409, { preflight: publicPreflight })

        const customerInput = preflight.normalized.customer
        const contact = preflight.normalized.contact
        const vehicle = preflight.normalized.vehicle
        let partner = preflight.targetCustomer ? { id: preflight.targetCustomer.id } : null
        let customerVehicle = preflight.targetVehicle ? { id: preflight.targetVehicle.id } : null
        let createdPartner = false; let createdVehicle = false
        if (preflight.action === 'create_customer') {
          const by = actorDetails(actor); const partnerNo = generatedNumber(); partner = { id: randomUUID() }
          await client.query(`INSERT INTO business_partner (id,partner_no,partner_type,name,short_name,tax_id,phone,email,address,status,payment_terms_days,credit_limit,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
            VALUES ($1,$2,'customer',$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$12,$13)`, [partner.id, partnerNo, customerInput.name, customerInput.shortName, customerInput.taxId, customerInput.phone, customerInput.email, customerInput.address, customerInput.paymentTermsDays, customerInput.creditLimit, customerInput.notes, by.id, by.name])
          if (contact) await client.query(`INSERT INTO business_partner_contact (id,partner_id,name,role_title,phone,wechat,email,is_primary,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`, [randomUUID(), partner.id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.notes])
          await insertEvent(client, partner.id, 'quick_quote_customer_created', actor, { partnerNo, requestKey: key, phone: customerInput.phone, decisionFingerprint: preflight.fingerprint }, customerInput.notes)
          createdPartner = true
        }
        if (preflight.action !== 'reuse_vehicle') {
          customerVehicle = { id: randomUUID() }
          await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,platform_master_id,variant_master_id,engine_code,model_year,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [customerVehicle.id, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.platformMasterId, vehicle.variantMasterId, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
          if (!createdPartner) {
            const by = actorDetails(actor)
            await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
          }
          await insertEvent(client, partner.id, 'quick_quote_vehicle_added', actor, { vehicleId: customerVehicle.id, requestKey: key, matchedBy: preflight.matchedBy, vin: vehicle.vin, licensePlate: vehicle.licensePlate, platformMasterId: vehicle.platformMasterId, variantMasterId: vehicle.variantMasterId, decisionFingerprint: preflight.fingerprint })
          createdVehicle = true
        }
        const by = actorDetails(actor)
        await client.query(`INSERT INTO business_customer_onboarding_request
          (request_key,partner_id,customer_vehicle_id,created_partner,created_vehicle,matched_by,decision_fingerprint,decision_snapshot,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [key, partner.id, customerVehicle.id, createdPartner, createdVehicle, preflight.matchedBy, preflight.fingerprint, JSON.stringify(preflight._snapshot), by.id, by.name])
        return { partnerId: partner.id, vehicleId: customerVehicle.id, createdPartner, createdVehicle, matchedBy: preflight.matchedBy, decisionFingerprint: preflight.fingerprint, created: true }
      })
      const partner = await get(result.partnerId)
      return { ...result, customer: partner, vehicle: partner.vehicles.find((item) => item.id === result.vehicleId) }
    },

    async previewCustomerMerge(rawInput = {}) {
      const preview = await buildCustomerMergePreview(pool, rawInput)
      const { _snapshot, _survivor, _retired, ...result } = preview
      return result
    },

    async mergeCustomer(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const reason = clean(rawInput.reason)
      if (reason.length < 8 || reason.length > 500) throw problem('INVALID_CUSTOMER_MERGE_REASON', '客户合并原因必须为 8 至 500 个字符')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-merge-request:${key}`])
        const existing = (await client.query('SELECT * FROM business_partner_merge WHERE request_key=$1', [key])).rows[0]
        if (existing) return { created: false, mergeId: existing.id, survivorPartnerId: existing.survivor_partner_id, retiredPartnerId: existing.retired_partner_id, decisionFingerprint: existing.decision_fingerprint }
        const survivorId = clean(rawInput.survivorPartnerId); const retiredId = clean(rawInput.retiredPartnerId)
        for (const id of [survivorId, retiredId].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-merge-partner:${id}`])
        const preview = await buildCustomerMergePreview(client, rawInput, { lock: true })
        const publicPreview = Object.fromEntries(Object.entries(preview).filter(([name]) => !name.startsWith('_')))
        const submittedFingerprint = clean(rawInput.previewFingerprint)
        if (!submittedFingerprint) throw problem('CUSTOMER_MERGE_PREVIEW_REQUIRED', '客户合并必须先完成影响预览', 409, { preview: publicPreview })
        if (submittedFingerprint !== preview.fingerprint) throw problem('CUSTOMER_MERGE_PREVIEW_STALE', '客户或关联业务数据已变化，请刷新合并预览', 409, { preview: publicPreview })
        if (!preview.ready) throw problem('CUSTOMER_MERGE_REVIEW_REQUIRED', '客户合并仍有字段选择或资料冲突未处理', 409, { preview: publicPreview })

        const survivor = preview._survivor; const retired = preview._retired; const mergeId = randomUUID(); const by = actorDetails(actor)
        const survivorHasPrimary = Boolean((await client.query('SELECT 1 FROM business_partner_contact WHERE partner_id=$1 AND is_primary LIMIT 1', [survivor.id])).rows[0])
        if (survivorHasPrimary) await client.query('UPDATE business_partner_contact SET is_primary=false WHERE partner_id=$1 AND is_primary', [retired.id])
        await client.query('UPDATE business_partner_contact SET partner_id=$1,version=version+1,updated_at=now() WHERE partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_customer_vehicle SET partner_id=$1,version=version+1,updated_at=now() WHERE partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_partner_event SET partner_id=$1 WHERE partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_inquiry SET customer_partner_id=$1,updated_at=now() WHERE customer_partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_sales_order SET customer_partner_id=$1,updated_at=now() WHERE customer_partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_receivable SET customer_partner_id=$1,updated_at=now() WHERE customer_partner_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_after_sales_case SET customer_partner_id=$1,updated_at=now() WHERE customer_partner_id=$2', [survivor.id, retired.id])
        const draftRows = (await client.query('SELECT id,version FROM business_quick_quote_draft WHERE customer_partner_id=$1 ORDER BY id FOR UPDATE', [retired.id])).rows
        for (const draft of draftRows) {
          await client.query(`UPDATE business_quick_quote_draft SET customer_partner_id=$2,
            payload=jsonb_set(payload,'{customerPartnerId}',to_jsonb($2::text),true),version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1`, [draft.id, survivor.id, by.id, by.name])
          await client.query(`INSERT INTO business_quick_quote_draft_event
            (id,draft_id,action,from_version,to_version,actor_id,actor_name,snapshot) VALUES ($1,$2,'customer_merged',$3,$4,$5,$6,$7::jsonb)`,
          [randomUUID(), draft.id, draft.version, draft.version + 1, by.id, by.name, JSON.stringify({ mergeId, fromPartnerId: retired.id, toPartnerId: survivor.id })])
        }
        await client.query('UPDATE business_customer_onboarding_request SET partner_id=$1 WHERE partner_id=$2', [survivor.id, retired.id])
        await client.query(`UPDATE business_partner SET merged_into_partner_id=$1,version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now()
          WHERE merged_into_partner_id=$2`, [survivor.id, retired.id, by.id, by.name])

        await client.query(`UPDATE business_partner SET status='inactive',merged_into_partner_id=$2,merged_at=now(),
          name=$3,short_name='',tax_id='',phone='',email='',address='',version=version+1,updated_by_id=$4,updated_by_name=$5,updated_at=now() WHERE id=$1`,
        [retired.id, survivor.id, `[已合并] ${retired.name}`, by.id, by.name])
        const resolved = preview.resolved
        await client.query(`UPDATE business_partner SET name=$2,short_name=$3,tax_id=$4,phone=$5,email=$6,address=$7,
          payment_terms_days=$8,credit_limit=$9,notes=$10,version=version+1,updated_by_id=$11,updated_by_name=$12,updated_at=now() WHERE id=$1`,
        [survivor.id, resolved.name, resolved.shortName, resolved.taxId, resolved.phone, resolved.email, resolved.address, resolved.paymentTermsDays, resolved.creditLimit, resolved.notes, by.id, by.name])
        await client.query(`INSERT INTO business_partner_merge
          (id,request_key,survivor_partner_id,retired_partner_id,reason,decision_fingerprint,decision_snapshot,impact_snapshot,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
        [mergeId, key, survivor.id, retired.id, reason, preview.fingerprint, JSON.stringify(preview._snapshot), JSON.stringify(preview.impact), by.id, by.name])
        await insertEvent(client, survivor.id, 'customer_merged', actor, { mergeId, retiredPartnerId: retired.id, decisionFingerprint: preview.fingerprint, impact: preview.impact, resolved }, reason)
        await insertEvent(client, retired.id, 'merged_into_customer', actor, { mergeId, survivorPartnerId: survivor.id, decisionFingerprint: preview.fingerprint }, reason)
        return { created: true, mergeId, survivorPartnerId: survivor.id, retiredPartnerId: retired.id, decisionFingerprint: preview.fingerprint }
      })
      return { ...result, survivor: await get(result.survivorPartnerId), retired: await get(result.retiredPartnerId) }
    },

    async previewCustomerVehicleMerge(rawInput = {}) {
      const preview = await buildCustomerVehicleMergePreview(pool, rawInput)
      const { _snapshot, _survivor, _retired, ...result } = preview
      return result
    },

    async mergeCustomerVehicle(rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const reason = clean(rawInput.reason)
      if (reason.length < 8 || reason.length > 500) throw problem('INVALID_CUSTOMER_VEHICLE_MERGE_REASON', '车辆合并原因必须为 8 至 500 个字符')
      const result = await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-vehicle-merge-request:${key}`])
        const existing = (await client.query('SELECT * FROM business_customer_vehicle_merge WHERE request_key=$1', [key])).rows[0]
        if (existing) return { created: false, mergeId: existing.id, partnerId: existing.partner_id, survivorVehicleId: existing.survivor_vehicle_id, retiredVehicleId: existing.retired_vehicle_id, decisionFingerprint: existing.decision_fingerprint }
        const survivorId = clean(rawInput.survivorVehicleId)
        const retiredId = clean(rawInput.retiredVehicleId)
        for (const id of [survivorId, retiredId].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-customer-vehicle-merge:${id}`])
        const preview = await buildCustomerVehicleMergePreview(client, rawInput, { lock: true })
        const publicPreview = Object.fromEntries(Object.entries(preview).filter(([name]) => !name.startsWith('_')))
        const submittedFingerprint = clean(rawInput.previewFingerprint)
        if (!submittedFingerprint) throw problem('CUSTOMER_VEHICLE_MERGE_PREVIEW_REQUIRED', '车辆合并必须先完成影响预览', 409, { preview: publicPreview })
        if (submittedFingerprint !== preview.fingerprint) throw problem('CUSTOMER_VEHICLE_MERGE_PREVIEW_STALE', '车辆或关联业务数据已变化，请刷新合并预览', 409, { preview: publicPreview })
        if (!preview.ready) throw problem('CUSTOMER_VEHICLE_MERGE_REVIEW_REQUIRED', '车辆合并仍有字段选择或资料冲突未处理', 409, { preview: publicPreview })

        const survivor = preview._survivor
        const retired = preview._retired
        const mergeId = randomUUID()
        const by = actorDetails(actor)
        await client.query('UPDATE business_inquiry SET customer_vehicle_id=$1,updated_at=now() WHERE customer_vehicle_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_sales_order SET customer_vehicle_id=$1,updated_at=now() WHERE customer_vehicle_id=$2', [survivor.id, retired.id])
        await client.query('UPDATE business_customer_onboarding_request SET customer_vehicle_id=$1 WHERE customer_vehicle_id=$2', [survivor.id, retired.id])
        const draftRows = (await client.query('SELECT id,version FROM business_quick_quote_draft WHERE customer_vehicle_id=$1 ORDER BY id FOR UPDATE', [retired.id])).rows
        for (const draft of draftRows) {
          await client.query(`UPDATE business_quick_quote_draft SET customer_vehicle_id=$2,
            payload=jsonb_set(payload,'{customerVehicleId}',to_jsonb($2::text),true),version=version+1,updated_by_id=$3,updated_by_name=$4,updated_at=now() WHERE id=$1`, [draft.id, survivor.id, by.id, by.name])
          await client.query(`INSERT INTO business_quick_quote_draft_event
            (id,draft_id,action,from_version,to_version,actor_id,actor_name,snapshot) VALUES ($1,$2,'vehicle_merged',$3,$4,$5,$6,$7::jsonb)`,
          [randomUUID(), draft.id, draft.version, draft.version + 1, by.id, by.name, JSON.stringify({ mergeId, fromVehicleId: retired.id, toVehicleId: survivor.id })])
        }
        await client.query(`UPDATE business_customer_vehicle SET merged_into_vehicle_id=$1,version=version+1,updated_at=now()
          WHERE merged_into_vehicle_id=$2`, [survivor.id, retired.id])
        await client.query(`UPDATE business_customer_vehicle SET vehicle_label=$3,vin='',license_plate='',merged_into_vehicle_id=$2,merged_at=now(),version=version+1,updated_at=now()
          WHERE id=$1`, [retired.id, survivor.id, `[已合并] ${retired.vehicle_label}`])
        const resolved = preview.resolved
        await client.query(`UPDATE business_customer_vehicle SET vehicle_label=$2,vin=$3,license_plate=$4,platform_code=$5,
          platform_master_id=$6,variant_master_id=$7,engine_code=$8,model_year=$9,notes=$10,version=version+1,updated_at=now() WHERE id=$1`,
        [survivor.id, resolved.vehicleLabel, resolved.vin, resolved.licensePlate, resolved.platformCode, resolved.platformMasterId, resolved.variantMasterId, resolved.engineCode, resolved.modelYear, resolved.notes])
        await client.query(`UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1`, [survivor.partner_id, by.id, by.name])
        await client.query(`INSERT INTO business_customer_vehicle_merge
          (id,request_key,partner_id,survivor_vehicle_id,retired_vehicle_id,reason,decision_fingerprint,decision_snapshot,impact_snapshot,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
        [mergeId, key, survivor.partner_id, survivor.id, retired.id, reason, preview.fingerprint, JSON.stringify(preview._snapshot), JSON.stringify(preview.impact), by.id, by.name])
        await insertEvent(client, survivor.partner_id, 'customer_vehicle_merged', actor, { mergeId, survivorVehicleId: survivor.id, retiredVehicleId: retired.id, decisionFingerprint: preview.fingerprint, impact: preview.impact, resolved }, reason)
        return { created: true, mergeId, partnerId: survivor.partner_id, survivorVehicleId: survivor.id, retiredVehicleId: retired.id, decisionFingerprint: preview.fingerprint }
      })
      const partner = await get(result.partnerId)
      return { ...result, customer: partner, survivorVehicle: partner.vehicles.find((vehicle) => vehicle.id === result.survivorVehicleId), retiredVehicle: partner.vehicles.find((vehicle) => vehicle.id === result.retiredVehicleId) }
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
        if (current.merged_into_vehicle_id) throw problem('CUSTOMER_VEHICLE_ALREADY_MERGED', '该车辆已合并，不能继续修改', 409, { mergedIntoVehicleId: current.merged_into_vehicle_id })
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
