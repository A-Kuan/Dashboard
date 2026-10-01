import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCatalogCsv } from '../src/services/catalogApi.js'

test('parses Chinese SKU import headers and quoted commas', () => {
  const rows = parseCatalogCsv('\uFEFF中文名称,英文名称,品牌,分类,主 OE,车型,适配条件\n前刹车片,"Brake pad, front",Porsche OE,制动系统 / 制动片,95B 698 151 H,Macan (95B),"前轴, 排除 PSCB"')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].nameZh, '前刹车片')
  assert.equal(rows[0].nameEn, 'Brake pad, front')
  assert.equal(rows[0].primaryOe, '95B 698 151 H')
  assert.equal(rows[0].condition, '前轴, 排除 PSCB')
})

test('rejects import files without identity or primary OE columns', () => {
  assert.throws(() => parseCatalogCsv('品牌,主 OE\nPorsche,123'), /中文名称/)
  assert.throws(() => parseCatalogCsv('中文名称,品牌\n刹车片,Porsche'), /主 OE/)
})
