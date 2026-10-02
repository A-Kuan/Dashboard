import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalogImportRepository } from '../src/catalog-import-repository.mjs'
import { createSkuRepository } from '../src/repository.mjs'

function singleFlightPool(rowsForSql) {
  let active = false
  return {
    async query(sql) {
      assert.equal(active, false, `同一个 PostgreSQL client 不能并发查询：${sql}`)
      active = true
      try {
        await new Promise((resolve) => setImmediate(resolve))
        return { rows: rowsForSql(sql) }
      } finally {
        active = false
      }
    },
  }
}

test('loads legacy SKU child records sequentially on one database client', async () => {
  const pool = singleFlightPool((sql) => sql.includes('FROM sku WHERE')
    ? [{ id: 'sku-1', sku_code: 'SKU-1', image_urls: [], version: 1 }]
    : [])

  const item = await createSkuRepository(pool).get('sku-1')

  assert.equal(item.id, 'sku-1')
  assert.deepEqual(item.oeRelations, [])
  assert.deepEqual(item.fitments, [])
  assert.deepEqual(item.changeHistory, [])
})

test('loads import job child records sequentially on one database client', async () => {
  const pool = singleFlightPool((sql) => sql.includes('FROM catalog_import_job WHERE id=')
    ? [{
        id: 'job-1', total_rows: 0, ready_rows: 0, duplicate_rows: 0, review_rows: 0,
        invalid_rows: 0, imported_rows: 0, failed_rows: 0, mapping_snapshot: {}, version: 1,
      }]
    : [])

  const item = await createCatalogImportRepository(pool, {}).get('job-1')

  assert.equal(item.id, 'job-1')
  assert.deepEqual(item.rows, [])
  assert.deepEqual(item.attempts, [])
  assert.deepEqual(item.valueResolutions, [])
})
