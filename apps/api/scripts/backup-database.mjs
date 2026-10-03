import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createPool } from '../src/db.mjs'
import { resolveReleaseRevision } from '../src/release-info.mjs'

const outputDirectory = resolve(process.argv[2] || process.env.CATALOG_BACKUP_DIR || './backups')
const database = process.env.PGDATABASE || 'dashboard_sku'
const host = process.env.PGHOST || '/var/run/postgresql'
const port = String(process.env.PGPORT || 5432)
const user = process.env.PGUSER || 'dashboard_sku'
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const backupName = `${timestamp}-${randomUUID().slice(0, 8)}-${database}`
const dumpPath = resolve(outputDirectory, `${backupName}.dump`)
const manifestPath = resolve(outputDirectory, `${backupName}.manifest.json`)
const assetDirectory = String(process.env.CATALOG_EPC_ASSET_DIR || '').trim()
const assetArchivePath = assetDirectory ? resolve(outputDirectory, `${backupName}.epc-assets.tar.gz`) : ''
const backupPurpose = String(process.env.BACKUP_PURPOSE || 'manual').trim().toLowerCase()
if (!/^[a-z][a-z0-9_-]{0,31}$/.test(backupPurpose)) throw new Error('BACKUP_PURPOSE must be a short machine-readable label')
const releaseRevision = await resolveReleaseRevision()

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

await mkdir(outputDirectory, { recursive: true, mode: 0o750 })
const pool = createPool({ max: 1 })
const counts = {}
let schemaMigrations = []
let serverMajorVersion = ''
try {
  const versionNumber = Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)
  serverMajorVersion = String(Math.trunc(versionNumber / 10000))
  for (const table of ['schema_migration', 'sku', 'sku_oe_relation', 'sku_fitment', 'sku_change_log', 'vehicle_variant', 'vehicle_part_requirement', 'vehicle_part_candidate', 'vehicle_service_package', 'vehicle_service_package_item', 'vehicle_change_log', 'catalog_sku', 'catalog_part_identifier', 'catalog_fitment', 'catalog_fitment_review_event', 'catalog_vehicle_platform', 'catalog_vehicle_platform_change_event', 'catalog_vehicle_variant', 'catalog_vehicle_variant_change_event', 'catalog_fitment_scope_resolution', 'catalog_source_evidence', 'catalog_change_log', 'catalog_intake', 'catalog_epc_preview', 'catalog_epc_preview_item', 'catalog_epc_publish_decision', 'catalog_epc_connector_run', 'catalog_epc_asset', 'catalog_epc_asset_attempt', 'catalog_import_job', 'catalog_import_mapping_profile', 'catalog_import_mapping_profile_change', 'catalog_import_value_resolution', 'catalog_dictionary_proposal', 'catalog_identifier_resolution', 'catalog_sku_merge', 'catalog_legacy_migration_batch', 'catalog_legacy_sku_migration', 'catalog_legacy_migration_item', 'catalog_legacy_migration_plan', 'catalog_legacy_migration_plan_item', 'catalog_legacy_migration_plan_event', 'business_inquiry', 'business_inquiry_item', 'business_supplier_offer', 'business_quote', 'business_quote_item', 'business_inquiry_event', 'business_partner', 'business_partner_contact', 'business_customer_vehicle', 'business_partner_event', 'business_customer_onboarding_request', 'business_sales_order', 'business_sales_order_item', 'business_purchase_order', 'business_purchase_order_item', 'business_order_event', 'business_warehouse', 'business_goods_receipt', 'business_goods_receipt_item', 'business_inventory_lot', 'business_inventory_balance', 'business_stock_reservation', 'business_stock_reservation_item', 'business_stock_reservation_allocation', 'business_shipment', 'business_shipment_item', 'business_inventory_movement', 'business_receivable', 'business_payment', 'business_receivable_event', 'business_after_sales_case', 'business_after_sales_item', 'business_return_receipt', 'business_return_receipt_item', 'business_refund', 'business_after_sales_event']) {
    const exists = (await pool.query('SELECT to_regclass($1) AS table_name', [`public.${table}`])).rows[0].table_name
    counts[table] = exists ? Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count) : null
  }
  for (const table of ['business_payable', 'business_supplier_payment', 'business_payable_event', 'business_supplier_return_case', 'business_supplier_return_item', 'business_supplier_return_shipment', 'business_supplier_return_shipment_item', 'business_supplier_refund', 'business_supplier_return_event', 'business_quote_approval_event', 'business_quote_revision_event', 'business_quote_integrity_event', 'business_control_event', 'business_quick_quote_draft', 'business_quick_quote_draft_event', 'business_partner_merge', 'business_customer_vehicle_merge', 'business_master_data_quality_decision', 'business_master_data_quality_task', 'business_master_data_quality_task_event']) {
    const exists = (await pool.query('SELECT to_regclass($1) AS table_name', [`public.${table}`])).rows[0].table_name
    counts[table] = exists ? Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count) : null
  }
  if (counts.schema_migration) schemaMigrations = (await pool.query('SELECT filename,checksum,applied_at FROM schema_migration ORDER BY filename')).rows
} finally {
  await pool.end()
}

