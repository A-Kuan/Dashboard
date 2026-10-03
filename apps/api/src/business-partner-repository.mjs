import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const partnerTypes = new Set(['customer', 'supplier', 'both'])
const partnerStatuses = new Set(['active', 'inactive', 'blocked'])

function clean(value) { return String(value ?? '').trim() }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
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
  if (!clean(input.vehicleLabel)) throw problem('INVALID_CUSTOMER_VEHICLE', '车辆名称为必填项')
  const modelYear = input.modelYear === '' || input.modelYear == null ? null : Number(input.modelYear)
  if (modelYear != null && (!Number.isInteger(modelYear) || modelYear < 1950 || modelYear > 2200)) throw problem('INVALID_CUSTOMER_VEHICLE', '车辆年款无效')
  return { vehicleLabel: clean(input.vehicleLabel), vin: normalizeVin(input.vin), licensePlate: clean(input.licensePlate).toUpperCase(), platformCode: clean(input.platformCode).toUpperCase(), engineCode: clean(input.engineCode).toUpperCase(), modelYear, notes: clean(input.notes) }
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
  return { id: row.id, partnerId: row.partner_id, vehicleLabel: row.vehicle_label, vin: row.vin, licensePlate: row.license_plate, platformCode: row.platform_code, engineCode: row.engine_code, modelYear: row.model_year, notes: row.notes, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
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

    async create(rawInput = {}, actor) {
      const input = normalizeBusinessPartnerInput(rawInput); const contacts = Array.isArray(rawInput.contacts) ? rawInput.contacts.map(normalizeContact) : []; const vehicles = Array.isArray(rawInput.vehicles) ? rawInput.vehicles.map(normalizeVehicle) : []
      if (contacts.filter((contact) => contact.isPrimary).length > 1) throw problem('INVALID_PARTNER_CONTACT', '只能设置一个主联系人')
      if (vehicles.length && input.partnerType === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆')
      const id = randomUUID(); const partnerNo = generatedNumber(); const by = actorDetails(actor)
      await withTransaction(pool, async (client) => {
        await client.query(`INSERT INTO business_partner (id,partner_no,partner_type,name,short_name,tax_id,phone,email,address,status,payment_terms_days,credit_limit,notes,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15)`, [id, partnerNo, input.partnerType, input.name, input.shortName, input.taxId, input.phone, input.email, input.address, input.status, input.paymentTermsDays, input.creditLimit, input.notes, by.id, by.name])
        for (const contact of contacts) await client.query(`INSERT INTO business_partner_contact (id,partner_id,name,role_title,phone,wechat,email,is_primary,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), id, contact.name, contact.roleTitle, contact.phone, contact.wechat, contact.email, contact.isPrimary, contact.notes])
        for (const vehicle of vehicles) await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,engine_code,model_year,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
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
      const vehicle = normalizeVehicle(rawInput); const vehicleId = randomUUID()
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        if (partner.partner_type === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆', 409)
        await client.query(`INSERT INTO business_customer_vehicle (id,partner_id,vehicle_label,vin,license_plate,platform_code,engine_code,model_year,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [vehicleId, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'vehicle_added', actor, { vehicleId, vehicleLabel: vehicle.vehicleLabel, vin: vehicle.vin })
      })
      return get(partnerId)
    },

    async updateVehicle(partnerId, vehicleId, rawInput = {}, actor) {
      const vehicle = normalizeVehicle(rawInput)
      await withTransaction(pool, async (client) => {
        const partner = await lockPartner(client, partnerId, rawInput.expectedPartnerVersion)
        if (partner.partner_type === 'supplier') throw problem('INVALID_CUSTOMER_VEHICLE', '纯供应商不能登记客户车辆', 409)
        const current = (await client.query('SELECT * FROM business_customer_vehicle WHERE id=$1 AND partner_id=$2 FOR UPDATE', [vehicleId, partner.id])).rows[0]
        if (!current) throw problem('CUSTOMER_VEHICLE_NOT_FOUND', '客户车辆不存在', 404)
        if (Number(rawInput.expectedVersion) !== current.version) throw problem('CUSTOMER_VEHICLE_VERSION_CONFLICT', '车辆资料已变化，请刷新后重试', 409, { currentVersion: current.version })
        await client.query(`UPDATE business_customer_vehicle SET vehicle_label=$3,vin=$4,license_plate=$5,platform_code=$6,engine_code=$7,model_year=$8,notes=$9,version=version+1,updated_at=now() WHERE id=$1 AND partner_id=$2`, [vehicleId, partner.id, vehicle.vehicleLabel, vehicle.vin, vehicle.licensePlate, vehicle.platformCode, vehicle.engineCode, vehicle.modelYear, vehicle.notes])
        const by = actorDetails(actor); await client.query('UPDATE business_partner SET version=version+1,updated_by_id=$2,updated_by_name=$3,updated_at=now() WHERE id=$1', [partner.id, by.id, by.name])
        await insertEvent(client, partner.id, 'vehicle_updated', actor, { vehicleId, fromVersion: current.version, toVersion: current.version + 1 })
      })
      return get(partnerId)
    },
  }
}
