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
    create: async (input, actor) => { const item = { id: 'sku-1', ...input, updatedBy: actor, version: 1, changeHistory: [{ version: 1, action: '创建草稿', changedBy: actor }] }; items.push(item); return item },
    update: async (id, input, actor, action = '保存草稿') => {
      const index = items.findIndex((item) => item.id === id)
      if (items[index].version !== input.version) {
        const error = new Error(`该 SKU 已被其他操作更新（当前版本 v${items[index].version}），请刷新后再编辑`)
        error.statusCode = 409
        error.errorCode = 'SKU_VERSION_CONFLICT'
        throw error
      }
      const version = items[index].version + 1
      items[index] = { ...items[index], ...input, updatedBy: actor, version, changeHistory: [{ version, action, changedBy: actor }, ...items[index].changeHistory] }
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

function createVehicleRepository() {
  const items = []
  return {
    list: async () => items,
    get: async (id) => items.find((item) => item.id === id || item.vehicleCode === id) || null,
    codeExists: async (code, exceptId) => items.some((item) => item.vehicleCode === code && item.id !== exceptId),
    create: async (input, actor) => { const item = { id: 'vehicle-1', ...input, updatedBy: actor, version: 1, lifecycleStatus: '草稿', changeHistory: [] }; items.push(item); return item },
    update: async (id, input, actor, action = '保存车型资料') => {
      const index = items.findIndex((item) => item.id === id)
      if (items[index].version !== input.version) {
        const error = new Error('该车型已被其他操作更新，请刷新后再编辑')
        error.statusCode = 409
        error.errorCode = 'VEHICLE_VERSION_CONFLICT'
        throw error
      }
      items[index] = { ...items[index], ...input, updatedBy: actor, version: items[index].version + 1, changeHistory: [{ action }, ...(items[index].changeHistory || [])] }
      return items[index]
    },
    autoMatch: async (id) => items.find((item) => item.id === id),
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
  assert.equal(created.json().updatedBy, '系统操作员')
  assert.equal((await app.inject('/api/v1/skus')).json().items.length, 1)
  assert.equal((await app.inject('/api/v1/skus/sku-1')).json().chineseName, '测试零件')
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 1, chineseName: '测试零件二' } })
  assert.equal(updated.json().chineseName, '测试零件二')
  assert.equal(updated.json().version, 2)
  assert.equal(updated.json().updatedBy, '系统操作员')
  await app.close()
})

test('normalizes legacy and multiple SKU images', async () => {
  const app = buildApp({ repository: createRepository(), logger: false })
  const created = await app.inject({ method: 'POST', url: '/api/v1/skus', payload: { ...input, imageUrl: 'legacy-image' } })
  assert.equal(created.statusCode, 201)
  assert.deepEqual(created.json().imageUrls, ['legacy-image'])
  assert.equal(created.json().imageUrl, 'legacy-image')
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 1, imageUrls: ['primary-image', 'detail-image'] } })
  assert.equal(updated.statusCode, 200)
  assert.deepEqual(updated.json().imageUrls, ['primary-image', 'detail-image'])
  assert.equal(updated.json().imageUrl, 'primary-image')
  const tooMany = await app.inject({ method: 'PUT', url: '/api/v1/skus/sku-1', payload: { ...input, version: 2, imageUrls: Array.from({ length: 9 }, (_, index) => `image-${index}`) } })
  assert.equal(tooMany.statusCode, 400)
  assert.match(tooMany.json().message, /最多上传 8 张/)
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

test('creates, updates, publishes and auto-matches a vehicle aggregate', async () => {
  const app = buildApp({ repository: createRepository(), vehicleRepository: createVehicleRepository(), logger: false })
  const vehicle = {
    vehicleCode: 'POR-MACAN-95B-20T-2014-2018', brand: '保时捷', series: 'Macan', platform: '95B',
    displayName: '保时捷 Macan 95B', displacement: '2.0L', engineCode: 'CYP', transmissionCode: 'A5B03',
    yearStart: 2014, yearEnd: 2018, sampleVin: 'WP1AA2951HLB19468', dataSource: 'Porsche EPC',
    requirements: [{ itemName: '机油格', partNumber: '95811556201', quantity: 1 }],
    packages: [{ packageCode: 'MINOR', name: '小保养套餐', items: [] }],
  }
  const created = await app.inject({ method: 'POST', url: '/api/v1/vehicles', payload: vehicle })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().vehicleCode, vehicle.vehicleCode)
  assert.equal((await app.inject('/api/v1/vehicles')).json().items.length, 1)
  assert.equal((await app.inject('/api/v1/vehicles/vehicle-1')).json().sampleVin, vehicle.sampleVin)
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/vehicles/vehicle-1', payload: { ...created.json(), market: '中国' } })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().market, '中国')
  const matched = await app.inject({ method: 'POST', url: '/api/v1/vehicles/vehicle-1/auto-match' })
  assert.equal(matched.statusCode, 200)
  const published = await app.inject({ method: 'POST', url: '/api/v1/vehicles/vehicle-1/publish', payload: updated.json() })
  assert.equal(published.statusCode, 200)
  assert.equal(published.json().lifecycleStatus, '已发布')
  await app.close()
})

test('validates VIN, publish requirements and stale vehicle versions', async () => {
  const app = buildApp({ repository: createRepository(), vehicleRepository: createVehicleRepository(), logger: false })
  const base = { vehicleCode: 'TEST-VEHICLE', brand: '测试品牌', series: '测试车系', platform: 'T1', displayName: '测试车型' }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/vehicles', payload: { ...base, sampleVin: 'INVALID' } })).statusCode, 400)
  const created = await app.inject({ method: 'POST', url: '/api/v1/vehicles', payload: base })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/vehicles/vehicle-1/publish', payload: created.json() })).statusCode, 422)
  await app.inject({ method: 'PUT', url: '/api/v1/vehicles/vehicle-1', payload: { ...created.json(), displayName: '新名称' } })
  const stale = await app.inject({ method: 'PUT', url: '/api/v1/vehicles/vehicle-1', payload: { ...created.json(), displayName: '过期覆盖' } })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().error, 'VEHICLE_VERSION_CONFLICT')
  await app.close()
})