async function postgresBinary(environmentKey, name) {
  if (process.env[environmentKey]) return process.env[environmentKey]
  const versioned = `/usr/lib/postgresql/${serverMajorVersion}/bin/${name}`
  try {
    await access(versioned)
    return versioned
  } catch {
    return name
  }
}

const pgDump = await postgresBinary('PG_DUMP_BIN', 'pg_dump')
const pgRestore = await postgresBinary('PG_RESTORE_BIN', 'pg_restore')
const dump = spawnSync(pgDump, ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', '--host', host, '--port', port, '--username', user, '--file', dumpPath, database], { env: process.env, encoding: 'utf8' })
if (dump.status !== 0) throw new Error(`pg_dump failed: ${(dump.stderr || dump.stdout || 'unknown error').trim()}`)
await chmod(dumpPath, 0o640)
const listing = spawnSync(pgRestore, ['--list', dumpPath], { env: process.env, encoding: 'utf8' })
const listedObjects = listing.stdout.split('\n').filter((line) => /^\d+;/.test(line)).length
if (listing.status !== 0 || !listing.stdout.includes('; Archive created at') || !listedObjects) throw new Error(`pg_restore validation failed: ${(listing.stderr || listing.stdout || 'invalid archive').trim()}`)

const file = await stat(dumpPath)
let assetArchive = null
if (assetDirectory) {
  await access(assetDirectory)
  const archived = spawnSync('tar', ['-czf', assetArchivePath, '-C', assetDirectory, '.'], { env: process.env, encoding: 'utf8' })
  if (archived.status !== 0) throw new Error(`EPC asset snapshot failed: ${(archived.stderr || archived.stdout || 'unknown error').trim()}`)
  await chmod(assetArchivePath, 0o640)
  const assetListing = spawnSync('tar', ['-tzf', assetArchivePath], { env: process.env, encoding: 'utf8' })
  if (assetListing.status !== 0) throw new Error(`EPC asset snapshot validation failed: ${(assetListing.stderr || assetListing.stdout || 'invalid archive').trim()}`)
  const assetFile = await stat(assetArchivePath)
  assetArchive = {
    filename: basename(assetArchivePath), format: 'tar-gzip', bytes: assetFile.size,
    sha256: await sha256File(assetArchivePath),
    fileCount: assetListing.stdout.split('\n').filter((line) => line && !line.endsWith('/')).length,
  }
}
const manifest = {
  manifestVersion: 'dashboard-postgres-backup-v1',
  createdAt: new Date().toISOString(),
  purpose: backupPurpose,
  database,
  releaseRevision,
  postgres: { serverMajorVersion, pgDump, pgRestore },
  archive: { filename: `${backupName}.dump`, format: 'postgres-custom', bytes: file.size, sha256: await sha256File(dumpPath) },
  assetArchive,
  counts,
  schemaMigrations,
  verification: { pgRestoreList: 'passed', objectCount: listedObjects },
}
const temporaryManifestPath = `${manifestPath}.tmp`
await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 })
await chmod(temporaryManifestPath, 0o640)
await rename(temporaryManifestPath, manifestPath)
process.stdout.write(`${JSON.stringify({ dumpPath, manifestPath, assetArchivePath: assetArchive ? assetArchivePath : '', bytes: file.size, counts })}\n`)
