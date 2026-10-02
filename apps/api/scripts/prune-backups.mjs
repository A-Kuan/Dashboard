import { pruneScheduledBackups } from '../src/backup-retention.mjs'

const apply = process.argv.includes('--apply')
const directory = process.env.CATALOG_BACKUP_DIR || process.argv.find((value, index) => index > 1 && !value.startsWith('--')) || './backups'
const result = await pruneScheduledBackups({
  directory,
  apply,
  keepRecent: Number(process.env.BACKUP_KEEP_RECENT || 14),
  keepWeekly: Number(process.env.BACKUP_KEEP_WEEKLY || 8),
  minimumAgeHours: Number(process.env.BACKUP_MINIMUM_AGE_HOURS || 24),
  maxDeleteSets: Number(process.env.BACKUP_MAX_DELETE_SETS || 30),
})
process.stdout.write(`${JSON.stringify(result)}\n`)
