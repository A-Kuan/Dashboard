import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const manifestSuffix = '.manifest.json'

export function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function required(value, name) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} is required when offsite backups are enabled`)
  return normalized
}

export function safePrefix(value) {
  const prefix = String(value || 'dashboard-sku').trim().replace(/^\/+|\/+$/g, '')
  if (!prefix || prefix.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9/_-]{0,255}$/.test(prefix)) {
    throw new Error('OSS_PREFIX must be a safe object-key prefix')
  }
  return prefix
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function inside(directory, path) {
  return resolve(path).startsWith(`${resolve(directory)}/`)
}

function missingObject(error) {
  return error?.status === 404 || error?.statusCode === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code)
}

async function defaultClientFactory(configuration) {
  const { default: OSS } = await import('ali-oss')
  return new OSS(configuration)
}

async function defaultCredentialProvider(roleName) {
  const imported = await import('@alicloud/credentials')
  const Credential = imported.default?.default || imported.default
  const provider = new Credential({ type: 'ecs_ram_role', roleName, disableIMDSv1: true })
  const credential = await provider.getCredential()
  return { accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret, stsToken: credential.securityToken }
}

export async function createOffsiteClient({ environment = process.env, clientFactory = defaultClientFactory, credentialProvider = defaultCredentialProvider } = {}) {
  const prefix = safePrefix(environment.OSS_PREFIX)
  const roleName = String(environment.OSS_ECS_RAM_ROLE || '').trim()
  const staticAccessKeyId = String(environment.OSS_ACCESS_KEY_ID || '').trim()
  const staticAccessKeySecret = String(environment.OSS_ACCESS_KEY_SECRET || '').trim()
  if (roleName && (staticAccessKeyId || staticAccessKeySecret || environment.OSS_STS_TOKEN)) throw new Error('Configure either OSS_ECS_RAM_ROLE or static OSS credentials, not both')
  const credentials = roleName
    ? await credentialProvider(roleName)
    : { accessKeyId: required(staticAccessKeyId, 'OSS_ACCESS_KEY_ID'), accessKeySecret: required(staticAccessKeySecret, 'OSS_ACCESS_KEY_SECRET'), stsToken: String(environment.OSS_STS_TOKEN || '').trim() }
  if (!credentials.accessKeyId || !credentials.accessKeySecret || (roleName && !credentials.stsToken)) throw new Error('OSS credential provider returned incomplete credentials')
  const timeout = Number(environment.OSS_TIMEOUT_MS || 120000)
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600000) throw new Error('OSS_TIMEOUT_MS must be an integer between 1000 and 600000')
  const configuration = {
    region: required(environment.OSS_REGION, 'OSS_REGION'),
    bucket: required(environment.OSS_BUCKET, 'OSS_BUCKET'),
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    authorizationV4: true,
    secure: true,
    timeout,
  }
  if (credentials.stsToken) configuration.stsToken = credentials.stsToken
  if (environment.OSS_ENDPOINT) configuration.endpoint = String(environment.OSS_ENDPOINT)
  return { client: await clientFactory(configuration), configuration, prefix, credentialMode: roleName ? 'ecs-ram-role' : 'static' }
}

async function uploadObject(client, object, { encryption }) {
  try {
    const existing = await client.head(object.key)
    if (existing?.meta?.sha256 === object.sha256) return { key: object.key, bytes: object.bytes, sha256: object.sha256, disposition: 'existing' }
    throw new Error(`Offsite object already exists with different content: ${object.key}`)
  } catch (error) {
    if (!missingObject(error)) throw error
  }

  const headers = { 'x-oss-forbid-overwrite': 'true' }
  if (encryption) headers['x-oss-server-side-encryption'] = encryption
  await client.put(object.key, object.path, {
    headers,
    meta: { sha256: object.sha256, bytes: String(object.bytes) },
    additionalHeaders: Object.keys(headers),
  })
  const uploaded = await client.head(object.key)
  if (uploaded?.meta?.sha256 !== object.sha256) throw new Error(`Offsite verification failed for ${object.key}`)
  return { key: object.key, bytes: object.bytes, sha256: object.sha256, disposition: 'uploaded' }
}

export async function uploadBackupSet({ manifestPath, environment = process.env, clientFactory = defaultClientFactory, credentialProvider = defaultCredentialProvider, now = () => new Date() }) {
  if (!enabled(environment.OFFSITE_BACKUP_ENABLED)) return { status: 'disabled' }

  const absoluteManifestPath = resolve(manifestPath)
  if (!absoluteManifestPath.endsWith(manifestSuffix)) throw new Error('Offsite upload requires a backup manifest path')
  const directory = dirname(absoluteManifestPath)
  const manifest = JSON.parse(await readFile(absoluteManifestPath, 'utf8'))
  const base = basename(absoluteManifestPath).slice(0, -manifestSuffix.length)
  if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1' || manifest.purpose !== 'scheduled') {
    throw new Error('Only verified scheduled backup sets can be uploaded offsite')
  }
  if (manifest.archive?.filename !== `${base}.dump` || manifest.assetArchive?.filename !== `${base}.epc-assets.tar.gz`) {
    throw new Error('Backup manifest filenames do not match the backup set')
  }

  const archivePath = resolve(directory, manifest.archive.filename)
  const assetPath = resolve(directory, manifest.assetArchive.filename)
  if (![archivePath, assetPath].every((path) => inside(directory, path))) throw new Error('Backup set escaped its backup directory')

  const { client, configuration, prefix, credentialMode } = await createOffsiteClient({ environment, clientFactory, credentialProvider })

  const files = [
    { path: archivePath, filename: manifest.archive.filename, expectedSha256: manifest.archive.sha256, expectedBytes: manifest.archive.bytes },
    { path: assetPath, filename: manifest.assetArchive.filename, expectedSha256: manifest.assetArchive.sha256, expectedBytes: manifest.assetArchive.bytes },
    { path: absoluteManifestPath, filename: basename(absoluteManifestPath) },
  ]
  const objects = []
  for (const file of files) {
    const information = await stat(file.path)
    if (!information.isFile()) throw new Error(`Backup member is not a regular file: ${file.filename}`)
    const sha256 = await sha256File(file.path)
    if (file.expectedSha256 && sha256 !== file.expectedSha256) throw new Error(`Backup member checksum changed before offsite upload: ${file.filename}`)
    if (Number.isFinite(file.expectedBytes) && information.size !== file.expectedBytes) throw new Error(`Backup member size changed before offsite upload: ${file.filename}`)
    objects.push({ ...file, bytes: information.size, sha256, key: `${prefix}/${base}/${file.filename}` })
  }

  const uploaded = []
  for (const object of objects) uploaded.push(await uploadObject(client, object, { encryption: String(environment.OSS_SERVER_SIDE_ENCRYPTION || 'AES256').trim() }))

  const receiptPath = resolve(directory, `${base}.offsite.json`)
  const receipt = {
    receiptVersion: 'dashboard-offsite-backup-v1',
    status: 'complete',
    provider: 'aliyun-oss',
    credentialMode,
    uploadedAt: now().toISOString(),
    releaseRevision: manifest.releaseRevision,
    manifest: basename(absoluteManifestPath),
    bucket: configuration.bucket,
    region: configuration.region,
    prefix,
    objects: uploaded,
  }
  const temporaryPath = `${receiptPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o640 })
  await chmod(temporaryPath, 0o640)
  await rename(temporaryPath, receiptPath)
  return { status: 'complete', receiptPath, bucket: configuration.bucket, region: configuration.region, objects: uploaded }
}
