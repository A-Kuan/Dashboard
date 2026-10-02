import { spawn } from 'node:child_process'
import { pruneScheduledBackups } from '../src/backup-retention.mjs'
import { uploadBackupSet } from '../src/offsite-backup.mjs'

function runJson(script, args = [], environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errorOutput += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${script} failed: ${(errorOutput || output).trim()}`))
      else {
        try { resolve(JSON.parse(output)) } catch { reject(new Error(`${script} did not return valid JSON`)) }
      }
    })
  })
}

const backupDirectory = process.env.CATALOG_BACKUP_DIR || '/opt/dashboard-sku-api/backups'
if (!String(process.env.CATALOG_EPC_ASSET_DIR || '').trim()) throw new Error('Scheduled backups require CATALOG_EPC_ASSET_DIR')
const environment = { ...process.env, BACKUP_PURPOSE: 'scheduled', CATALOG_BACKUP_DIR: backupDirectory }
const backup = await runJson('scripts/backup-database.mjs', [], environment)
const verification = await runJson('scripts/verify-backup.mjs', [backup.manifestPath], environment)
const offsite = await uploadBackupSet({ manifestPath: backup.manifestPath, environment })
const retention = await pruneScheduledBackups({
  directory: backupDirectory,
  apply: true,
  keepRecent: Number(process.env.BACKUP_KEEP_RECENT || 14),
  keepWeekly: Number(process.env.BACKUP_KEEP_WEEKLY || 8),
  minimumAgeHours: Number(process.env.BACKUP_MINIMUM_AGE_HOURS || 24),
  maxDeleteSets: Number(process.env.BACKUP_MAX_DELETE_SETS || 30),
})
process.stdout.write(`${JSON.stringify({ status: 'ok', backup: { manifestPath: backup.manifestPath, bytes: backup.bytes }, verification, offsite, retention: { managedSets: retention.managedSets, keptSets: retention.kept.length, deletedSets: retention.deletedSets } })}\n`)
