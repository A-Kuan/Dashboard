import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, resolve, sep } from 'node:path'

const contentTypes = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['application/pdf', 'pdf'],
])

function storageError(message, statusCode, errorCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.errorCode = errorCode
  return error
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && [0, 2].includes(c)) || (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224
}

function privateIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) return privateIpv4(normalized)
  if (isIP(normalized) !== 6) return true
  if (normalized.startsWith('::ffff:')) return privateIpv4(normalized.slice(7))
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
}

function detectContentType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif'
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  return ''
}

function normalizedDeclaredType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase()
}

async function readResponseBody(response, maxBytes) {
  if (!response.body) throw storageError('资源文件为空', 422, 'EPC_ASSET_EMPTY')
  const chunks = []
  let byteSize = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    byteSize += buffer.length
    if (byteSize > maxBytes) {
      await response.body.cancel?.().catch(() => {})
      throw storageError('资源文件超过大小限制', 413, 'EPC_ASSET_TOO_LARGE')
    }
    chunks.push(buffer)
  }
  if (!byteSize) throw storageError('资源文件为空', 422, 'EPC_ASSET_EMPTY')
  return Buffer.concat(chunks, byteSize)
}

export function createCatalogEpcAssetStorage({
  rootDir = process.env.CATALOG_EPC_ASSET_DIR || '',
  maxBytes = Number(process.env.CATALOG_EPC_ASSET_MAX_BYTES) || 12 * 1024 * 1024,
  timeoutMs = Number(process.env.CATALOG_EPC_ASSET_TIMEOUT_MS) || 15000,
  allowedHosts = process.env.CATALOG_EPC_ASSET_ALLOWED_HOSTS || '',
  fetchImpl = globalThis.fetch,
  lookupImpl = lookup,
  allowPrivateNetwork = false,
} = {}) {
  const storageRoot = rootDir ? resolve(rootDir) : ''
  const hostAllowlist = String(allowedHosts).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)

  async function assertSafeUrl(value) {
    let url
    try { url = new URL(value) } catch { throw storageError('资源地址无效', 400, 'EPC_ASSET_INVALID_URL') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw storageError('资源地址必须使用无凭据的 HTTP 或 HTTPS', 400, 'EPC_ASSET_UNSAFE_URL')
    if (url.port && !['80', '443'].includes(url.port)) throw storageError('资源地址端口不受支持', 400, 'EPC_ASSET_UNSAFE_URL')
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (hostAllowlist.length && !hostAllowlist.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) throw storageError('资源域名未进入允许列表', 403, 'EPC_ASSET_HOST_NOT_ALLOWED')
    if (!allowPrivateNetwork) {
      if (hostname === 'localhost') throw storageError('资源地址不能指向本机或内网', 400, 'EPC_ASSET_PRIVATE_NETWORK_BLOCKED')
      const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupImpl(hostname, { all: true, verbatim: true }).catch(() => { throw storageError('无法解析资源域名', 502, 'EPC_ASSET_DNS_FAILED') })
      if (!addresses.length || addresses.some((item) => privateIp(item.address))) throw storageError('资源地址不能指向本机或内网', 400, 'EPC_ASSET_PRIVATE_NETWORK_BLOCKED')
    }
    return url
  }

  async function fetchAsset(sourceUrl) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(60000, Math.max(1000, timeoutMs)))
    try {
      let url = await assertSafeUrl(sourceUrl)
      for (let redirect = 0; redirect <= 3; redirect += 1) {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'image/png,image/jpeg,image/webp,image/gif,application/pdf;q=0.9' } })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirect === 3) throw storageError('资源重定向次数过多', 502, 'EPC_ASSET_TOO_MANY_REDIRECTS')
          const location = response.headers.get('location')
          if (!location) throw storageError('资源重定向缺少目标地址', 502, 'EPC_ASSET_INVALID_REDIRECT')
          url = await assertSafeUrl(new URL(location, url).toString())
          continue
        }
        if (!response.ok) throw storageError(`资源服务器返回 ${response.status}`, 502, 'EPC_ASSET_UPSTREAM_ERROR')
        const declaredLength = Number(response.headers.get('content-length') || 0)
        if (declaredLength > maxBytes) throw storageError('资源文件超过大小限制', 413, 'EPC_ASSET_TOO_LARGE')
        const buffer = await readResponseBody(response, maxBytes)
        return buffer
      }
      throw storageError('资源重定向失败', 502, 'EPC_ASSET_INVALID_REDIRECT')
    } catch (error) {
      if (error.errorCode) throw error
      if (error.name === 'AbortError') throw storageError('资源下载超时', 504, 'EPC_ASSET_TIMEOUT')
      throw storageError('无法下载外部资源', 502, 'EPC_ASSET_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
    }
  }

  function absolutePath(storageKey) {
    if (!storageRoot) throw storageError('目录资源存储尚未配置', 503, 'EPC_ASSET_STORAGE_NOT_CONFIGURED')
    const target = resolve(storageRoot, storageKey)
    if (target !== storageRoot && !target.startsWith(`${storageRoot}${sep}`)) throw storageError('资源存储路径无效', 500, 'EPC_ASSET_STORAGE_PATH_INVALID')
    return target
  }

  return {
    configured: Boolean(storageRoot),
    status() { return { configured: Boolean(storageRoot), maxBytes, allowedHostsConfigured: Boolean(hostAllowlist.length) } },
    async mirror(asset) {
      if (!storageRoot) throw storageError('目录资源存储尚未配置', 503, 'EPC_ASSET_STORAGE_NOT_CONFIGURED')
      const buffer = await fetchAsset(asset.sourceUrl)
      const contentType = detectContentType(buffer)
      if (!contentType) throw storageError('资源文件类型不受支持', 422, 'EPC_ASSET_CONTENT_TYPE_UNSUPPORTED')
      const declaredType = normalizedDeclaredType(asset.declaredContentType)
      if (declaredType && declaredType !== contentType) throw storageError('资源实际类型与目录声明不一致', 422, 'EPC_ASSET_CONTENT_TYPE_MISMATCH')
      const checksumSha256 = createHash('sha256').update(buffer).digest('hex')
      const expected = String(asset.expectedChecksum || '').toLowerCase().replace(/^sha256:/, '')
      if (expected && expected !== checksumSha256) throw storageError('资源校验值与目录声明不一致', 422, 'EPC_ASSET_CHECKSUM_MISMATCH')
      const storageKey = `${checksumSha256.slice(0, 2)}/${checksumSha256}.${contentTypes.get(contentType)}`
      const target = absolutePath(storageKey)
      await mkdir(dirname(target), { recursive: true, mode: 0o750 })
      await writeFile(target, buffer, { flag: 'wx', mode: 0o640 }).catch(async (error) => {
        if (error.code !== 'EEXIST') throw error
        const existing = await readFile(target)
        if (createHash('sha256').update(existing).digest('hex') === checksumSha256) return
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, buffer, { flag: 'wx', mode: 0o640 })
        await rename(temporary, target)
      })
      return { storageKey, contentType, byteSize: buffer.length, checksumSha256 }
    },
    async verify(asset) {
      const target = absolutePath(asset.storageKey)
      const buffer = await readFile(target).catch((error) => {
        if (error.code === 'ENOENT') throw storageError('托管文件不存在', 409, 'EPC_ASSET_FILE_MISSING')
        throw error
      })
      const checksumSha256 = createHash('sha256').update(buffer).digest('hex')
      if (checksumSha256 !== asset.checksumSha256) throw storageError('托管文件校验值已变化', 409, 'EPC_ASSET_FILE_CORRUPT')
      const file = await stat(target)
      return { checksumSha256, byteSize: file.size }
    },
    async open(asset) {
      const target = absolutePath(asset.storageKey)
      await stat(target).catch((error) => {
        if (error.code === 'ENOENT') throw storageError('托管文件不存在', 409, 'EPC_ASSET_FILE_MISSING')
        throw error
      })
      return createReadStream(target)
    },
  }
}
