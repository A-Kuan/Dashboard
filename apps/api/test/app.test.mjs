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
