import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const testInfoByPage = new WeakMap()

function capture(page, filename) {
  const testInfo = testInfoByPage.get(page)
  if (!testInfo) throw new Error('Missing Playwright test context for screenshot')
  const path = process.env.UPDATE_QA_ARTIFACTS === '1'
    ? `qa-artifacts/${filename}`
    : testInfo.outputPath(filename)
  return page.screenshot({ path, fullPage: false })
}

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/v1/dictionaries/reset', {
    headers: { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright' },
  })
  expect(response.ok()).toBeTruthy()
})

test.beforeEach(async ({ page }, testInfo) => {
  testInfoByPage.set(page, testInfo)
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  page.__consoleErrors = errors
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '下午好，虎山行' })).toBeVisible()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
})

test.afterEach(async ({ page }) => {
  expect(page.__consoleErrors).toEqual([])
})

test('renders the standalone workbench home', async ({ page }) => {
  await expect(page.getByLabel('工作台搜索')).toBeVisible()
  await expect(page.getByRole('heading', { name: '业务跟进' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '我的待办' })).toBeVisible()
  await expect(page.getByText('Pi 助手', { exact: true }).last()).toBeVisible()
  await capture(page, 'implementation-workbench-home-1680.png')
})

test('supports search, command center and todo interactions', async ({ page }) => {
  await page.getByLabel('工作台搜索').fill('Q7')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const commandCenter = page.getByRole('dialog', { name: '命令中心' })
  await expect(commandCenter).toBeVisible()
  await expect(commandCenter).toContainText('Audi Q7 (4M)')
  await page.keyboard.press('Escape')
  await expect(commandCenter).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '命令中心' })).toBeVisible()
  await page.keyboard.press('Escape')

  const firstTodo = page.getByRole('button', { name: /确认采购单/ })
  await firstTodo.click()
  await expect(firstTodo).toHaveClass(/done/)
})

test('opens the SKU v2 library and supports its core inspection flow', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await expect(page).toHaveURL(/#\/sku$/)
  await expect(page.getByRole('heading', { name: 'SKU 资料库' })).toBeVisible()
  await expect(page.getByText('95B 698 151 H', { exact: true }).first()).toBeVisible()
  await capture(page, 'implementation-sku-library-default-1680.png')

  await page.getByPlaceholder('搜索 SKU、OE 号、配件名称、品牌或适配车型').fill('机油滤清器')
  await expect(page.getByText('机油滤清器', { exact: true }).first()).toBeVisible()
  await page.getByText('机油滤清器', { exact: true }).first().click()
  await expect(page.getByText('06M 198 405 F', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '库存与价格' }).click()
  await expect(page.getByText('OEM 参考价')).toBeVisible()
  await capture(page, 'implementation-sku-library-1680.png')
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await expect(page.getByRole('dialog', { name: '选择 SKU 创建来源' })).toBeVisible()
  await capture(page, 'implementation-sku-source-modal-1680.png')
})

test('establishes an auditable vehicle platform master record', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await page.getByRole('button', { name: '车型平台' }).click()
  await expect(page.getByRole('heading', { name: '车型平台' })).toBeVisible()
  await page.getByRole('button', { name: '新建平台' }).click()
  await page.getByLabel('平台编码').fill('9YA')
  await page.getByLabel('状态').selectOption('active')
  await page.getByLabel('品牌名称').fill('Porsche')
  await page.getByLabel('品牌编码').fill('POR')
  await page.getByLabel('车系名称').fill('Cayenne')
  await page.getByLabel('代际名称').fill('第三代')
  await page.getByLabel('别名').fill('9Y0')
  await page.getByLabel('起始年款').fill('2018')
  await page.getByLabel('结束年款').fill('2025')
  await page.getByLabel('市场代码').fill('CN, EU')
  await page.getByLabel('车身形式').fill('SUV')
  await page.getByLabel('来源系统').fill('Porsche PET')
  await page.getByLabel('来源引用').fill('Cayenne 9YA model index')
  await page.getByRole('button', { name: '保存平台' }).click()
  await expect(page.getByText('车型平台已建立')).toBeVisible()
  await expect(page.getByText('9YA', { exact: true }).first()).toBeVisible()
  await capture(page, 'implementation-sku-platform-governance-1680.png')
  const aliasLookup = await page.request.get('/api/v2/catalog/vehicle-platforms/9Y0')
  expect(aliasLookup.ok()).toBeTruthy()
  expect((await aliasLookup.json()).platformCode).toBe('9YA')
  const duplicateAlias = await page.request.post('/api/v2/catalog/vehicle-platforms', {
    data: { platformCode: '95B', brandLabel: 'Porsche', seriesLabel: 'Macan', aliases: ['9YA'], lifecycleStatus: 'draft' },
  })
  expect(duplicateAlias.status()).toBe(409)
  expect((await duplicateAlias.json()).error).toBe('PLATFORM_ALIAS_CONFLICT')
})

test('governs structured vehicle variants under a platform', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await page.getByRole('button', { name: '车型平台' }).click()
  await page.getByRole('button', { name: '版本档案' }).click()
  await expect(page.getByRole('heading', { name: '车型版本' })).toBeVisible()
  await page.getByRole('button', { name: '新建版本' }).click()
  await page.getByLabel('所属平台').selectOption({ index: 1 })
  await page.getByLabel('状态').selectOption('active')
  await page.getByLabel('版本编码').fill('9YA-DCBE-CN')
  await page.getByLabel('版本名称').fill('3.0T 中国版')
  await page.getByLabel('起始年款').fill('2018')
  await page.getByLabel('结束年款').fill('2023')
  await page.getByLabel('发动机代码').fill('DCBE')
  await page.getByLabel('变速箱代码').fill('A48.00')
  await page.getByLabel('市场代码').fill('CN')
  await page.getByLabel('车身形式').fill('SUV')
  await page.getByLabel('驱动形式').fill('AWD')
  await page.getByLabel('PR 代码').fill('1ZT')
  await page.getByLabel('来源系统').fill('Porsche PET')
  await page.getByLabel('来源引用').fill('9YA DCBE CN model index')
  await page.getByRole('button', { name: '保存版本' }).click()
  await expect(page.getByText('车型版本已建立')).toBeVisible()
  await expect(page.getByText('9YA-DCBE-CN', { exact: true }).first()).toBeVisible()
  await capture(page, 'implementation-sku-vehicle-variant-1680.png')
  const variants = await (await page.request.get('/api/v2/catalog/vehicle-variants?status=active')).json()
  expect(variants.items[0].engineCodes).toContain('DCBE')
  expect(variants.items[0].history).toBeUndefined()
})

test('creates a source-first SKU and submits it into the review queue', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /从 EPC \/ VIN 创建/ }).click()

  await expect(page.getByRole('heading', { name: '从 VIN / EPC 建立资料' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '连接器采集' })).toBeVisible()
  await expect(page.getByText('待配置', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '读取目录' })).toBeDisabled()
  await page.getByPlaceholder('17 位 VIN').fill('WP1ZZZ9Y0KDA12345')
  await page.getByPlaceholder('例如 Macan 95B / 601-05').fill('Cayenne 9YA / 615-05')
  await page.getByLabel('第 1 行 OE 编号').fill('9Y0 615 301 M')
  await page.getByLabel('第 1 行原始名称').fill('前制动盘')
  await page.getByPlaceholder('601-05-01').fill('615-05-03')
  await page.getByPlaceholder('位置 6').fill('位置 3')
  await page.getByPlaceholder('平台 95B').fill('9YA')
  await page.getByPlaceholder('版本代码').fill('9YA-DCBE-CN')
  await page.getByPlaceholder('Porsche Macan').fill('Cayenne (9YA)')
  await page.getByPlaceholder('发动机代码').fill('DCBE')
  await page.getByPlaceholder('起始年款').fill('2018')
  await page.getByPlaceholder('结束年款').fill('2023')
  await page.getByPlaceholder('变速箱代码').fill('A48.00')
  await page.getByPlaceholder('PR 代码').fill('1ZT')
  await capture(page, 'implementation-sku-epc-intake-1680.png')
  await page.getByRole('button', { name: '生成匹配预览' }).click()
  await expect(page.getByText('写入前匹配预览', { exact: true })).toBeVisible()
  await expect(page.getByText('建议新建', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('9YA-DCBE-CN', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('现有人工名称、分类、价格不覆盖')).toBeVisible()
  await capture(page, 'implementation-sku-epc-preview-1680.png')

  const commitResponse = page.waitForResponse((response) => response.url().includes('/api/v2/catalog/epc-previews/') && response.url().endsWith('/commit') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认写入所选记录' }).click()
  const committed = await (await commitResponse).json()
  const skuId = committed.items[0].resultingSkuId
  expect(skuId).toBeTruthy()
  await expect(page.getByRole('button', { name: '完成并返回资料库' })).toBeVisible()
  await page.getByRole('button', { name: '返回批次记录' }).click()
  await expect(page.getByRole('heading', { name: 'EPC 批次记录' })).toBeVisible()
  await expect(page.getByText('已完成 · 1/1')).toBeVisible()
  await expect(page.getByText(/Cayenne 9YA \/ 615-05/)).toBeVisible()
  await capture(page, 'implementation-sku-epc-history-1680.png')

  const created = await (await page.request.get(`/api/v2/catalog/skus/${skuId}`)).json()
  const completed = await page.request.patch(`/api/v2/catalog/skus/${skuId}`, { data: {
    expectedVersion: created.version,
    identity: { ...created.identity, nameZh: '前制动盘', brandCode: 'POR', brandLabel: 'Porsche', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: created.evidence.map((item) => ({ ...item, clientKey: item.id })),
    identifiers: created.identifiers.map((item) => ({ ...item, clientKey: item.id, evidenceKey: item.evidenceId })),
    fitments: created.fitments.map((item) => ({ ...item, evidenceKey: item.evidenceId, includeConditions: { note: '标准制动', rules: [{ field: 'prCode', operator: 'in', values: ['1ZT'] }] } })),
    interchanges: [],
  } })
  expect(completed.ok()).toBeTruthy()
  const submitted = await page.request.post(`/api/v2/catalog/skus/${skuId}/transition`, { data: { expectedVersion: (await completed.json()).version, action: 'submit_review', assignee: '资料审核员' } })
  expect(submitted.ok()).toBeTruthy()
  await page.getByRole('button', { name: '返回资料库' }).click()
  await expect(page.getByRole('heading', { name: 'SKU 资料库' })).toBeVisible()
  await expect(page.getByText('前制动盘', { exact: true }).first()).toBeVisible()
})

test('resumes a partial EPC batch without repeating completed decisions', async ({ page }) => {
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  const preview = await (await page.request.post('/api/v2/catalog/epc-previews', { headers, data: {
    sourceSystem: 'Audi ETKA', catalogPath: 'Q7 4M / 121-05', items: [
      { oe: 'RESUME-EPC-001', originalName: 'Source row one', sourceRecordId: '121-05-01' },
      { oe: 'RESUME-EPC-002', originalName: 'Source row two', sourceRecordId: '121-05-02' },
    ],
  } })).json()
  const partial = await page.request.post(`/api/v2/catalog/epc-previews/${preview.id}/commit`, { headers, data: { expectedVersion: preview.version, decisions: [{ itemId: preview.items[0].id, action: 'skip' }] } })
  expect(partial.ok()).toBeTruthy()
  expect((await partial.json()).state).toBe('partial')

  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /从 EPC \/ VIN 创建/ }).click()
  await page.getByRole('button', { name: /批次记录/ }).click()
  await expect(page.getByText('处理中 · 1/2').first()).toBeVisible()
  await page.getByRole('button', { name: /Audi ETKA/ }).first().click()
  await expect(page.getByText('已跳过', { exact: true })).toBeVisible()
  await expect(page.getByText('建议新建', { exact: true }).first()).toBeVisible()
  await page.getByText('跳过本条', { exact: true }).click()
  await page.getByRole('button', { name: '确认写入所选记录' }).click()
  await expect(page.getByRole('button', { name: '完成并返回资料库' })).toBeVisible()
  await page.getByRole('button', { name: '返回批次记录' }).click()
  await expect(page.getByText('已完成 · 2/2')).toBeVisible()
})

test('operates failed EPC connector runs with filters, inspection and linked retries', async ({ page }) => {
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  const connectors = await (await page.request.get('/api/v2/catalog/epc-connectors', { headers })).json()
  const connector = connectors.items[0]
  const vin = 'WP1ZZZ95ZHLB54321'
  const failed = await page.request.post(`/api/v2/catalog/epc-connectors/${connector.id}/collect`, { headers, data: { vin, catalogPath: '95B / 601-05', groupCode: '601-05' } })
  expect(failed.status()).toBe(503)
  expect((await failed.json()).details.connectorRunId).toBeTruthy()

  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /从 EPC \/ VIN 创建/ }).click()
  await page.getByRole('button', { name: '运行中心' }).click()
  await expect(page.getByRole('heading', { name: 'EPC 运行中心' })).toBeVisible()
  await page.getByLabel('搜索连接器运行').fill(vin)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByText(vin).first()).toBeVisible()
  await expect(page.getByRole('strong').filter({ hasText: 'EPC_CONNECTOR_NOT_CONFIGURED' })).toBeVisible()
  await expect(page.getByText('地址与密钥不会进入浏览器或运行记录')).toBeVisible()
  await capture(page, 'implementation-epc-run-center-1680.png')

  const retryResponse = page.waitForResponse((response) => response.url().includes('/api/v2/catalog/epc-connector-runs/') && response.url().endsWith('/retry') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '使用原条件重试' }).click()
  expect((await retryResponse).status()).toBe(503)
  page.__consoleErrors = page.__consoleErrors.filter((message) => !message.includes('status of 503'))
  await expect(page.getByText(vin).first()).toBeVisible()
  await expect(page.getByText('重试记录').first()).toBeVisible()
  await expect(page.getByText(/连接器尚未配置/).last()).toBeVisible()
})

