import { createHash } from 'node:crypto'

export const defaultBusinessControls = Object.freeze({
  marginControlEnabled: true,
  minimumMarginRate: 15,
  creditControlEnabled: true,
})

function number(value) { return Number(value || 0) }
function roundMoney(value) { return Math.round(number(value) * 100) / 100 }
function roundRate(value) { return Math.round(number(value) * 10000) / 10000 }

export function normalizeBusinessControls(value = {}) {
  for (const key of ['marginControlEnabled', 'creditControlEnabled']) {
    if (value[key] != null && typeof value[key] !== 'boolean') {
      const error = new Error(`${key} 必须是布尔值`)
      error.errorCode = 'INVALID_BUSINESS_CONTROLS'
      error.statusCode = 400
      throw error
    }
  }
  const minimumMarginRate = Number(value.minimumMarginRate ?? defaultBusinessControls.minimumMarginRate)
  if (!Number.isFinite(minimumMarginRate) || minimumMarginRate < 0 || minimumMarginRate > 100) {
    const error = new Error('最低毛利率必须在 0 到 100 之间')
    error.errorCode = 'INVALID_BUSINESS_CONTROLS'
    error.statusCode = 400
    throw error
  }
  return {
    marginControlEnabled: value.marginControlEnabled == null ? defaultBusinessControls.marginControlEnabled : value.marginControlEnabled,
    minimumMarginRate: roundRate(minimumMarginRate),
    creditControlEnabled: value.creditControlEnabled == null ? defaultBusinessControls.creditControlEnabled : value.creditControlEnabled,
  }
}

export async function readBusinessControls(client, { lock = false } = {}) {
  const suffix = lock === 'update' ? ' FOR UPDATE' : lock ? ' FOR SHARE' : ''
  const row = (await client.query(`SELECT payload,version,updated_by,updated_at FROM app_configuration WHERE key='business_controls'${suffix}`)).rows[0]
  return {
    controls: normalizeBusinessControls(row?.payload || defaultBusinessControls),
    version: Number(row?.version || 1),
    updatedBy: row?.updated_by || '',
    updatedAt: row?.updated_at || null,
  }
}

export async function evaluateQuoteRisk(client, { customerPartnerId = null, currency = 'CNY', totalAmount = 0, marginAmount = 0 } = {}) {
  const configuration = await readBusinessControls(client, { lock: true })
  const normalizedCurrency = String(currency || 'CNY').trim().toUpperCase()
  const total = roundMoney(totalAmount)
  const margin = roundMoney(marginAmount)
  const marginRate = total > 0 ? roundRate(margin / total * 100) : 0
  let customer = null
  let outstandingAmount = 0
  if (customerPartnerId) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-credit:${customerPartnerId}`])
    customer = (await client.query(`SELECT id,name,status,partner_type,payment_terms_days,credit_limit
      FROM business_partner WHERE id=$1 FOR SHARE`, [customerPartnerId])).rows[0] || null
    if (customer) {
      outstandingAmount = roundMoney((await client.query(`SELECT COALESCE(sum(GREATEST((original_amount-credited_amount)-(paid_amount-refunded_amount),0)),0)::numeric amount
        FROM business_receivable WHERE customer_partner_id=$1 AND currency=$2 AND status IN ('open','partial')`, [customer.id, normalizedCurrency])).rows[0]?.amount)
    }
  }
  const paymentTermsDays = Number(customer?.payment_terms_days || 0)
  const creditLimit = roundMoney(customer?.credit_limit)
  const projectedExposure = roundMoney(outstandingAmount + total)
  const reasons = []
  if (configuration.controls.marginControlEnabled && marginRate < configuration.controls.minimumMarginRate) reasons.push('low_margin')
  if (configuration.controls.creditControlEnabled && customer && paymentTermsDays > 0) {
    if (normalizedCurrency !== 'CNY') reasons.push('credit_currency_review')
    else if (projectedExposure > creditLimit) reasons.push('credit_limit_exceeded')
  }
  const snapshot = {
    controlsVersion: configuration.version,
    controls: configuration.controls,
    customerPartnerId: customer?.id || '',
    customerName: customer?.name || '',
    currency: normalizedCurrency,
    totalAmount: total,
    marginAmount: margin,
    marginRate,
    paymentTermsDays,
    creditLimit,
    outstandingAmount,
    projectedExposure,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return { required: reasons.length > 0, reasons, snapshot, fingerprint, marginRate, configuration }
}
