import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const defaultMigrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

export async function loadMigrationDefinitions(directory = defaultMigrationDirectory) {
  const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
  return Promise.all(files.map(async (filename) => {
    const sql = await readFile(`${directory}/${filename}`, 'utf8')
    return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

async function ensureLedger(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    execution_ms integer NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
}

export async function runMigrations(pool, { log = console.log } = {}) {
  const definitions = await loadMigrationDefinitions()
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('dashboard_sku_schema_migrations'))")
    await ensureLedger(client)
    const applied = new Map((await client.query('SELECT filename,checksum FROM schema_migration')).rows.map((row) => [row.filename, row.checksum]))
    const result = { applied: [], skipped: [], latest: definitions.at(-1)?.filename || '' }
    for (const migration of definitions) {
      const previousChecksum = applied.get(migration.filename)
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          const error = new Error(`Migration checksum mismatch: ${migration.filename}`)
          error.code = 'MIGRATION_CHECKSUM_MISMATCH'
          error.details = { filename: migration.filename, expected: previousChecksum, actual: migration.checksum }
          throw error
        }
        result.skipped.push(migration.filename)
        log(`Skipped migration ${migration.filename}`)
        continue
      }
      const startedAt = Date.now()
      try {
        await client.query('BEGIN')
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migration (filename,checksum,execution_ms) VALUES ($1,$2,$3)', [migration.filename, migration.checksum, Date.now() - startedAt])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      result.applied.push(migration.filename)
      log(`Applied migration ${migration.filename}`)
    }
    return result
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('dashboard_sku_schema_migrations'))").catch(() => {})
    client.release()
  }
}

export async function migrationReadiness(pool) {
  const definitions = await loadMigrationDefinitions()
  const { rows } = await pool.query('SELECT filename,checksum,applied_at FROM schema_migration ORDER BY filename')
  const applied = new Map(rows.map((row) => [row.filename, row]))
  const missing = definitions.filter((item) => !applied.has(item.filename)).map((item) => item.filename)
  const changed = definitions.filter((item) => applied.has(item.filename) && applied.get(item.filename).checksum !== item.checksum).map((item) => item.filename)
  if (missing.length || changed.length) {
    const error = new Error('Database schema is not ready')
    error.code = 'DATABASE_SCHEMA_NOT_READY'
    error.details = { missing, changed }
    throw error
  }
  return {
    database: 'ready', migrations: rows.length, latestMigration: definitions.at(-1)?.filename || '',
    lastAppliedAt: applied.get(definitions.at(-1)?.filename)?.applied_at || null,
  }
}
