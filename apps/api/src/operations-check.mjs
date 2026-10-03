import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, statfs } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const releasePattern = /^[0-9a-f]{40}$/

async function newestManifest(backupDirectory, { purpose } = {}) {
  const names = (await readdir(backupDirectory)).filter((name) => name.endsWith('.manifest.json'))
  if (!names.length) throw new Error('No database backup manifest is available')
  const candidates = (await Promise.all(names.map(async (name) => {
    const path = resolve(backupDirectory, name)
    if (purpose) {
      try {
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        if (manifest.purpose !== purpose) return null
      } catch { return null }
    }
    return { path, modifiedAtMs: (await stat(path)).mtimeMs }
  }))).filter(Boolean)
  if (!candidates.length) throw new Error(`No ${purpose || 'database'} backup manifest is available`)
  return candidates.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]
}

async function offsiteReceipt(backupDirectory) {
  const scheduled = await newestManifest(backupDirectory, { purpose: 'scheduled' })
  const receiptPath = scheduled.path.replace(/\.manifest\.json$/, '.offsite.json')
  let receipt
  try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')) } catch { throw new Error('Latest scheduled backup does not have a valid offsite receipt') }
  if (receipt.receiptVersion !== 'dashboard-offsite-backup-v1' || receipt.status !== 'complete') throw new Error('Latest scheduled backup offsite receipt is incomplete')
  if (receipt.manifest !== basename(scheduled.path) || receipt.provider !== 'aliyun-oss' || !Array.isArray(receipt.objects) || receipt.objects.length !== 3) {
    throw new Error('Latest scheduled backup offsite receipt does not match its manifest')
  }
  return { receiptPath, provider: receipt.provider, bucket: receipt.bucket, region: receipt.region, uploadedAt: receipt.uploadedAt, objects: receipt.objects.length }
}

function spawnVerification(releaseDirectory, manifestPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-backup.mjs', manifestPath], { cwd: releaseDirectory, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errorOutput += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Latest backup verification failed: ${(errorOutput || output).trim()}`))
      else resolvePromise(JSON.parse(output))
    })
  })
}

function metricValue(body, name) {
  const match = body.match(new RegExp(`^${name}\\s+([0-9.eE+-]+)$`, 'm'))
  return match ? Number(match[1]) : null
}

function count(value) {
  const result = Number(value)
  return Number.isInteger(result) && result >= 0 ? result : null
}

export function summarizeBusinessQualityQueue(body) {
  if (!body || !Array.isArray(body.items) || !body.summary || typeof body.summary !== 'object') throw new Error('Business quality queue returned an invalid response')
  const summary = {
    open: count(body.summary.open),
    unassigned: count(body.summary.unassigned),
    dueSoon: count(body.summary.dueSoon),
    overdue: count(body.summary.overdue),
    escalated: count(body.summary.escalated),
  }
  if (Object.values(summary).some((value) => value === null)) throw new Error('Business quality queue summary is incomplete')
  const actionable = summary.unassigned + summary.dueSoon + summary.overdue
  const topItems = body.items
    .filter((item) => ['unassigned', 'due_soon', 'overdue'].includes(item.slaStatus))
    .sort((left, right) => Number(right.escalationLevel || 0) - Number(left.escalationLevel || 0)
      || ({ overdue: 0, unassigned: 1, due_soon: 2 }[left.slaStatus] ?? 3) - ({ overdue: 0, unassigned: 1, due_soon: 2 }[right.slaStatus] ?? 3)
      || String(left.issueKey).localeCompare(String(right.issueKey)))
    .slice(0, 5)
    .map((item) => ({
      issueKey: String(item.issueKey || ''),
      title: String(item.title || ''),
      slaStatus: String(item.slaStatus || ''),
      assignedTo: String(item.assignedTo?.name || '待分配'),
      dueAt: item.dueAt || null,
      escalationLevel: Number(item.escalationLevel || 0),
      taskVersion: Number(item.taskVersion || 0),
      fingerprint: String(item.fingerprint || ''),
    }))
  const alertSummary = { unassigned: summary.unassigned, dueSoon: summary.dueSoon, overdue: summary.overdue, escalated: summary.escalated }
  const dedupeKey = createHash('sha256').update(JSON.stringify({ alertSummary, topItems })).digest('hex')
  const slaLabels = { unassigned: '未分配', due_soon: '临期', overdue: '超期' }
  const itemLines = topItems.map((item) => `- ${item.title || item.issueKey}｜${item.assignedTo}｜${slaLabels[item.slaStatus]}${item.dueAt ? `｜截止 ${item.dueAt}` : ''}`)
  const message = [
    `主数据质量待办：未分配 ${summary.unassigned}，临期 ${summary.dueSoon}，超期 ${summary.overdue}，升级 ${summary.escalated}。`,
    ...itemLines,
    '请在业务跟进中心完成分配、核对或安全合并。',
  ].join('\n')
  return { status: actionable ? 'attention_required' : 'clear', alertRequired: actionable > 0, actionable, summary, topItems, dedupeKey, message }
}

