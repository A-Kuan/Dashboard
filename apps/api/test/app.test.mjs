import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'

function createRepository() {
  const items = []
  return {
    list: async () => items,
    get: async (id) => items.find((item) => item.id === id || item.skuCode === id) || null,
    codeExists: async (code, exceptId) => items.some((item) => item.skuCode === code && item.id !== exceptId),
    create: async (input) => { const item = { id: 'sku-1', ...input }; items.push(item); return item },
    update: async (id, input) => { const index = items.findIndex((item) => item.id === id); items[index] = { ...items[index], ...input }; return items[index] },
  }
}

function createDictionaryRepository() {
  let config = { version: 1, dictionaries: { sku_brand: { label: '品牌', items: [{ value: '__all__', label: '全部', sort: 0, enabled: true }] } } }
  const defaults = structuredClone(config)
  return {
    get: async () => config,
    save: async (next) => { config = { ...next, version: config.version + 1 }; return config },
    reset: async () => { config = { ...structuredClone(defaults), version: config.version + 1 }; return config },
  }
}

const input = {
  skuCode: 'TEST-001', chineseName: '测试零件', brand: 'Porsche', category: '车身及内饰',
  subcategory: '内饰件', manufacturerPartNumber: 'TEST 001', primaryOe: 'TEST 001', unit: '件',
  lifecycleStatus: '草稿', oeRelations: [], fitments: [],
}

test('creates, lists, reads and updates a SKU', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  const created = await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().skuCode, 'TEST-001')
  assert.equal((await app.inject('/api/v1/skus')).json().items.length, 1)
  assert.equal((await app.inject('/api/v1/skus/sku-1')).json().chineseName, '测试零件')
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, chineseName: '测试零件二' } })
  assert.equal(updated.json().chineseName, '测试零件二')
  await app.close()
})

test('rejects missing fields and duplicate SKU codes', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/skus', payload: {} })).statusCode, 400)
  await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })).statusCode, 409)
  await app.close()
})

test('rejects Chinese characters in identifier fields', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  for (const key of ['skuCode', 'manufacturerPartNumber', 'primaryOe']) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/skus', payload: { ...input, [key]: '零件-001' } })
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /仅支持英文字母/)
  }
  await app.close()
})

test('keeps drafts out of the published state until publish requirements pass', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  const created = await app.inject({ method: 'POST', url: '/api/v1/skus', payload: { ...input, lifecycleStatus: '在售' } })
  assert.equal(created.json().lifecycleStatus, '草稿')
  const invalidPublish = await app.inject({ method: 'POST', url: '/api/v1/skus/sku-1/publish', payload: input })
  assert.equal(invalidPublish.statusCode, 422)
  const validPublish = await app.inject({ method: 'POST', url: '/api/v1/skus/sku-1/publish', payload: {
    ...input,
    dataSource: '人工录入',
    oeRelations: [{ type: '主 OE', oeNumber: input.primaryOe }],
    fitments: [{ vehicle: 'Porsche Cayenne' }],
  } })
  assert.equal(validPublish.statusCode, 200)
  assert.equal(validPublish.json().lifecycleStatus, '在售')
  await app.close()
})

test('reads, saves and resets shared dictionaries', async () => {
  const app = buildApp({ repository: createRepository(), dictionaryRepository: createDictionaryRepository(), logger: false })
  const initial = await app.inject('/api/v1/dictionaries')
  assert.equal(initial.json().dictionaries.sku_brand.items[0].label, '全部')
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/dictionaries', payload: { version: 1, dictionaries: { sku_brand: { label: '品牌', items: [{ value: '__all__', label: '全部', sort: 0, enabled: true }, { value: 'Audi', label: 'Audi', sort: 10, enabled: true }] } } } })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.json().dictionaries.sku_brand.items[1].label, 'Audi')
  const reset = await app.inject({ method: 'POST', url: '/api/v1/dictionaries/reset' })
  assert.equal(reset.json().dictionaries.sku_brand.items.length, 1)
  await app.close()
})