test('reviews a submitted SKU in the data quality workspace', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await expect(page.getByText('数据质量与审核', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '适配治理' }).click()
  await expect(page.getByRole('heading', { name: '适配关系' })).toBeVisible()
  await expect(page.getByText('Cayenne (9YA)', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('9YA', { exact: true }).first()).toBeVisible()
  await page.getByLabel('适配审核结论').fill('EPC 图组、平台、年款与排除条件均已复核')
  await page.locator('.fitment-governance-scroll').evaluate((element) => { element.scrollTop = 0 })
  await capture(page, 'implementation-sku-fitment-governance-1680.png')
  await page.getByRole('button', { name: '通过适配' }).click()
  await expect(page.getByText('适配关系已通过审核')).toBeVisible()
  await page.getByRole('button', { name: '处理队列' }).click()
  await expect(page.getByRole('heading', { name: '处理队列' })).toBeVisible()
  await page.getByRole('button', { name: /前制动盘/ }).click()
  await expect(page.getByText('全部通过', { exact: true })).toBeVisible()
  await expect(page.getByText('资料审核员', { exact: true }).first()).toBeVisible()
  await capture(page, 'implementation-sku-quality-review-1680.png')
  await page.getByRole('button', { name: '通过审核', exact: true }).click()
  await page.getByPlaceholder('可填写审核结论（选填）').fill('来源、编号与车型适配均已复核')
  await page.getByRole('button', { name: '确认通过审核' }).click()
  await expect(page.getByText('审核已通过')).toBeVisible()
  await page.getByRole('button', { name: '运营洞察' }).click()
  await expect(page.getByRole('heading', { name: '运营洞察' })).toBeVisible()
  await expect(page.getByText('审核通过率')).toBeVisible()
  await expect(page.getByText('平均审核耗时')).toBeVisible()
  await capture(page, 'implementation-sku-quality-insights-1680.png')
})

test('detects and resolves overlapping fitment scopes before publication', async ({ page }) => {
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  const created = await (await page.request.post('/api/v2/catalog/skus', { headers, data: {
    identity: { nameZh: '适配重叠验收件', brandCode: 'POR', brandLabel: 'Porsche', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: 'OVERLAP-E2E-01', catalogPath: '9YA/615' }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'OVERLAP-E2E-001', isPrimary: true, evidenceKey: 'source' }],
    fitments: [
      { vehiclePlatformId: '9YA', vehicleLabel: 'Cayenne (9YA)', years: '2018–2022', yearFrom: 2018, yearTo: 2022, position: '前轴', prCodes: ['1ZT'], includeConditions: { note: '标准制动' }, evidenceKey: 'source' },
      { vehiclePlatformId: '9YA', vehicleLabel: 'Cayenne (9YA)', years: '2021–2025', yearFrom: 2021, yearTo: 2025, position: '前轴', prCodes: ['1ZK'], includeConditions: { note: '增强制动' }, evidenceKey: 'source' },
    ],
  } })).json()
  expect(created.fitments).toHaveLength(2)
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await page.getByRole('button', { name: '车型平台' }).click()
  await page.getByRole('button', { name: /\u51b2\u7a81\u626b\u63cf/ }).click()
  await page.getByRole('button', { name: /\u8303\u56f4\u91cd\u53e0/ }).click()
  await expect(page.getByText('适配重叠验收件', { exact: true }).first()).toBeVisible()
  await page.getByText('允许重叠', { exact: true }).click()
  await page.getByLabel('适配冲突处理依据').fill('PR 1ZT 与 1ZK 对应不同制动配置，允许年款重叠')
  await capture(page, 'implementation-sku-fitment-conflict-1680.png')
  await page.getByRole('button', { name: '提交处理结论' }).click()
  await expect(page.getByText('适配冲突已留痕处理')).toBeVisible()
})

test('compares historical SKU versions and restores one as a new draft', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByText('前制动盘', { exact: true }).first().click()
  await page.getByRole('button', { name: '编辑 SKU' }).click()
  await page.getByLabel('中文标准名称').fill('前制动盘（误改）')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存到 SKU 资料库/)).toBeVisible()
  await page.getByLabel('返回 SKU 资料库').click()
  await page.getByRole('button', { name: '变更记录' }).click()
  await page.getByRole('button', { name: /v5 · 审核通过/ }).click()
  const dialog = page.getByRole('dialog', { name: 'SKU 版本对比' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('审核状态不会回退')).toBeVisible()
  await capture(page, 'implementation-sku-version-compare-1680.png')
  await dialog.getByPlaceholder('例如：撤销错误的 OE 与车型适配修改').fill('撤销测试中的错误名称修改')
  await dialog.getByRole('button', { name: '恢复 v5 为新草稿' }).click()
  await expect(page.getByText(/已从 v5 恢复为新草稿/)).toBeVisible()
  await expect(page.getByRole('heading', { name: '前制动盘' })).toBeVisible()
})

