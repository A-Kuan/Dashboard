import { expect, test } from '@playwright/test'

const fixtureSku = {
  id: 'sku-fixture-1', skuCode: '95B-867-288-OM8', chineseName: '行李厢内饰板（黑色）',
  brand: 'Porsche', category: '车身及内饰', subcategory: '内饰件',
  manufacturerPartNumber: '95B 867 288 OM8', primaryOe: '95B 867 288 OM8', unit: '件',
  lifecycleStatus: '草稿', barcode: '6921734567890', imageUrl: '/assets/parts/selected-part.png',
  dataSource: 'Porsche EPC', createdBy: '张伟', updatedBy: '张伟',
  createdAt: '2026-09-27T06:00:00.000Z', updatedAt: '2026-09-27T06:32:00.000Z', fitmentCount: 2,
  oeRelations: [{ id: 'oe-1', type: '主 OE', oeNumber: '95B 867 288 OM8', brand: 'Porsche', relation: '', source: 'Porsche EPC', confidence: '高' }],
  fitments: [{ id: 'fit-1', vehicle: 'Porsche Cayenne (9YA)', years: '2018–2023', engine: '全部', body: 'SUV', condition: '', source: 'Porsche EPC', verificationStatus: '已验证' }],
  sourceEvidence: { title: 'Porsche EPC 原始记录', syncedAt: '2026-09-27', oe: '95B 867 288 OM8', originalName: 'Trim panel, luggage compartment, black', group: '867-05', position: '9', fitment: 'Cayenne (9YA), 2018–2023', referencePrice: '¥ 1,120.50', diagramUrl: '/assets/parts/epc-diagram.png', comparisons: [{ label: 'OE 号', result: '一致', note: '与 EPC 记录一致', passed: true }] },
}

async function installMockSkuApi(page) {
  const records = [structuredClone(fixtureSku)]
  page.__apiRecords = records
  await page.route('**/api/v1/skus**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/validate-code')) {
      const body = request.postDataJSON()
      return json(200, { available: !records.some((item) => item.skuCode === body.skuCode && item.id !== body.exceptId) })
    }
    const marker = '/api/v1/skus/'
    const suffix = path.includes(marker) ? decodeURIComponent(path.split(marker)[1]) : ''
    if (!suffix && method === 'GET') return json(200, { items: records })
    if (!suffix && method === 'POST') {
      const body = request.postDataJSON()
      const item = { id: 'created-sku-1', ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: '张伟', fitmentCount: body.fitments?.length || 0 }
      records.unshift(item)
      return json(201, item)
    }
    const id = suffix.replace('/publish', '')
    const index = records.findIndex((item) => item.id === id || item.skuCode === id)
    if (index < 0) return json(404, { message: 'SKU 不存在' })
    if (method === 'GET') return json(200, records[index])
    if (method === 'PUT' || method === 'POST') {
      records[index] = { ...records[index], ...request.postDataJSON(), updatedAt: new Date().toISOString(), updatedBy: '张伟' }
      return json(200, records[index])
    }
    return json(405, { message: '不支持的操作' })
  })
}

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await installMockSkuApi(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'SKU 管理' })).toBeVisible()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  page.__consoleErrors = errors
})

test.afterEach(async ({ page }) => {
  expect(page.__consoleErrors).toEqual([])
})

test('loads persisted SKU data and captures the default state', async ({ page }) => {
  await expect(page.getByRole('row', { name: /95B-867-288-OM8/ })).toHaveClass(/selected/)
  await page.screenshot({ path: 'qa-artifacts/implementation-default.png', fullPage: false })
})

const visualStates = [
  ['expanded', '02-focus-expanded'], ['oe', '03-oe-sku-results'], ['vin', '04-vin-fitment-results'],
  ['empty', '05-no-results-correction'], ['loading', '06-loading'], ['error', '07-service-error-retry'],
]

for (const [state, filename] of visualStates) {
  test(`renders ${state} command-center state without invented records`, async ({ page }) => {
    await page.goto(`./?state=${state}`)
    await expect(page.getByLabel('命令中枢搜索')).toHaveClass(new RegExp(`command-panel-${state}`))
    await page.screenshot({ path: `qa-artifacts/implementation-${filename}.png`, fullPage: false })
  })
}

test('creates a SKU through the persisted form flow', async ({ page }) => {
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await expect(page).toHaveURL(/\/skus\/new$/)
  await page.getByLabel('SKU 编码 *').fill('REAL-TEST-001')
  await page.getByLabel('中文名称 *').fill('流程测试零件')
  await page.getByLabel('零件小类 *').fill('测试分类')
  await page.getByLabel('制造商零件号 *').fill('REAL TEST 001')
  await page.getByLabel('主 OE 号 *').fill('REAL TEST 001')
  await page.getByRole('button', { name: '添加 OE 号' }).click()
  await page.getByLabel('OE 编号 1').fill('REAL TEST 001')
  await page.getByRole('button', { name: '添加适配车型' }).click()
  await page.getByLabel('适配车型 1').fill('测试车型')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page).toHaveURL(/\/skus\/created-sku-1\/edit$/)
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
})

test('edits relations, fitment, dictionaries and saves to the API', async ({ page }) => {
  await page.goto('./skus/sku-fixture-1/edit')
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
  const brandDictionary = page.locator('.editor-field [data-dictionary="sku_brand"]')
  await brandDictionary.getByRole('combobox').click()
  await expect(brandDictionary.getByRole('option', { name: '全部' })).toHaveCount(0)
  await brandDictionary.getByRole('option', { name: 'BMW' }).click()
  await page.getByRole('button', { name: '添加 OE 号' }).click()
  await page.getByLabel('OE 编号 2').fill('BMW TEST 002')
  await page.getByRole('button', { name: '添加适配车型' }).click()
  await page.getByLabel('适配车型 2').fill('BMW X5 (G05)')
  await page.getByRole('button', { name: '保存 SKU' }).click()
  await expect(page.getByText('SKU 已保存并发布')).toBeVisible()
  await page.getByRole('button', { name: '放大 EPC 图' }).click()
  await expect(page.getByRole('button', { name: '关闭 EPC 大图' })).toBeVisible()
})

test('configures dictionaries and persists the result', async ({ page }) => {
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: /字典管理/ }).click()
  await expect(page.getByRole('heading', { name: '字典管理' })).toBeVisible()
  await page.getByRole('button', { name: '新增选项' }).click()
  const newRow = page.locator('.dictionary-table-row').last()
  await newRow.locator('input').nth(0).fill('测试品牌')
  await newRow.locator('input').nth(1).fill('TEST_BRAND')
  await page.getByRole('button', { name: '保存配置' }).click()
  await expect(page.getByText('配置已保存')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-dictionary-module-1920.png', fullPage: false })
})

test('renders the persisted editor at 1920 by 1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('./skus/sku-fixture-1/edit')
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-1920.png', fullPage: false })
})
