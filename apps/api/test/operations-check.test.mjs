import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkApiOperations } from '../src/operations-check.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => String(body),
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
      fetchImpl: async (url) => url.endsWith('/api/ready')
        ? response({ status: 'ready', releaseRevision: revision, database: 'ready', migrations: 30, latestMigration: '030.sql' })
        : response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests 0\n`),
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
      fetchImpl: async (url) => url.endsWith('/api/ready')
        ? response({ status: 'ready', releaseRevision: revision })
        : response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests 0\n`),
    }), /backup is 120 seconds old/)
    await assert.rejects(checkApiOperations({
      ...base,
      fetchImpl: async (url) => url.endsWith('/api/ready')
        ? response({ status: 'ready', releaseRevision: revision })
        : response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests 7\n`),
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
      fetchImpl: async (url) => url.endsWith('/api/ready')
        ? response({ status: 'ready', releaseRevision: revision })
        : response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests 0\n`),
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    })
    assert.equal(result.offsite.provider, 'aliyun-oss')
    assert.equal(result.offsite.objects, 3)
    await rm(join(files.backupDirectory, 'scheduled.offsite.json'))
    await assert.rejects(checkApiOperations({
      endpoint: 'http://api.test', releaseDirectory: files.root, backupDirectory: files.backupDirectory, now: () => checkedAt,
      requireOffsiteBackup: true,
      fetchImpl: async (url) => url.endsWith('/api/ready')
        ? response({ status: 'ready', releaseRevision: revision })
        : response(`dashboard_api_build_info{revision="${revision}"} 1\ndashboard_api_database_pool_waiting_requests 0\n`),
      verifyBackup: async () => ({ valid: true }), getAvailableBytes: async () => 4 * 1024 * 1024 * 1024,
    }), /valid offsite receipt/)
    assert.ok(scheduledManifest)
  } finally {
    await files.cleanup()
  }
})
