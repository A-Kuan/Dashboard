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

test('completes the source-first SKU draft and verification prototype', async ({ page }) => {
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
  await expect(page.getByText(/草稿已保存在当前原型中/)).toBeVisible()
  await page.getByRole('button', { name: '4 发布检查' }).click()
  await page.getByRole('button', { name: '完成核验' }).click()
  await expect(page.getByRole('heading', { name: '模拟核验已通过' })).toBeVisible()
  await page.screenshot({ path: 'qa-artifacts/implementation-sku-editor-verified-1680.png', fullPage: false })

  await page.getByRole('button', { name: '返回 SKU 资料库' }).click()
  await page.getByRole('button', { name: '编辑 SKU' }).click()
  await expect(page.getByText('编辑 SKU', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '前制动片套装' })).toBeVisible()
})

test('shows actionable validation issues for an incomplete manual SKU', async ({ page }) => {
  await page.getByRole('button', { name: 'SKU 资料库' }).click()
  await page.getByRole('button', { name: '新建 SKU' }).click()
  await page.getByRole('button', { name: /手工建立空白 SKU/ }).click()

  await expect(page.getByText('0%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '4 发布检查' }).click()
  await page.getByRole('button', { name: '完成核验' }).click()
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
