import { expect, test } from '@playwright/test'

const fixtureSku = {
  id: 'sku-fixture-1', skuCode: '95B-867-288-OM8', chineseName: '行李厢内饰板（黑色）',
  brand: 'SKU_BRAND_PORSCHE_FACTORY', category: '车身及内饰', subcategory: '内饰件',
  manufacturerPartNumber: '95B 867 288 OM8', primaryOe: '95B 867 288 OM8', unit: '件',
  lifecycleStatus: '草稿', barcode: '6921734567890', imageUrl: '/assets/parts/selected-part.png',
  dataSource: 'Porsche EPC', createdBy: '张伟', updatedBy: '张伟',
  createdAt: '2026-09-27T06:00:00.000Z', updatedAt: '2026-09-27T06:32:00.000Z', fitmentCount: 2, version: 1,
  changeHistory: [{ id: 'change-1', version: 1, action: '创建草稿', changedBy: '张伟', changedAt: '2026-09-27T06:00:00.000Z', details: { oeRelationCount: 1, fitmentCount: 1 } }],
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
    if (!suffix && method === 'GET') {
      const query = (url.searchParams.get('q') || '').toLowerCase()
      const items = query ? records.filter((item) => [item.skuCode, item.primaryOe, item.chineseName, item.brand, item.category, ...item.oeRelations.map((row) => row.oeNumber), ...item.fitments.map((row) => row.vehicle)].join(' ').toLowerCase().includes(query)) : records
      return json(200, { items })
    }
    if (!suffix && method === 'POST') {
      const body = request.postDataJSON()
      const item = { id: 'created-sku-1', ...body, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: '张伟', fitmentCount: body.fitments?.length || 0, changeHistory: [{ version: 1, action: '创建草稿', changedBy: '张伟', changedAt: new Date().toISOString(), details: { oeRelationCount: body.oeRelations?.length || 0, fitmentCount: body.fitments?.length || 0 } }] }
      records.unshift(item)
      return json(201, item)
    }
    const transition = suffix.endsWith('/publish') ? 'publish' : suffix.endsWith('/discontinue') ? 'discontinue' : ''
    const id = suffix.replace(/\/(publish|discontinue)$/, '')
    const index = records.findIndex((item) => item.id === id || item.skuCode === id)
    if (index < 0) return json(404, { message: 'SKU 不存在' })
    if (method === 'GET') return json(200, records[index])
    if (method === 'PUT' || method === 'POST') {
      const body = request.postDataJSON()
      if (body.version !== records[index].version) return json(409, { error: 'SKU_VERSION_CONFLICT', message: '该 SKU 已被其他操作更新，请刷新后再编辑' })
      const version = records[index].version + 1
      const action = transition === 'publish' ? '发布 SKU' : transition === 'discontinue' ? '停产 SKU' : '保存草稿'
      const lifecycleStatus = transition === 'publish' ? '在售' : transition === 'discontinue' ? '停产' : records[index].lifecycleStatus
      const change = { version, action, changedBy: '张伟', changedAt: new Date().toISOString(), details: { oeRelationCount: body.oeRelations?.length || records[index].oeRelations?.length || 0, fitmentCount: body.fitments?.length || records[index].fitments?.length || 0 } }
      records[index] = { ...records[index], ...body, lifecycleStatus, version, updatedAt: new Date().toISOString(), updatedBy: '张伟', changeHistory: [change, ...(records[index].changeHistory || [])] }
      return json(200, records[index])
    }
    return json(405, { message: '不支持的操作' })
  })
}

