import { createPool } from './db.mjs'
import { runMigrations } from './migration-runner.mjs'

const pool = createPool()
try {
  const result = await runMigrations(pool)
  console.log(`Migration state: ${result.applied.length} applied, ${result.skipped.length} unchanged, latest ${result.latest || 'none'}`)
} finally {
  await pool.end()
}
