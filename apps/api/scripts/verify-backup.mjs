import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const manifestPath = process.argv[2] ? resolve(process.argv[2]) : ''
if (!manifestPath) throw new Error('Usage: npm run backup:verify -- /absolute/path/to/backup.manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1') throw new Error('Unsupported backup manifest version')
const dumpPath = resolve(dirname(manifestPath), manifest.archive.filename)
const dumpBuffer = await readFile(dumpPath)
const file = await stat(dumpPath)
const checksum = createHash('sha256').update(dumpBuffer).digest('hex')
if (checksum !== manifest.archive.sha256) throw new Error('Backup checksum mismatch')
if (file.size !== manifest.archive.bytes) throw new Error('Backup size does not match manifest')
const listing = spawnSync('pg_restore', ['--list', dumpPath], { env: process.env, encoding: 'utf8' })
const listedObjects = listing.stdout.split('\n').filter((line) => /^\d+;/.test(line)).length
if (listing.status !== 0 || !listing.stdout.includes('; Archive created at') || !listedObjects) throw new Error(`Backup archive is unreadable: ${(listing.stderr || '').trim()}`)
process.stdout.write(`${JSON.stringify({ valid: true, dumpPath, bytes: file.size, sha256: checksum, counts: manifest.counts })}\n`)
