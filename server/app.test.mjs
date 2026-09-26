import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, hashPassword } from './app.mjs'

test('authenticated persistent customer and SKU workflow', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-api-test-'))
  let app = createApp({
    dataDir: directory,
    origins: ['http://app.test'],
    trustLoopbackProxy: true,
  })
  let base
  async function listen() {
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${app.server.address().port}`
  }
  await listen()
  t.after(async () => {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  })
  let adminCookie = ''
  async function call(path, method = 'GET', body, token = adminCookie, extra = {}) {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Request': '1',
        Origin: 'http://app.test',
        Cookie: token,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    }
  }
  let customerA, customerB, storedSku, viewerCookie, editorCookie, viewerId
  const sample = {
    code: 'TEST-001',
    name: '测试空气滤芯',
    category: '滤清系统',
    brand: '测试品牌',
    partNumber: 'TEST-PART',
    nature: 'AFTERMARKET',
    origin: '国产',
    country: '中国',
    unit: '个',
    specification: '',
    position: '前轴、左侧',
    packQuantity: 1,
    imageUrl: '',
    tradePriceMinor: 12000,
    repairPriceMinor: 14500,
    notes: '',
    enabled: true,
    numbers: [{ type: 'OE号', code: 'TEST-OE' }],
    fitments: [
      {
        make: '测试车厂',
        series: '测试车系',
        chassis: 'TEST',
        yearFrom: '2020',
        yearTo: '2025',
        power: '混动',
        engine: '',
        notes: '',
        verified: false,
      },
    ],
    stocks: [{ warehouse: '测试仓', bin: 'A1', quantity: 0 }],
    prices: [],
  }
  await t.test('blocks unauthenticated reads and cross-origin mutations', async () => {
    assert.equal((await call('/skus')).status, 401)
    assert.equal((await call('/customers')).status, 401)
    assert.equal(
      (await call('/auth/setup', 'POST', {}, '', { Origin: 'https://evil.test' })).status,
      403,
    )
    assert.equal(
      (await call('/auth/setup', 'POST', {}, '', { 'X-Dashboard-Request': '' })).status,
      403,
    )
    assert.equal((await call('/auth/session')).body.setupRequired, true)
  })
  await t.test('one-time setup and secure session', async () => {
    const token = readFileSync(join(directory, 'setup-token.txt'), 'utf8')
    assert.equal(
      (await call('/auth/setup', 'POST', { setupToken: token, username: 'owner', password: '' }))
        .status,
      400,
    )
    assert.equal(
      (
        await call('/auth/setup', 'POST', {
          setupToken: 'wrong',
          username: 'owner',
          password: 'short',
        })
      ).status,
      403,
    )
    const result = await call('/auth/setup', 'POST', {
      setupToken: token,
      username: 'owner',
      password: 'short',
    })
    assert.equal(result.status, 201)
    adminCookie = result.cookie
    assert.equal((await call('/auth/session')).body.user.role, 'admin')
    assert.equal((await call('/auth/setup', 'POST', { setupToken: token })).status, 403)
    assert.equal(
      (await call('/auth/login', 'POST', { username: 'owner', password: 'wrong-password' })).status,
      401,
    )
    const row = app.db.prepare('SELECT password_hash FROM users').get()
    assert.ok(!row.password_hash.includes('short'))
  })
  await t.test('serves the authenticated Porsche vehicle archive', async () => {
    const result = await call('/vehicle-models')
    assert.equal(result.status, 200)
    const macan = result.body.families.find((family) => family.id === 'macan')
    assert.equal(macan.codes[0], '95B.1')
    assert.equal(
      macan.generations.find((generation) => generation.code === '95B.3').years,
      '2022–2024',
    )
    assert.deepEqual(
      result.body.families
        .filter((family) => ['356', '914', '924', '944', '968', '918'].includes(family.id))
        .map((family) => family.id),
      ['356', '914', '924', '944', '968', '918'],
    )
    assert.deepEqual(result.body.eras[0].familyIds, ['356', '911', '914'])
    assert.ok(result.body.families.every((family) => family.image.endsWith('.png')))
  })
  await t.test('proxy login limits are isolated by validated client IP', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await call('/auth/login', 'POST', {}, '', { 'X-Real-IP': '198.51.100.10' })
      assert.equal(result.status, 400)
    }
    assert.equal(
      (await call('/auth/login', 'POST', {}, '', { 'X-Real-IP': '198.51.100.10' })).status,
      429,
    )
    assert.equal(
      (await call('/auth/login', 'POST', {}, '', { 'X-Real-IP': '198.51.100.11' })).status,
      400,
    )
    assert.equal(
      (await call('/auth/login', 'POST', {}, '', { 'X-Real-IP': 'not-an-ip' })).status,
      400,
    )
  })
  await t.test('dictionary groups, paging and SKU option validation', async () => {
    app.db
      .prepare(
        `INSERT INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json)
      VALUES('sku_foundation','category','商品品类','',1,'active','user',1,'test','{}')`,
      )
      .run()
    app.db
      .prepare(
        `INSERT INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json)
      VALUES('sku_foundation','unit','基本单位','',1,'active','user',2,'test-unit','{}')`,
      )
      .run()
    assert.equal((await call('/dictionaries/groups?scope=sku_foundation')).body.length, 2)
    const created = await call('/dictionaries/items?scope=sku_foundation&code=category', 'POST', {
      code: 'MANUAL_CODE_MUST_BE_IGNORED',
      label: '测试专用品类',
      description: '',
      sortOrder: 1,
      status: 'active',
      parentCode: null,
    })
    assert.equal(created.status, 201)
    assert.match(created.body.code, /^DICT_[0-9A-F]{32}$/)
    assert.notEqual(created.body.code, 'MANUAL_CODE_MUST_BE_IGNORED')
    assert.equal(
      (await call('/dictionaries/items?scope=sku_foundation&code=category&page=1&search=专用')).body
        .total,
      1,
    )
    assert.equal(
      (await call('/dictionaries/options?scope=sku_foundation&code=category')).body[0].label,
      '测试专用品类',
    )
    assert.equal(
      (
        await call('/dictionaries/items?scope=sku_foundation&code=category', 'PUT', {
          ...created.body,
          label: '测试分类已更新',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await call('/dictionaries/items?scope=sku_foundation&code=category', 'PUT', {
          ...created.body,
          label: '过期版本',
        })
      ).status,
      409,
    )
  })
  await t.test('dictionary items keep children under their parent', async () => {
    app.db
      .prepare(
        `INSERT INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json)
        VALUES('configuration','supply_type','供货性质','',1,'active','user',3,'test-supply-order','{}')`,
      )
      .run()
    const insert = app.db.prepare(
      `INSERT INTO dictionary_items(scope,dictionary_code,code,label,description,sort_order,status,parent_code,metadata_json,navigation_rule_json,source_id,source_json)
       VALUES('configuration','supply_type',?,?,'',?,'active',?,'{}','{}',?,'{}')`,
    )
    insert.run('GENUINE', '原厂件', 10, null, 'order-genuine')
    insert.run('AFTERMARKET', '品牌件', 20, null, 'order-aftermarket')
    insert.run('germany', '德国', 0, 'GENUINE', 'order-germany')
    insert.run('domestic_brand', '国产品牌', 0, 'AFTERMARKET', 'order-domestic')
    const result = await call('/dictionaries/items?scope=configuration&code=supply_type')
    assert.equal(result.status, 200)
    assert.deepEqual(
      result.body.rows.map((item) => item.code),
      ['GENUINE', 'germany', 'AFTERMARKET', 'domestic_brand'],
    )
    assert.equal(result.body.rows[1].parentLabel, '原厂件')
    const filtered = await call(
      '/dictionaries/items?scope=configuration&code=supply_type&search=国产品牌',
    )
    assert.deepEqual(
      filtered.body.rows.map((item) => item.code),
      ['domestic_brand'],
    )
    assert.equal(filtered.body.rows[0].parentLabel, '品牌件')
  })
  await t.test('SKU fields use matching active dictionaries', async () => {
    const addGroup = app.db.prepare(
      `INSERT INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json)
       VALUES('sku_foundation',?,?, '',1,'active','user',?,?,'{}')`,
    )
    addGroup.run('product_brand', '商品品牌', 3, 'test-product-brand')
    addGroup.run('vehicle_brand', '适配汽车品牌', 4, 'test-vehicle-brand')
    addGroup.run('position', '安装位置', 5, 'test-position')
    const addItem = app.db.prepare(
      `INSERT INTO dictionary_items(scope,dictionary_code,code,label,description,sort_order,status,parent_code,metadata_json,navigation_rule_json,source_id,source_json)
       VALUES('sku_foundation',?,?,?,'',0,'active',NULL,'{}','{}',?,'{}')`,
    )
    addItem.run('product_brand', 'TEST_BRAND', '测试品牌', 'test-brand-item')
    addItem.run('vehicle_brand', 'TEST_MAKE', '测试车厂', 'test-make-item')
    addItem.run('position', 'FRONT', '前轴', 'test-position-front')
    addItem.run('position', 'LEFT', '左侧', 'test-position-left')
    assert.equal(
      (
        await call('/skus', 'POST', {
          ...sample,
          code: 'INVALID-DICTIONARY-SKU',
          brand: '字典外品牌',
        })
      ).status,
      400,
    )
  })
  await t.test('persists customers with automatic codes and version protection', async () => {
    const typeOptions = await call('/dictionaries/options?scope=configuration&code=customer_type')
    const stageOptions = await call('/dictionaries/options?scope=configuration&code=customer_stage')
    assert.deepEqual(
      typeOptions.body.map((item) => item.label),
      ['同行', '修理厂', '待分类'],
    )
    assert.deepEqual(
      stageOptions.body.map((item) => item.label),
      ['待跟进', '询价中', '已报价', '合作中'],
    )
    const input = {
      code: 'C-001',
      name: '测试客户甲',
      customerType: '同行',
      contact: '测试',
      phone: '',
      notes: '',
      enabled: true,
    }
    customerA = (await call('/customers', 'POST', input)).body
    assert.match(customerA.code, /^KH\d{8}\d{3}$/)
    assert.notEqual(customerA.code, input.code)
    assert.equal(customerA.projectStage, '待跟进')
    assert.equal(
      (
        await call('/customers', 'POST', {
          ...input,
          code: 'C-INVALID',
          customerType: '字典外类型',
        })
      ).status,
      400,
    )
    customerB = (
      await call('/customers', 'POST', {
        ...input,
        code: 'C-002',
        name: '测试客户乙',
        customerType: '修理厂',
      })
    ).body
    assert.notEqual(customerB.code, customerA.code)
    assert.equal(
      (await call(`/customers/${customerA.id}`, 'PUT', { ...customerA, version: 0 })).status,
      409,
    )
    const moved = await call(`/customers/${customerA.id}`, 'PUT', {
      ...customerA,
      projectStage: '询价中',
      additionalContacts: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '采购联系人',
          phone: '13800138000',
          wechat: 'buyer-test',
          email: 'buyer@example.com',
        },
      ],
    })
    assert.equal(moved.body.projectStage, '询价中')
    assert.equal(moved.body.additionalContacts[0].name, '采购联系人')
    customerA = moved.body
    assert.equal(
      (await call(`/customers/${customerA.id}/activities`, 'POST', { content: '询价马勒空气滤芯' }))
        .status,
      201,
    )
    assert.equal(
      (await call(`/customers/${customerA.id}/activities`)).body[0].content,
      '询价马勒空气滤芯',
    )
  })
  await t.test('keeps customer prices separate and zero stock enabled', async () => {
    const result = await call('/skus', 'POST', {
      ...sample,
      prices: [
        { customerId: customerA.id, amountMinor: 12800 },
        { customerId: customerB.id, amountMinor: 15000 },
      ],
    })
    assert.equal(result.status, 201)
    storedSku = result.body
    assert.equal(storedSku.stocks[0].quantity, 0)
    assert.equal(storedSku.position, '前轴、左侧')
    assert.equal(storedSku.prices.find((p) => p.customerId === customerB.id).amountMinor, 15000)
    assert.equal(storedSku.tradePriceMinor, 12000)
    assert.equal(storedSku.repairPriceMinor, 14500)
    assert.equal(customerB.customerType, '修理厂')
    assert.equal((await call('/skus')).body.length, 1)
    const page = await call('/skus/page?page=1&search=TEST-001')
    assert.equal(page.status, 200)
    assert.equal(page.body.total, 1)
    assert.equal(page.body.rows[0].code, 'TEST-001')
    assert.deepEqual(page.body.brands, ['测试品牌'])
    assert.equal(
      (await call('/skus', 'POST', { ...sample, code: 'TEST-002', origin: '进口' })).status,
      201,
    )
    assert.equal((await call('/skus', 'POST', sample)).status, 409)
  })
  await t.test('supplier quote history stays separate from selling prices', async () => {
    const path = `/skus/${storedSku.id}/supplier-quotes`
    assert.equal(
      (
        await call(path, 'POST', {
          supplier: 'A',
          quotedOn: '2026-09-01',
          amountMinor: -1,
          notes: '',
        })
      ).status,
      400,
    )
    const first = await call(path, 'POST', {
      supplier: '供应商甲',
      quotedOn: '2026-09-01',
      amountMinor: 8000,
      notes: '',
    })
    assert.equal(first.status, 201)
    const second = await call(path, 'POST', {
      supplier: '供应商乙',
      quotedOn: '2026-09-20',
      amountMinor: 8500,
      notes: '报价有效期待核实',
    })
    assert.equal(second.status, 201)
    assert.equal(second.body.supplierQuotes.length, 2)
    assert.equal(second.body.supplierQuotes[0].amountMinor, 8500)
    assert.equal(second.body.prices.find((p) => p.customerId === customerA.id).amountMinor, 12800)
    assert.equal(second.body.tradePriceMinor, 12000)
    storedSku = second.body
  })
  await t.test(
    'validates fitment, origin, stock and customer references without partial writes',
    async () => {
      assert.equal(
        (
          await call('/skus', 'POST', {
            ...sample,
            code: 'BAD',
            nature: 'imported_volkswagen',
            origin: '国产',
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await call('/skus', 'POST', {
            ...sample,
            code: 'BAD',
            stocks: [{ warehouse: 'A', bin: 'B', quantity: -1 }],
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await call('/skus', 'POST', {
            ...sample,
            code: 'BAD',
            fitments: [{ ...sample.fitments[0], yearFrom: '2026', yearTo: '2020' }],
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await call('/skus', 'POST', {
            ...sample,
            code: 'BAD',
            prices: [{ customerId: 'missing', amountMinor: 100 }],
          })
        ).status,
        400,
      )
      assert.equal((await call('/skus')).body.length, 2)
    },
  )
  await t.test('uses active old supply-type codes while preserving an existing value', async () => {
    app.db
      .prepare(
        "INSERT INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json) VALUES('sku_foundation','supply_type','供货性质','',1,'active','user',3,'test-supply','{}')",
      )
      .run()
    app.db
      .prepare(
        "INSERT INTO dictionary_items(scope,dictionary_code,code,label,description,sort_order,status,parent_code,metadata_json,navigation_rule_json,source_id,source_json) VALUES('sku_foundation','supply_type','GENUINE','原厂件','',10,'active',NULL,'{}','{}','test-genuine','{}')",
      )
      .run()
    assert.equal(
      (await call('/dictionaries/options?scope=sku_foundation&code=supply_type')).body[0].code,
      'GENUINE',
    )
    assert.equal(
      (await call('/skus', 'POST', { ...sample, code: 'NEW-SUPPLY', nature: 'AFTERMARKET' }))
        .status,
      400,
    )
    storedSku = (await call(`/skus/${storedSku.id}`, 'PUT', { ...storedSku, nature: 'GENUINE' }))
      .body
    assert.equal(storedSku.nature, 'GENUINE')
    app.db
      .prepare(
        "UPDATE dictionary_items SET status='disabled' WHERE scope='sku_foundation' AND dictionary_code='supply_type' AND code='GENUINE'",
      )
      .run()
    assert.equal(
      (await call('/skus', 'POST', { ...sample, code: 'DISABLED-SUPPLY', nature: 'GENUINE' }))
        .status,
      400,
    )
    assert.equal((await call(`/skus/${storedSku.id}`, 'PUT', storedSku)).status, 200)
    app.db.prepare("UPDATE skus SET nature='待确认' WHERE id=?").run(storedSku.id)
    const unknownPage = await call('/skus/page?enabled=true&page=1&nature=UNKNOWN')
    assert.equal(unknownPage.body.total, 1)
    assert.equal(unknownPage.body.rows[0].nature, '待确认')
    storedSku = (await call('/skus')).body.find((item) => item.id === storedSku.id)
  })
  await t.test('read-only and editor roles are enforced by the server', async () => {
    const viewer = await call('/users', 'POST', {
      username: 'viewer',
      password: 'v',
      role: 'viewer',
    })
    viewerId = viewer.body.id
    viewerCookie = (
      await call('/auth/login', 'POST', {
        username: 'viewer',
        password: 'v',
      })
    ).cookie
    assert.equal((await call('/skus', 'GET', undefined, viewerCookie)).status, 200)
    assert.equal((await call('/customers', 'POST', {}, viewerCookie)).status, 403)
    assert.equal((await call('/skus', 'POST', sample, viewerCookie)).status, 403)
    assert.equal((await call('/users', 'GET', undefined, viewerCookie)).status, 403)
    await call('/users', 'POST', {
      username: 'editor',
      password: 'e',
      role: 'editor',
    })
    editorCookie = (
      await call('/auth/login', 'POST', {
        username: 'editor',
        password: 'e',
      })
    ).cookie
    assert.equal(
      (
        await call(
          '/customers',
          'POST',
          {
            code: 'C-003',
            name: '测试丙',
            customerType: '同行',
            contact: '',
            phone: '',
            notes: '',
            enabled: true,
          },
          editorCookie,
        )
      ).status,
      201,
    )
    assert.equal((await call('/users', 'POST', {}, editorCookie)).status, 403)
  })
  await t.test('deactivation hides SKU without deleting data; stale writes fail', async () => {
    const result = await call(`/skus/${storedSku.id}`, 'PUT', { ...storedSku, enabled: false })
    assert.equal(result.status, 200)
    assert.equal((await call('/skus')).body.length, 1)
    assert.equal((await call('/skus?enabled=false')).body[0].prices.length, 2)
    assert.equal((await call(`/skus/${storedSku.id}`, 'PUT', storedSku)).status, 409)
  })
  await t.test('database and sessions survive server restart', async () => {
    await app.close()
    app = createApp({ dataDir: directory, origins: ['http://app.test'] })
    await listen()
    assert.equal((await call('/customers')).body.length, 3)
    assert.equal(
      (await call('/customers')).body.find((row) => row.id === customerA.id).projectStage,
      '询价中',
    )
    assert.equal(
      (await call(`/customers/${customerA.id}/activities`)).body[0].content,
      '询价马勒空气滤芯',
    )
    assert.equal((await call('/skus?enabled=false')).body[0].prices.length, 2)
    assert.equal((await call('/auth/session')).body.user.username, 'owner')
  })
  await t.test('disable and logout revoke access', async () => {
    assert.equal(
      (await call(`/users/${viewerId}`, 'PUT', { role: 'viewer', enabled: false })).status,
      200,
    )
    assert.equal((await call('/skus', 'GET', undefined, viewerCookie)).status, 401)
    assert.equal((await call('/auth/logout', 'POST', {}, editorCookie)).status, 200)
    assert.equal((await call('/skus', 'GET', undefined, editorCookie)).status, 401)
  })
})

test('development auth bypass reuses an enabled local account only when explicitly enabled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-dev-auth-test-'))
  let app = createApp({ dataDir: directory, origins: ['http://app.test'], devAuthBypass: true })
  app.db
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
    .run(
      'local-admin',
      'localadmin',
      await hashPassword('unused'),
      'admin',
      1,
      new Date().toISOString(),
    )
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  let base = `http://127.0.0.1:${app.server.address().port}`
  let response = await fetch(`${base}/api/auth/session`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.username, 'localadmin')
  assert.equal((await fetch(`${base}/api/vehicle-models`)).status, 200)
  await app.close()

  app = createApp({ dataDir: directory, origins: ['http://app.test'] })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${app.server.address().port}`
  response = await fetch(`${base}/api/vehicle-models`)
  assert.equal(response.status, 401)
  await app.close()
  rmSync(directory, { recursive: true, force: true })
})

test('SPA fallback accepts generation codes containing dots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-spa-fallback-test-'))
  const distDir = join(directory, 'dist')
  mkdirSync(distDir)
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Dashboard</title>')
  const app = createApp({ dataDir: join(directory, 'data'), distDir })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}`
  const detail = await fetch(`${base}/vehicles/macan/95B.3`)
  assert.equal(detail.status, 200)
  assert.match(await detail.text(), /Dashboard/)
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
  await app.close()
  rmSync(directory, { recursive: true, force: true })
})
