import { expect, test } from '@playwright/test'

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
  const csv = '\uFEFF中文名称,品牌,分类,单位,主 OE,车型,年款范围,来源系统\n后刹车片,Porsche OE,制动系统 / 制动片,件,TEST-IMPORT-001,Macan (95B),2014-2018,Porsche PET\n重复前制动盘,Porsche OE,制动系统 / 制动盘,件,9Y0 615 301 M,Cayenne (9YA),2018-2023,Porsche PET\n无编号件,Porsche OE,制动系统 / 制动片,件,,,,供应商资料'
  await dialog.locator('input[type=file]').setInputFiles({ name: 'sku-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText('总行数')).toBeVisible()
  await expect(page.getByText('疑似重复', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('不可导入', { exact: true }).first()).toBeVisible()
  await expect(page.getByLabel('选择第 3 行')).not.toBeChecked()
  await expect(page.getByLabel('选择第 4 行')).toBeDisabled()
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
