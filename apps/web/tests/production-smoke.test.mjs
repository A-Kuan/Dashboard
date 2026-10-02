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
    await page.getByRole('button', { name: 'SKU 资料库', exact: true }).click()
    await page.getByRole('heading', { name: 'SKU 资料库', exact: true }).waitFor({ state: 'visible' })

    const sessionResponse = await page.request.get(new URL('api/v2/catalog/session', baseUrl).toString())
    assert.equal(sessionResponse.ok(), true)
    const session = await sessionResponse.json()
    await page.getByText(session.roleLabel, { exact: true }).waitFor({ state: 'visible', timeout: 10000 })

    assert.equal(await page.getByText('真实资料库为空，当前为开发演示数据', { exact: true }).isVisible().catch(() => false), false)
    assert.equal(await page.getByText('API 未连接，当前为开发演示数据', { exact: true }).isVisible().catch(() => false), false)
    if (!session.capabilities.includes('catalog.edit')) assert.equal(await page.getByRole('button', { name: '新建 SKU', exact: true }).isEnabled(), false)
    assert.ok(catalogRequests.length > 0)
    assert.ok(catalogRequests.every((url) => url.startsWith(new URL('api/', baseUrl).toString())))
    assert.deepEqual(consoleErrors, [])

    if (process.env.PLAYWRIGHT_SCREENSHOT) await page.screenshot({ path: process.env.PLAYWRIGHT_SCREENSHOT, fullPage: true })
  } finally {
    await browser.close()
  }
})
