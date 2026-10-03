import { createHash } from 'node:crypto'

function number(value) { return Number(value || 0) }
function roundMoney(value) { return Math.round(number(value) * 100) / 100 }
function roundRate(value) { return Math.round(number(value) * 10000) / 10000 }

export function summarizePriceSamples(rawSamples = []) {
  const samples = rawSamples.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  if (!samples.length) return { count: 0, minimum: null, p25: null, median: null, p75: null, maximum: null }
  const percentile = (ratio) => {
    const position = (samples.length - 1) * ratio
    const lower = Math.floor(position); const upper = Math.ceil(position)
    const value = samples[lower] + (samples[upper] - samples[lower]) * (position - lower)
    return roundMoney(value)
  }
  return { count: samples.length, minimum: roundMoney(samples[0]), p25: percentile(0.25), median: percentile(0.5), p75: percentile(0.75), maximum: roundMoney(samples.at(-1)) }
}

export function buildPricingDecision({ marginControlEnabled = true, minimumMarginRate = 15, quantity = 1, costUnitPrice = null, saleUnitPrice = null, customerPrices = [], marketPrices = [] } = {}) {
  const customerHistory = summarizePriceSamples(customerPrices)
  const marketHistory = summarizePriceSamples(marketPrices)
  const hasCost = costUnitPrice !== '' && costUnitPrice != null && Number.isFinite(Number(costUnitPrice)) && Number(costUnitPrice) >= 0
  const hasSale = saleUnitPrice !== '' && saleUnitPrice != null && Number.isFinite(Number(saleUnitPrice)) && Number(saleUnitPrice) >= 0
  const cost = hasCost ? roundMoney(costUnitPrice) : null
  const sale = hasSale ? roundMoney(saleUnitPrice) : null
  const unboundedMargin = hasCost && marginControlEnabled && Number(minimumMarginRate) >= 100
  const marginFloor = hasCost && marginControlEnabled
    ? unboundedMargin ? null : Math.ceil(cost / (1 - Number(minimumMarginRate) / 100) * 100) / 100
    : hasCost ? cost : null
  const historyReference = customerHistory.median ?? marketHistory.median
  const suggestedUnitPrice = marginFloor == null && historyReference == null ? null : roundMoney(Math.max(marginFloor ?? 0, historyReference ?? 0))
  const marginAmount = hasCost && hasSale ? roundMoney((sale - cost) * Number(quantity || 1)) : null
  const marginRate = hasCost && hasSale && sale > 0 ? roundRate((sale - cost) / sale * 100) : null
  const warnings = []
  if (!hasCost) warnings.push('cost_confirmation_required')
  if (unboundedMargin) warnings.push('margin_floor_unbounded')
  if (!customerHistory.count && !marketHistory.count) warnings.push('price_history_unavailable')
  if (hasCost && hasSale && marginControlEnabled && marginRate < Number(minimumMarginRate)) warnings.push('sale_below_margin_floor')
  return {
    quantity: Number(quantity || 1), marginControlEnabled: Boolean(marginControlEnabled), minimumMarginRate: Number(minimumMarginRate),
    costUnitPrice: cost, saleUnitPrice: sale, marginFloorUnitPrice: marginFloor, suggestedUnitPrice,
    suggestionBasis: customerHistory.median != null ? 'customer_median' : marketHistory.median != null ? 'market_median' : marginFloor != null ? 'margin_floor' : 'none',
    customerHistory, marketHistory, marginAmount, marginRate, pricingReady: hasCost && !unboundedMargin && (!marginControlEnabled || !hasSale || marginRate >= Number(minimumMarginRate)), warnings,
  }
}

export function decisionFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
