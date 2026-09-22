import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApp } from './app.mjs'

test('quote templates persist, enforce roles and delete their parts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-quotes-test-'))
  let app = createApp({ dataDir: directory, origins: ['http://app.test'] })
  let base = ''
  async function listen() {
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${app.server.address().port}`
  }
  await listen()
  t.after(async () => {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  })
  async function call(path, method = 'GET', body, cookie = '') {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Request': '1',
        Origin: 'http://app.test',
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    }
  }

  assert.equal((await call('/quote-templates')).status, 401)
  const setupToken = readFileSync(join(directory, 'setup-token.txt'), 'utf8')
  const setup = await call('/auth/setup', 'POST', {
    setupToken,
    username: 'owner',
    password: 'pass',
  })
  assert.equal(setup.status, 201)
  const admin = setup.cookie
  assert.deepEqual((await call('/quote-templates', 'GET', undefined, admin)).body, [])

  const part = { id: randomUUID(), vehicle: '卡宴 E3', name: '空气滤芯', brand: '马勒', note: '' }
  const input = { name: '卡宴滤芯', customer: '黄总', note: '', isCommon: true, parts: [part] }
  const created = await call('/quote-templates', 'POST', input, admin)
  assert.equal(created.status, 201)
  assert.equal(created.body.version, 1)
  assert.deepEqual(created.body.parts, [part])
  assert.equal((await call('/quote-templates', 'GET', undefined, admin)).body.length, 1)

  const viewer = await call(
    '/users',
    'POST',
    {
      username: 'reader',
      password: 'pass',
      role: 'viewer',
      enabled: true,
    },
    admin,
  )
  assert.equal(viewer.status, 201)
  const viewerLogin = await call('/auth/login', 'POST', { username: 'reader', password: 'pass' })
  assert.equal((await call('/quote-templates', 'GET', undefined, viewerLogin.cookie)).status, 200)
  assert.equal((await call('/quote-templates', 'POST', input, viewerLogin.cookie)).status, 403)

  const changed = await call(
    `/quote-templates/${created.body.id}`,
    'PUT',
    {
      ...created.body,
      name: '卡宴滤芯组合',
      parts: [...created.body.parts, { ...part, id: randomUUID(), name: '空调滤芯' }],
    },
    admin,
  )
  assert.equal(changed.status, 200)
  assert.equal(changed.body.version, 2)
  assert.equal(changed.body.parts.length, 2)
  assert.equal(
    (await call(`/quote-templates/${created.body.id}`, 'PUT', created.body, admin)).status,
    409,
  )

  await app.close()
  app = createApp({ dataDir: directory, origins: ['http://app.test'] })
  await listen()
  const persisted = await call('/quote-templates', 'GET', undefined, admin)
  assert.equal(persisted.body[0].name, '卡宴滤芯组合')
  assert.equal(persisted.body[0].parts.length, 2)
  assert.equal(
    (await call(`/quote-templates/${created.body.id}`, 'DELETE', undefined, viewerLogin.cookie))
      .status,
    403,
  )
  assert.equal(
    (await call(`/quote-templates/${created.body.id}`, 'DELETE', undefined, admin)).status,
    200,
  )
  assert.deepEqual((await call('/quote-templates', 'GET', undefined, admin)).body, [])
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM quote_template_parts').get().count, 0)
})
