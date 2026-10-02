import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadLatestOffsiteBackup } from '../src/offsite-recovery.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')

function environment(overrides = {}) {
  return {
    OFFSITE_RESTORE_DRILL_ENABLED: '1', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'dashboard-backups',
    OSS_ACCESS_KEY_ID: 'test-key', OSS_ACCESS_KEY_SECRET: 'test-secret', OSS_PREFIX: 'production/dashboard-sku',
    ...overrides,
  }
}

function backupObjects(base, { releaseRevision = 'b'.repeat(40), mutateManifest } = {}) {
  const dump = Buffer.from(`database-${base}`)
  const assets = Buffer.from(`assets-${base}`)
  const manifest = {
    manifestVersion: 'dashboard-postgres-backup-v1', purpose: 'scheduled', releaseRevision,
    archive: { filename: `${base}.dump`, bytes: dump.length, sha256: digest(dump) },
    assetArchive: { filename: `${base}.epc-assets.tar.gz`, bytes: assets.length, sha256: digest(assets) },
  }
  mutateManifest?.(manifest)
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest)}\n`)
  const prefix = `production/dashboard-sku/${base}`
  return new Map([
    [`${prefix}/${base}.dump`, dump],
    [`${prefix}/${base}.epc-assets.tar.gz`, assets],
    [`${prefix}/${base}.manifest.json`, manifestBuffer],
  ])
}

function fakeClient(objects, manifestKeys) {
  const listQueries = []
  return {
    listQueries,
    async list(query) {
      listQueries.push(query)
      if (!query.marker) return { objects: [{ name: manifestKeys[0] }], isTruncated: true, nextMarker: 'next-page' }
      return { objects: [{ name: manifestKeys[1] }, { name: `${query.prefix}not-a-committed-object.tmp` }], isTruncated: false }
    },
    async head(key) {
      const value = objects.get(key)
      if (!value) throw Object.assign(new Error('missing'), { status: 404 })
      return { meta: { sha256: digest(value), bytes: String(value.length) } }
    },
    async get(key, path) {
      const value = objects.get(key)
      if (!value) throw Object.assign(new Error('missing'), { status: 404 })
      await writeFile(path, value)
      return { name: key }
    },
  }
}

test('downloads the newest committed manifest and verifies all three objects', async () => {
  const target = await mkdtemp(join(tmpdir(), 'dashboard-offsite-recovery-'))
  try {
    const older = '20260901T040000Z-11111111-dashboard_sku'
    const newer = '20261001T040000Z-22222222-dashboard_sku'
    const objects = new Map([...backupObjects(older), ...backupObjects(newer)])
    const manifestKeys = [
      `production/dashboard-sku/${older}/${older}.manifest.json`,
      `production/dashboard-sku/${newer}/${newer}.manifest.json`,
    ]
    const client = fakeClient(objects, manifestKeys)
    const result = await downloadLatestOffsiteBackup({ targetDirectory: target, environment: environment(), clientFactory: async () => client })
    assert.equal(result.status, 'complete')
    assert.equal(result.objects.length, 3)
    assert.equal(client.listQueries.length, 2)
    assert.equal(client.listQueries[1].marker, 'next-page')
    assert.match(result.manifestPath, new RegExp(`${newer}\\.manifest\\.json$`))
    assert.equal(JSON.parse(await readFile(result.manifestPath, 'utf8')).releaseRevision, 'b'.repeat(40))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('is separately opt-in and rejects remote checksum or filename drift', async () => {
  assert.deepEqual(await downloadLatestOffsiteBackup({ environment: {} }), { status: 'disabled' })
  const target = await mkdtemp(join(tmpdir(), 'dashboard-offsite-recovery-invalid-'))
  try {
    const base = '20261001T040000Z-33333333-dashboard_sku'
    const objects = backupObjects(base, { mutateManifest: (manifest) => { manifest.archive.filename = 'other.dump' } })
    const key = `production/dashboard-sku/${base}/${base}.manifest.json`
    const client = fakeClient(objects, [key, key])
    await assert.rejects(downloadLatestOffsiteBackup({ targetDirectory: target, environment: environment(), clientFactory: async () => client }), /filenames do not match/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
