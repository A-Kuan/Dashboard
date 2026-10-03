import { checkApiOperations } from '../src/operations-check.mjs'
import { clearOperationalAlertState, deliverOperationalAlert } from '../src/alert-delivery.mjs'

const enabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())

const result = await checkApiOperations({
  endpoint: process.env.API_OPERATIONS_ENDPOINT || 'http://127.0.0.1:4183',
  releaseDirectory: process.cwd(),
  backupDirectory: process.env.CATALOG_BACKUP_DIR || '/opt/dashboard-sku-api/backups',
  maxBackupAgeSeconds: Number(process.env.API_MAX_BACKUP_AGE_SECONDS || 26 * 60 * 60),
  minFreeBytes: Number(process.env.API_MIN_FREE_BYTES || 1024 * 1024 * 1024),
  maxDatabaseWaitingRequests: Number(process.env.API_MAX_DB_WAITING_REQUESTS || 5),
  requireOffsiteBackup: enabled(process.env.OFFSITE_BACKUP_REQUIRED),
})
const alertSource = 'business-master-data-quality'
const notification = result.businessQuality.alertRequired
  ? await deliverOperationalAlert({
      source: alertSource,
      message: result.businessQuality.message,
      dedupeKey: result.businessQuality.dedupeKey,
      cooldownSeconds: Number(process.env.BUSINESS_QUALITY_ALERT_REPEAT_SECONDS || 86400),
    })
  : await clearOperationalAlertState({ source: alertSource })
result.businessQuality.notification = notification
process.stdout.write(`${JSON.stringify(result)}\n`)
