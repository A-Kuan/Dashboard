import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCatalogEpcAssetStorage } from '../src/catalog-epc-asset-storage.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

test('mirrors content-addressed EPC assets and verifies their integrity', async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'hushanxing-epc-assets-'))
  context.after(() => rm(rootDir, { recursive: true, force: true }))
  const checksum = createHash('sha256').update(png).digest('hex')
  const storage = createCatalogEpcAssetStorage({
    rootDir, allowPrivateNetwork: true,
    fetchImpl: async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } }),
  })
  const result = await storage.mirror({ sourceUrl: 'https://assets.example.test/601-05.png', declaredContentType: 'image/png', expectedChecksum: `sha256:${checksum}` })
  assert.equal(result.contentType, 'image/png')
  assert.equal(result.byteSize, png.length)
  assert.equal(result.checksumSha256, checksum)
  assert.match(result.storageKey, new RegExp(`^${checksum.slice(0, 2)}/${checksum}\\.png$`))
  assert.deepEqual(await storage.verify({ storageKey: result.storageKey, checksumSha256: checksum }), { checksumSha256: checksum, byteSize: png.length })
  const chunks = []
  for await (const chunk of await storage.open({ storageKey: result.storageKey })) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), png)
})

test('rejects checksum and declared content-type mismatches', async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'hushanxing-epc-assets-'))
  context.after(() => rm(rootDir, { recursive: true, force: true }))
  const storage = createCatalogEpcAssetStorage({ rootDir, allowPrivateNetwork: true, fetchImpl: async () => new Response(png, { status: 200 }) })
  await assert.rejects(() => storage.mirror({ sourceUrl: 'https://assets.example.test/a.png', declaredContentType: 'application/pdf' }), { errorCode: 'EPC_ASSET_CONTENT_TYPE_MISMATCH' })
  await assert.rejects(() => storage.mirror({ sourceUrl: 'https://assets.example.test/a.png', expectedChecksum: `sha256:${'a'.repeat(64)}` }), { errorCode: 'EPC_ASSET_CHECKSUM_MISMATCH' })
})

test('stops reading an unbounded response when it exceeds the configured limit', async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'hushanxing-epc-assets-'))
  context.after(() => rm(rootDir, { recursive: true, force: true }))
  const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(1)])
  const storage = createCatalogEpcAssetStorage({ rootDir, maxBytes: 16, allowPrivateNetwork: true, fetchImpl: async () => new Response(body) })
  await assert.rejects(() => storage.mirror({ sourceUrl: 'http://127.0.0.1/large.png' }), { errorCode: 'EPC_ASSET_TOO_LARGE' })
})

test('blocks private networks and validates every redirect target', async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'hushanxing-epc-assets-'))
  context.after(() => rm(rootDir, { recursive: true, force: true }))
  let requests = 0
  const storage = createCatalogEpcAssetStorage({
    rootDir,
    lookupImpl: async (hostname) => hostname === 'public.example.test' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => { requests += 1; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private.png' } }) },
  })
  await assert.rejects(() => storage.mirror({ sourceUrl: 'http://127.0.0.1/private.png' }), { errorCode: 'EPC_ASSET_PRIVATE_NETWORK_BLOCKED' })
  assert.equal(requests, 0)
  await assert.rejects(() => storage.mirror({ sourceUrl: 'https://public.example.test/a.png' }), { errorCode: 'EPC_ASSET_PRIVATE_NETWORK_BLOCKED' })
  assert.equal(requests, 1)
})