test('previews CSV conflicts and imports only explicitly selected rows', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '批量导入' }).click()
  const dialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('先用标准模板整理')).toBeVisible()
  const templateDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载标准模板' }).click()
  expect((await templateDownload).suggestedFilename()).toBe('hushanxing-sku-import-template.csv')
  await dialog.getByRole('button', { name: '查看字段说明' }).click()
  await expect(dialog.getByText('来源记录ID', { exact: true })).toBeVisible()
  await capture(page, 'implementation-sku-import-template-1680.png')
  await dialog.getByRole('button', { name: '查看字段说明' }).click()
  const csv = '\uFEFF中文名称,品牌,分类,单位,主 OE,车型,年款范围,来源系统\n后刹车片,Porsche OE,制动系统 / 制动片,件,TEST-IMPORT-001,Macan (95B),2014-2018,Porsche PET\n重复前制动盘,Porsche OE,制动系统 / 制动盘,件,9Y0 615 301 M,Cayenne (9YA),2018-2023,Porsche PET\n无编号件,Porsche OE,制动系统 / 制动片,件,,,,供应商资料\n文件重复件 A,Porsche OE,制动系统 / 制动片,件,FILE-DUP-001,Macan (95B),2014-2018,Porsche PET\n文件重复件 B,Porsche OE,制动系统 / 制动片,件,FILE DUP 001,Macan (95B),2014-2018,Porsche PET'
  await dialog.locator('input[type=file]').setInputFiles({ name: 'sku-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(dialog.getByRole('heading', { name: '存在阻断项' })).toBeVisible()
  await expect(dialog.getByText('资料覆盖率')).toBeVisible()
  await expect(dialog.getByText('问题汇总')).toBeVisible()
  await expect(page.getByText('总行数')).toBeVisible()
  await expect(page.getByText('疑似重复', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('不可导入', { exact: true }).first()).toBeVisible()
  await expect(page.getByLabel('选择第 3 行')).not.toBeChecked()
  await expect(page.getByLabel('选择第 4 行')).toBeDisabled()
  await expect(page.getByLabel('选择第 5 行')).not.toBeChecked()
  await expect(dialog.getByText('与文件第 6 行使用相同主 OE')).toBeVisible()
  await capture(page, 'implementation-sku-import-preview-1680.png')
  await page.getByRole('button', { name: '写入 1 条草稿' }).click()
  await expect(page.getByRole('heading', { name: '导入批次已完成' })).toBeVisible()
  await expect(page.getByText('成功写入 1 条，失败 0 条')).toBeVisible()
  await page.getByRole('button', { name: '查看本次导入记录' }).click()
  await expect(page.getByText('首次写入')).toBeVisible()
  await expect(page.getByText('sku-import.csv', { exact: true }).first()).toBeVisible()
  await capture(page, 'implementation-sku-import-history-1680.png')
  await dialog.locator('.sku-import-actions').getByRole('button', { name: '关闭' }).click()
  await expect(page.getByText('后刹车片', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '批量导入' }).click()
  const repeatedDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  await repeatedDialog.locator('input[type=file]').setInputFiles({ name: 'renamed-copy.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(repeatedDialog.getByText('该文件内容已导入过')).toBeVisible()
  await expect(repeatedDialog.getByText('首次写入')).toBeVisible()
  await capture(page, 'implementation-sku-import-idempotency-1680.png')
  await repeatedDialog.locator('.sku-import-actions').getByRole('button', { name: '关闭' }).click()
})

test('maps supplier CSV headers and reuses a saved supplier profile', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '批量导入' }).click()
  const dialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  const supplierCsv = '供应商品名,原厂编号,厂牌,适用车系,内部备注\n空调滤芯,4M0 819 439 B,MANN,Audi Q7 (4M),供应商特价批次'
  await dialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a.csv', mimeType: 'text/csv', buffer: Buffer.from(supplierCsv) })
  await expect(dialog.getByRole('heading', { name: '确认供应商字段映射' })).toBeVisible()
  await expect(dialog.getByLabel('映射 中文名称')).toHaveValue('0')
  await expect(dialog.getByLabel('映射 主 OE')).toHaveValue('1')
  await expect(dialog.getByLabel('映射 品牌')).toHaveValue('2')
  await expect(dialog.getByLabel('映射 车型')).toHaveValue('3')
  await expect(dialog.locator('.sku-import-mapping > footer p').getByText('内部备注', { exact: true })).toBeVisible()
  await expect(dialog.getByText('保存为供应商方案')).toBeVisible()
  await expect(dialog.getByLabel('映射方案名称')).toHaveValue('supplier-a 映射方案')
  await capture(page, 'implementation-sku-import-mapping-1680.png')
  await dialog.getByRole('button', { name: '确认映射并预检查' }).click()
  await expect(dialog.getByText('空调滤芯', { exact: true })).toBeVisible()
  await expect(dialog.getByText('4M0 819 439 B', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭' }).first().click()

  await page.getByRole('button', { name: '批量导入' }).click()
  const reuseDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  const nextCsv = '供应商品名,原厂编号,厂牌,适用车系,内部备注\n机油滤芯,06L 115 562 B,MANN,Audi A4 (B9),常规补货'
  await reuseDialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a-202610.csv', mimeType: 'text/csv', buffer: Buffer.from(nextCsv) })
  await expect(reuseDialog.getByText('已自动套用“supplier-a 映射方案”')).toBeVisible()
  await expect(reuseDialog.getByLabel('映射 主 OE')).toHaveValue('1')
  await capture(page, 'implementation-sku-import-profile-reuse-1680.png')
  await reuseDialog.getByRole('button', { name: '确认映射并预检查' }).click()
  await expect(reuseDialog.getByText('机油滤芯', { exact: true })).toBeVisible()
  await reuseDialog.getByRole('button', { name: '关闭' }).first().click()

  await page.getByRole('button', { name: '批量导入' }).click()
  const driftDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  const driftCsv = '供应商品名,原厂编号,厂牌,适用车系,内部备注,仓库\n空气滤芯,8W0 133 843 C,MANN,Audi A4 (B9),新版表头,华东仓'
  await driftDialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a-202611.csv', mimeType: 'text/csv', buffer: Buffer.from(driftCsv) })
  await expect(driftDialog.getByText('检测到“supplier-a 映射方案”的表头发生变化')).toBeVisible()
  await expect(driftDialog.getByText(/新增：仓库/)).toBeVisible()
  await driftDialog.getByRole('button', { name: '应用已有方案' }).click()
  await expect(driftDialog.getByRole('button', { name: '已应用可匹配字段' })).toBeDisabled()
  await expect(driftDialog.getByText('同步更新供应商方案')).toBeVisible()
  await capture(page, 'implementation-sku-import-profile-drift-1680.png')
  await driftDialog.getByRole('button', { name: '关闭' }).first().click()
})

test('manages supplier mapping profiles without deleting audit history', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '批量导入' }).click()
  const dialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  await dialog.getByRole('button', { name: '映射方案' }).click()
  await expect(dialog.getByRole('heading', { name: '供应商映射方案' })).toBeVisible()
  await expect(dialog.getByText('supplier-a 映射方案', { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText('字段对应关系')).toBeVisible()
  await expect(dialog.getByText('供应商品名', { exact: true }).last()).toBeVisible()

  await dialog.getByRole('button', { name: '编辑导入规则' }).click()
  await dialog.getByLabel('默认品牌').fill('MANN')
  await dialog.getByLabel('默认单位').fill('件')
  await dialog.getByLabel('来源系统').fill('供应商 A CSV')
  await dialog.locator('.sku-profile-rule-editor').getByRole('button', { name: '保存规则' }).click()
  await expect(dialog.locator('.sku-profile-rule-summary')).toContainText('品牌 MANN')
  await expect(dialog.locator('.sku-profile-rule-summary')).toContainText('单位 件')
  await expect(dialog.locator('.sku-profile-rule-summary')).toContainText('来源 供应商 A CSV')
  await expect(dialog.locator('.sku-profile-detail-grid > section').nth(1).getByText('更新导入规则', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: '编辑值映射' }).click()
  await dialog.getByRole('button', { name: '添加品牌映射' }).click()
  await dialog.getByLabel('品牌供应商值 1').fill('MANN')
  await dialog.getByLabel('品牌标准值 1').fill('MANN-FILTER')
  await dialog.getByRole('button', { name: '添加品牌映射' }).click()
  await dialog.getByLabel('品牌供应商值 2').fill('博世中国')
  await dialog.getByLabel('品牌标准值 2').fill('BOSCH')
  await capture(page, 'implementation-sku-import-value-editor-1680.png')
  await dialog.locator('.sku-profile-value-editor').getByRole('button', { name: '保存映射' }).click()
  await expect(dialog.locator('.sku-profile-value-summary')).toContainText('品牌2 条')
  await expect(dialog.locator('.sku-profile-detail-grid > section').nth(1).getByText('更新值映射', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: '重命名方案' }).click()
  await dialog.getByLabel('新的方案名称').fill('供应商 A 标准映射')
  await dialog.locator('.sku-profile-action').getByRole('button', { name: '确认' }).click()
  await expect(dialog.getByRole('heading', { name: '供应商 A 标准映射' })).toBeVisible()
  await expect(dialog.locator('.sku-profile-detail-grid > section').nth(1).getByText('重命名', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: '复制方案' }).click()
  await dialog.getByLabel('复制方案名称').fill('供应商 A 备用映射')
  await dialog.locator('.sku-profile-action').getByRole('button', { name: '确认' }).click()
  await expect(dialog.getByRole('heading', { name: '供应商 A 备用映射' })).toBeVisible()
  await expect(dialog.locator('.sku-profile-detail-grid > section').nth(1).getByText('复制方案', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: '停用方案' }).click()
  await expect(dialog.getByText('停用后不再参与自动匹配')).toBeVisible()
  await dialog.locator('.sku-profile-action').getByRole('button', { name: '确认' }).click()
  await expect(dialog.locator('.sku-profile-inspector > header').getByText('已停用')).toBeVisible()
  await capture(page, 'implementation-sku-import-profile-manager-1680.png')

  await dialog.getByRole('button', { name: '恢复方案' }).click()
  await dialog.locator('.sku-profile-action').getByRole('button', { name: '确认' }).click()
  await expect(dialog.locator('.sku-profile-inspector > header').getByText('启用中')).toBeVisible()
  await dialog.locator('.sku-import-actions').getByRole('button', { name: '关闭' }).click()

  await page.getByRole('button', { name: '批量导入' }).click()
  const rulesDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  const rulesCsv = '供应商品名,原厂编号,厂牌,适用车系,内部备注\n　燃油  滤芯　,ａb-１２３,,Audi A4 (B9),规则测试'
  await rulesDialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a-rules.csv', mimeType: 'text/csv', buffer: Buffer.from(rulesCsv) })
  await expect(rulesDialog.getByText('导入规则预览 · 第 1 行')).toBeVisible()
  await expect(rulesDialog.locator('.sku-mapping-rule-preview')).toContainText('ａb-１２３')
  await expect(rulesDialog.locator('.sku-mapping-rule-preview')).toContainText('AB-123')
  await expect(rulesDialog.locator('.sku-mapping-rule-preview')).toContainText('MANN-FILTER')
  await capture(page, 'implementation-sku-import-rule-preview-1680.png')
  await rulesDialog.getByRole('button', { name: '确认映射并预检查' }).click()
  await expect(rulesDialog.getByText('燃油 滤芯', { exact: true }).first()).toBeVisible()
  await expect(rulesDialog.getByText('AB-123', { exact: true })).toBeVisible()
  await expect(rulesDialog.getByText('MANN-FILTER', { exact: true })).toBeVisible()
  await rulesDialog.getByRole('button', { name: '关闭' }).first().click()

  await page.getByRole('button', { name: '批量导入' }).click()
  const valueDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  const valueCsv = '供应商品名,原厂编号,厂牌,适用车系,内部备注\n火花塞,VALUE-MAP-001,博世中国,Audi A4 (B9),已配置映射\n点火线圈,VALUE-MAP-002,曼牌中国,Audi A4 (B9),可映射标准品牌\n高压油泵,VALUE-MAP-003,新品牌中国,Audi A4 (B9),需要申请新标准值'
  await valueDialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a-values.csv', mimeType: 'text/csv', buffer: Buffer.from(valueCsv) })
  await expect(valueDialog.getByText('2 行值需要人工确认')).toBeVisible()
  await expect(valueDialog.getByText('品牌 · 曼牌中国 × 1')).toBeVisible()
  await valueDialog.getByRole('button', { name: '确认映射并预检查' }).click()
  await expect(valueDialog.getByText('供应商值异常队列')).toBeVisible()
  await expect(valueDialog.getByText('曼牌中国', { exact: true }).first()).toBeVisible()
  await expect(valueDialog.getByText('新品牌中国', { exact: true }).first()).toBeVisible()
  await expect(valueDialog.getByText('BOSCH', { exact: true })).toBeVisible()
  await expect(valueDialog.getByLabel('选择第 2 行')).toBeChecked()
  await expect(valueDialog.getByLabel('选择第 3 行')).not.toBeChecked()
  await expect(valueDialog.getByLabel('选择第 4 行')).not.toBeChecked()
  await expect(valueDialog.getByLabel('选择第 3 行')).toBeDisabled()
  await expect(valueDialog.getByLabel('选择第 4 行')).toBeDisabled()
  await expect(valueDialog.locator('.import-state.review')).toHaveCount(2)
  await capture(page, 'implementation-sku-import-value-review-1680.png')
  await valueDialog.getByLabel('品牌 曼牌中国 的标准值').selectOption('MANN-FILTER')
  await valueDialog.getByRole('button', { name: '保存并重新检查' }).click()
  await expect(valueDialog.locator('.sku-value-review-queue article').filter({ hasText: '曼牌中国' })).toHaveCount(0)
  await expect(valueDialog.locator('.sku-import-table').getByText('MANN-FILTER', { exact: true })).toBeVisible()
  await expect(valueDialog.getByLabel('选择第 3 行')).toBeChecked()
  await expect(valueDialog.locator('.import-state.review')).toHaveCount(1)

  await valueDialog.getByText('没有合适项？申请新增').click()
  await valueDialog.getByLabel('新品牌中国 建议标准值').fill('NEW-BRAND')
  await valueDialog.getByLabel('新品牌中国 申请原因').fill('供应商品牌证明已核对，需作为新的标准品牌')
  await valueDialog.getByRole('button', { name: '提交审核' }).click()
  await expect(valueDialog.getByText('已提交新增申请')).toBeVisible()
  await valueDialog.getByRole('button', { name: '标准值治理' }).click()
  await expect(valueDialog.getByRole('heading', { name: '标准值治理' })).toBeVisible()
  await expect(valueDialog.getByText('NEW-BRAND', { exact: true })).toBeVisible()
  await valueDialog.getByLabel('NEW-BRAND 审核说明').fill('品牌资料已核验，同意纳入标准字典')
  await valueDialog.getByRole('button', { name: '通过并入字典' }).click()
  await expect(valueDialog.getByText('当前没有待审核申请')).toBeVisible()
  await capture(page, 'implementation-sku-standard-governance-1680.png')

  await valueDialog.getByRole('button', { name: '新建导入' }).click()
  await valueDialog.locator('input[type=file]').setInputFiles({ name: 'supplier-a-values.csv', mimeType: 'text/csv', buffer: Buffer.from(valueCsv) })
  await expect(valueDialog.getByText('1 行值需要人工确认')).toBeVisible()
  await valueDialog.getByRole('button', { name: '确认映射并预检查' }).click()
  await valueDialog.getByLabel('品牌 新品牌中国 的标准值').selectOption('NEW-BRAND')
  await valueDialog.getByRole('button', { name: '保存并重新检查' }).click()
  await expect(valueDialog.getByText('供应商值异常队列')).not.toBeVisible()
  await expect(valueDialog.locator('.sku-import-table').getByText('NEW-BRAND', { exact: true })).toBeVisible()
  await expect(valueDialog.getByLabel('选择第 4 行')).toBeChecked()
  await expect(valueDialog.getByRole('button', { name: '写入 3 条草稿' })).toBeVisible()
  await capture(page, 'implementation-sku-import-value-resolved-1680.png')
  await valueDialog.getByRole('button', { name: '关闭' }).first().click()
})

test('supports controlled bulk review submission with per-record results', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByLabel('选择 前制动盘').check()
  await page.getByLabel('选择 后刹车片').check()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量提交审核' })
  await expect(dialog).toContainText('已选择 2 条资料')
  await capture(page, 'implementation-sku-bulk-review-1680.png')
  await dialog.getByRole('button', { name: '提交审核 2 条' }).click()
  await expect(dialog.getByRole('heading', { name: '批量操作已完成' })).toBeVisible()
  await expect(dialog.getByText('成功 2 条，失败 0 条')).toBeVisible()
  await dialog.getByRole('button', { name: '返回资料库' }).click()
})

test('exports a full audit package and a readable business CSV', async ({ page }) => {
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  const payload = {
    identity: { nameZh: '导出验收测试件', brandCode: 'POR', brandLabel: 'Porsche OE', categoryCode: 'FILTER', categoryLabel: '滤清器' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: 'EXPORT-E2E-01' }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'EXPORT-E2E-001', isPrimary: true, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: 'Macan (95B)', years: '2014-2018', evidenceKey: 'source' }], interchanges: [],
  }
  expect((await page.request.post('/api/v2/catalog/skus', { headers, data: payload })).ok()).toBeTruthy()
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '导出资料' }).click()
  const dialog = page.getByRole('dialog', { name: '导出 SKU 资料' })
  await expect(dialog).toContainText('审计包自带完整性信息')
  await expect(dialog).toContainText('业务导出不等于数据库备份')
  await capture(page, 'implementation-sku-export-1680.png')

  const jsonDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载 JSON' }).click()
  const jsonDownload = await jsonDownloadPromise
  expect(jsonDownload.suggestedFilename()).toMatch(/^hushanxing-sku-\d{8}\.json$/)
  const snapshot = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'))
  expect(snapshot.schemaVersion).toBe('catalog-export-v1')
  expect(snapshot.checksum.value).toMatch(/^[a-f0-9]{64}$/)
  expect(snapshot.items.some((item) => item.identity.nameZh === '导出验收测试件')).toBeTruthy()

  await page.getByRole('button', { name: '导出资料' }).click()
  const csvDialog = page.getByRole('dialog', { name: '导出 SKU 资料' })
  await csvDialog.getByLabel(/业务表格/).check()
  const csvDownloadPromise = page.waitForEvent('download')
  await csvDialog.getByRole('button', { name: '下载 CSV' }).click()
  const csvDownload = await csvDownloadPromise
  expect(csvDownload.suggestedFilename()).toMatch(/^hushanxing-sku-\d{8}\.csv$/)
  const csv = await readFile(await csvDownload.path(), 'utf8')
  expect(csv).toContain('SKU 编码,中文名称')
  expect(csv).toContain('EXPORT-E2E-001')
})

test('switches development roles and disables unauthorized operations', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '当前资料权限' }).click()
  await expect(page.getByText('开发环境可切换角色进行验收')).toBeVisible()
  await page.getByRole('button', { name: /只读查看/ }).click()
  await expect(page.getByRole('button', { name: '新建 SKU' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '批量导入' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '导出资料' })).toBeDisabled()
  await page.getByRole('button', { name: '当前资料权限' }).click()
  await capture(page, 'implementation-sku-role-permissions-1680.png')
})

test('reviews and resolves an identifier conflict with evidence', async ({ page }) => {
  const payload = (name, vehicle) => ({
    identity: { nameZh: name, brandCode: 'POR', brandLabel: 'Porsche OE', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: name }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'CONFLICT-001', isPrimary: true, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: vehicle, years: '2018-2023', evidenceKey: 'source' }], interchanges: [],
  })
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  expect((await page.request.post('/api/v2/catalog/skus', { headers, data: payload('冲突测试左', 'Cayenne (9YA)') })).ok()).toBeTruthy()
  expect((await page.request.post('/api/v2/catalog/skus', { headers, data: payload('冲突测试右', 'Macan (95B)') })).ok()).toBeTruthy()
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await page.getByRole('button', { name: '编号冲突' }).click()
  await page.getByRole('button', { name: /CONFLICT-001/ }).first().click()
  await expect(page.getByText('CONFLICT001', { exact: true })).toBeVisible()
  await page.getByLabel(/适用范围不同/).check()
  await page.getByPlaceholder('记录品牌目录、EPC 图组、适用范围或人工复核依据').fill('两个 SKU 的适配车型不同，已依据品牌目录逐项复核')
  await capture(page, 'implementation-sku-conflict-resolution-1680.png')
  await page.getByRole('button', { name: '保存处理结论' }).click()
  await expect(page.getByText('冲突结论已保存，质量阻断已解除')).toBeVisible()
  await expect(page.getByText('适用范围不同', { exact: true }).first()).toBeVisible()
})