export async function checkApiOperations({
  endpoint = 'http://127.0.0.1:4183',
  releaseDirectory = process.cwd(),
  backupDirectory = '/opt/dashboard-sku-api/backups',
  maxBackupAgeSeconds = 26 * 60 * 60,
  minFreeBytes = 1024 * 1024 * 1024,
  maxDatabaseWaitingRequests = 5,
  requireOffsiteBackup = false,
  now = () => Date.now(),
  fetchImpl = fetch,
  getAvailableBytes = async (path) => {
    const filesystem = await statfs(path, { bigint: true })
    return Number(filesystem.bavail * filesystem.bsize)
  },
  verifyBackup = (manifestPath) => spawnVerification(releaseDirectory, manifestPath),
} = {}) {
  const revision = (await readFile(resolve(releaseDirectory, 'REVISION'), 'utf8')).trim()
  if (!releasePattern.test(revision)) throw new Error('Current release does not contain a full Git revision')

  const readyResponse = await fetchImpl(`${endpoint}/api/ready`, { signal: AbortSignal.timeout(5000) })
  if (!readyResponse.ok) throw new Error(`API readiness returned HTTP ${readyResponse.status}`)
  const readiness = await readyResponse.json()
  if (readiness.status !== 'ready' || readiness.releaseRevision !== revision) throw new Error('API readiness does not match the current release')

  const metricsResponse = await fetchImpl(`${endpoint}/api/metrics`, { signal: AbortSignal.timeout(5000) })
  if (!metricsResponse.ok) throw new Error(`API metrics returned HTTP ${metricsResponse.status}`)
  const metrics = await metricsResponse.text()
  if (!metrics.includes(`revision="${revision}"`)) throw new Error('API metrics do not identify the current release')
  const waitingRequests = metricValue(metrics, 'dashboard_api_database_pool_waiting_requests')
  if (waitingRequests === null) throw new Error('API metrics are missing the database waiting-request gauge')
  if (waitingRequests > maxDatabaseWaitingRequests) throw new Error(`Database pool has ${waitingRequests} waiting requests`)

  const businessQualityResponse = await fetchImpl(`${endpoint}/api/v2/business/master-data-quality?status=open&pageSize=100`, { signal: AbortSignal.timeout(10000) })
  if (!businessQualityResponse.ok) throw new Error(`Business quality queue returned HTTP ${businessQualityResponse.status}`)
  const businessQuality = summarizeBusinessQualityQueue(await businessQualityResponse.json())

  const latest = await newestManifest(backupDirectory)
  const backupAgeSeconds = Math.max(0, (now() - latest.modifiedAtMs) / 1000)
  if (backupAgeSeconds > maxBackupAgeSeconds) throw new Error(`Latest database backup is ${Math.round(backupAgeSeconds)} seconds old`)
  const backup = await verifyBackup(latest.path)
  if (!backup.valid) throw new Error('Latest database backup did not pass validation')
  const offsite = requireOffsiteBackup ? await offsiteReceipt(backupDirectory) : { status: 'not-required' }

  const availableBytes = await getAvailableBytes(backupDirectory)
  if (availableBytes < minFreeBytes) throw new Error(`Only ${availableBytes} bytes remain on the API volume`)

  return {
    status: 'ok',
    checkedAt: new Date(now()).toISOString(),
    releaseRevision: revision,
    readiness: { database: readiness.database, migrations: readiness.migrations, latestMigration: readiness.latestMigration },
    databasePoolWaitingRequests: waitingRequests,
    businessQuality,
    backup: { manifestPath: latest.path, ageSeconds: Math.round(backupAgeSeconds), bytes: backup.bytes, sha256: backup.sha256, assetFiles: backup.assetArchive?.fileCount ?? null },
    offsite,
    storage: { availableBytes },
  }
}
