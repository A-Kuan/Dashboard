import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPool } from '../src/db.mjs'

const outputDirectory = resolve(process.argv[2] || process.env.CATALOG_BACKUP_DIR || './backups')
const database = process.env.PGDATABASE || 'dashboard_sku'
const host = process.env.PGHOST || '/var/run/postgresql'
const port = String(process.env.PGPORT || 5432)
const user = process.env.PGUSER || 'dashboard_sku'
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const backupName = `${timestamp}-${randomUUID().slice(0, 8)}-${database}`
const dumpPath = resolve(outputDirectory, `${backupName}.dump`)
const manifestPath = resolve(outputDirectory, `${backupName}.manifest.json`)

await mkdir(outputDirectory, { recursive: true, mode: 0o750 })
const pool = createPool({ max: 1 })
const counts = {}
let schemaMigrations = []
try {
  for (const table of ['schema_migration', 'catalog_sku', 'catalog_part_identifier', 'catalog_fitment', 'catalog_source_evidence', 'catalog_change_log', 'catalog_import_job', 'catalog_import_mapping_profile', 'catalog_import_mapping_profile_change', 'catalog_import_value_resolution', 'catalog_identifier_resolution', 'catalog_sku_merge']) {
    const exists = (await pool.query('SELECT to_regclass($1) AS table_name', [`public.${table}`])).rows[0].table_name
    counts[table] = exists ? Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count) : null
  }
  if (counts.schema_migration) schemaMigrations = (await pool.query('SELECT filename,checksum,applied_at FROM schema_migration ORDER BY filename')).rows
} finally {
  await pool.end()
}

const dump = spawnSync('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', '--host', host, '--port', port, '--username', user, '--file', dumpPath, database], { env: process.env, encoding: 'utf8' })
if (dump.status !== 0) throw new Error(`pg_dump failed: ${(dump.stderr || dump.stdout || 'unknown error').trim()}`)
const listing = spawnSync('pg_restore', ['--list', dumpPath], { env: process.env, encoding: 'utf8' })
const listedObjects = listing.stdout.split('\n').filter((line) => /^\d+;/.test(line)).length
if (listing.status !== 0 || !listing.stdout.includes('; Archive created at') || !listedObjects) throw new Error(`pg_restore validation failed: ${(listing.stderr || listing.stdout || 'invalid archive').trim()}`)

const dumpBuffer = await readFile(dumpPath)
const file = await stat(dumpPath)
const manifest = {
  manifestVersion: 'dashboard-postgres-backup-v1',
  createdAt: new Date().toISOString(),
  database,
  releaseRevision: process.env.RELEASE_REVISION || '',
  archive: { filename: `${backupName}.dump`, format: 'postgres-custom', bytes: file.size, sha256: createHash('sha256').update(dumpBuffer).digest('hex') },
  counts,
  schemaMigrations,
  verification: { pgRestoreList: 'passed', objectCount: listedObjects },
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 })
process.stdout.write(`${JSON.stringify({ dumpPath, manifestPath, bytes: file.size, counts })}\n`)