test('previews and safely merges a confirmed duplicate SKU', async ({ page }) => {
  const payload = (name, reference, vehicle) => ({
    identity: { nameZh: name, brandCode: 'POR', brandLabel: 'Porsche OE', categoryCode: 'BRAKE', categoryLabel: '制动系统' },
    evidence: [{ clientKey: 'source', sourceType: 'brand_catalog', sourceSystem: 'Porsche PET', sourceRecordId: name }],
    identifiers: [{ clientKey: 'oe', type: 'oe', rawValue: 'MERGE-E2E-001', isPrimary: true, evidenceKey: 'source' }, { clientKey: 'reference', type: 'reference', rawValue: reference, evidenceKey: 'source' }],
    fitments: [{ vehicleLabel: vehicle, years: '2018-2023', evidenceKey: 'source' }], interchanges: [],
  })
  const headers = { 'x-operator-role': 'catalog_admin', 'x-operator-name': 'playwright', 'content-type': 'application/json' }
  const survivor = await (await page.request.post('/api/v2/catalog/skus', { headers, data: payload('合并测试主资料', 'MERGE-REF-A', 'Cayenne (9YA)') })).json()
  const retired = await (await page.request.post('/api/v2/catalog/skus', { headers, data: payload('合并测试重复资料', 'MERGE-REF-B', 'Touareg (CR)') })).json()
  const resolved = await page.request.post('/api/v2/catalog/conflicts/resolve', { headers, data: {
    normalizedValue: 'MERGEE2E001', skuIdA: survivor.id, skuIdB: retired.id, expectedVersionA: survivor.version, expectedVersionB: retired.version,
    resolutionType: 'merge_required', note: '品牌目录和实物标签复核为同一零件',
  } })
  expect(resolved.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await page.getByRole('button', { name: '编号冲突' }).click()
  await page.getByRole('button', { name: /MERGE-E2E-001/ }).click()
  await page.getByRole('button', { name: '进入安全合并' }).click()
  const dialog = page.getByRole('dialog', { name: '安全合并重复 SKU' })
  await expect(dialog).toBeVisible()
  await dialog.locator('.sku-merge-choice label').filter({ hasText: '合并测试主资料' }).getByRole('radio').check()
  await expect(dialog.getByText('新增编号')).toBeVisible()
  await expect(dialog.getByText('版本锁、双份快照和操作人留痕已开启')).toBeVisible()
  await dialog.getByPlaceholder(/例如：经 Porsche EPC/).fill('经 Porsche PET 目录和实物标签复核，两条资料确认是同一零件')
  await dialog.getByLabel(/我已核对保留项与停用项/).check()
  await capture(page, 'implementation-sku-safe-merge-1680.png')
  await dialog.getByRole('button', { name: '确认安全合并' }).click()
  await expect(page.getByText(/已合并至 .*原 SKU 已安全停用/)).toBeVisible()
  await expect(page.getByRole('button', { name: /MERGE-E2E-001/ })).toHaveCount(0)
  const survivorAfter = await (await page.request.get(`/api/v2/catalog/skus/${survivor.id}`, { headers })).json()
  const retiredAfter = await (await page.request.get(`/api/v2/catalog/skus/${retired.id}`, { headers })).json()
  expect(survivorAfter.lifecycleStatus).toBe('draft')
  expect(survivorAfter.identifiers).toHaveLength(3)
  expect(survivorAfter.fitments).toHaveLength(2)
  expect(retiredAfter.lifecycleStatus).toBe('discontinued')
})

test('shows actionable validation issues for an incomplete manual SKU', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /手工建立空白 SKU/ }).click()

  await expect(page.getByText('0%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '4 发布检查' }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(page.getByRole('heading', { name: '来源与基本身份' })).toBeVisible()
  await expect(page.getByText('还有 5 项需要补充')).toBeVisible()
  await capture(page, 'implementation-sku-editor-incomplete-1680.png')
})

