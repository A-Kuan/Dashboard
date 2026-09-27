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

const visualStates = [
  ['expanded', '02-focus-expanded'],
  ['oe', '03-oe-sku-results'],
  ['vin', '04-vin-fitment-results'],
  ['empty', '05-no-results-correction'],
  ['loading', '06-loading'],
  ['error', '07-service-error-retry'],
]

for (const [state, filename] of visualStates) {
  test(`renders ${state} command-center state`, async ({ page }) => {
    await page.goto(`./?state=${state}`)
    await expect(page.getByLabel('命令中枢搜索')).toHaveClass(new RegExp(`command-panel-${state}`))
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
    await page.screenshot({ path: `qa-artifacts/implementation-${filename}.png`, fullPage: false })
  })
}

test('supports command search transitions, filtering, row selection and the new SKU flow', async ({ page }) => {
  await page.getByRole('button', { name: /搜索 VIN/ }).click()
  await expect(page.getByText('最近访问')).toBeVisible()
  const commandInput = page.getByRole('textbox', { name: '命令搜索' })
  await commandInput.fill('95B 867 288')
  await commandInput.press('Enter')
  await expect(page.getByText('正在搜索零件数据...')).toBeVisible()
  await expect(page.getByText('精确匹配')).toBeVisible()
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

test('supports VIN recognition, correction suggestion and service retry', async ({ page }) => {
  await page.getByRole('button', { name: /搜索 VIN/ }).click()
  const commandInput = page.getByRole('textbox', { name: '命令搜索' })
  await commandInput.fill('WP1AA2A25PLB12345')
  await commandInput.press('Enter')
  await expect(page.getByText('识别到的车辆信息')).toBeVisible()

  await page.goto('./?state=empty')
  await page.getByRole('button', { name: '使用建议' }).click()
  await expect(page.getByText('精确匹配')).toBeVisible()

  await page.goto('./?state=error')
  await page.getByRole('button', { name: '重新搜索' }).click()
  await expect(page.getByText('正在搜索零件数据...')).toBeVisible()
  await expect(page.getByText('精确匹配')).toBeVisible()
})
