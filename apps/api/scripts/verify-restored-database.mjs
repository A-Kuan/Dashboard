import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPool } from '../src/db.mjs'
import { migrationReadiness } from '../src/migration-runner.mjs'

const manifestPath = process.argv[2] ? resolve(process.argv[2]) : ''
const mode = process.argv[3] || 'before-migrate'
if (!manifestPath || !['before-migrate', 'after-migrate'].includes(mode)) {
  throw new Error('Usage: npm run restore:verify -- /absolute/path/to/backup.manifest.json before-migrate|after-migrate')
}

const database = String(process.env.PGDATABASE || '')
if (!/^dashboard_sku_restore_[a-z0-9_]+$/.test(database)) throw new Error('Restore verification requires an isolated dashboard_sku_restore_* database')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1') throw new Error('Unsupported backup manifest version')
if (database === manifest.database) throw new Error('Restore verification refuses to inspect the source database')

const pool = createPool({ max: 1 })
const verifiedCounts = {}
try {
  const activeDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name
  if (activeDatabase !== database) throw new Error(`Connected to unexpected database: ${activeDatabase}`)

  for (const [table, expected] of Object.entries(manifest.counts || {})) {
    if (expected === null || (mode === 'after-migrate' && table === 'schema_migration')) continue
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name in manifest: ${table}`)
    const exists = (await pool.query('SELECT to_regclass($1) AS table_name', [`public.${table}`])).rows[0].table_name
    if (!exists) throw new Error(`Restored table is missing: ${table}`)
    const actual = Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count)
    if (actual !== expected) throw new Error(`Restored row count mismatch for ${table}: expected ${expected}, received ${actual}`)
    verifiedCounts[table] = actual
  }

  if (mode === 'before-migrate') {
    const actualMigrations = (await pool.query('SELECT filename,checksum FROM schema_migration ORDER BY filename')).rows
    const expectedMigrations = (manifest.schemaMigrations || []).map(({ filename, checksum }) => ({ filename, checksum }))
    if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) throw new Error('Restored migration ledger does not match the backup manifest')
  } else {
    await migrationReadiness(pool)
  }

  process.stdout.write(`${JSON.stringify({ valid: true, mode, database, verifiedCounts })}\n`)
} finally {
  await pool.end()
}
