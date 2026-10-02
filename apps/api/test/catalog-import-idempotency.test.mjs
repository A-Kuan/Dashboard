import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCatalogImportRows } from '../src/catalog-import-repository.mjs'

test('fingerprints normalized import content and detects repeated OE rows', () => {
  const first = analyzeCatalogImportRows([
    { nameZh: '前刹车片', primaryOe: ' 95B 698 151 H ', vehicle: 'Macan' },
    { nameZh: '后刹车片', primaryOe: '95B-698-151-H', vehicle: 'Macan' },
  ])
  const sameContent = analyzeCatalogImportRows([
    { nameZh: '后刹车片', primaryOe: '95B-698-151-H', vehicle: 'Macan' },
    { nameZh: '前刹车片', primaryOe: '95B.698.151.H', vehicle: 'Macan' },
  ])
  const changed = analyzeCatalogImportRows([
    { nameZh: '前刹车片', primaryOe: '95B 698 151 H', vehicle: 'Macan' },
  ])
  assert.equal(first.contentHash, sameContent.contentHash)
  assert.notEqual(first.contentHash, changed.contentHash)
  assert.deepEqual(first.inFileDuplicates['95B698151H'], [2, 3])
})
