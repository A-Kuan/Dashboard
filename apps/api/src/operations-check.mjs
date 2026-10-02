import { spawn } from 'node:child_process'
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
    backup: { manifestPath: latest.path, ageSeconds: Math.round(backupAgeSeconds), bytes: backup.bytes, sha256: backup.sha256, assetFiles: backup.assetArchive?.fileCount ?? null },
    offsite,
    storage: { availableBytes },
  }
}
