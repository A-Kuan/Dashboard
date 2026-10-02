import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadBackupSet } from '../src/offsite-backup.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-offsite-'))
  const base = '20261002T100000Z-12345678-dashboard_sku'
  const dump = Buffer.from('database-archive')
  const assets = Buffer.from('asset-archive')
  const dumpName = `${base}.dump`
  const assetName = `${base}.epc-assets.tar.gz`
  const manifestPath = join(directory, `${base}.manifest.json`)
  await writeFile(join(directory, dumpName), dump)
  await writeFile(join(directory, assetName), assets)
  await writeFile(manifestPath, `${JSON.stringify({
    manifestVersion: 'dashboard-postgres-backup-v1', purpose: 'scheduled', releaseRevision: 'a'.repeat(40),
    archive: { filename: dumpName, bytes: dump.length, sha256: sha256(dump) },
    assetArchive: { filename: assetName, bytes: assets.length, sha256: sha256(assets) },
  })}\n`)
  return { directory, base, manifestPath, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

function environment(overrides = {}) {
  return {
    OFFSITE_BACKUP_ENABLED: '1', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'dashboard-backups',
    OSS_ACCESS_KEY_ID: 'test-key', OSS_ACCESS_KEY_SECRET: 'test-secret', OSS_PREFIX: 'production/dashboard-sku',
    ...overrides,
  }
}

function fakeClient() {
  const objects = new Map()
  const puts = []
  return {
    objects,
    puts,
    async head(key) {
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' })
      return { meta: objects.get(key).meta }
    },
    async put(key, path, options) {
      puts.push({ key, path, options })
      objects.set(key, { meta: options.meta })
      return { name: key }
    },
  }
}

test('uploads data before the manifest, verifies each object and records an atomic receipt', async () => {
  const files = await fixture()
  try {
    const client = fakeClient()
    const result = await uploadBackupSet({
      manifestPath: files.manifestPath,
      environment: environment(),
      clientFactory: async (configuration) => {
        assert.equal(configuration.authorizationV4, true)
        assert.equal(configuration.secure, true)
        return client
      },
      now: () => new Date('2026-10-02T10:05:00.000Z'),
    })
    assert.equal(result.status, 'complete')
    assert.equal(client.puts.length, 3)
    assert.match(client.puts[0].key, /\.dump$/)
    assert.match(client.puts[1].key, /\.epc-assets\.tar\.gz$/)
    assert.match(client.puts[2].key, /\.manifest\.json$/)
    assert.equal(client.puts[0].options.headers['x-oss-forbid-overwrite'], 'true')
    assert.equal(client.puts[0].options.headers['x-oss-server-side-encryption'], 'AES256')
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'))
    assert.equal(receipt.status, 'complete')
    assert.equal(receipt.objects.length, 3)

    const retried = await uploadBackupSet({ manifestPath: files.manifestPath, environment: environment(), clientFactory: async () => client })
    assert.equal(client.puts.length, 3)
    assert.ok(retried.objects.every((object) => object.disposition === 'existing'))
  } finally {
    await files.cleanup()
  }
})

test('is opt-in and refuses changed backup content before uploading', async () => {
  const files = await fixture()
  try {
    assert.deepEqual(await uploadBackupSet({ manifestPath: files.manifestPath, environment: {} }), { status: 'disabled' })
    await writeFile(join(files.directory, `${files.base}.dump`), 'changed')
    const client = fakeClient()
    await assert.rejects(uploadBackupSet({ manifestPath: files.manifestPath, environment: environment(), clientFactory: async () => client }), /checksum changed/)
    assert.equal(client.puts.length, 0)
  } finally {
    await files.cleanup()
  }
})

test('prefers hardened ECS RAM role credentials and rejects ambiguous credential sources', async () => {
  const files = await fixture()
  try {
    const client = fakeClient()
    const roleEnvironment = environment({
      OSS_ECS_RAM_ROLE: 'DashboardSkuBackupRole', OSS_ACCESS_KEY_ID: '', OSS_ACCESS_KEY_SECRET: '',
    })
    const result = await uploadBackupSet({
      manifestPath: files.manifestPath,
      environment: roleEnvironment,
      credentialProvider: async (roleName) => {
        assert.equal(roleName, 'DashboardSkuBackupRole')
        return { accessKeyId: 'temporary-id', accessKeySecret: 'temporary-secret', stsToken: 'temporary-token' }
      },
      clientFactory: async (configuration) => {
        assert.equal(configuration.stsToken, 'temporary-token')
        return client
      },
    })
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'))
    assert.equal(receipt.credentialMode, 'ecs-ram-role')
    await assert.rejects(uploadBackupSet({
      manifestPath: files.manifestPath,
      environment: environment({ OSS_ECS_RAM_ROLE: 'role-and-key' }),
      clientFactory: async () => client,
    }), /either OSS_ECS_RAM_ROLE or static OSS credentials/)
  } finally {
    await files.cleanup()
  }
})
