import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from '@playwright/test'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL

test('production workbench uses its real API without writing data', { skip: !baseUrl }, async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
  const consoleErrors = []
  const catalogRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => { if (request.url().includes('/api/v2/catalog/')) catalogRequests.push(request.url()) })

  try {
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    assert.equal(response?.status(), 200)
    const readyResponse = await page.request.get(new URL('api/ready', baseUrl).toString())
    assert.equal(readyResponse.ok(), true)
    const readiness = await readyResponse.json()
    assert.equal(readiness.status, 'ready')
    assert.match(readiness.releaseRevision, /^[0-9a-f]{40}$/)
    await page.getByRole('button', { name: 'SKU 资料库', exact: true }).click()
    await page.getByRole('heading', { name: 'SKU 资料库', exact: true }).waitFor({ state: 'visible' })

    const sessionResponse = await page.request.get(new URL('api/v2/catalog/session', baseUrl).toString())
    assert.equal(sessionResponse.ok(), true)
    const session = await sessionResponse.json()
    await page.getByText(session.roleLabel, { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
    if (session.role === 'catalog_viewer') {
      assert.equal(session.authenticated, false)
      assert.equal(session.authMode, 'anonymous-readonly')
    }

    assert.equal(await page.getByText('真实资料库为空，当前为开发演示数据', { exact: true }).isVisible().catch(() => false), false)
    assert.equal(await page.getByText('API 未连接，当前为开发演示数据', { exact: true }).isVisible().catch(() => false), false)
    if (!session.capabilities.includes('catalog.edit')) assert.equal(await page.getByRole('button', { name: '新建 SKU', exact: true }).isEnabled(), false)

    await page.getByRole('button', { name: '旧资料迁移', exact: true }).click()
    await page.getByRole('heading', { name: '旧 SKU 迁移治理', exact: true }).waitFor({ state: 'visible' })
    await page.getByText('当前迁移范围', { exact: true }).waitFor({ state: 'visible' })
    const legacyPreviewResponse = await page.request.get(new URL('api/v2/catalog/legacy-migration-preview', baseUrl).toString())
    assert.equal(legacyPreviewResponse.ok(), true)
    const legacyPreview = await legacyPreviewResponse.json()
    assert.ok(Number.isInteger(legacyPreview.summary.total))
    const pilotResponse = await page.request.get(new URL('api/v2/catalog/legacy-migration-pilot?size=5', baseUrl).toString())
    assert.equal(pilotResponse.ok(), true)
    const pilot = await pilotResponse.json()
    assert.equal(pilot.requestedSize, 5)
    assert.equal(pilot.summary.selected, Math.min(5, pilot.summary.available))
    assert.ok(pilot.items.every((item) => item.legacySkuId && Number.isInteger(item.estimatedMinutes)))
    await page.getByRole('button', { name: /首批试运行/ }).click()
    await page.getByText('首批候选组合', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.locator('.legacy-pilot-row').count(), pilot.summary.selected)
    await page.getByRole('button', { name: '资料治理', exact: true }).click()
    const planListResponse = await page.request.get(new URL('api/v2/catalog/legacy-migration-plans', baseUrl).toString())
    assert.equal(planListResponse.ok(), true)
    assert.equal(await page.getByText('方案内 0 条迁移', { exact: false }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '提交审核 0 条', exact: true }).isEnabled(), false)
    if (!session.capabilities.includes('catalog.migration.plan')) assert.equal(await page.getByRole('button', { name: '选择全部建议项', exact: true }).isEnabled(), false)
    if (!session.capabilities.includes('catalog.migration.plan')) {
      const denied = await page.request.post(new URL('api/v2/catalog/legacy-migration-plans', baseUrl).toString(), { data: { items: [], reason: '只读冒烟' } })
      assert.equal(denied.status(), 403)
    }

    const inquiryListResponse = await page.request.get(new URL('api/v2/business/inquiries?page=1&pageSize=5', baseUrl).toString())
    assert.equal(inquiryListResponse.ok(), true)
    const inquiryList = await inquiryListResponse.json()
    assert.ok(Array.isArray(inquiryList.items))
    assert.ok(Number.isInteger(inquiryList.total))
    const partnerListResponse = await page.request.get(new URL('api/v2/business/partners?page=1&pageSize=5', baseUrl).toString())
    assert.equal(partnerListResponse.ok(), true)
    const partnerList = await partnerListResponse.json()
    assert.ok(Array.isArray(partnerList.items))
    assert.ok(Number.isInteger(partnerList.total))
    const quickQuoteContextResponse = await page.request.get(new URL('api/v2/business/quick-quote/context?pageSize=5', baseUrl).toString())
    assert.equal(quickQuoteContextResponse.ok(), true)
    const quickQuoteContext = await quickQuoteContextResponse.json()
    assert.ok(Array.isArray(quickQuoteContext.customers))
    assert.ok(Array.isArray(quickQuoteContext.platforms))
    assert.ok(Array.isArray(quickQuoteContext.vehicles))
    assert.ok(Array.isArray(quickQuoteContext.skus))
    const salesOrderListResponse = await page.request.get(new URL('api/v2/business/sales-orders?page=1&pageSize=5', baseUrl).toString())
    assert.equal(salesOrderListResponse.ok(), true)
    const salesOrderList = await salesOrderListResponse.json()
    assert.ok(Array.isArray(salesOrderList.items))
    assert.ok(Number.isInteger(salesOrderList.total))
    const purchaseOrderListResponse = await page.request.get(new URL('api/v2/business/purchase-orders?page=1&pageSize=5', baseUrl).toString())
    assert.equal(purchaseOrderListResponse.ok(), true)
    const purchaseOrderList = await purchaseOrderListResponse.json()
    assert.ok(Array.isArray(purchaseOrderList.items))
    assert.ok(Number.isInteger(purchaseOrderList.total))
    const warehouseListResponse = await page.request.get(new URL('api/v2/business/warehouses', baseUrl).toString())
    assert.equal(warehouseListResponse.ok(), true)
    assert.ok(Array.isArray((await warehouseListResponse.json()).items))
    const inventoryListResponse = await page.request.get(new URL('api/v2/business/inventory-balances?page=1&pageSize=5', baseUrl).toString())
    assert.equal(inventoryListResponse.ok(), true)
    assert.ok(Array.isArray((await inventoryListResponse.json()).items))
    const movementListResponse = await page.request.get(new URL('api/v2/business/inventory-movements?page=1&pageSize=5', baseUrl).toString())
    assert.equal(movementListResponse.ok(), true)
    assert.ok(Array.isArray((await movementListResponse.json()).items))
    if (!session.capabilities.includes('business.manage')) {
      const denied = await page.request.post(new URL('api/v2/business/inquiries', baseUrl).toString(), { data: { customerName: '只读冒烟', items: [{ requirementText: '不应写入' }] } })
      assert.equal(denied.status(), 403)
      const partnerDenied = await page.request.post(new URL('api/v2/business/partners', baseUrl).toString(), { data: { partnerType: 'customer', name: '不应写入' } })
      assert.equal(partnerDenied.status(), 403)
    }
    if (!session.capabilities.includes('business.quote')) {
      const quickQuoteDenied = await page.request.post(new URL('api/v2/business/quick-quotes', baseUrl).toString(), { data: { requestKey: 'read-only-quick-quote', customerPartnerId: 'none', customerVehicleId: 'none', items: [] } })
      assert.equal(quickQuoteDenied.status(), 403)
    }
    if (!session.capabilities.includes('business.order')) {
      const conversionDenied = await page.request.post(new URL('api/v2/business/inquiries/read-only-smoke/convert-order', baseUrl).toString())
      assert.equal(conversionDenied.status(), 403)
      const salesTransitionDenied = await page.request.post(new URL('api/v2/business/sales-orders/read-only-smoke/transition', baseUrl).toString(), { data: { expectedVersion: 1, status: 'confirmed' } })
      assert.equal(salesTransitionDenied.status(), 403)
      const purchaseTransitionDenied = await page.request.post(new URL('api/v2/business/purchase-orders/read-only-smoke/transition', baseUrl).toString(), { data: { expectedVersion: 1, status: 'submitted' } })
      assert.equal(purchaseTransitionDenied.status(), 403)
      const receiptDenied = await page.request.post(new URL('api/v2/business/purchase-orders/read-only-smoke/receive', baseUrl).toString(), { data: { expectedVersion: 1, items: [{ itemId: 'read-only-smoke', quantity: 1 }] } })
      assert.equal(receiptDenied.status(), 403)
    }
    if (!session.capabilities.includes('business.inventory')) {
      const warehouseDenied = await page.request.post(new URL('api/v2/business/warehouses', baseUrl).toString(), { data: { warehouseCode: 'SMOKE', name: '不应写入' } })
      assert.equal(warehouseDenied.status(), 403)
      const goodsReceiptDenied = await page.request.post(new URL('api/v2/business/purchase-orders/read-only-smoke/receipts', baseUrl).toString(), { data: { requestKey: 'read-only-smoke', warehouseId: 'none', items: [] } })
      assert.equal(goodsReceiptDenied.status(), 403)
      const reservationDenied = await page.request.post(new URL('api/v2/business/sales-orders/read-only-smoke/reservations', baseUrl).toString(), { data: { warehouseId: 'none', items: [] } })
      assert.equal(reservationDenied.status(), 403)
      const shipmentDenied = await page.request.post(new URL('api/v2/business/sales-orders/read-only-smoke/shipments', baseUrl).toString(), { data: { requestKey: 'read-only-smoke', reservationId: 'none', items: [] } })
      assert.equal(shipmentDenied.status(), 403)
    }

    assert.ok(catalogRequests.length > 0)
    assert.ok(catalogRequests.every((url) => url.startsWith(new URL('api/', baseUrl).toString())))
    assert.deepEqual(consoleErrors, [])

    if (process.env.PLAYWRIGHT_SCREENSHOT) await page.screenshot({ path: process.env.PLAYWRIGHT_SCREENSHOT, fullPage: true })
  } finally {
    await browser.close()
  }
})
