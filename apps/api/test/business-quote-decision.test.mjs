import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPricingDecision, decisionFingerprint, summarizePriceSamples } from '../src/business-quote-decision.mjs'

test('summarizes price evidence without allowing invalid samples to distort it', () => {
  assert.deepEqual(summarizePriceSamples([900, '800', 1000, -1, 'invalid']), { count: 3, minimum: 800, p25: 850, median: 900, p75: 950, maximum: 1000 })
  assert.deepEqual(summarizePriceSamples([]), { count: 0, minimum: null, p25: null, median: null, p75: null, maximum: null })
})

test('builds an explainable margin-safe quote decision from customer history', () => {
  const decision = buildPricingDecision({ minimumMarginRate: 15, quantity: 2, costUnitPrice: 600, saleUnitPrice: 888, customerPrices: [850, 900, 950], marketPrices: [800, 880] })
  assert.equal(decision.marginFloorUnitPrice, 705.89)
  assert.equal(decision.suggestedUnitPrice, 900)
  assert.equal(decision.suggestionBasis, 'customer_median')
  assert.equal(decision.marginAmount, 576)
  assert.equal(decision.marginRate, 32.4324)
  assert.equal(decision.pricingReady, true)
  assert.deepEqual(decision.warnings, [])
})

test('requires current cost evidence and flags prices below the configured floor', () => {
  const missingCost = buildPricingDecision({ minimumMarginRate: 15, marketPrices: [800, 900] })
  assert.equal(missingCost.suggestedUnitPrice, 850)
  assert.equal(missingCost.pricingReady, false)
  assert.ok(missingCost.warnings.includes('cost_confirmation_required'))
  const lowMargin = buildPricingDecision({ minimumMarginRate: 15, costUnitPrice: 600, saleUnitPrice: 650 })
  assert.equal(lowMargin.pricingReady, false)
  assert.ok(lowMargin.warnings.includes('sale_below_margin_floor'))
  assert.equal(decisionFingerprint({ a: 1 }), decisionFingerprint({ a: 1 }))
})