test('preflights and atomically executes an approved legacy SKU migration plan', async ({ page }) => {
  const headers = (role, id, name) => ({
    'x-operator-role': role,
    'x-operator-id': id,
    'x-operator-name': encodeURIComponent(name),
    'content-type': 'application/json',
  })
  const editorHeaders = headers('catalog_editor', 'e2e:migration-editor', '迁移资料员')
  const reviewerHeaders = headers('catalog_reviewer', 'e2e:migration-reviewer', '独立审核员')
  const adminHeaders = headers('catalog_admin', 'e2e:migration-admin', '迁移管理员')
  const legacyInput = (suffix) => ({
    skuCode: `LEGACY-PILOT-${suffix}`,
    chineseName: `迁移试运行零件 ${suffix}`,
    brand: 'Porsche', category: '保养件', subcategory: '滤清器', manufacturerPartNumber: '',
    primaryOe: `PILOT-OE-${suffix}`, unit: '件', lifecycleStatus: '在售', dataSource: '迁移隔离测试',
    sourceEvidence: { source: 'e2e', reference: suffix }, oeRelations: [], fitments: [],
  })
  const createLegacy = async (suffix) => {
    const response = await page.request.post('/api/v1/skus', { headers: editorHeaders, data: legacyInput(suffix) })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }
  const previewItem = async (code) => {
    const response = await page.request.get(`/api/v2/catalog/legacy-migration-preview?q=${encodeURIComponent(code)}`, { headers: editorHeaders })
    expect(response.ok()).toBeTruthy()
    return (await response.json()).items[0]
  }

  const staleLegacy = await createLegacy('STALE')
  const stalePreview = await previewItem(staleLegacy.skuCode)
  const stalePlanResponse = await page.request.post('/api/v2/catalog/legacy-migration-plans', { headers: editorHeaders, data: {
    reason: '验证来源变化会阻止批准', items: [{ legacySkuId: stalePreview.legacySkuId, sourceHash: stalePreview.sourceHash, decision: 'migrate', overrides: {} }],
  } })
  expect(stalePlanResponse.status()).toBe(201)
  const stalePlan = await stalePlanResponse.json()
  const changedLegacy = await page.request.put(`/api/v1/skus/${staleLegacy.id}`, { headers: adminHeaders, data: { ...legacyInput('STALE'), chineseName: '迁移试运行零件 STALE 已更新', version: staleLegacy.version } })
  expect(changedLegacy.ok()).toBeTruthy()
  const staleCheck = await (await page.request.get(`/api/v2/catalog/legacy-migration-plans/${stalePlan.id}/preflight`, { headers: reviewerHeaders })).json()
  expect(staleCheck.ready).toBe(false)
  expect(staleCheck.summary.changed).toBe(1)
  const staleApproval = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${stalePlan.id}/review`, { headers: reviewerHeaders, data: { expectedVersion: stalePlan.version, decision: 'approve' } })
  expect(staleApproval.status()).toBe(409)
  expect((await staleApproval.json()).error).toBe('LEGACY_MIGRATION_PREFLIGHT_FAILED')

  const first = await createLegacy('ATOMIC-A')
  const second = await createLegacy('ATOMIC-B')
  await createLegacy('PILOT-C')
  await createLegacy('PILOT-D')
  await createLegacy('PILOT-E')
  await createLegacy('PILOT-F')
  const firstPreview = await previewItem(first.skuCode)
  const secondPreview = await previewItem(second.skuCode)
  const plansBeforePilot = await (await page.request.get('/api/v2/catalog/legacy-migration-plans', { headers: editorHeaders })).json()
  const pilotResponse = await page.request.get('/api/v2/catalog/legacy-migration-pilot?size=5', { headers: editorHeaders })
  expect(pilotResponse.ok()).toBeTruthy()
  const pilot = await pilotResponse.json()
  expect(pilot.summary.selected).toBe(5)
  expect(pilot.summary.available).toBeGreaterThanOrEqual(5)
  expect(pilot.summary.estimatedMinutes).toBeGreaterThan(0)
  expect(pilot.items).toHaveLength(5)
  const plansAfterPilot = await (await page.request.get('/api/v2/catalog/legacy-migration-plans', { headers: editorHeaders })).json()
  expect(plansAfterPilot.total).toBe(plansBeforePilot.total)
  const planResponse = await page.request.post('/api/v2/catalog/legacy-migration-plans', { headers: editorHeaders, data: {
    reason: '首批真实流程隔离试运行',
    items: [firstPreview, secondPreview].map((item) => ({ legacySkuId: item.legacySkuId, sourceHash: item.sourceHash, decision: 'migrate', overrides: {} })),
  } })
  expect(planResponse.status()).toBe(201)
  const plan = await planResponse.json()
  const preflight = await (await page.request.get(`/api/v2/catalog/legacy-migration-plans/${plan.id}/preflight`, { headers: reviewerHeaders })).json()
  expect(preflight.ready).toBe(true)
  expect(preflight.summary.ready).toBe(2)
  const approvedResponse = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/review`, { headers: reviewerHeaders, data: { expectedVersion: plan.version, decision: 'approve', note: '来源与编号复核通过' } })
  expect(approvedResponse.ok()).toBeTruthy()
  const approved = await approvedResponse.json()
  const committedResponse = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/commit`, { headers: adminHeaders, data: { expectedVersion: approved.version } })
  expect(committedResponse.ok()).toBeTruthy()
  const committed = await committedResponse.json()
  expect(committed.state).toBe('committed')
  expect(committed.execution.summary).toEqual({ total: 2, migrated: 2, skipped: 0, failed: 0 })
  const persisted = await (await page.request.get(`/api/v2/catalog/legacy-migration-plans/${plan.id}`, { headers: adminHeaders })).json()
  expect(persisted.execution.summary.migrated).toBe(2)
  expect(persisted.execution.items).toHaveLength(2)
  const initialAcceptance = await (await page.request.get(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: reviewerHeaders })).json()
  expect(initialAcceptance.ready).toBe(false)
  expect(initialAcceptance.summary.needsAttention).toBe(2)
  const selfAcceptance = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: adminHeaders, data: { expectedVersion: committed.version, decision: 'accept' } })
  expect(selfAcceptance.status()).toBe(403)
  expect((await selfAcceptance.json()).error).toBe('LEGACY_MIGRATION_SELF_ACCEPTANCE_FORBIDDEN')
  const prematureAcceptance = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: reviewerHeaders, data: { expectedVersion: committed.version, decision: 'accept' } })
  expect(prematureAcceptance.status()).toBe(409)
  expect((await prematureAcceptance.json()).error).toBe('LEGACY_MIGRATION_ACCEPTANCE_FAILED')
  const changesRequiredResponse = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: reviewerHeaders, data: {
    expectedVersion: committed.version, decision: 'changes_required', note: '补齐车型平台并完成适配专项审核',
  } })
  expect(changesRequiredResponse.ok()).toBeTruthy()
  const changesRequired = await changesRequiredResponse.json()
  expect(changesRequired.acceptanceState).toBe('changes_required')

  const platformResponse = await page.request.post('/api/v2/catalog/vehicle-platforms', { headers: adminHeaders, data: {
    platformCode: 'PILOT-E2E', brandCode: 'POR', brandLabel: 'Porsche', seriesCode: 'PILOT', seriesLabel: '迁移试运行车型',
    yearFrom: 2018, yearTo: 2025, lifecycleStatus: 'active', sourceSystem: '迁移隔离测试', sourceReference: 'pilot-e2e-platform',
  } })
  expect(platformResponse.status()).toBe(201)
  for (const result of persisted.execution.items) {
    let catalogSku = await (await page.request.get(`/api/v2/catalog/skus/${result.catalogSkuId}`, { headers: adminHeaders })).json()
    expect(catalogSku.lifecycleStatus).toBe('draft')
    expect(catalogSku.verificationLevel).toBe('unverified')
    const completedResponse = await page.request.patch(`/api/v2/catalog/skus/${result.catalogSkuId}`, { headers: adminHeaders, data: {
      expectedVersion: catalogSku.version,
      identity: catalogSku.identity,
      evidence: catalogSku.evidence,
      identifiers: catalogSku.identifiers,
      fitments: [{ vehiclePlatformId: 'PILOT-E2E', vehicleLabel: 'Porsche 迁移试运行车型', years: '2018-2025', yearFrom: 2018, yearTo: 2025, evidenceId: catalogSku.evidence[0].id, includeConditions: { note: '按 OE 与车型平台复核' } }],
      interchanges: catalogSku.interchanges,
    } })
    expect(completedResponse.ok()).toBeTruthy()
    catalogSku = await completedResponse.json()
    const fitmentReviewResponse = await page.request.post(`/api/v2/catalog/fitments/${catalogSku.fitments[0].id}/review`, { headers: reviewerHeaders, data: {
      expectedSkuVersion: catalogSku.version, expectedReviewVersion: catalogSku.fitments[0].reviewVersion, decision: 'approve', note: 'OE、平台与年款范围一致',
    } })
    expect(fitmentReviewResponse.ok()).toBeTruthy()
    catalogSku = (await fitmentReviewResponse.json()).sku
    const submittedResponse = await page.request.post(`/api/v2/catalog/skus/${catalogSku.id}/transition`, { headers: editorHeaders, data: {
      action: 'submit_review', expectedVersion: catalogSku.version, assignee: '独立审核员',
    } })
    expect(submittedResponse.ok()).toBeTruthy()
    catalogSku = await submittedResponse.json()
    const verifiedResponse = await page.request.post(`/api/v2/catalog/skus/${catalogSku.id}/verify`, { headers: reviewerHeaders, data: {
      expectedVersion: catalogSku.version, note: '迁移资料与来源证据一致',
    } })
    expect(verifiedResponse.ok()).toBeTruthy()
  }
  const readyAcceptance = await (await page.request.get(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: reviewerHeaders })).json()
  expect(readyAcceptance.ready).toBe(true)
  expect(readyAcceptance.summary.verified).toBe(2)
  const acceptedResponse = await page.request.post(`/api/v2/catalog/legacy-migration-plans/${plan.id}/acceptance`, { headers: reviewerHeaders, data: {
    expectedVersion: changesRequired.version, decision: 'accept', note: '两条资料已完成适配与 SKU 独立审核',
  } })
  expect(acceptedResponse.ok()).toBeTruthy()
  const accepted = await acceptedResponse.json()
  expect(accepted.acceptanceState).toBe('accepted')
  expect(accepted.acceptance.ready).toBe(true)

  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '旧资料迁移' }).click()
  await page.getByRole('button', { name: /首批试运行/ }).click()
  await expect(page.getByText('首批候选组合')).toBeVisible()
  await expect(page.locator('.legacy-pilot-row')).toHaveCount(5)
  await expect(page.getByText('预计复核任务')).toBeVisible()
  await page.getByRole('button', { name: '采用这组候选' }).click()
  await expect(page.getByText(/方案内 5 条迁移/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: '方案说明' })).toHaveValue(/首批真实 SKU 试运行：5 条/)
  await page.getByRole('button', { name: /审批记录/ }).click()
  await page.getByRole('button', { name: /首批真实流程隔离试运行/ }).click()
  await expect(page.getByRole('heading', { name: '执行结果' })).toBeVisible()
  await expect(page.getByText('2生成草稿')).toBeVisible()
  await expect(page.getByRole('heading', { name: '迁移后验收' })).toBeVisible()
  await expect(page.getByText('已验收', { exact: true })).toBeVisible()
  await expect(page.getByText('2已达标')).toBeVisible()
})

test('collapses the navigation into a persistent icon rail', async ({ page }) => {
  const collapseButton = page.getByRole('button', { name: '收起导航' })
  await expect(collapseButton).toBeVisible()
  await collapseButton.click()

  await expect(page.locator('.workbench-home')).toHaveClass(/sidebar-collapsed/)
  await expect(page.getByRole('button', { name: '展开导航' })).toBeVisible()
  await expect.poll(async () => Math.round((await page.locator('.workbench-main').boundingBox()).x)).toBe(72)
  await capture(page, 'implementation-sidebar-collapsed-1680.png')

  await page.reload()
  await expect(page.locator('.workbench-home')).toHaveClass(/sidebar-collapsed/)
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await expect(page).toHaveURL(/#\/sku$/)
  await expect.poll(async () => Math.round((await page.locator('.sku-main').boundingBox()).x)).toBe(72)

  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(page.locator('.workbench-home')).not.toHaveClass(/sidebar-collapsed/)
})

test('connects customer vehicle, verified SKU and an idempotent quick quote', async ({ page }) => {
  const editorHeaders = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('快速报价员'), 'x-operator-id': 'quick-quote-e2e-1' }
  const warehouseResponse = await page.request.post('/api/v2/business/warehouses', { headers: editorHeaders, data: {
    warehouseCode: 'QQ-STOCK', name: '快速报价现货仓', address: '杭州市',
  } })
  expect(warehouseResponse.status()).toBe(201)
  const warehouse = await warehouseResponse.json()
  const verifiedList = await (await page.request.get('/api/v2/catalog/skus?status=verified&pageSize=20', { headers: editorHeaders })).json()
  let selectedSku = null
  for (const item of verifiedList.items) {
    const detail = await (await page.request.get(`/api/v2/catalog/skus/${item.id}`, { headers: editorHeaders })).json()
    if (detail.fitments.some((fitment) => fitment.verificationStatus === 'verified' && fitment.platformMasterId)) { selectedSku = detail; break }
  }
  expect(selectedSku).toBeTruthy()
  const selectedFitment = selectedSku.fitments.find((fitment) => fitment.verificationStatus === 'verified' && fitment.platformMasterId)
  const customerResponse = await page.request.post('/api/v2/business/quick-quote/customer-onboarding', { headers: editorHeaders, data: {
    requestKey: 'quick-quote-customer-e2e-0001',
    customer: { name: '快速报价闭环客户', phone: '13800000118', contactName: '陈师傅' },
    vehicle: { platformMasterId: selectedFitment.platformMasterId, vehicleLabel: selectedFitment.vehicleLabel, modelYear: selectedFitment.yearFrom || 2020, vin: 'WP1ZZZ95ZMLB11888' },
  } })
  expect(customerResponse.status()).toBe(201)
  const onboarding = await customerResponse.json()
  expect(onboarding.createdPartner).toBe(true)
  expect(onboarding.createdVehicle).toBe(true)
  expect(onboarding.matchedBy).toBe('created')
  const customer = onboarding.customer
  expect(customer.vehicles[0].platformMasterId).toBe(selectedFitment.platformMasterId)
  const repeatedOnboardingResponse = await page.request.post('/api/v2/business/quick-quote/customer-onboarding', { headers: editorHeaders, data: {
    requestKey: 'quick-quote-customer-e2e-0001', customer: { name: '不会覆盖原客户', phone: '13900000118' },
    vehicle: { platformMasterId: selectedFitment.platformMasterId, vin: 'WP1ZZZ95ZMLB11888' },
  } })
  expect(repeatedOnboardingResponse.status()).toBe(200)
  const repeatedOnboarding = await repeatedOnboardingResponse.json()
  expect(repeatedOnboarding.created).toBe(false)
  expect(repeatedOnboarding.customer.id).toBe(customer.id)
  expect(repeatedOnboarding.vehicle.id).toBe(customer.vehicles[0].id)
  const vinMatchedResponse = await page.request.post('/api/v2/business/quick-quote/customer-onboarding', { headers: editorHeaders, data: {
    requestKey: 'quick-quote-customer-e2e-0002', customer: { name: '重复车辆线索', phone: '13900000118' },
    vehicle: { platformMasterId: selectedFitment.platformMasterId, vin: 'WP1ZZZ95ZMLB11888' },
  } })
  expect(vinMatchedResponse.status()).toBe(201)
  const vinMatched = await vinMatchedResponse.json()
  expect(vinMatched.createdPartner).toBe(false)
  expect(vinMatched.createdVehicle).toBe(false)
  expect(vinMatched.matchedBy).toBe('vin')
  expect(vinMatched.customer.id).toBe(customer.id)
  const concurrentOnboardingPayloads = [
    { requestKey: 'quick-quote-customer-concurrent-1', customer: { name: '并发首次客户', phone: '13800000119' }, vehicle: { platformMasterId: selectedFitment.platformMasterId, vin: 'WP1ZZZ95ZMLB11889' } },
    { requestKey: 'quick-quote-customer-concurrent-2', customer: { name: '并发首次客户', phone: '13800000119' }, vehicle: { platformMasterId: selectedFitment.platformMasterId, vin: 'WP1ZZZ95ZMLB11890' } },
  ]
  const concurrentOnboardingResponses = await Promise.all(concurrentOnboardingPayloads.map((data) => page.request.post('/api/v2/business/quick-quote/customer-onboarding', { headers: editorHeaders, data })))
  expect(concurrentOnboardingResponses.every((response) => response.status() === 201)).toBeTruthy()
  const concurrentOnboardings = await Promise.all(concurrentOnboardingResponses.map((response) => response.json()))
  expect(new Set(concurrentOnboardings.map((item) => item.customer.id)).size).toBe(1)
  expect(concurrentOnboardings.filter((item) => item.createdPartner)).toHaveLength(1)
  expect(new Set(concurrentOnboardings.map((item) => item.vehicle.id)).size).toBe(2)
  const supplierResponse = await page.request.post('/api/v2/business/partners', { headers: editorHeaders, data: {
    partnerType: 'supplier', name: '快速报价采购供应商', phone: '057188801188',
    contacts: [{ name: '周经理', phone: '13700000118', isPrimary: true }],
  } })
  expect(supplierResponse.status()).toBe(201)
  const supplier = await supplierResponse.json()

  const contextResponse = await page.request.get(`/api/v2/business/quick-quote/context?customerId=${customer.id}&customerVehicleId=${customer.vehicles[0].id}&skuQuery=${encodeURIComponent(selectedSku.identity.skuCode)}`, { headers: editorHeaders })
  expect(contextResponse.ok()).toBeTruthy()
  const context = await contextResponse.json()
  expect(context.customer.id).toBe(customer.id)
  expect(context.selectedVehicle.platformMasterId).toBe(selectedFitment.platformMasterId)
  expect(context.skus[0].id).toBe(selectedSku.id)
  expect(context.skus[0].fitmentStatus).toBe('matched')
  expect(context.suppliers.map((item) => item.id)).toContain(supplier.id)
  expect(context.warehouses.map((item) => item.id)).toContain(warehouse.id)
  expect(context.skus[0].inventoryByWarehouse).toEqual([])

  const unavailableStockResponse = await page.request.post('/api/v2/business/quick-quotes', { headers: editorHeaders, data: {
    requestKey: 'quick-quote-stock-unavailable', customerPartnerId: customer.id, customerVehicleId: customer.vehicles[0].id,
    items: [{ catalogSkuId: selectedSku.id, quantity: 1, saleUnitPrice: 888, costUnitPrice: 600, fulfillmentSource: 'stock', fulfillmentWarehouseId: warehouse.id }],
  } })
  expect(unavailableStockResponse.status()).toBe(409)
  expect((await unavailableStockResponse.json()).error).toBe('QUICK_QUOTE_STOCK_INSUFFICIENT')

  const payload = {
    requestKey: 'quick-quote-e2e-0001', customerPartnerId: customer.id, customerVehicleId: customer.vehicles[0].id,
    validUntil: '2026-10-31', note: '车型、OE 与 SKU 已复核',
    items: [{ catalogSkuId: selectedSku.id, quantity: 2, saleUnitPrice: 888, costUnitPrice: 600, fulfillmentSource: 'purchase', supplierPartnerId: supplier.id, leadTimeDays: 2 }],
  }
  const quickResponse = await page.request.post('/api/v2/business/quick-quotes', { headers: editorHeaders, data: payload })
  expect(quickResponse.status()).toBe(201)
  const quick = await quickResponse.json()
  expect(quick.created).toBe(true)
  expect(quick.inquiry.customerPartnerId).toBe(customer.id)
  expect(quick.inquiry.customerVehicleId).toBe(customer.vehicles[0].id)
  expect(quick.inquiry.vehiclePlatformId).toBe(selectedFitment.platformMasterId)
  expect(quick.inquiry.items[0].catalogSkuId).toBe(selectedSku.id)
  expect(quick.inquiry.items[0].skuCodeSnapshot).toBe(selectedSku.identity.skuCode)
  expect(quick.inquiry.items[0].fitmentSnapshot.fitmentId).toBe(selectedFitment.id)
  expect(quick.inquiry.quotes[0].creationMode).toBe('quick')
  expect(quick.inquiry.quotes[0].totalAmount).toBe(1776)
  expect(quick.inquiry.quotes[0].items[0].catalogSkuVersion).toBe(selectedSku.version)
  expect(quick.inquiry.quotes[0].items[0].fulfillmentSource).toBe('purchase')
  expect(quick.inquiry.quotes[0].items[0].supplierOfferId).toBeTruthy()

  const repeatedResponse = await page.request.post('/api/v2/business/quick-quotes', { headers: editorHeaders, data: { ...payload, items: [{ ...payload.items[0], saleUnitPrice: 999 }] } })
  expect(repeatedResponse.status()).toBe(200)
  const repeated = await repeatedResponse.json()
  expect(repeated.created).toBe(false)
  expect(repeated.quoteId).toBe(quick.quoteId)
  expect(repeated.inquiry.quotes[0].totalAmount).toBe(1776)

  const concurrentPayload = { ...payload, requestKey: 'quick-quote-e2e-0002' }
  const concurrentResponses = await Promise.all([
    page.request.post('/api/v2/business/quick-quotes', { headers: editorHeaders, data: concurrentPayload }),
    page.request.post('/api/v2/business/quick-quotes', { headers: editorHeaders, data: concurrentPayload }),
  ])
  expect(concurrentResponses.map((response) => response.status()).sort()).toEqual([200, 201])
  const concurrentResults = await Promise.all(concurrentResponses.map((response) => response.json()))
  expect(new Set(concurrentResults.map((result) => result.quoteId)).size).toBe(1)

  let orderInquiry = quick.inquiry
  const sentResponse = await page.request.post(`/api/v2/business/quotes/${orderInquiry.quotes[0].id}/send`, { headers: editorHeaders, data: {
    expectedRevision: orderInquiry.quotes[0].revision, nextAction: '等待客户确认快速报价',
  } })
  expect(sentResponse.ok()).toBeTruthy()
  orderInquiry = await sentResponse.json()
  const wonResponse = await page.request.post(`/api/v2/business/inquiries/${orderInquiry.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: orderInquiry.version, status: 'won', note: '客户接受快速报价',
  } })
  expect(wonResponse.ok()).toBeTruthy()
  orderInquiry = await wonResponse.json()
  const conversionResponse = await page.request.post(`/api/v2/business/inquiries/${orderInquiry.id}/convert-order`, { headers: editorHeaders })
  expect(conversionResponse.status()).toBe(201)
  const conversion = await conversionResponse.json()
  expect(conversion.salesOrder.items[0].fulfillmentSource).toBe('purchase')
  expect(conversion.purchaseOrders).toHaveLength(1)
  expect(conversion.purchaseOrders[0].supplierPartnerId).toBe(supplier.id)
  expect(conversion.salesOrder.receivable.status).toBe('open')
  const depositResponse = await page.request.post(`/api/v2/business/receivables/${conversion.salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: {
    requestKey: 'quick-quote-deposit-e2e', amount: 100, paymentMethod: 'wechat', note: '客户订金',
  } })
  expect(depositResponse.status()).toBe(201)
  const cancelPaidOrderResponse = await page.request.post(`/api/v2/business/sales-orders/${conversion.salesOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: conversion.salesOrder.version, status: 'cancelled', note: '不应越过退款处理',
  } })
  expect(cancelPaidOrderResponse.status()).toBe(409)
  expect((await cancelPaidOrderResponse.json()).error).toBe('RECEIVABLE_HAS_PAYMENTS')
})

