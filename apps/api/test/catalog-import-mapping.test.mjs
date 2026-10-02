import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogHeaderSignature, normalizeMappingHeader } from '../src/catalog-import-mapping-repository.mjs'

test('normalizes supplier headers and keeps signatures stable across column order', () => {
  assert.equal(normalizeMappingHeader(' OE_编号（主） '), 'oe编号主')
  const first = catalogHeaderSignature([{ sourceKey: '供应商品名' }, { sourceKey: '原厂编号' }, { sourceKey: '厂牌' }])
  const reordered = catalogHeaderSignature([{ sourceKey: '厂牌' }, { sourceKey: '供应商品名' }, { sourceKey: '原厂编号' }])
  const changed = catalogHeaderSignature([{ sourceKey: '供应商品名' }, { sourceKey: '原厂编号' }, { sourceKey: '品牌' }])
  assert.equal(first, reordered)
  assert.notEqual(first, changed)
})
