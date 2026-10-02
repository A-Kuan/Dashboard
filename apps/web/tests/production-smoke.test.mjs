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
    const planListResponse = await page.request.get(new URL('api/v2/catalog/legacy-migration-plans', baseUrl).toString())
    assert.equal(planListResponse.ok(), true)
    assert.equal(await page.getByText('方案内 0 条迁移', { exact: false }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '提交审核 0 条', exact: true }).isEnabled(), false)
    if (!session.capabilities.includes('catalog.migration.plan')) assert.equal(await page.getByRole('button', { name: '选择全部建议项', exact: true }).isEnabled(), false)
    if (!session.capabilities.includes('catalog.migration.plan')) {
      const denied = await page.request.post(new URL('api/v2/catalog/legacy-migration-plans', baseUrl).toString(), { data: { items: [], reason: '只读冒烟' } })
      assert.equal(denied.status(), 403)
    }

    assert.ok(catalogRequests.length > 0)
    assert.ok(catalogRequests.every((url) => url.startsWith(new URL('api/', baseUrl).toString())))
    assert.deepEqual(consoleErrors, [])

    if (process.env.PLAYWRIGHT_SCREENSHOT) await page.screenshot({ path: process.env.PLAYWRIGHT_SCREENSHOT, fullPage: true })
  } finally {
    await browser.close()
  }
})
