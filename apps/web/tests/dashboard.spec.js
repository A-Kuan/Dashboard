import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'SKU 管理' })).toBeVisible()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  page.__consoleErrors = errors
})

test.afterEach(async ({ page }) => {
  expect(page.__consoleErrors).toEqual([])
})

test('matches the default collapsed state and captures visual evidence', async ({ page }) => {
  await expect(page.getByRole('button', { name: /搜索 VIN/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /95B-867-288-OM8/ })).toHaveClass(/selected/)
  await page.screenshot({ path: 'qa-artifacts/implementation-default.png', fullPage: false })
})

test('supports search, filtering, row selection and the new SKU flow', async ({ page }) => {
  await page.getByRole('button', { name: /搜索 VIN/ }).click()
  const commandInput = page.getByPlaceholder('搜索 VIN、OE号、SKU、车型，或输入命令…')
  await commandInput.fill('BMW')
  await expect(page.getByText('5111-8087-375', { exact: true }).last()).toBeVisible()
  await page.keyboard.press('Escape')

  await page.locator('.filter-select').first().getByRole('combobox').selectOption('Porsche')
  await expect(page.locator('.sku-table tbody tr')).toHaveCount(4)
  await page.locator('.filter-select').first().getByRole('combobox').selectOption('全部')

  await page.getByRole('row', { name: /958-121-251/ }).click()
  await expect(page.locator('.part-title h2')).toHaveText('958-121-251')

  await page.getByRole('button', { name: '新建 SKU' }).click()
  await expect(page.getByRole('heading', { name: '新建 SKU' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { name: '新建 SKU' })).toHaveCount(0)
})
