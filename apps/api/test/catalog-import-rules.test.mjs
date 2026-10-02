import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCatalogImportProfile, mergeCatalogValueMappings, normalizeCatalogValueMappings } from '../src/catalog-import-rules.mjs'

test('normalizes profile value mappings and ignores duplicate supplier aliases', () => {
  assert.deepEqual(normalizeCatalogValueMappings({
    brand: [{ source: ' 博世中国 ', target: 'BOSCH' }, { source: '博世中国', target: '重复值' }, { source: '', target: '空' }],
  }), {
    brand: [{ source: '博世中国', target: 'BOSCH' }],
    category: [],
    unit: [],
  })
})

test('applies canonical supplier values and reports unresolved aliases without touching source evidence', () => {
  const sourceRow = { 品牌: '未知品牌', 单位: 'ＰＣＳ' }
  const known = applyCatalogImportProfile({ brand: '博世中国', unit: 'ＰＣＳ', primaryOe: 'ａb-１２３', _sourceRow: sourceRow }, {
    transformRules: { normalizeFullWidth: true, trimText: true, collapseWhitespace: true, uppercaseOe: true },
    valueMappings: { brand: [{ source: '博世中国', target: 'BOSCH' }], unit: [{ source: 'PCS', target: '件' }] },
  })
  assert.equal(known.brand, 'BOSCH')
  assert.equal(known.unit, '件')
  assert.equal(known.primaryOe, 'AB-123')
  assert.deepEqual(known._valueMappingIssues, [])
  assert.deepEqual(known._sourceRow, sourceRow)

  const unknown = applyCatalogImportProfile({ brand: '未知品牌', _sourceRow: sourceRow }, {
    valueMappings: { brand: [{ source: '博世中国', target: 'BOSCH' }] },
  })
  assert.deepEqual(unknown._valueMappingIssues, [{ field: 'brand', value: '未知品牌' }])
})

test('learns new supplier aliases without losing or duplicating existing mappings', () => {
  assert.deepEqual(mergeCatalogValueMappings({
    brand: [{ source: '博世中国', target: 'BOSCH' }],
    unit: [{ source: 'PCS', target: '件' }],
  }, [
    { field: 'brand', source: '神秘品牌', target: 'MYSTERY' },
    { field: 'brand', source: ' 博世中国 ', target: 'BOSCH CN' },
  ]), {
    brand: [{ source: '博世中国', target: 'BOSCH CN' }, { source: '神秘品牌', target: 'MYSTERY' }],
    category: [],
    unit: [{ source: 'PCS', target: '件' }],
  })
})
