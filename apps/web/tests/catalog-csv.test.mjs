import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectCatalogCsv, mapCatalogCsvInspection, parseCatalogCsv } from '../src/services/catalogApi.js'

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

test('suggests supplier column mappings and preserves unmapped source context', () => {
  const inspection = inspectCatalogCsv('供应商品名,原厂编号,厂牌,适用车系,内部备注\n空调滤芯,4M0 819 439 B,MANN,Audi Q7,特价批次')
  assert.equal(inspection.isStandardTemplate, false)
  assert.equal(inspection.suggestedMapping.nameZh, 0)
  assert.equal(inspection.suggestedMapping.primaryOe, 1)
  assert.equal(inspection.suggestedMapping.brand, 2)
  assert.equal(inspection.suggestedMapping.vehicle, 3)
  const rows = mapCatalogCsvInspection(inspection, inspection.suggestedMapping)
  assert.equal(rows[0].nameZh, '空调滤芯')
  assert.equal(rows[0].primaryOe, '4M0 819 439 B')
  assert.equal(rows[0]._sourceRow['内部备注'], '特价批次')
})

test('supports manual mapping and rejects one source column mapped twice', () => {
  const inspection = inspectCatalogCsv('描述,货号\n机油滤清器,06M 198 405 F')
  const rows = mapCatalogCsvInspection(inspection, { ...inspection.suggestedMapping, nameZh: 0, primaryOe: 1 })
  assert.equal(rows[0].nameZh, '机油滤清器')
  assert.throws(() => mapCatalogCsvInspection(inspection, { ...inspection.suggestedMapping, nameZh: 0, primaryOe: 0 }), /同一原始列/)
})
