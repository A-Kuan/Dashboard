import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
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
  await page.screenshot({ path: 'qa-artifacts/implementation-workbench-home-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-library-default-1680.png', fullPage: false })

  await page.getByPlaceholder('搜索 SKU、OE 号、配件名称、品牌或适配车型').fill('机油滤清器')
  await expect(page.getByText('机油滤清器', { exact: true }).first()).toBeVisible()
  await page.getByText('机油滤清器', { exact: true }).first().click()
  await expect(page.getByText('06M 198 405 F', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '库存与价格' }).click()
  await expect(page.getByText('OEM 参考价')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-library-1680.png', fullPage: false })
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await expect(page.getByRole('dialog', { name: '选择 SKU 创建来源' })).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-source-modal-1680.png', fullPage: false })
})

test('creates a source-first SKU and submits it into the review queue', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /从 EPC \/ VIN 创建/ }).click()

  await expect(page.getByText('新建 SKU', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '前制动盘' })).toBeVisible()
  await expect(page.getByText('发布前检查')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-identity-1680.png', fullPage: false })

  await page.getByRole('button', { name: '2 编号关系' }).click()
  await expect(page.getByLabel('主 OE 编号')).toHaveValue('9Y0 615 301 M')
  await page.getByRole('button', { name: '3 适配车型' }).click()
  await expect(page.getByLabel('车型 / 平台')).toHaveValue('Cayenne (9YA)')

  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存到 SKU 资料库/)).toBeVisible()
  await page.getByRole('button', { name: '来源与身份' }).click()
  await expect(page.getByLabel('SKU 编码')).not.toHaveValue('保存后自动生成')
  await page.getByRole('button', { name: '4 发布检查' }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(page.getByRole('heading', { name: '资料已进入审核队列' })).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-verified-1680.png', fullPage: false })

  await page.getByRole('button', { name: '返回 SKU 资料库' }).click()
  await expect(page.getByText('真实资料', { exact: false }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'SKU 资料库' })).toBeVisible()
  await expect(page.getByText('前制动盘', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '编辑 SKU' }).click()
  await expect(page.getByText('编辑 SKU', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '前制动盘' })).toBeVisible()
})

test('reviews a submitted SKU in the data quality workspace', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '质量审核' }).click()
  await expect(page.getByText('数据质量与审核', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '处理队列' })).toBeVisible()
  await page.getByRole('button', { name: /前制动盘/ }).click()
  await expect(page.getByText('全部通过', { exact: true })).toBeVisible()
  await expect(page.getByText('资料审核员', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-quality-review-1680.png', fullPage: false })
  await page.getByRole('button', { name: '通过审核', exact: true }).click()
  await page.getByPlaceholder('可填写审核结论（选填）').fill('来源、编号与车型适配均已复核')
  await page.getByRole('button', { name: '确认通过审核' }).click()
  await expect(page.getByText('审核已通过')).toBeVisible()
  await page.getByRole('button', { name: '运营洞察' }).click()
  await expect(page.getByRole('heading', { name: '运营洞察' })).toBeVisible()
  await expect(page.getByText('审核通过率')).toBeVisible()
  await expect(page.getByText('平均审核耗时')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-quality-insights-1680.png', fullPage: false })
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
  await page.getByRole('button', { name: /v4 · 审核通过/ }).click()
  const dialog = page.getByRole('dialog', { name: 'SKU 版本对比' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('审核状态不会回退')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-version-compare-1680.png', fullPage: false })
  await dialog.getByPlaceholder('例如：撤销错误的 OE 与车型适配修改').fill('撤销测试中的错误名称修改')
  await dialog.getByRole('button', { name: '恢复 v4 为新草稿' }).click()
  await expect(page.getByText(/已从 v4 恢复为新草稿/)).toBeVisible()
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-import-template-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-import-preview-1680.png', fullPage: false })
  await page.getByRole('button', { name: '写入 1 条草稿' }).click()
  await expect(page.getByRole('heading', { name: '导入批次已完成' })).toBeVisible()
  await expect(page.getByText('成功写入 1 条，失败 0 条')).toBeVisible()
  await page.getByRole('button', { name: '查看本次导入记录' }).click()
  await expect(page.getByText('首次写入')).toBeVisible()
  await expect(page.getByText('sku-import.csv', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-import-history-1680.png', fullPage: false })
  await dialog.locator('.sku-import-actions').getByRole('button', { name: '关闭' }).click()
  await expect(page.getByText('后刹车片', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '批量导入' }).click()
  const repeatedDialog = page.getByRole('dialog', { name: '批量导入 SKU' })
  await repeatedDialog.locator('input[type=file]').setInputFiles({ name: 'renamed-copy.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(repeatedDialog.getByText('该文件内容已导入过')).toBeVisible()
  await expect(repeatedDialog.getByText('首次写入')).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-import-idempotency-1680.png', fullPage: false })
  await repeatedDialog.locator('.sku-import-actions').getByRole('button', { name: '关闭' }).click()
})

test('supports controlled bulk review submission with per-record results', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByLabel('选择 前制动盘').check()
  await page.getByLabel('选择 后刹车片').check()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量提交审核' })
  await expect(dialog).toContainText('已选择 2 条资料')
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-bulk-review-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-export-1680.png', fullPage: false })

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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-role-permissions-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-conflict-resolution-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-safe-merge-1680.png', fullPage: false })
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
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-incomplete-1680.png', fullPage: false })
})

test('collapses the navigation into a persistent icon rail', async ({ page }) => {
  const collapseButton = page.getByRole('button', { name: '收起导航' })
  await expect(collapseButton).toBeVisible()
  await collapseButton.click()

  await expect(page.locator('.workbench-home')).toHaveClass(/sidebar-collapsed/)
  await expect(page.getByRole('button', { name: '展开导航' })).toBeVisible()
  await expect.poll(async () => Math.round((await page.locator('.workbench-main').boundingBox()).x)).toBe(72)
  await page.screenshot({ path: 'qa-artifacts/implementation-sidebar-collapsed-1680.png', fullPage: false })

  await page.reload()
  await expect(page.locator('.workbench-home')).toHaveClass(/sidebar-collapsed/)
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await expect(page).toHaveURL(/#\/sku$/)
  await expect.poll(async () => Math.round((await page.locator('.sku-main').boundingBox()).x)).toBe(72)

  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(page.locator('.workbench-home')).not.toHaveClass(/sidebar-collapsed/)
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
