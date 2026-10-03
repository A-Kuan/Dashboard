import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkApiOperations, summarizeBusinessQualityQueue } from '../src/operations-check.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => String(body),
  }
}

const clearBusinessQuality = {
  items: [],
  summary: { open: 0, unassigned: 0, dueSoon: 0, overdue: 0, escalated: 0 },
}

function operationsFetch({ waitingRequests = 0, businessQuality = clearBusinessQuality, businessQualityStatus = 200 } = {}) {
  return async (url) => {
    if (url.endsWith('/api/ready')) return response({ status: 'ready', releaseRevision: revision, database: 'ready', migrations: 30, latestMigration: '030.sql' })
    if (url.includes('/api/v2/business/master-data-quality')) return response(businessQuality, businessQualityStatus)
    return response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests ${waitingRequests}\n`)
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-operations-'))
  const backupDirectory = join(root, 'backups')
  await mkdir(backupDirectory)
  await writeFile(join(root, 'REVISION'), `${revision}\n`)
  const manifestPath = join(backupDirectory, 'current.manifest.json')
  await writeFile(manifestPath, '{}\n')
  return { root, backupDirectory, manifestPath, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function addScheduledOffsiteReceipt(files) {
  const manifestName = 'scheduled.manifest.json'
  const manifestPath = join(files.backupDirectory, manifestName)
  await writeFile(manifestPath, `${JSON.stringify({ purpose: 'scheduled' })}\n`)
  await writeFile(join(files.backupDirectory, 'scheduled.offsite.json'), `${JSON.stringify({
    receiptVersion: 'dashboard-offsite-backup-v1', status: 'complete', provider: 'aliyun-oss', manifest: manifestName,
    bucket: 'backup-bucket', region: 'oss-cn-hangzhou', uploadedAt: '2026-10-02T09:59:00.000Z', objects: [{}, {}, {}],
  })}\n`)
  return manifestPath
}

test('checks release identity, readiness, metrics, backup integrity and storage together', async () => {
  const files = await fixture()
  try {
    const checkedAt = Date.parse('2026-10-02T10:00:00.000Z')
    await utimes(files.manifestPath, new Date(checkedAt - 60_000), new Date(checkedAt - 60_000))
    const result = await checkApiOperations({
      endpoint: 'http://api.test',
      releaseDirectory: files.root,
      backupDirectory: files.backupDirectory,
      now: () => checkedAt,
      fetchImpl: operationsFetch(),
      verifyBackup: async (path) => ({ valid: true, path, bytes: 2048, sha256: 'abc', assetArchive: { fileCount: 2 } }),
      getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    })
    assert.equal(result.status, 'ok')
    assert.equal(result.releaseRevision, revision)
    assert.equal(result.backup.ageSeconds, 60)
    assert.equal(result.backup.assetFiles, 2)
  } finally {
    await files.cleanup()
  }
})

test('fails closed for a stale backup or saturated database pool', async () => {
  const files = await fixture()
  try {
    const checkedAt = Date.parse('2026-10-02T10:00:00.000Z')
    await utimes(files.manifestPath, new Date(checkedAt - 120_000), new Date(checkedAt - 120_000))
    const base = {
      endpoint: 'http://api.test', releaseDirectory: files.root, backupDirectory: files.backupDirectory, now: () => checkedAt,
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    }
    await assert.rejects(checkApiOperations({
      ...base,
      maxBackupAgeSeconds: 30,
      fetchImpl: operationsFetch(),
    }), /backup is 120 seconds old/)
    await assert.rejects(checkApiOperations({
      ...base,
      fetchImpl: operationsFetch({ waitingRequests: 7 }),
    }), /7 waiting requests/)
  } finally {
    await files.cleanup()
  }
})

test('requires a matching complete offsite receipt when configured', async () => {
  const files = await fixture()
  try {
    const scheduledManifest = await addScheduledOffsiteReceipt(files)
    const checkedAt = Date.parse('2026-10-02T10:00:00.000Z')
    const result = await checkApiOperations({
      endpoint: 'http://api.test', releaseDirectory: files.root, backupDirectory: files.backupDirectory, now: () => checkedAt,
      requireOffsiteBackup: true,
      fetchImpl: operationsFetch(),
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    })
    assert.equal(result.offsite.provider, 'aliyun-oss')
    assert.equal(result.offsite.objects, 3)
    await rm(join(files.backupDirectory, 'scheduled.offsite.json'))
    await assert.rejects(checkApiOperations({
      endpoint: 'http://api.test', releaseDirectory: files.root, backupDirectory: files.backupDirectory, now: () => checkedAt,
      requireOffsiteBackup: true,
      fetchImpl: operationsFetch(),
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    }), /valid offsite receipt/)
    assert.ok(scheduledManifest)
  } finally {
    await files.cleanup()
  }
})

test('summarizes actionable business-quality work and changes the dedupe key with meaningful state', () => {
  const body = {
    summary: { open: 4, unassigned: 1, dueSoon: 1, overdue: 1, escalated: 1 },
    items: [
      { issueKey: 'vehicle_duplicate:v1:v2', title: '车辆重复', slaStatus: 'due_soon', assignedTo: { name: '复核员' }, dueAt: '2026-10-03T12:00:00.000Z', fingerprint: 'a', taskVersion: 1 },
      { issueKey: 'customer_duplicate:c1:c2', title: '客户重复', slaStatus: 'overdue', assignedTo: { name: '客资料组' }, dueAt: '2026-10-02T12:00:00.000Z', escalationLevel: 2, fingerprint: 'b', taskVersion: 3 },
      { issueKey: 'vehicle_duplicate:v3:v4', title: '车辆待分配', slaStatus: 'unassigned', fingerprint: 'c' },
      { issueKey: 'vehicle_duplicate:v5:v6', title: '正常处理', slaStatus: 'on_track', assignedTo: { name: '复核员' } },
    ],
  }
  const result = summarizeBusinessQualityQueue(body)
  assert.equal(result.status, 'attention_required')
  assert.equal(result.actionable, 3)
  assert.deepEqual(result.topItems.map((item) => item.slaStatus), ['overdue', 'unassigned', 'due_soon'])
  assert.match(result.message, /未分配 1，临期 1，超期 1/)
  assert.equal(result.dedupeKey, summarizeBusinessQualityQueue(body).dedupeKey)
  const onlyOnTrackChanged = structuredClone(body)
  onlyOnTrackChanged.summary.open = 5
  assert.equal(summarizeBusinessQualityQueue(onlyOnTrackChanged).dedupeKey, result.dedupeKey)
  const changed = structuredClone(body)
  changed.items[1].taskVersion = 4
  assert.notEqual(summarizeBusinessQualityQueue(changed).dedupeKey, result.dedupeKey)
  assert.equal(summarizeBusinessQualityQueue(clearBusinessQuality).alertRequired, false)
  assert.throws(() => summarizeBusinessQualityQueue({ items: [], summary: { open: 0 } }), /summary is incomplete/)
})

test('fails closed when the business-quality queue cannot be read', async () => {
  const files = await fixture()
  try {
    await assert.rejects(checkApiOperations({
      endpoint: 'http://api.test', releaseDirectory: files.root, backupDirectory: files.backupDirectory,
      fetchImpl: operationsFetch({ businessQualityStatus: 503 }),
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    }), /Business quality queue returned HTTP 503/)
  } finally {
    await files.cleanup()
  }
})
