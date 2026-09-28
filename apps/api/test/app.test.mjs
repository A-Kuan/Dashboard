import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { defaultDictionaries } from '../src/default-dictionaries.mjs'

function createRepository() {
  const items = []
  return {
    list: async () => items,
    get: async (id) => items.find((item) => item.id === id || item.skuCode === id) || null,
    codeExists: async (code, exceptId) => items.some((item) => item.skuCode === code && item.id !== exceptId),
    create: async (input) => { const item = { id: 'sku-1', ...input, version: 1, changeHistory: [{ version: 1, action: '创建草稿' }] }; items.push(item); return item },
    update: async (id, input, _actor, action = '保存草稿') => {
      const index = items.findIndex((item) => item.id === id)
      if (items[index].version !== input.version) {
        const error = new Error(`该 SKU 已被其他操作更新（当前版本 v${items[index].version}），请刷新后再编辑`)
        error.statusCode = 409
        error.errorCode = 'SKU_VERSION_CONFLICT'
        throw error
      }
      const version = items[index].version + 1
      items[index] = { ...items[index], ...input, version, changeHistory: [{ version, action }, ...items[index].changeHistory] }
      return items[index]
    },
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
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 1, chineseName: '测试零件二' } })
  assert.equal(updated.json().chineseName, '测试零件二')
  assert.equal(updated.json().version, 2)
  await app.close()
})

test('rejects missing fields and duplicate SKU codes', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/skus', payload: {} })).statusCode, 400)
  const missingUnit = await app.inject({ method: 'POST', url: '/api/v1/skus', payload: { ...input, unit: '' } })
  assert.equal(missingUnit.statusCode, 400)
  assert.match(missingUnit.json().message, /计量单位/)
  await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })).statusCode, 409)
  await app.close()
})

test('allows drafts without a subcategory or manufacturer part number', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/skus',
    payload: { ...input, skuCode: 'OPTIONAL-001', subcategory: '', manufacturerPartNumber: '' },
  })
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().subcategory, '')
  assert.equal(response.json().manufacturerPartNumber, '')
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
  const invalidPublish = await app.inject({ method: 'POST', url: '/api/v1/skus/sku-1/publish', payload: { ...input, version: 1 } })
  assert.equal(invalidPublish.statusCode, 422)
  const validPublish = await app.inject({ method: 'POST', url: '/api/v1/skus/sku-1/publish', payload: {
    ...input,
    version: 1,
    dataSource: '人工录入',
    oeRelations: [{ type: '主 OE', oeNumber: input.primaryOe }],
    fitments: [{ vehicle: 'Porsche Cayenne' }],
  } })
  assert.equal(validPublish.statusCode, 200)
  assert.equal(validPublish.json().lifecycleStatus, '在售')
  assert.equal(validPublish.json().changeHistory[0].action, '发布 SKU')
  const discontinued = await app.inject({ method: 'POST', url: '/api/v1/skus/sku-1/discontinue', payload: { version: 2 } })
  assert.equal(discontinued.statusCode, 200)
  assert.equal(discontinued.json().lifecycleStatus, '停产')
  assert.equal(discontinued.json().changeHistory[0].action, '停产 SKU')
  await app.close()
})

test('rejects stale SKU updates instead of overwriting newer data', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  await app.inject({ method: 'POST', url: '/api/v1/skus', payload: input })
  const first = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 1, chineseName: '第一次保存' } })
  assert.equal(first.statusCode, 200)
  const stale = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 1, chineseName: '过期覆盖' } })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().error, 'SKU_VERSION_CONFLICT')
  assert.match(stale.json().message, /刷新后再编辑/)
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

test('provides maintainable unit dictionary defaults', () => {
  assert.deepEqual(defaultDictionaries.dictionaries.unit.items.map((item) => item.label), ['件', '套', '盒', '支'])
  assert.deepEqual(
    ['data_source', 'oe_type', 'oe_relation', 'confidence_level', 'body_type', 'verification_status'].filter((code) => defaultDictionaries.dictionaries[code]),
    ['data_source', 'oe_type', 'oe_relation', 'confidence_level', 'body_type', 'verification_status'],
  )
})
