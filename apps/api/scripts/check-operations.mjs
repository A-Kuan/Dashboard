import { checkApiOperations } from '../src/operations-check.mjs'

const result = await checkApiOperations({
  endpoint: process.env.API_OPERATIONS_ENDPOINT || 'http://127.0.0.1:4183',
  releaseDirectory: process.cwd(),
  backupDirectory: process.env.CATALOG_BACKUP_DIR || '/opt/dashboard-sku-api/backups',
  maxBackupAgeSeconds: Number(process.env.API_MAX_BACKUP_AGE_SECONDS || 26 * 60 * 60),
  minFreeBytes: Number(process.env.API_MIN_FREE_BYTES || 1024 * 1024 * 1024),
  maxDatabaseWaitingRequests: Number(process.env.API_MAX_DB_WAITING_REQUESTS || 5),
})
process.stdout.write(`${JSON.stringify(result)}\n`)
