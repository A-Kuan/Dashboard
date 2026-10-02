import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCatalogImportRules, inspectCatalogCsv, mapCatalogCsvInspection, parseCatalogCsv } from '../src/services/catalogApi.js'

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

test('applies supplier defaults and text rules without changing original source evidence', () => {
  const sourceRow = { 供应商品名: '　空气  滤芯　', 原厂编号: 'ａb-１２３ ' }
  const rows = applyCatalogImportRules([{ nameZh: sourceRow.供应商品名, primaryOe: sourceRow.原厂编号, brand: '', unit: '', _sourceRow: sourceRow }], {
    defaultValues: { brand: 'MANN', unit: '件' },
    transformRules: { trimText: true, collapseWhitespace: true, uppercaseOe: true, normalizeFullWidth: true },
  })
  assert.equal(rows[0].nameZh, '空气 滤芯')
  assert.equal(rows[0].primaryOe, 'AB-123')
  assert.equal(rows[0].brand, 'MANN')
  assert.equal(rows[0].unit, '件')
  assert.deepEqual(rows[0]._sourceRow, sourceRow)
})

test('maps known supplier values and queues unknown values for review', () => {
  const rows = applyCatalogImportRules([
    { nameZh: '火花塞', primaryOe: '06K905601M', brand: '博世中国', category: '点火件', unit: 'PCS', _sourceRow: { 品牌: '博世中国' } },
    { nameZh: '火花塞', primaryOe: '06K905601N', brand: '未知品牌', category: '点火件', unit: 'PCS', _sourceRow: { 品牌: '未知品牌' } },
  ], {
    valueMappings: {
      brand: [{ source: '博世中国', target: 'BOSCH' }],
      category: [{ source: '点火件', target: '点火系统 / 火花塞' }],
      unit: [{ source: 'PCS', target: '件' }],
    },
  })
  assert.equal(rows[0].brand, 'BOSCH')
  assert.equal(rows[0].category, '点火系统 / 火花塞')
  assert.equal(rows[0].unit, '件')
  assert.deepEqual(rows[0]._valueMappingIssues, [])
  assert.deepEqual(rows[1]._valueMappingIssues, [{ field: 'brand', value: '未知品牌' }])
  assert.equal(rows[1]._sourceRow.品牌, '未知品牌')
})
