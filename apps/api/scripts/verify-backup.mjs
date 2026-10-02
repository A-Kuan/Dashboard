import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const manifestPath = process.argv[2] ? resolve(process.argv[2]) : ''
if (!manifestPath) throw new Error('Usage: npm run backup:verify -- /absolute/path/to/backup.manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1') throw new Error('Unsupported backup manifest version')

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const dumpPath = resolve(dirname(manifestPath), manifest.archive.filename)
const file = await stat(dumpPath)
const checksum = await sha256File(dumpPath)
if (checksum !== manifest.archive.sha256) throw new Error('Backup checksum mismatch')
if (file.size !== manifest.archive.bytes) throw new Error('Backup size does not match manifest')
async function resolvePgRestore() {
  if (process.env.PG_RESTORE_BIN) return process.env.PG_RESTORE_BIN
  const candidates = [
    manifest.postgres?.serverMajorVersion ? `/usr/lib/postgresql/${manifest.postgres.serverMajorVersion}/bin/pg_restore` : '',
    String(manifest.postgres?.pgRestore || '').startsWith('/') ? manifest.postgres.pgRestore : '',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next portable location. */ }
  }
  return manifest.postgres?.pgRestore || 'pg_restore'
}

const pgRestore = await resolvePgRestore()
const listing = spawnSync(pgRestore, ['--list', dumpPath], { env: process.env, encoding: 'utf8' })
const listedObjects = listing.stdout.split('\n').filter((line) => /^\d+;/.test(line)).length
if (listing.status !== 0 || !listing.stdout.includes('; Archive created at') || !listedObjects) throw new Error(`Backup archive is unreadable: ${(listing.stderr || '').trim()}`)

let assetArchive = null
if (manifest.assetArchive) {
  const assetPath = resolve(dirname(manifestPath), manifest.assetArchive.filename)
  const assetFile = await stat(assetPath)
  const assetChecksum = await sha256File(assetPath)
  if (assetChecksum !== manifest.assetArchive.sha256) throw new Error('EPC asset backup checksum mismatch')
  if (assetFile.size !== manifest.assetArchive.bytes) throw new Error('EPC asset backup size does not match manifest')
  const assetListing = spawnSync('tar', ['-tzf', assetPath], { env: process.env, encoding: 'utf8' })
  if (assetListing.status !== 0) throw new Error(`EPC asset backup is unreadable: ${(assetListing.stderr || '').trim()}`)
  const fileCount = assetListing.stdout.split('\n').filter((line) => line && !line.endsWith('/')).length
  if (fileCount !== manifest.assetArchive.fileCount) throw new Error('EPC asset backup file count does not match manifest')
  assetArchive = { path: assetPath, bytes: assetFile.size, sha256: assetChecksum, fileCount }
}

process.stdout.write(`${JSON.stringify({ valid: true, dumpPath, bytes: file.size, sha256: checksum, assetArchive, counts: manifest.counts })}\n`)
