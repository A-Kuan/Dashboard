import { chmod, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createOffsiteClient, enabled, sha256File } from './offsite-backup.mjs'

const backupBasePattern = /^\d{8}T\d{6}Z-[0-9a-f]{8}-[A-Za-z0-9_-]+$/

function committedManifestKey(prefix, key) {
  if (!key.startsWith(`${prefix}/`)) return null
  const relative = key.slice(prefix.length + 1)
  const parts = relative.split('/')
  if (parts.length !== 2 || !backupBasePattern.test(parts[0]) || parts[1] !== `${parts[0]}.manifest.json`) return null
  return { base: parts[0], key }
}

async function latestCommittedManifest(client, prefix) {
  const manifests = []
  let marker = null
  for (let page = 0; page < 100; page += 1) {
    const query = { prefix: `${prefix}/`, 'max-keys': 1000, ...(marker ? { marker } : {}) }
    const listed = await client.list(query)
    for (const object of listed.objects || []) {
      const candidate = committedManifestKey(prefix, object.name)
      if (candidate) manifests.push(candidate)
    }
    if (!listed.isTruncated) break
    marker = listed.nextMarker || listed.objects?.at(-1)?.name
    if (!marker) throw new Error('OSS listing was truncated without a continuation marker')
    if (page === 99) throw new Error('OSS backup listing exceeded the safety page limit')
  }
  if (!manifests.length) throw new Error('No committed scheduled backup manifest is available in OSS')
  return manifests.sort((left, right) => right.base.localeCompare(left.base))[0]
}

async function downloadAndVerify(client, { key, path, expectedSha256, expectedBytes, maxBytes }) {
  const metadata = await client.head(key)
  const remoteSha256 = metadata?.meta?.sha256
  const remoteBytes = Number(metadata?.meta?.bytes)
  if (!/^[0-9a-f]{64}$/.test(String(remoteSha256 || ''))) throw new Error(`OSS object is missing its checksum metadata: ${key}`)
  if (!Number.isSafeInteger(remoteBytes) || remoteBytes < 0) throw new Error(`OSS object is missing its size metadata: ${key}`)
  if (Number.isFinite(maxBytes) && remoteBytes > maxBytes) throw new Error(`OSS object exceeds the restore download limit: ${key}`)
  if (expectedSha256 && remoteSha256 !== expectedSha256) throw new Error(`OSS object checksum metadata does not match the manifest: ${key}`)
  if (Number.isFinite(expectedBytes) && remoteBytes !== expectedBytes) throw new Error(`OSS object size metadata does not match the manifest: ${key}`)
  await client.get(key, path)
  await chmod(path, 0o640)
  const information = await stat(path)
  if (!information.isFile()) throw new Error(`Downloaded OSS member is not a regular file: ${key}`)
  if (information.size !== remoteBytes) throw new Error(`Downloaded OSS member size does not match its metadata: ${key}`)
  const sha256 = await sha256File(path)
  if (sha256 !== remoteSha256) throw new Error(`Downloaded OSS member checksum verification failed: ${key}`)
  return { key, path, bytes: information.size, sha256 }
}

export async function downloadLatestOffsiteBackup({
  targetDirectory,
  environment = process.env,
  clientFactory,
  credentialProvider,
} = {}) {
  if (!enabled(environment.OFFSITE_RESTORE_DRILL_ENABLED)) return { status: 'disabled' }
  const directory = resolve(targetDirectory || '')
  if (!targetDirectory || directory === '/') throw new Error('A safe target directory is required for the offsite restore drill')
  await mkdir(directory, { recursive: true, mode: 0o750 })
  if ((await readdir(directory)).length) throw new Error('Offsite restore target directory must be empty')

  const { client, configuration, prefix, credentialMode } = await createOffsiteClient({ environment, clientFactory, credentialProvider })
  const maxObjectBytes = Number(environment.OFFSITE_RESTORE_MAX_OBJECT_BYTES || 20 * 1024 * 1024 * 1024)
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1024 * 1024 || maxObjectBytes > 1024 * 1024 * 1024 * 1024) {
    throw new Error('OFFSITE_RESTORE_MAX_OBJECT_BYTES must be an integer between 1 MiB and 1 TiB')
  }
  const committed = await latestCommittedManifest(client, prefix)
  const manifestPath = resolve(directory, `${committed.base}.manifest.json`)
  const manifestObject = await downloadAndVerify(client, { key: committed.key, path: manifestPath, maxBytes: 2 * 1024 * 1024 })
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1' || manifest.purpose !== 'scheduled') throw new Error('Latest OSS manifest is not a scheduled Dashboard backup')
  if (!/^[0-9a-f]{40}$/.test(String(manifest.releaseRevision || ''))) throw new Error('Latest OSS manifest does not identify an immutable release')
  if (manifest.archive?.filename !== `${committed.base}.dump` || manifest.assetArchive?.filename !== `${committed.base}.epc-assets.tar.gz`) {
    throw new Error('Latest OSS manifest filenames do not match its immutable object prefix')
  }

  const archivePath = resolve(directory, manifest.archive.filename)
  const assetPath = resolve(directory, manifest.assetArchive.filename)
  const archiveObject = await downloadAndVerify(client, {
    key: `${prefix}/${committed.base}/${manifest.archive.filename}`,
    path: archivePath,
    expectedSha256: manifest.archive.sha256,
    expectedBytes: manifest.archive.bytes,
    maxBytes: maxObjectBytes,
  })
  const assetObject = await downloadAndVerify(client, {
    key: `${prefix}/${committed.base}/${manifest.assetArchive.filename}`,
    path: assetPath,
    expectedSha256: manifest.assetArchive.sha256,
    expectedBytes: manifest.assetArchive.bytes,
    maxBytes: maxObjectBytes,
  })
  return {
    status: 'complete',
    manifestPath,
    releaseRevision: manifest.releaseRevision,
    provider: 'aliyun-oss',
    credentialMode,
    bucket: configuration.bucket,
    region: configuration.region,
    prefix,
    objects: [archiveObject, assetObject, manifestObject],
  }
}
