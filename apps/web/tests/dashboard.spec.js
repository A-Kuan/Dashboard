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

test('does not expose retired frontend business routes', async ({ page }) => {
  for (const route of ['skus', 'vehicles', 'dictionaries']) {
    await page.goto(`./${route}`)
    await expect(page.getByRole('heading', { name: '下午好，虎山行' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'SKU 管理' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '车型库' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '字典管理' })).toHaveCount(0)
  }
})
