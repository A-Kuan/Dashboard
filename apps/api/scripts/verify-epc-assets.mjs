import { createCatalogEpcAssetStorage } from '../src/catalog-epc-asset-storage.mjs'
import { createPool } from '../src/db.mjs'

const pool = createPool()
const storage = createCatalogEpcAssetStorage()

if (!storage.configured) {
  throw new Error('CATALOG_EPC_ASSET_DIR is required to verify hosted EPC assets')
}

try {
  const rows = (await pool.query(`SELECT id,storage_key,checksum_sha256,byte_size
    FROM catalog_epc_asset
    WHERE storage_key<>''
    ORDER BY created_at,id`)).rows
  const results = []

  for (const row of rows) {
    try {
      const verified = await storage.verify({
        storageKey: row.storage_key,
        checksumSha256: row.checksum_sha256,
      })
      results.push({ id: row.id, valid: true, ...verified })
    } catch (error) {
      results.push({ id: row.id, valid: false, code: error.errorCode || 'EPC_ASSET_VERIFY_FAILED', message: error.message })
    }
  }

  const failed = results.filter((item) => !item.valid)
  process.stdout.write(`${JSON.stringify({
    valid: failed.length === 0,
    checkedAt: new Date().toISOString(),
    rootConfigured: true,
    total: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    failures: failed,
  })}\n`)
  if (failed.length) process.exitCode = 1
} finally {
  await pool.end()
}