test('runs an inquiry through purchasing, inventory reservation and shipment', async ({ page }) => {
  const editorHeaders = { 'x-operator-role': 'catalog_editor', 'x-operator-name': encodeURIComponent('业务员甲'), 'x-operator-id': 'sales-e2e-1' }
  const afterSalesReviewerHeaders = { 'x-operator-role': 'catalog_reviewer', 'x-operator-name': encodeURIComponent('独立售后审核员'), 'x-operator-id': 'after-sales-reviewer-e2e-1' }
  const warehouseResponse = await page.request.post('/api/v2/business/warehouses', { headers: editorHeaders, data: {
    warehouseCode: 'HZ-MAIN', name: '杭州主仓', address: '杭州市余杭区', isDefault: true,
  } })
  expect(warehouseResponse.status()).toBe(201)
  const warehouse = await warehouseResponse.json()
  expect(warehouse.warehouseCode).toBe('HZ-MAIN')
  expect(warehouse.isDefault).toBe(true)
  const customerResponse = await page.request.post('/api/v2/business/partners', { headers: editorHeaders, data: {
    partnerType: 'customer', name: '业务闭环测试汽修', shortName: '闭环汽修', phone: '13800000001', paymentTermsDays: 15, creditLimit: 20000,
    contacts: [{ name: '王师傅', roleTitle: '店长', phone: '13800000001', wechat: 'wang-master', isPrimary: true }],
    vehicles: [{ vehicleLabel: 'Porsche Cayenne (95B)', vin: 'WP1AA29P39LA12345', licensePlate: '浙A12345', platformCode: '95B', engineCode: 'CGEA', modelYear: 2019 }],
  } })
  expect(customerResponse.status()).toBe(201)
  let customer = await customerResponse.json()
  expect(customer.contacts[0].isPrimary).toBe(true)
  expect(customer.vehicles[0].vin).toBe('WP1AA29P39LA12345')

  const addedContactResponse = await page.request.post(`/api/v2/business/partners/${customer.id}/contacts`, { headers: editorHeaders, data: {
    expectedPartnerVersion: customer.version, name: '小王', roleTitle: '采购', phone: '13800000002', isPrimary: false,
  } })
  expect(addedContactResponse.status()).toBe(201)
  customer = await addedContactResponse.json()
  const updatedVehicleResponse = await page.request.patch(`/api/v2/business/partners/${customer.id}/vehicles/${customer.vehicles[0].id}`, { headers: editorHeaders, data: {
    expectedPartnerVersion: customer.version, expectedVersion: customer.vehicles[0].version, vehicleLabel: customer.vehicles[0].vehicleLabel,
    vin: customer.vehicles[0].vin, licensePlate: '浙A54321', platformCode: '95B', engineCode: 'CGEA', modelYear: 2019,
  } })
  expect(updatedVehicleResponse.ok()).toBeTruthy()
  customer = await updatedVehicleResponse.json()
  const updatedCustomerResponse = await page.request.patch(`/api/v2/business/partners/${customer.id}`, { headers: editorHeaders, data: { expectedVersion: customer.version, address: '杭州市西湖区' } })
  expect(updatedCustomerResponse.ok()).toBeTruthy()
  customer = await updatedCustomerResponse.json()
  const staleCustomerResponse = await page.request.patch(`/api/v2/business/partners/${customer.id}`, { headers: editorHeaders, data: { expectedVersion: 1, address: '不应覆盖' } })
  expect(staleCustomerResponse.status()).toBe(409)
  expect((await staleCustomerResponse.json()).error).toBe('PARTNER_VERSION_CONFLICT')

  const supplierResponse = await page.request.post('/api/v2/business/partners', { headers: editorHeaders, data: {
    partnerType: 'supplier', name: '华东供应商', phone: '057188888888', paymentTermsDays: 30,
    contacts: [{ name: '李经理', roleTitle: '销售', phone: '13900000001', isPrimary: true }],
  } })
  expect(supplierResponse.status()).toBe(201)
  const supplier = await supplierResponse.json()
  const customerSearchResponse = await page.request.get('/api/v2/business/partners?q=WP1AA29P39LA12345&type=customer', { headers: editorHeaders })
  expect(customerSearchResponse.ok()).toBeTruthy()
  expect((await customerSearchResponse.json()).items[0].id).toBe(customer.id)

  const createdResponse = await page.request.post('/api/v2/business/inquiries', { headers: editorHeaders, data: {
    customerPartnerId: customer.id, customerVehicleId: customer.vehicles[0].id, channel: 'phone',
    priority: 'high', nextAction: '核对 OE 并向供应商询价',
    items: [
      { requirementText: '前刹车片', oeNumber: '95B 698 151 H', requestedQuantity: 2, unit: '套', targetBrand: 'Porsche' },
      { requirementText: '前制动盘', oeNumber: '95B 615 301 G', requestedQuantity: 1, unit: '对', targetBrand: 'Porsche' },
    ],
  } })
  expect(createdResponse.status()).toBe(201)
  let inquiry = await createdResponse.json()
  expect(inquiry.status).toBe('new')
  expect(inquiry.items).toHaveLength(2)
  expect(inquiry.customerPartnerId).toBe(customer.id)
  expect(inquiry.customerVehicleId).toBe(customer.vehicles[0].id)
  expect(inquiry.customerName).toBe('业务闭环测试汽修')
  expect(inquiry.contactName).toBe('王师傅')
  expect(inquiry.contactPhone).toBe('13800000001')
  expect(inquiry.vin).toBe('WP1AA29P39LA12345')

  const firstOfferResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/items/${inquiry.items[0].id}/offers`, { headers: editorHeaders, data: {
    supplierPartnerId: supplier.id, brandLabel: 'Porsche', unitPrice: 600, availability: 'in_stock', leadTimeDays: 1, selected: true,
  } })
  expect(firstOfferResponse.status()).toBe(201)
  inquiry = await firstOfferResponse.json()
  expect(inquiry.status).toBe('sourcing')
  expect(inquiry.items[0].offers[0].supplierPartnerId).toBe(supplier.id)
  expect(inquiry.items[0].offers[0].supplierName).toBe('华东供应商')
  const secondOfferResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/items/${inquiry.items[1].id}/offers`, { headers: editorHeaders, data: {
    supplierPartnerId: supplier.id, brandLabel: 'Porsche', unitPrice: 1200, availability: 'ordered', leadTimeDays: 2, selected: true,
  } })
  expect(secondOfferResponse.status()).toBe(201)
  inquiry = await secondOfferResponse.json()

  const quoteResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/quotes`, { headers: editorHeaders, data: {
    discountAmount: 60, freightAmount: 100, note: '含税报价，VIN 复核后订货',
    items: [
      { inquiryItemId: inquiry.items[0].id, supplierOfferId: inquiry.items[0].offers[0].id, saleUnitPrice: 780 },
      { inquiryItemId: inquiry.items[1].id, supplierOfferId: inquiry.items[1].offers[0].id, saleUnitPrice: 1600 },
    ],
  } })
  expect(quoteResponse.status()).toBe(201)
  inquiry = await quoteResponse.json()
  expect(inquiry.status).toBe('quoting')
  expect(inquiry.quotes[0].totalAmount).toBe(3200)
  expect(inquiry.quotes[0].marginAmount).toBe(700)

  const sentResponse = await page.request.post(`/api/v2/business/quotes/${inquiry.quotes[0].id}/send`, { headers: editorHeaders, data: {
    expectedRevision: 1, nextAction: '明天下午回访客户', note: '已通过微信发送报价',
  } })
  expect(sentResponse.ok()).toBeTruthy()
  inquiry = await sentResponse.json()
  expect(inquiry.status).toBe('quoted')
  expect(inquiry.quotes[0].state).toBe('sent')

  const followUpResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: inquiry.version, status: 'follow_up', nextAction: '确认客户到店时间', note: '客户已读，等待确认',
  } })
  expect(followUpResponse.ok()).toBeTruthy()
  inquiry = await followUpResponse.json()
  const wonResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: inquiry.version, status: 'won', note: '客户确认采购',
  } })
  expect(wonResponse.ok()).toBeTruthy()
  inquiry = await wonResponse.json()
  expect(inquiry.status).toBe('won')
  expect(inquiry.quotes[0].state).toBe('accepted')
  expect(inquiry.events.map((event) => event.action)).toEqual(expect.arrayContaining(['created', 'supplier_offer_added', 'quote_created', 'quote_sent', 'status_changed']))

  const convertResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/convert-order`, { headers: editorHeaders })
  expect(convertResponse.status()).toBe(201)
  const conversion = await convertResponse.json()
  expect(conversion.created).toBe(true)
  expect(conversion.salesOrder.status).toBe('draft')
  expect(conversion.salesOrder.totalAmount).toBe(3200)
  expect(conversion.salesOrder.items).toHaveLength(2)
  expect(conversion.purchaseOrders).toHaveLength(1)
  expect(conversion.purchaseOrders[0].supplierPartnerId).toBe(supplier.id)
  expect(conversion.purchaseOrders[0].subtotal).toBe(2400)
  expect(conversion.purchaseOrders[0].items).toHaveLength(2)

  const repeatedConvertResponse = await page.request.post(`/api/v2/business/inquiries/${inquiry.id}/convert-order`, { headers: editorHeaders })
  expect(repeatedConvertResponse.status()).toBe(200)
  const repeatedConversion = await repeatedConvertResponse.json()
  expect(repeatedConversion.created).toBe(false)
  expect(repeatedConversion.salesOrder.id).toBe(conversion.salesOrder.id)
  expect(repeatedConversion.purchaseOrders.map((order) => order.id)).toEqual(conversion.purchaseOrders.map((order) => order.id))

  let salesOrder = conversion.salesOrder
  const confirmedSalesResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: salesOrder.version, status: 'confirmed', note: '客户订单复核完成',
  } })
  expect(confirmedSalesResponse.ok()).toBeTruthy()
  salesOrder = await confirmedSalesResponse.json()
  expect(salesOrder.status).toBe('confirmed')

  let purchaseOrder = conversion.purchaseOrders[0]
  const submittedPurchaseResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: purchaseOrder.version, status: 'submitted', note: '采购单已发送供应商',
  } })
  expect(submittedPurchaseResponse.ok()).toBeTruthy()
  purchaseOrder = await submittedPurchaseResponse.json()
  const confirmedPurchaseResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: purchaseOrder.version, status: 'confirmed', note: '供应商已确认供货',
  } })
  expect(confirmedPurchaseResponse.ok()).toBeTruthy()
  purchaseOrder = await confirmedPurchaseResponse.json()

  const firstReceiptResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/receipts`, { headers: editorHeaders, data: {
    requestKey: 'e2e-receipt-first', warehouseId: warehouse.id, expectedVersion: purchaseOrder.version,
    items: [{ itemId: purchaseOrder.items[0].id, quantity: 1 }], note: '首批到货',
  } })
  expect(firstReceiptResponse.status()).toBe(201)
  const firstReceipt = await firstReceiptResponse.json()
  expect(firstReceipt.created).toBe(true)
  expect(firstReceipt.receipt.warehouseId).toBe(warehouse.id)
  expect(firstReceipt.receipt.items[0].receivedQuantity).toBe(1)
  expect(firstReceipt.receipt.stockReservationIds).toHaveLength(1)
  expect(firstReceipt.receipt.autoReservedQuantity).toBe(1)
  purchaseOrder = await (await page.request.get(`/api/v2/business/purchase-orders/${purchaseOrder.id}`, { headers: editorHeaders })).json()
  expect(purchaseOrder.status).toBe('partially_received')
  expect(purchaseOrder.items[0].receivedQuantity).toBe(1)
  expect(purchaseOrder.items[0].remainingQuantity).toBe(1)

  const overReceiptResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/receipts`, { headers: editorHeaders, data: {
    requestKey: 'e2e-receipt-over', warehouseId: warehouse.id, expectedVersion: purchaseOrder.version,
    items: [{ itemId: purchaseOrder.items[0].id, quantity: 2 }],
  } })
  expect(overReceiptResponse.status()).toBe(409)
  expect((await overReceiptResponse.json()).error).toBe('RECEIPT_EXCEEDS_ORDERED_QUANTITY')

  const finalReceiptResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/receipts`, { headers: editorHeaders, data: {
    requestKey: 'e2e-receipt-final', warehouseId: warehouse.id, expectedVersion: purchaseOrder.version,
    items: [
      { itemId: purchaseOrder.items[0].id, quantity: 1 },
      { itemId: purchaseOrder.items[1].id, quantity: 1 },
    ],
    note: '全部到货并核对数量',
  } })
  expect(finalReceiptResponse.status()).toBe(201)
  const finalReceipt = await finalReceiptResponse.json()
  expect(finalReceipt.receipt.items).toHaveLength(2)
  expect(finalReceipt.receipt.stockReservationIds).toEqual(firstReceipt.receipt.stockReservationIds)
  expect(finalReceipt.receipt.autoReservedQuantity).toBe(2)
  const repeatedReceiptResponse = await page.request.post(`/api/v2/business/purchase-orders/${purchaseOrder.id}/receipts`, { headers: editorHeaders, data: {
    requestKey: 'e2e-receipt-final', warehouseId: warehouse.id, expectedVersion: purchaseOrder.version,
    items: [{ itemId: purchaseOrder.items[0].id, quantity: 1 }],
  } })
  expect(repeatedReceiptResponse.status()).toBe(200)
  expect((await repeatedReceiptResponse.json()).receipt.id).toBe(finalReceipt.receipt.id)
  purchaseOrder = await (await page.request.get(`/api/v2/business/purchase-orders/${purchaseOrder.id}`, { headers: editorHeaders })).json()
  expect(purchaseOrder.status).toBe('received')
  expect(purchaseOrder.items.every((item) => item.receivedQuantity === item.quantity)).toBeTruthy()

  const stockedBalancesResponse = await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })
  expect(stockedBalancesResponse.ok()).toBeTruthy()
  const stockedBalances = await stockedBalancesResponse.json()
  expect(stockedBalances.items).toHaveLength(2)
  expect(stockedBalances.items.reduce((sum, item) => sum + item.onHandQuantity, 0)).toBe(3)
  expect(stockedBalances.items.reduce((sum, item) => sum + item.reservedQuantity, 0)).toBe(3)
  salesOrder = await (await page.request.get(`/api/v2/business/sales-orders/${salesOrder.id}`, { headers: editorHeaders })).json()
  expect(salesOrder.stockReservations).toHaveLength(1)
  expect(salesOrder.stockReservations[0].id).toBe(firstReceipt.receipt.stockReservationIds[0])
  expect(salesOrder.stockReservations[0].status).toBe('active')
  expect(salesOrder.events.map((event) => event.action)).toContain('purchase_receipt_auto_reserved')
  const receiptReservation = await (await page.request.get(`/api/v2/business/reservations/${salesOrder.stockReservations[0].id}`, { headers: editorHeaders })).json()
  expect(receiptReservation.items).toHaveLength(2)
  expect(receiptReservation.items.reduce((sum, item) => sum + item.reservedQuantity, 0)).toBe(3)
  const releaseReceiptReservationResponse = await page.request.post(`/api/v2/business/reservations/${receiptReservation.id}/release`, { headers: editorHeaders, data: {
    expectedVersion: receiptReservation.version, note: '释放采购专属锁定以继续并发库存回归',
  } })
  expect(releaseReceiptReservationResponse.ok()).toBeTruthy()
  const balancesAfterReceiptRelease = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(balancesAfterReceiptRelease.items.every((item) => item.reservedQuantity === 0)).toBeTruthy()

  const stockInquiryResponse = await page.request.post('/api/v2/business/inquiries', { headers: editorHeaders, data: {
    customerPartnerId: customer.id, customerVehicleId: customer.vehicles[0].id,
    items: [{ requirementText: '前刹车片现货复购', oeNumber: '95B 698 151 H', requestedQuantity: 1, unit: '套' }],
  } })
  expect(stockInquiryResponse.status()).toBe(201)
  let stockInquiry = await stockInquiryResponse.json()
  const stockQuoteResponse = await page.request.post(`/api/v2/business/inquiries/${stockInquiry.id}/quotes`, { headers: editorHeaders, data: {
    items: [{ inquiryItemId: stockInquiry.items[0].id, fulfillmentSource: 'stock', fulfillmentWarehouseId: warehouse.id, costUnitPrice: 600, saleUnitPrice: 820 }],
  } })
  expect(stockQuoteResponse.status()).toBe(201)
  stockInquiry = await stockQuoteResponse.json()
  expect(stockInquiry.quotes[0].items[0].fulfillmentSource).toBe('stock')
  const sentStockQuoteResponse = await page.request.post(`/api/v2/business/quotes/${stockInquiry.quotes[0].id}/send`, { headers: editorHeaders, data: { expectedRevision: stockInquiry.quotes[0].revision } })
  expect(sentStockQuoteResponse.ok()).toBeTruthy()
  stockInquiry = await sentStockQuoteResponse.json()
  const wonStockInquiryResponse = await page.request.post(`/api/v2/business/inquiries/${stockInquiry.id}/transition`, { headers: editorHeaders, data: { expectedVersion: stockInquiry.version, status: 'won' } })
  expect(wonStockInquiryResponse.ok()).toBeTruthy()
  stockInquiry = await wonStockInquiryResponse.json()
  const refreshedSalesResponse = await page.request.get(`/api/v2/business/sales-orders/${salesOrder.id}`, { headers: editorHeaders })
  expect(refreshedSalesResponse.ok()).toBeTruthy()
  salesOrder = await refreshedSalesResponse.json()
  expect(salesOrder.status).toBe('fulfilling')
  expect(salesOrder.receivedPurchaseOrderCount).toBe(1)
  expect(salesOrder.events.map((event) => event.action)).toEqual(expect.arrayContaining(['created_from_inquiry', 'status_changed', 'purchasing_completed']))

  const prematureCompletionResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: salesOrder.version, status: 'completed', note: '客户交付完成',
  } })
  expect(prematureCompletionResponse.status()).toBe(409)
  expect((await prematureCompletionResponse.json()).error).toBe('SALES_ORDER_NOT_FULLY_SHIPPED')

  const emptyWarehouseResponse = await page.request.post('/api/v2/business/warehouses', { headers: editorHeaders, data: {
    warehouseCode: 'HZ-EMPTY', name: '杭州空仓', address: '杭州市',
  } })
  expect(emptyWarehouseResponse.status()).toBe(201)
  const emptyWarehouse = await emptyWarehouseResponse.json()
  const insufficientReservationResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/reservations`, { headers: editorHeaders, data: {
    warehouseId: emptyWarehouse.id, items: [{ itemId: salesOrder.items[0].id, quantity: 1 }],
  } })
  expect(insufficientReservationResponse.status()).toBe(409)
  expect((await insufficientReservationResponse.json()).error).toBe('INSUFFICIENT_AVAILABLE_STOCK')

  const reservationResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/reservations`, { headers: editorHeaders, data: {
    warehouseId: warehouse.id,
    items: [{ itemId: salesOrder.items[0].id, quantity: salesOrder.items[0].quantity }],
    note: '先锁定第一项库存',
  } })
  expect(reservationResponse.status()).toBe(201)
  let reservation = (await reservationResponse.json()).reservation
  expect(reservation.status).toBe('active')
  expect(reservation.items).toHaveLength(1)
  expect(reservation.items.every((item) => item.shortageQuantity === 0)).toBeTruthy()
  const extendedReservationResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/reservations`, { headers: editorHeaders, data: {
    warehouseId: warehouse.id, items: [{ itemId: salesOrder.items[1].id, quantity: salesOrder.items[1].quantity }], note: '补充锁定第二项库存',
  } })
  expect(extendedReservationResponse.status()).toBe(200)
  const extendedReservationResult = await extendedReservationResponse.json()
  expect(extendedReservationResult.extended).toBe(true)
  reservation = extendedReservationResult.reservation
  expect(reservation.items).toHaveLength(2)
  expect(reservation.items.reduce((sum, item) => sum + item.reservedQuantity, 0)).toBe(3)
  const repeatedReservationResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/reservations`, { headers: editorHeaders, data: {
    warehouseId: warehouse.id, items: [{ itemId: salesOrder.items[0].id, quantity: salesOrder.items[0].quantity }],
  } })
  expect(repeatedReservationResponse.status()).toBe(200)
  expect((await repeatedReservationResponse.json()).reservation.id).toBe(reservation.id)

  const changedStockConversionResponse = await page.request.post(`/api/v2/business/inquiries/${stockInquiry.id}/convert-order`, { headers: editorHeaders })
  expect(changedStockConversionResponse.status()).toBe(409)
  const changedStockConversionError = await changedStockConversionResponse.json()
  expect(changedStockConversionError.error).toBe('ORDER_STOCK_CHANGED')
  expect(changedStockConversionError.details.fulfillmentWarehouseId).toBe(warehouse.id)

  const releasedReservationResponse = await page.request.post(`/api/v2/business/reservations/${reservation.id}/release`, { headers: editorHeaders, data: {
    expectedVersion: reservation.version, note: '演练释放后重新锁定',
  } })
  expect(releasedReservationResponse.ok()).toBeTruthy()
  expect((await releasedReservationResponse.json()).status).toBe('released')
  const balancesAfterRelease = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(balancesAfterRelease.items.every((item) => item.reservedQuantity === 0 && item.availableQuantity === item.onHandQuantity)).toBeTruthy()
  const stockConversionResponse = await page.request.post(`/api/v2/business/inquiries/${stockInquiry.id}/convert-order`, { headers: editorHeaders })
  expect(stockConversionResponse.status()).toBe(201)
  const stockConversion = await stockConversionResponse.json()
  expect(stockConversion.salesOrder.items[0].fulfillmentSource).toBe('stock')
  expect(stockConversion.salesOrder.items[0].fulfillmentWarehouseId).toBe(warehouse.id)
  expect(stockConversion.purchaseOrders).toHaveLength(0)
  expect(stockConversion.stockReservationIds).toHaveLength(1)
  expect(stockConversion.salesOrder.stockReservations).toHaveLength(1)
  expect(stockConversion.salesOrder.stockReservations[0].status).toBe('active')
  expect(stockConversion.salesOrder.events[0].snapshot.stockItemCount).toBe(1)
  const balancesAfterAtomicReservation = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(balancesAfterAtomicReservation.items.find((item) => item.oeNumber === '95B 698 151 H').reservedQuantity).toBe(1)
  const cancelledStockOrderResponse = await page.request.post(`/api/v2/business/sales-orders/${stockConversion.salesOrder.id}/transition`, { headers: editorHeaders, data: {
    expectedVersion: stockConversion.salesOrder.version, status: 'cancelled', note: '验证取消订单自动释放锁定',
  } })
  expect(cancelledStockOrderResponse.ok()).toBeTruthy()
  const cancelledStockOrder = await cancelledStockOrderResponse.json()
  expect(cancelledStockOrder.status).toBe('cancelled')
  expect(cancelledStockOrder.receivable.status).toBe('void')
  expect(cancelledStockOrder.stockReservations[0].status).toBe('released')
  expect(cancelledStockOrder.events.map((event) => event.action)).toContain('stock_reservations_released')
  const balancesAfterAutomaticRelease = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(balancesAfterAutomaticRelease.items.every((item) => item.reservedQuantity === 0)).toBeTruthy()
  const replacementReservationResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/reservations`, { headers: editorHeaders, data: {
    warehouseId: warehouse.id,
    items: salesOrder.items.map((item) => ({ itemId: item.id, quantity: item.quantity })),
    note: '正式锁定客户订单库存',
  } })
  expect(replacementReservationResponse.status()).toBe(201)
  reservation = (await replacementReservationResponse.json()).reservation

  const firstSalesItem = salesOrder.items.find((item) => item.quantity === 2)
  const secondSalesItem = salesOrder.items.find((item) => item.quantity === 1)
  const firstShipmentResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/shipments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-shipment-first', reservationId: reservation.id, expectedReservationVersion: reservation.version,
    items: [{ itemId: firstSalesItem.id, quantity: 1 }], note: '首批交付客户',
  } })
  expect(firstShipmentResponse.status()).toBe(201)
  const firstShipment = await firstShipmentResponse.json()
  expect(firstShipment.shipment.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(1)
  reservation = await (await page.request.get(`/api/v2/business/reservations/${reservation.id}`, { headers: editorHeaders })).json()
  expect(reservation.status).toBe('active')
  expect(reservation.version).toBe(2)

  const repeatedShipmentResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/shipments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-shipment-first', reservationId: reservation.id, expectedReservationVersion: reservation.version,
    items: [{ itemId: firstSalesItem.id, quantity: 1 }],
  } })
  expect(repeatedShipmentResponse.status()).toBe(200)
  expect((await repeatedShipmentResponse.json()).shipment.id).toBe(firstShipment.shipment.id)

  const overShipmentResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/shipments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-shipment-over', reservationId: reservation.id, expectedReservationVersion: reservation.version,
    items: [{ itemId: firstSalesItem.id, quantity: 2 }],
  } })
  expect(overShipmentResponse.status()).toBe(409)
  expect((await overShipmentResponse.json()).error).toBe('SHIPMENT_EXCEEDS_RESERVED_QUANTITY')

  const finalShipmentResponse = await page.request.post(`/api/v2/business/sales-orders/${salesOrder.id}/shipments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-shipment-final', reservationId: reservation.id, expectedReservationVersion: reservation.version,
    items: [{ itemId: firstSalesItem.id, quantity: 1 }, { itemId: secondSalesItem.id, quantity: 1 }], note: '全部交付完成',
  } })
  expect(finalShipmentResponse.status()).toBe(201)
  reservation = await (await page.request.get(`/api/v2/business/reservations/${reservation.id}`, { headers: editorHeaders })).json()
  expect(reservation.status).toBe('fulfilled')
  salesOrder = await (await page.request.get(`/api/v2/business/sales-orders/${salesOrder.id}`, { headers: editorHeaders })).json()
  expect(salesOrder.status).toBe('completed')
  expect(salesOrder.events.map((event) => event.action)).toContain('shipment_completed')

  const depletedBalances = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(depletedBalances.items.every((item) => item.onHandQuantity === 0 && item.reservedQuantity === 0 && item.availableQuantity === 0)).toBeTruthy()
  const movements = await (await page.request.get(`/api/v2/business/inventory-movements?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(movements.items.map((item) => item.movementType)).toEqual(expect.arrayContaining(['receipt', 'reserve', 'release', 'ship']))
  for (const balance of depletedBalances.items) {
    const itemMovements = movements.items.filter((movement) => movement.stockKey === balance.stockKey)
    expect(itemMovements.reduce((sum, movement) => sum + movement.onHandDelta, 0)).toBe(balance.onHandQuantity)
    expect(itemMovements.reduce((sum, movement) => sum + movement.reservedDelta, 0)).toBe(balance.reservedQuantity)
  }

  const salesListResponse = await page.request.get('/api/v2/business/sales-orders?status=completed', { headers: editorHeaders })
  expect(salesListResponse.ok()).toBeTruthy()
  expect((await salesListResponse.json()).items.map((order) => order.id)).toContain(salesOrder.id)
  const purchaseListResponse = await page.request.get(`/api/v2/business/purchase-orders?status=received&supplierPartnerId=${supplier.id}`, { headers: editorHeaders })
  expect(purchaseListResponse.ok()).toBeTruthy()
  expect((await purchaseListResponse.json()).items.map((order) => order.id)).toContain(purchaseOrder.id)

  expect(salesOrder.receivable.originalAmount).toBe(3200)
  expect(salesOrder.receivable.status).toBe('open')
  const partialPaymentResponse = await page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-payment-first', amount: 1000, paymentMethod: 'bank_transfer', referenceNo: 'BANK-20261003-001', note: '客户首笔转账',
  } })
  expect(partialPaymentResponse.status()).toBe(201)
  const partialPayment = await partialPaymentResponse.json()
  expect(partialPayment.receivable.status).toBe('partial')
  expect(partialPayment.receivable.paidAmount).toBe(1000)
  expect(partialPayment.receivable.outstandingAmount).toBe(2200)
  const repeatedPaymentResponse = await page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-payment-first', amount: 9999, paymentMethod: 'cash',
  } })
  expect(repeatedPaymentResponse.status()).toBe(200)
  expect((await repeatedPaymentResponse.json()).receivable.paidAmount).toBe(1000)
  const finalPaymentPayload = { requestKey: 'e2e-payment-final', amount: 2200, paymentMethod: 'wechat', note: '客户结清尾款' }
  const concurrentPaymentResponses = await Promise.all([
    page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: finalPaymentPayload }),
    page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: finalPaymentPayload }),
  ])
  expect(concurrentPaymentResponses.map((response) => response.status()).sort()).toEqual([200, 201])
  const finalReceivable = await (await page.request.get(`/api/v2/business/receivables/${salesOrder.receivable.id}`, { headers: editorHeaders })).json()
  expect(finalReceivable.status).toBe('paid')
  expect(finalReceivable.paidAmount).toBe(3200)
  expect(finalReceivable.outstandingAmount).toBe(0)
  expect(finalReceivable.payments).toHaveLength(2)
  const overpaymentResponse = await page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: {
    requestKey: 'e2e-payment-over', amount: 1, paymentMethod: 'cash',
  } })
  expect(overpaymentResponse.status()).toBe(409)
  expect((await overpaymentResponse.json()).error).toBe('PAYMENT_EXCEEDS_OUTSTANDING')
  const receivableList = await (await page.request.get(`/api/v2/business/receivables?customerPartnerId=${customer.id}`, { headers: editorHeaders })).json()
  expect(receivableList.items.map((item) => item.id)).toContain(finalReceivable.id)

  const returnedShipmentItem = firstShipment.shipment.items[0]
  const afterSalesPayload = {
    requestKey: 'e2e-after-sales-first', salesOrderId: salesOrder.id, reasonCode: 'fitment_issue',
    description: '装车复核发现版本不适配，客户退回首批刹车片',
    items: [{ shipmentItemId: returnedShipmentItem.id, quantity: 1 }],
  }
  const afterSalesResponse = await page.request.post('/api/v2/business/after-sales', { headers: editorHeaders, data: afterSalesPayload })
  expect(afterSalesResponse.status()).toBe(201)
  let afterSales = (await afterSalesResponse.json()).case
  expect(afterSales.status).toBe('requested')
  expect(afterSales.items[0].saleUnitPrice).toBe(780)
  expect(afterSales.requestedRefundAmount).toBe(780)
  const repeatedAfterSalesResponse = await page.request.post('/api/v2/business/after-sales', { headers: editorHeaders, data: { ...afterSalesPayload, description: '重复请求不应覆盖原单' } })
  expect(repeatedAfterSalesResponse.status()).toBe(200)
  expect((await repeatedAfterSalesResponse.json()).case.id).toBe(afterSales.id)
  const excessiveReturnResponse = await page.request.post('/api/v2/business/after-sales', { headers: editorHeaders, data: {
    ...afterSalesPayload, requestKey: 'e2e-after-sales-excess',
  } })
  expect(excessiveReturnResponse.status()).toBe(409)
  expect((await excessiveReturnResponse.json()).error).toBe('RETURN_QUANTITY_EXCEEDS_SHIPPED')
  const selfReviewResponse = await page.request.post(`/api/v2/business/after-sales/${afterSales.id}/review`, { headers: editorHeaders, data: {
    expectedVersion: afterSales.version, decision: 'approve', note: '申请人不应自行审核',
  } })
  expect(selfReviewResponse.status()).toBe(403)
  const approvedAfterSalesResponse = await page.request.post(`/api/v2/business/after-sales/${afterSales.id}/review`, { headers: afterSalesReviewerHeaders, data: {
    expectedVersion: afterSales.version, decision: 'approve', note: '核对原出库批次与配件包装无误，同意退货退款',
  } })
  expect(approvedAfterSalesResponse.ok()).toBeTruthy()
  afterSales = await approvedAfterSalesResponse.json()
  expect(afterSales.status).toBe('approved')
  expect(afterSales.approvedRefundAmount).toBe(780)

  const returnReceiptPayload = { requestKey: 'e2e-return-receipt-first', expectedVersion: afterSales.version, items: [{ itemId: afterSales.items[0].id, quantity: 1 }], note: '退回原出库仓与原批次' }
  const concurrentReturnResponses = await Promise.all([
    page.request.post(`/api/v2/business/after-sales/${afterSales.id}/return-receipts`, { headers: editorHeaders, data: returnReceiptPayload }),
    page.request.post(`/api/v2/business/after-sales/${afterSales.id}/return-receipts`, { headers: editorHeaders, data: returnReceiptPayload }),
  ])
  expect(concurrentReturnResponses.map((response) => response.status()).sort()).toEqual([200, 201])
  afterSales = await (await page.request.get(`/api/v2/business/after-sales/${afterSales.id}`, { headers: editorHeaders })).json()
  expect(afterSales.status).toBe('refund_pending')
  expect(afterSales.creditedAmount).toBe(780)
  expect(afterSales.items[0].receivedQuantity).toBe(1)
  expect(afterSales.returnReceipts).toHaveLength(1)
  const receivableAfterReturn = await (await page.request.get(`/api/v2/business/receivables/${salesOrder.receivable.id}`, { headers: editorHeaders })).json()
  expect(receivableAfterReturn.status).toBe('refund_pending')
  expect(receivableAfterReturn.creditedAmount).toBe(780)
  expect(receivableAfterReturn.adjustedAmount).toBe(2420)
  expect(receivableAfterReturn.refundableAmount).toBe(780)
  const collectionWhileRefundPending = await page.request.post(`/api/v2/business/receivables/${salesOrder.receivable.id}/payments`, { headers: editorHeaders, data: { requestKey: 'e2e-payment-during-refund', amount: 1, paymentMethod: 'cash' } })
  expect(collectionWhileRefundPending.status()).toBe(409)
  expect((await collectionWhileRefundPending.json()).error).toBe('RECEIVABLE_REFUND_PENDING')
  const balancesAfterReturn = await (await page.request.get(`/api/v2/business/inventory-balances?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(balancesAfterReturn.items.find((item) => item.stockKey === returnedShipmentItem.stockKey).onHandQuantity).toBe(1)
  const movementsAfterReturn = await (await page.request.get(`/api/v2/business/inventory-movements?warehouseId=${warehouse.id}`, { headers: editorHeaders })).json()
  expect(movementsAfterReturn.items.map((item) => item.movementType)).toContain('return_in')
  const returnedStockMovements = movementsAfterReturn.items.filter((movement) => movement.stockKey === returnedShipmentItem.stockKey)
  expect(returnedStockMovements.reduce((sum, movement) => sum + movement.onHandDelta, 0)).toBe(1)

  const refundPayload = { requestKey: 'e2e-refund-first', amount: 780, refundMethod: 'wechat', referenceNo: 'WX-REFUND-001', note: '原路退回客户' }
  const concurrentRefundResponses = await Promise.all([
    page.request.post(`/api/v2/business/after-sales/${afterSales.id}/refunds`, { headers: editorHeaders, data: refundPayload }),
    page.request.post(`/api/v2/business/after-sales/${afterSales.id}/refunds`, { headers: editorHeaders, data: refundPayload }),
  ])
  expect(concurrentRefundResponses.map((response) => response.status()).sort()).toEqual([200, 201])
  afterSales = await (await page.request.get(`/api/v2/business/after-sales/${afterSales.id}`, { headers: editorHeaders })).json()
  expect(afterSales.status).toBe('completed')
  expect(afterSales.refundedAmount).toBe(780)
  expect(afterSales.refunds).toHaveLength(1)
  const settledReceivable = await (await page.request.get(`/api/v2/business/receivables/${salesOrder.receivable.id}`, { headers: editorHeaders })).json()
  expect(settledReceivable.status).toBe('paid')
  expect(settledReceivable.refundedAmount).toBe(780)
  expect(settledReceivable.netCollectedAmount).toBe(2420)
  expect(settledReceivable.outstandingAmount).toBe(0)
  expect(settledReceivable.refundableAmount).toBe(0)
  const overRefundResponse = await page.request.post(`/api/v2/business/after-sales/${afterSales.id}/refunds`, { headers: editorHeaders, data: { ...refundPayload, requestKey: 'e2e-refund-over', amount: 1 } })
  expect(overRefundResponse.status()).toBe(409)
  expect((await overRefundResponse.json()).error).toBe('AFTER_SALES_REFUND_NOT_PENDING')
  salesOrder = await (await page.request.get(`/api/v2/business/sales-orders/${salesOrder.id}`, { headers: editorHeaders })).json()
  expect(salesOrder.afterSalesCases.map((item) => item.id)).toContain(afterSales.id)
  expect(salesOrder.receivable.netCollectedAmount).toBe(2420)

  const customer360Response = await page.request.get(`/api/v2/business/partners/${customer.id}/360?pageSize=100`, { headers: editorHeaders })
  expect(customer360Response.ok()).toBeTruthy()
  const customer360 = await customer360Response.json()
  expect(customer360.customer.id).toBe(customer.id)
  expect(customer360.summary.inquiryCount).toBeGreaterThanOrEqual(2)
  expect(customer360.summary.wonInquiryCount).toBeGreaterThanOrEqual(2)
  expect(customer360.summary.completedSalesOrderCount).toBeGreaterThanOrEqual(1)
  expect(customer360.summary.completedSalesAmount).toBeGreaterThanOrEqual(3200)
  expect(customer360.summary.shipmentCount).toBeGreaterThanOrEqual(2)
  expect(customer360.summary.collectedAmount).toBe(2420)
  expect(customer360.summary.outstandingAmount).toBe(0)
  expect(customer360.summary.afterSalesCount).toBe(1)
  expect(customer360.summary.openAfterSalesCount).toBe(0)
  expect(customer360.summary.afterSalesCreditedAmount).toBe(780)
  expect(customer360.summary.refundedAmount).toBe(780)
  expect(customer360.timeline.items.map((item) => item.entityType)).toEqual(expect.arrayContaining(['inquiry', 'sales_order', 'purchase_order', 'goods_receipt', 'shipment', 'receivable', 'after_sales']))
  const timelinePageResponse = await page.request.get(`/api/v2/business/partners/${customer.id}/360?pageSize=12`, { headers: editorHeaders })
  const timelinePage = await timelinePageResponse.json()
  expect(timelinePage.timeline.items).toHaveLength(12)
  expect(timelinePage.timeline.nextCursor).toBeTruthy()
  const olderTimelineResponse = await page.request.get(`/api/v2/business/partners/${customer.id}/360?pageSize=12&cursor=${encodeURIComponent(timelinePage.timeline.nextCursor)}`, { headers: editorHeaders })
  expect(olderTimelineResponse.ok()).toBeTruthy()
  const olderTimeline = await olderTimelineResponse.json()
  expect(olderTimeline.timeline.items.length).toBeGreaterThan(0)
  expect(new Set([...timelinePage.timeline.items, ...olderTimeline.timeline.items].map((item) => item.id)).size).toBe(timelinePage.timeline.items.length + olderTimeline.timeline.items.length)
})

test('does not expose retired frontend business routes', async ({ page }) => {
  for (const route of ['skus', 'vehicles', 'dictionaries']) {
    await page.goto(`./${route}`)
    await expect(page.getByRole('heading', { name: '下午好，虎山行' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'SKU 管理' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '车型库' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '字典管理' })).toHaveCount(0)
  }
})