async function installMockDictionaryApi(page) {
  let payload = {
    version: 1,
    dictionaries: {
      sku_brand: { label: '品牌', items: [{ value: '__all__', label: '全部', sort: 0, enabled: true }, { value: 'SKU_BRAND_PORSCHE_FACTORY', label: '保时捷原厂', sort: 10, enabled: true }, { value: 'BMW', label: 'BMW', sort: 20, enabled: true }, { value: 'Mercedes', label: 'Mercedes', sort: 30, enabled: true }] },
      part_category: { label: '零件大类', items: [{ value: '__all__', label: '全部', sort: 0, enabled: true }, { value: '车身及内饰', label: '车身及内饰', sort: 10, enabled: true }] },
      unit: { label: '计量单位', items: [{ value: '件', label: '件', sort: 0, enabled: true }, { value: '套', label: '套', sort: 10, enabled: true }, { value: '盒', label: '盒', sort: 20, enabled: true }, { value: '支', label: '支', sort: 30, enabled: true }] },
      data_source: { label: '数据来源', items: [{ value: '人工录入', label: '人工录入', sort: 0, enabled: true }, { value: 'EPC 导入', label: 'EPC 导入', sort: 10, enabled: true }, { value: '供应商资料', label: '供应商资料', sort: 20, enabled: true }, { value: '历史系统', label: '历史系统', sort: 30, enabled: true }] },
      oe_type: { label: 'OE 类型', items: [{ value: '主 OE', label: '主 OE', sort: 0, enabled: true }, { value: '替代号', label: '替代号', sort: 10, enabled: true }, { value: '历史号', label: '历史号', sort: 20, enabled: true }] },
      oe_relation: { label: 'OE 替代关系', items: [{ value: '直接替代', label: '直接替代', sort: 0, enabled: true }, { value: '可互换', label: '可互换', sort: 10, enabled: true }] },
      confidence_level: { label: '可信度', items: [{ value: '待核验', label: '待核验', sort: 0, enabled: true }, { value: '高', label: '高', sort: 10, enabled: true }] },
      body_type: { label: '车身形式', items: [{ value: 'SUV', label: 'SUV', sort: 0, enabled: true }, { value: 'Coupe', label: '轿跑 / Coupe', sort: 10, enabled: true }] },
      verification_status: { label: '验证状态', items: [{ value: '待验证', label: '待验证', sort: 0, enabled: true }, { value: '已验证', label: '已验证', sort: 10, enabled: true }] },
      sku_status: { label: '状态', items: [{ value: '__all__', label: '全部', sort: 0, enabled: true }, { value: '草稿', label: '草稿', sort: 10, enabled: true }, { value: '在售', label: '在售', sort: 20, enabled: true }] },
    },
  }
  const defaults = structuredClone(payload)
  await page.route('**/api/v1/dictionaries**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    if (request.url().endsWith('/reset')) payload = structuredClone(defaults)
    else payload = { ...request.postDataJSON(), version: payload.version + 1 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await installMockDictionaryApi(page)
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
  await expect(page.getByText('保时捷原厂').first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('SKU_BRAND_PORSCHE_FACTORY')
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
  await expect(page.getByRole('combobox', { name: '品牌：请选择品牌' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '零件大类：请选择零件大类' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '计量单位：请选择计量单位' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '数据来源：请选择数据来源' })).toBeVisible()
  await page.getByLabel('SKU 编码 *').fill('REAL-TEST-001')
  await page.getByLabel('中文名称 *').fill('流程测试零件')
  await page.getByRole('combobox', { name: '品牌：请选择品牌' }).click()
  await page.getByRole('option', { name: '保时捷原厂' }).click()
  await page.getByRole('combobox', { name: '零件大类：请选择零件大类' }).click()
  await page.getByRole('option', { name: '车身及内饰' }).click()
  await expect(page.getByLabel('零件小类')).toBeVisible()
  await expect(page.getByLabel('制造商零件号')).toBeVisible()
  await expect(page.getByLabel('零件小类 *')).toHaveCount(0)
  await expect(page.getByLabel('制造商零件号 *')).toHaveCount(0)
  await page.getByLabel('主 OE 号 *').fill('REAL TEST 001')
  await page.getByRole('combobox', { name: '计量单位：请选择计量单位' }).click()
  await page.getByRole('option', { name: '件', exact: true }).click()
  await page.getByRole('combobox', { name: '数据来源：请选择数据来源' }).click()
  await page.getByRole('option', { name: '人工录入', exact: true }).click()
  await page.getByRole('button', { name: '添加 OE 号' }).click()
  await expect(page.getByLabel('OE 编号 1')).toHaveValue('REAL TEST 001')
  await expect(page.getByLabel('OE 类型 1')).toHaveValue('主 OE')
  await expect(page.getByLabel('OE 品牌 1')).toHaveCount(0)
  await expect(page.getByLabel('OE 来源 1')).toHaveValue('人工录入')
  await expect(page.getByLabel('OE 可信度 1')).toHaveValue('待核验')
  await expect(page.getByLabel('OE 关系 1', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '添加适配车型' }).click()
  await expect(page.getByRole('button', { name: '添加适配车型' })).toBeDisabled()
  await expect(page.getByLabel('适配来源 1')).toHaveValue('人工录入')
  await expect(page.getByLabel('验证状态 1')).toHaveValue('待验证')
  await page.getByLabel('适配车型 1').fill('测试车型')
  await expect(page.getByRole('button', { name: '添加适配车型' })).toBeEnabled()
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expect(page).toHaveURL(/\/skus\/created-sku-1\/edit$/)
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
  expect(page.__apiRecords.find((item) => item.id === 'created-sku-1').brand).toBe('SKU_BRAND_PORSCHE_FACTORY')
})

test('restricts identifier fields to Latin codes', async ({ page }) => {
  await page.getByRole('button', { name: '新建 SKU' }).click()
  for (const label of ['SKU 编码 *', '制造商零件号', '主 OE 号 *']) {
    const input = page.getByLabel(label)
    await input.fill('AB中文-123/01')
    await expect(input).toHaveValue('AB-123/01')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  }
  await expect(page.getByText('仅支持英文字母、数字、空格及 - . _ / # ( ) +')).toHaveCount(3)
})

test('edits relations, fitment, dictionaries and saves to the API', async ({ page }) => {
  await page.goto('./skus/sku-fixture-1/edit')
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
  const brandDictionary = page.locator('.editor-field [data-dictionary="sku_brand"]')
  await brandDictionary.getByRole('combobox').click()
  await expect(brandDictionary.getByRole('option', { name: '全部' })).toHaveCount(0)
  await brandDictionary.getByRole('option', { name: 'BMW' }).click()
  await page.getByRole('button', { name: '添加 OE 号' }).click()
  await expect(page.getByLabel('OE 品牌 2')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加 OE 号' })).toBeDisabled()
  await page.getByLabel('OE 编号 2').fill('BMW TEST 002')
  await page.getByLabel('OE 关系 2', { exact: true }).selectOption('直接替代')
  await page.getByLabel('OE 类型 2').selectOption('主 OE')
  await expect(page.getByLabel('OE 关系 2', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('OE 关系 2', { exact: true })).toBeDisabled()
  await page.getByLabel('OE 类型 2').selectOption('替代号')
  await page.getByLabel('OE 关系 2', { exact: true }).selectOption('直接替代')
  await page.getByRole('button', { name: '添加适配车型' }).click()
  await page.getByLabel('适配车型 2').fill('BMW X5 (G05)')
  await page.getByLabel('车身形式 2').selectOption('Coupe')
  await page.getByLabel('验证状态 2').selectOption('已验证')
  await page.getByRole('button', { name: '发布 SKU' }).click()
  await expect(page.getByText('SKU 已保存并发布')).toBeVisible()
  await expect(page.getByRole('button', { name: '停产 SKU' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '停产 SKU' }).click()
  await expect(page.getByText('SKU 已标记为停产')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新发布 SKU' })).toBeVisible()
  await page.getByRole('button', { name: '放大 EPC 图' }).click()
  await expect(page.getByRole('button', { name: '关闭 EPC 大图' })).toBeVisible()
})

test('search returns only actual database matches', async ({ page }) => {
  await page.getByRole('button', { name: /SKU、车型/ }).click()
  await page.getByLabel('命令搜索').fill('NO-MATCH-XYZ')
  await page.getByLabel('命令搜索').press('Enter')
  await expect(page.getByRole('heading', { name: '数据库中没有匹配记录' })).toBeVisible()
  await page.locator('.empty-results').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /SKU、车型/ }).click()
  await page.getByLabel('命令搜索').fill('95B 867 288')
  await page.getByLabel('命令搜索').press('Enter')
  await expect(page.getByText('95B-867-288-OM8', { exact: true }).first()).toBeVisible()
})

test('applies additional filters and sorting without stale details', async ({ page }) => {
  await page.getByRole('button', { name: '更多筛选' }).click()
  await page.getByLabel('适配车型筛选').selectOption('未配置')
  await expect(page.getByRole('heading', { name: '当前筛选没有结果' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '基本信息' })).toHaveCount(0)
  await page.getByRole('button', { name: '清除附加筛选' }).click()
  await expect(page.getByRole('row', { name: /95B-867-288-OM8/ })).toBeVisible()
  await page.getByRole('button', { name: '完成' }).click()
  await page.getByRole('button', { name: '最近更新' }).click()
  await page.getByRole('menuitemradio', { name: 'SKU 编码' }).click()
  await expect(page.getByRole('button', { name: /SKU 编码/ })).toHaveAttribute('aria-expanded', 'false')
})

test('detail tabs render persisted fitment and edit opens the editor', async ({ page }) => {
  await page.getByRole('tab', { name: '适配信息' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Porsche Cayenne (9YA)')
  await expect(page.getByRole('tab', { name: '适配信息' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '变更记录' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('创建草稿')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/skus\/sku-fixture-1\/edit$/)
})

test('publish stays disabled until required relationships are complete', async ({ page }) => {
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByLabel('SKU 编码 *').fill('PUBLISH-GATE-001')
  await page.getByLabel('中文名称 *').fill('发布校验件')
  await page.getByRole('combobox', { name: '品牌：请选择品牌' }).click()
  await page.getByRole('option', { name: '保时捷原厂' }).click()
  await page.getByRole('combobox', { name: '零件大类：请选择零件大类' }).click()
  await page.getByRole('option', { name: '车身及内饰' }).click()
  await page.getByLabel('主 OE 号 *').fill('PUBLISH OE 001')
  await page.getByRole('combobox', { name: '计量单位：请选择计量单位' }).click()
  await page.getByRole('option', { name: '件', exact: true }).click()
  await page.getByRole('combobox', { name: '数据来源：请选择数据来源' }).click()
  await page.getByRole('option', { name: '人工录入', exact: true }).click()
  await page.getByRole('button', { name: '创建草稿' }).click()
  await page.getByRole('heading', { name: '编辑 SKU' }).waitFor()
  await expect(page.getByRole('button', { name: '发布 SKU' })).toBeDisabled()
})

test('configures dictionaries and persists the result', async ({ page }) => {
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: /字典管理/ }).click()
  await expect(page.getByRole('heading', { name: '字典管理' })).toBeVisible()
  await page.getByRole('button', { name: '新增选项' }).click()
  const newRow = page.locator('.dictionary-table-row').last()
  await newRow.locator('input').nth(0).fill('测试品牌')
  const systemCode = newRow.getByLabel('测试品牌 系统编码')
  await expect(systemCode).toHaveAttribute('readonly', '')
  await expect(systemCode).toHaveValue(/^SKU_BRAND_[0-9A-Z]+$/)
  const generatedCode = await systemCode.inputValue()
  await newRow.getByLabel('测试品牌 显示名称').fill('测试品牌（已修改）')
  await expect(newRow.getByLabel('测试品牌（已修改） 系统编码')).toHaveValue(generatedCode)
  await page.getByRole('button', { name: '保存配置' }).click()
  await expect(page.getByText('配置已保存')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('测试品牌（已修改） 系统编码')).toHaveValue(generatedCode)
  await page.screenshot({ path: 'qa-artifacts/implementation-dictionary-module-1920.png', fullPage: false })

  await page.getByRole('button', { name: /^计量单位/ }).click()
  await expect(page.getByRole('heading', { name: '计量单位' })).toBeVisible()
  await page.getByRole('button', { name: '新增选项' }).click()
  const unitRow = page.locator('.dictionary-table-row').last()
  await unitRow.locator('input').nth(0).fill('箱')
  await expect(unitRow.getByLabel('箱 系统编码')).toHaveValue(/^UNIT_[0-9A-Z]+$/)
  await page.getByRole('button', { name: '保存配置' }).click()
  await expect(page.getByText('配置已保存')).toBeVisible()

  await page.goto('./skus/new')
  const unitDictionary = page.locator('.editor-field [data-dictionary="unit"]')
  await unitDictionary.getByRole('combobox').click()
  await expect(unitDictionary.getByRole('option', { name: '箱', exact: true })).toBeVisible()
})

test('renders the persisted editor at 1920 by 1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('./skus/sku-fixture-1/edit')
  await expect(page.getByRole('heading', { name: '编辑 SKU' })).toBeVisible()
  await expect(page.getByText('保时捷原厂').first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('SKU_BRAND_PORSCHE_FACTORY')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-1920.png', fullPage: false })
})
