import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve, join, extname, sep } from 'node:path'
import { openDatabase, transaction } from './database.mjs'
import { ApiError, text, customerInput, skuInput, quoteTemplateInput } from './validation.mjs'
import catalog from '../shared/catalog.json' with { type: 'json' }

const deriveKey = promisify(scrypt)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  enabled: Boolean(u.enabled),
})

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await deriveKey(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  return `${salt}:${key.toString('hex')}`
}
async function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(':')
  const key = await deriveKey(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  return timingSafeEqual(key, Buffer.from(digest, 'hex'))
}
function credentials(body) {
  const username = text(body.username, '账号', true, 60)
  const password = text(body.password, '密码', true, 128)
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username))
    throw new ApiError(400, '账号须为 3–60 位字母、数字或 _ . -')
  return { username, password }
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new ApiError(415, '仅接受 JSON 请求')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new ApiError(413, '请求内容过大')
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw new ApiError(400, 'JSON 格式错误')
  }
}

export function createApp({
  dataDir,
  origins = ['http://127.0.0.1:4179'],
  secureCookie = false,
  trustLoopbackProxy = false,
  distDir = resolve('dist'),
}) {
  const db = openDatabase(dataDir)
  const setupFile = join(dataDir, 'setup-token.txt')
  const hasUsers = () => db.prepare('SELECT COUNT(*) AS total FROM users').get().total > 0
  if (!hasUsers() && !existsSync(setupFile))
    writeFileSync(setupFile, randomBytes(32).toString('hex'), { mode: 0o600 })
  const dummyHash = hashPassword(randomBytes(32).toString('hex'))
  const attempts = new Map()
  function rateLimit(req) {
    const peer = req.socket.remoteAddress
    const forwarded = req.headers['x-real-ip']
    const key =
      trustLoopbackProxy &&
      (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') &&
      typeof forwarded === 'string' &&
      isIP(forwarded)
        ? forwarded
        : peer
    const time = Date.now()
    for (const [ip, entry] of attempts) if (entry.until < time) attempts.delete(ip)
    const value = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1000 }
    if (value.count >= 20) throw new ApiError(429, '尝试过于频繁，请 15 分钟后重试')
    value.count++
    attempts.set(key, value)
  }
  const audit = (user, action, id) =>
    db
      .prepare('INSERT INTO audit_log(user_id,action,entity_id,created_at) VALUES(?,?,?,?)')
      .run(user.id, action, id, now())
  function json(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  function cookie(res, token, age) {
    res.setHeader(
      'Set-Cookie',
      `dashboard_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookie ? '; Secure' : ''}`,
    )
  }
  function issueSession(res, user) {
    const token = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      hash(token),
      user.id,
      Date.now() + 12 * 60 * 60 * 1000,
    )
    cookie(res, token, 12 * 60 * 60)
  }
  function session(req) {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
    const token = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('dashboard_session='))
      ?.slice(18)
    if (!token) return null
    return (
      db
        .prepare(
          'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND u.enabled=1',
        )
        .get(hash(token)) ?? null
    )
  }
  function checkVersion(body, row) {
    if (!row) throw new ApiError(404, '记录不存在')
    if (body.version !== row.version)
      throw new ApiError(409, '记录已被其他操作修改，请关闭后刷新并重试')
  }
  function customer(row) {
    return {
      ...row,
      customerType: row.customer_type,
      projectStage: row.project_stage,
      enabled: Boolean(row.enabled),
      updatedAt: row.updated_at,
    }
  }
  function quoteTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      customer: row.customer,
      note: row.note,
      isCommon: Boolean(row.is_common),
      version: row.version,
      updatedAt: row.updated_at,
      parts: db
        .prepare(
          'SELECT id,vehicle,sku_id AS skuId,sku_code AS skuCode,name,brand,price_minor AS priceMinor,note FROM quote_template_parts WHERE template_id=? ORDER BY position',
        )
        .all(row.id)
        .map((part) => ({ ...part, skuId: part.skuId ?? '' })),
    }
  }
  function sku(row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      brand: row.brand,
      sourceCategoryPath:
        db.prepare('SELECT category_path FROM sku_source WHERE sku_id=?').get(row.id)
          ?.category_path ?? '',
      sourceManufacturer:
        db.prepare('SELECT manufacturer FROM sku_source WHERE sku_id=?').get(row.id)
          ?.manufacturer ?? '',
      partNumber: row.part_number,
      nature: row.nature,
      origin: row.origin,
      country: row.country,
      unit: row.unit,
      specification: row.specification,
      position: row.position,
      packQuantity: row.pack_quantity,
      imageUrl: row.image_url,
      tradePriceMinor: row.trade_price_minor,
      repairPriceMinor: row.repair_price_minor,
      notes: row.notes,
      enabled: Boolean(row.enabled),
      version: row.version,
      updatedAt: row.updated_at,
      numbers: db.prepare('SELECT type,code FROM sku_numbers WHERE sku_id=?').all(row.id),
      fitments: db
        .prepare('SELECT * FROM fitments WHERE sku_id=?')
        .all(row.id)
        .map((f) => ({
          make: f.make,
          series: f.series,
          chassis: f.chassis,
          yearFrom: f.year_from,
          yearTo: f.year_to,
          power: f.power,
          engine: f.engine,
          notes: f.notes,
          verified: Boolean(f.verified),
        })),
      stocks: db
        .prepare('SELECT warehouse,bin,quantity FROM stock_balances WHERE sku_id=?')
        .all(row.id),
      prices: db
        .prepare(
          'SELECT customer_id AS customerId,amount_minor AS amountMinor,updated_at AS updatedAt FROM customer_prices WHERE sku_id=?',
        )
        .all(row.id),
      supplierQuotes: db
        .prepare(
          'SELECT id,supplier,quoted_on AS quotedOn,amount_minor AS amountMinor,notes,created_at AS createdAt FROM supplier_quotes WHERE sku_id=? ORDER BY quoted_on DESC,created_at DESC',
        )
        .all(row.id),
    }
  }
  function saveSku(id, value, existing, user) {
    return transaction(db, () => {
      for (const price of value.prices)
        if (!db.prepare('SELECT id FROM customers WHERE id=?').get(price.customerId))
          throw new ApiError(400, '价格关联的客户不存在')
      const args = [
        value.code,
        value.name,
        value.category,
        value.brand,
        value.partNumber,
        value.nature,
        value.origin,
        value.country,
        value.unit,
        value.specification,
        value.position,
        value.packQuantity,
        value.imageUrl,
        value.notes,
        Number(value.enabled),
        now(),
      ]
      if (existing)
        db.prepare(
          'UPDATE skus SET code=?,name=?,category=?,brand=?,part_number=?,nature=?,origin=?,country=?,unit=?,specification=?,position=?,pack_quantity=?,image_url=?,notes=?,enabled=?,updated_at=?,trade_price_minor=?,repair_price_minor=?,version=version+1 WHERE id=?',
        ).run(...args, value.tradePriceMinor, value.repairPriceMinor, id)
      else
        db.prepare(
          'INSERT INTO skus(code,name,category,brand,part_number,nature,origin,country,unit,specification,position,pack_quantity,image_url,notes,enabled,updated_at,trade_price_minor,repair_price_minor,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(...args, value.tradePriceMinor, value.repairPriceMinor, id)
      const oldPrices = db.prepare('SELECT * FROM customer_prices WHERE sku_id=?').all(id)
      for (const table of ['sku_numbers', 'fitments', 'stock_balances', 'customer_prices'])
        db.prepare(`DELETE FROM ${table} WHERE sku_id=?`).run(id)
      for (const n of value.numbers)
        db.prepare('INSERT INTO sku_numbers VALUES(?,?,?)').run(id, n.type, n.code)
      for (const f of value.fitments)
        db.prepare('INSERT INTO fitments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),
          id,
          f.make,
          f.series,
          f.chassis,
          f.yearFrom,
          f.yearTo,
          f.power,
          f.engine,
          f.notes,
          Number(f.verified),
        )
      for (const s of value.stocks)
        db.prepare('INSERT INTO stock_balances VALUES(?,?,?,?)').run(
          id,
          s.warehouse,
          s.bin,
          s.quantity,
        )
      for (const p of value.prices) {
        const old = oldPrices.find(
          (item) => item.customer_id === p.customerId && item.amount_minor === p.amountMinor,
        )
        db.prepare('INSERT INTO customer_prices VALUES(?,?,?,?)').run(
          id,
          p.customerId,
          p.amountMinor,
          old?.updated_at ?? now(),
        )
      }
      audit(user, existing ? 'sku.update' : 'sku.create', id)
      return sku(db.prepare('SELECT * FROM skus WHERE id=?').get(id))
    })
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, '不支持此请求方法')
        let file = resolve(distDir, '.' + decodeURIComponent(path))
        if (!file.startsWith(resolve(distDir) + sep)) file = join(distDir, 'index.html')
        if (!existsSync(file) || !statSync(file).isFile()) {
          if (extname(path)) throw new ApiError(404, '文件不存在')
          file = join(distDir, 'index.html')
        }
        if (!existsSync(file)) throw new ApiError(503, '请先构建前端')
        const mime = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
        }
        res.writeHead(200, {
          'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
        })
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
        return
      }
      const mutating = !['GET', 'HEAD'].includes(req.method)
      if (
        mutating &&
        (!origins.includes(req.headers.origin) || req.headers['x-dashboard-request'] !== '1')
      )
        throw new ApiError(403, '请求来源不被允许，请从本站页面操作')
      const user = session(req)
      if (path === '/api/auth/session' && req.method === 'GET')
        return json(res, 200, { user: user ? publicUser(user) : null, setupRequired: !hasUsers() })
      if (path === '/api/auth/setup' && req.method === 'POST') {
        rateLimit(req)
        if (hasUsers()) throw new ApiError(403, '管理员已初始化')
        const body = await readBody(req)
        const supplied = text(body.setupToken, '初始化码', true, 100)
        if (
          !existsSync(setupFile) ||
          !timingSafeEqual(
            Buffer.from(hash(supplied)),
            Buffer.from(hash(readFileSync(setupFile, 'utf8').trim())),
          )
        )
          throw new ApiError(403, '初始化码不正确')
        const c = credentials(body)
        const passwordHash = await hashPassword(c.password)
        const id = randomUUID()
        transaction(db, () => {
          if (hasUsers()) throw new ApiError(403, '管理员已初始化')
          db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(
            id,
            c.username,
            passwordHash,
            'admin',
            1,
            now(),
          )
        })
        unlinkSync(setupFile)
        const created = db.prepare('SELECT * FROM users WHERE id=?').get(id)
        issueSession(res, created)
        return json(res, 201, publicUser(created))
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        rateLimit(req)
        const body = await readBody(req)
        const username = text(body.username, '账号', true, 60)
        const password = text(body.password, '密码', true, 128)
        const found = db.prepare('SELECT * FROM users WHERE username=?').get(username)
        const valid = await verifyPassword(password, found?.password_hash ?? (await dummyHash))
        if (!found || !found.enabled || !valid) throw new ApiError(401, '账号或密码不正确')
        issueSession(res, found)
        return json(res, 200, publicUser(found))
      }
      if (!user) throw new ApiError(401, '请先登录')
      if (path === '/api/auth/logout' && req.method === 'POST') {
        const token = req.headers.cookie
          ?.split(';')
          .map((v) => v.trim())
          .find((v) => v.startsWith('dashboard_session='))
          ?.slice(18)
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token))
        cookie(res, '', 0)
        return json(res, 200, { ok: true })
      }
      if (mutating && user.role === 'viewer') throw new ApiError(403, '当前账号只有查看权限')
      const templateMatch = path.match(/^\/api\/quote-templates\/([0-9a-f-]{36})$/i)
      if (path === '/api/quote-templates' && req.method === 'GET')
        return json(
          res,
          200,
          db
            .prepare('SELECT * FROM quote_templates ORDER BY is_common DESC,updated_at DESC,id')
            .all()
            .map(quoteTemplate),
        )
      if (
        (path === '/api/quote-templates' && req.method === 'POST') ||
        (templateMatch && req.method === 'PUT')
      ) {
        const body = await readBody(req)
        const value = quoteTemplateInput(body)
        const id = templateMatch?.[1] ?? randomUUID()
        const updated = transaction(db, () => {
          if (templateMatch) {
            const previous = db.prepare('SELECT * FROM quote_templates WHERE id=?').get(id)
            checkVersion(body, previous)
            db.prepare(
              'UPDATE quote_templates SET name=?,customer=?,note=?,is_common=?,version=version+1,updated_at=? WHERE id=?',
            ).run(value.name, value.customer, value.note, Number(value.isCommon), now(), id)
            db.prepare('DELETE FROM quote_template_parts WHERE template_id=?').run(id)
          } else {
            db.prepare(
              'INSERT INTO quote_templates(id,name,customer,note,is_common,version,updated_at) VALUES(?,?,?,?,?,1,?)',
            ).run(id, value.name, value.customer, value.note, Number(value.isCommon), now())
          }
          const insertPart = db.prepare(
            'INSERT INTO quote_template_parts(id,template_id,position,vehicle,sku_id,sku_code,name,brand,price_minor,note) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          value.parts.forEach((part, index) =>
            insertPart.run(
              part.id,
              id,
              index,
              part.vehicle,
              part.skuId || null,
              part.skuCode,
              part.name,
              part.brand,
              part.priceMinor,
              part.note,
            ),
          )
          audit(user, templateMatch ? 'quote_template.update' : 'quote_template.create', id)
          return quoteTemplate(db.prepare('SELECT * FROM quote_templates WHERE id=?').get(id))
        })
        return json(res, templateMatch ? 200 : 201, updated)
      }
      if (templateMatch && req.method === 'DELETE') {
        transaction(db, () => {
          const removed = db.prepare('DELETE FROM quote_templates WHERE id=?').run(templateMatch[1])
          if (!removed.changes) throw new ApiError(404, '模板不存在')
          audit(user, 'quote_template.delete', templateMatch[1])
        })
        return json(res, 200, { ok: true })
      }
      if (path.startsWith('/api/dictionaries')) {
        const scope = url.searchParams.get('scope')
        const code = url.searchParams.get('code')
        const validScope = ['configuration', 'sku_foundation'].includes(scope)
        if (path === '/api/dictionaries/groups' && req.method === 'GET') {
          if (!validScope) throw new ApiError(400, '字典来源无效')
          return json(
            res,
            200,
            db
              .prepare(
                `SELECT g.scope,g.code,g.name,g.description,g.editable,g.status,g.maintenance_mode AS maintenanceMode,g.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM dictionary_items i WHERE i.scope=g.scope AND i.dictionary_code=g.code) AS itemCount
              FROM dictionary_groups g WHERE g.scope=? ORDER BY g.sort_order,g.code`,
              )
              .all(scope),
          )
        }
        if (path === '/api/dictionaries/items' && req.method === 'GET') {
          if (
            !validScope ||
            !code ||
            !db.prepare('SELECT 1 FROM dictionary_groups WHERE scope=? AND code=?').get(scope, code)
          )
            throw new ApiError(400, '字典分组无效')
          const page = Number(url.searchParams.get('page') ?? 1)
          if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
            throw new ApiError(400, '页码无效')
          const search = (url.searchParams.get('search') ?? '').trim()
          if (search.length > 100) throw new ApiError(400, '搜索内容过长')
          const status = url.searchParams.get('status') ?? ''
          if (status && !['active', 'disabled'].includes(status))
            throw new ApiError(400, '状态无效')
          const where =
            "WHERE i.scope=? AND i.dictionary_code=? AND (i.code LIKE ? OR i.label LIKE ?) AND (?='' OR i.status=?)"
          const args = [scope, code, `%${search}%`, `%${search}%`, status, status]
          const total = db
            .prepare(`SELECT COUNT(*) AS total FROM dictionary_items i ${where}`)
            .get(...args).total
          const rows = db
            .prepare(
              `SELECT i.code,i.label,i.description,i.sort_order AS sortOrder,i.status,i.parent_code AS parentCode,p.label AS parentLabel,i.version,
            (SELECT id FROM dictionary_logos l WHERE l.scope=i.scope AND l.dictionary_code=i.dictionary_code AND l.item_code=i.code LIMIT 1) AS logoId
            FROM dictionary_items i LEFT JOIN dictionary_items p
              ON p.scope=i.scope AND p.dictionary_code=i.dictionary_code AND p.code=i.parent_code
            ${where}
            ORDER BY COALESCE(p.sort_order,i.sort_order),COALESCE(p.code,i.code),
              CASE WHEN i.parent_code IS NULL THEN 0 ELSE 1 END,i.sort_order,i.code
            LIMIT 50 OFFSET ?`,
            )
            .all(...args, (page - 1) * 50)
          return json(res, 200, { rows, total, page })
        }
        if (path === '/api/dictionaries/options' && req.method === 'GET') {
          if (!validScope || !code) throw new ApiError(400, '字典分组无效')
          return json(
            res,
            200,
            db
              .prepare(
                "SELECT code,label,parent_code AS parentCode FROM dictionary_items WHERE scope=? AND dictionary_code=? AND status='active' ORDER BY sort_order,code",
              )
              .all(scope, code),
          )
        }
        const logo = path.match(/^\/api\/dictionaries\/logo\/([a-f0-9-]{36})$/i)
        if (logo && req.method === 'GET') {
          const found = db.prepare('SELECT content FROM dictionary_logos WHERE id=?').get(logo[1])
          if (!found) throw new ApiError(404, '品牌 Logo 不存在')
          const bytes = found.content
          const mime =
            bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp'
          res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' })
          res.end(bytes)
          return
        }
        if (path === '/api/dictionaries/items' && ['POST', 'PUT'].includes(req.method)) {
          if (user.role !== 'admin') throw new ApiError(403, '仅管理员可维护字典')
          if (!validScope || !code) throw new ApiError(400, '字典分组无效')
          const group = db
            .prepare('SELECT editable FROM dictionary_groups WHERE scope=? AND code=?')
            .get(scope, code)
          if (!group) throw new ApiError(404, '字典分组不存在')
          if (!group.editable) throw new ApiError(403, '固定业务字典不可修改')
          const body = await readBody(req)
          const submittedCode = text(body.code, '字典编码', true, 200)
          const itemCode = req.method === 'POST' ? submittedCode.toUpperCase() : submittedCode
          const label = text(body.label, '字典名称', true, 200)
          const description = text(body.description, '说明', false, 600)
          const sortOrder = body.sortOrder
          if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999)
            throw new ApiError(400, '排序须为非负整数')
          const status = body.status
          if (!['active', 'disabled'].includes(status)) throw new ApiError(400, '状态无效')
          const parentCode = body.parentCode ? text(body.parentCode, '上级编码', true, 200) : null
          if (parentCode && code !== 'supply_type') throw new ApiError(400, '此字典不支持上下级')
          if (
            parentCode &&
            (!db
              .prepare(
                'SELECT 1 FROM dictionary_items WHERE scope=? AND dictionary_code=? AND code=? AND parent_code IS NULL',
              )
              .get(scope, code, parentCode) ||
              parentCode === itemCode)
          )
            throw new ApiError(400, '上级字典项无效')
          const result = transaction(db, () => {
            if (req.method === 'POST') {
              if (
                db
                  .prepare(
                    'SELECT 1 FROM dictionary_items WHERE scope=? AND dictionary_code=? AND code=?',
                  )
                  .get(scope, code, itemCode)
              )
                throw new ApiError(409, '字典编码已存在')
              db.prepare(
                `INSERT INTO dictionary_items(scope,dictionary_code,code,label,description,sort_order,status,parent_code,metadata_json,navigation_rule_json,source_id,source_json,version)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`,
              ).run(
                scope,
                code,
                itemCode,
                label,
                description,
                sortOrder,
                status,
                parentCode,
                '{}',
                'null',
                `local:${randomUUID()}`,
                '{}',
              )
            } else {
              const version = body.version
              if (!Number.isSafeInteger(version) || version < 1) throw new ApiError(400, '版本无效')
              const changed = db
                .prepare(
                  `UPDATE dictionary_items SET label=?,description=?,sort_order=?,status=?,parent_code=?,version=version+1
                WHERE scope=? AND dictionary_code=? AND code=? AND version=?`,
                )
                .run(
                  label,
                  description,
                  sortOrder,
                  status,
                  parentCode,
                  scope,
                  code,
                  itemCode,
                  version,
                )
              if (!changed.changes) throw new ApiError(409, '字典项已更新或不存在，请刷新重试')
            }
            audit(
              user,
              req.method === 'POST' ? 'dictionary_item.create' : 'dictionary_item.update',
              `${scope}:${code}:${itemCode}`,
            )
            return db
              .prepare(
                'SELECT code,label,description,sort_order AS sortOrder,status,parent_code AS parentCode,version FROM dictionary_items WHERE scope=? AND dictionary_code=? AND code=?',
              )
              .get(scope, code, itemCode)
          })
          return json(res, req.method === 'POST' ? 201 : 200, result)
        }
      }
      if (path.startsWith('/api/users')) {
        if (user.role !== 'admin') throw new ApiError(403, '仅管理员可管理账号')
        if (path === '/api/users' && req.method === 'GET')
          return json(
            res,
            200,
            db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser),
          )
        if (path === '/api/users' && req.method === 'POST') {
          const body = await readBody(req)
          const c = credentials(body)
          if (!catalog.roles.includes(body.role)) throw new ApiError(400, '账号角色无效')
          const passwordHash = await hashPassword(c.password)
          const id = randomUUID()
          db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(
            id,
            c.username,
            passwordHash,
            body.role,
            1,
            now(),
          )
          audit(user, 'user.create', id)
          return json(res, 201, publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)))
        }
        const match = path.match(/^\/api\/users\/([a-f0-9-]+)$/)
        if (match && req.method === 'PUT') {
          const body = await readBody(req)
          if (match[1] === user.id) throw new ApiError(400, '不能在此修改当前登录账号')
          if (!catalog.roles.includes(body.role) || typeof body.enabled !== 'boolean')
            throw new ApiError(400, '角色或状态无效')
          if (!db.prepare('SELECT id FROM users WHERE id=?').get(match[1]))
            throw new ApiError(404, '账号不存在')
          db.prepare('UPDATE users SET role=?,enabled=? WHERE id=?').run(
            body.role,
            Number(body.enabled),
            match[1],
          )
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(match[1])
          audit(user, 'user.update', match[1])
          return json(res, 200, { ok: true })
        }
      }
      if (path === '/api/customers' && req.method === 'GET')
        return json(
          res,
          200,
          db.prepare('SELECT * FROM customers ORDER BY updated_at DESC').all().map(customer),
        )
      const cm = path.match(/^\/api\/customers\/([a-f0-9-]+)$/)
      const activityMatch = path.match(/^\/api\/customers\/([a-f0-9-]+)\/activities$/)
      if (activityMatch && req.method === 'GET') {
        if (!db.prepare('SELECT id FROM customers WHERE id=?').get(activityMatch[1]))
          throw new ApiError(404, '客户不存在')
        return json(
          res,
          200,
          db
            .prepare(
              'SELECT a.id,a.content,a.created_at AS createdAt,u.username AS author FROM customer_activities a JOIN users u ON u.id=a.user_id WHERE a.customer_id=? ORDER BY a.created_at DESC LIMIT 100',
            )
            .all(activityMatch[1]),
        )
      }
      if (activityMatch && req.method === 'POST') {
        if (!db.prepare('SELECT id FROM customers WHERE id=?').get(activityMatch[1]))
          throw new ApiError(404, '客户不存在')
        const body = await readBody(req)
        const content = text(body.content, '跟进内容', true, 1000)
        const id = randomUUID()
        const createdAt = now()
        db.prepare(
          'INSERT INTO customer_activities(id,customer_id,content,created_at,user_id) VALUES(?,?,?,?,?)',
        ).run(id, activityMatch[1], content, createdAt, user.id)
        audit(user, 'customer.activity.create', activityMatch[1])
        return json(res, 201, { id, content, createdAt, author: user.username })
      }
      if ((path === '/api/customers' && req.method === 'POST') || (cm && req.method === 'PUT')) {
        const body = await readBody(req)
        const id = cm?.[1] ?? randomUUID()
        const previous = cm ? db.prepare('SELECT * FROM customers WHERE id=?').get(id) : null
        if (cm) checkVersion(body, previous)
        const activeDictionaryLabels = (code) =>
          db
            .prepare(
              "SELECT label FROM dictionary_items WHERE scope='configuration' AND dictionary_code=? AND status='active' ORDER BY sort_order,code",
            )
            .all(code)
            .map((item) => item.label)
        const customerTypes = activeDictionaryLabels('customer_type')
        const customerStages = activeDictionaryLabels('customer_stage')
        if (previous) {
          if (!customerTypes.includes(previous.customer_type))
            customerTypes.push(previous.customer_type)
          if (!customerStages.includes(previous.project_stage))
            customerStages.push(previous.project_stage)
        }
        const value = customerInput(body, { customerTypes, customerStages })
        return json(
          res,
          cm ? 200 : 201,
          transaction(db, () => {
            const args = [
              value.code,
              value.name,
              value.customerType,
              value.projectStage,
              value.contact,
              value.phone,
              value.notes,
              Number(value.enabled),
              now(),
              id,
            ]
            if (cm)
              db.prepare(
                'UPDATE customers SET code=?,name=?,customer_type=?,project_stage=?,contact=?,phone=?,notes=?,enabled=?,updated_at=?,version=version+1 WHERE id=?',
              ).run(...args)
            else
              db.prepare(
                'INSERT INTO customers(code,name,customer_type,project_stage,contact,phone,notes,enabled,updated_at,id) VALUES(?,?,?,?,?,?,?,?,?,?)',
              ).run(...args)
            if (previous && previous.project_stage !== value.projectStage)
              db.prepare(
                'INSERT INTO customer_activities(id,customer_id,content,created_at,user_id) VALUES(?,?,?,?,?)',
              ).run(
                randomUUID(),
                id,
                `跟进阶段：${previous.project_stage} → ${value.projectStage}`,
                now(),
                user.id,
              )
            audit(user, cm ? 'customer.update' : 'customer.create', id)
            return customer(db.prepare('SELECT * FROM customers WHERE id=?').get(id))
          }),
        )
      }
      if (path === '/api/skus/page' && req.method === 'GET') {
        const enabled = url.searchParams.get('enabled') === 'false' ? 0 : 1
        const page = Number(url.searchParams.get('page') ?? 1)
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
          throw new ApiError(400, '页码无效')
        const clauses = ['s.enabled=?']
        const args = [enabled]
        const search = (url.searchParams.get('search') ?? '').trim()
        if (search.length > 200) throw new ApiError(400, '搜索内容过长')
        const words = search.split(/\s+/).filter(Boolean)
        if (words.length > 10) throw new ApiError(400, '搜索词过多')
        for (const word of words) {
          clauses.push(
            `(s.code LIKE ? OR s.name LIKE ? OR s.brand LIKE ? OR s.part_number LIKE ? OR src.manufacturer LIKE ? OR src.category_path LIKE ? OR EXISTS(SELECT 1 FROM sku_numbers n WHERE n.sku_id=s.id AND n.code LIKE ?) OR EXISTS(SELECT 1 FROM fitments f WHERE f.sku_id=s.id AND (f.make LIKE ? OR f.series LIKE ? OR f.chassis LIKE ?)))`,
          )
          for (let i = 0; i < 10; i++) args.push(`%${word}%`)
        }
        for (const [key, column] of [
          ['brand', "COALESCE(NULLIF(s.brand,''),src.manufacturer)"],
          ['category', 's.category'],
          ['nature', 's.nature'],
          ['origin', 's.origin'],
        ]) {
          const value = url.searchParams.get(key)
          if (value) {
            if (key === 'nature' && value === 'UNKNOWN') {
              clauses.push(`${column} IN (?,?)`)
              args.push('UNKNOWN', '待确认')
            } else {
              clauses.push(`${column}=?`)
              args.push(value)
            }
          }
        }
        const vehicle = url.searchParams.get('vehicle')
        if (vehicle) {
          clauses.push(
            'EXISTS(SELECT 1 FROM fitments f WHERE f.sku_id=s.id AND (f.make LIKE ? OR f.series LIKE ? OR f.chassis LIKE ?))',
          )
          args.push(...Array(3).fill(`%${vehicle}%`))
        }
        const from =
          'FROM skus s LEFT JOIN sku_source src ON src.sku_id=s.id WHERE ' + clauses.join(' AND ')
        const total = db.prepare('SELECT COUNT(*) AS total ' + from).get(...args).total
        const sort = url.searchParams.get('sort')
        const order =
          sort === 'category'
            ? 's.category,s.code'
            : sort === 'vehicle'
              ? '(SELECT MIN(series) FROM fitments WHERE sku_id=s.id),s.code'
              : 's.code'
        const rows = db
          .prepare(`SELECT s.* ${from} ORDER BY ${order} LIMIT 20 OFFSET ?`)
          .all(...args, (page - 1) * 20)
          .map(sku)
        const brands = db
          .prepare(
            "SELECT DISTINCT COALESCE(NULLIF(s.brand,''),src.manufacturer) AS brand FROM skus s LEFT JOIN sku_source src ON src.sku_id=s.id WHERE s.enabled=? AND COALESCE(NULLIF(s.brand,''),src.manufacturer)<>'' ORDER BY brand",
          )
          .all(enabled)
          .map((r) => r.brand)
        return json(res, 200, { rows, total, brands, page })
      }
      if (path === '/api/skus' && req.method === 'GET') {
        const enabled = url.searchParams.get('enabled') === 'false' ? 0 : 1
        return json(
          res,
          200,
          db
            .prepare('SELECT * FROM skus WHERE enabled=? ORDER BY updated_at DESC')
            .all(enabled)
            .map(sku),
        )
      }
      const sm = path.match(/^\/api\/skus\/([a-f0-9-]+)$/)
      const sqm = path.match(/^\/api\/skus\/([a-f0-9-]+)\/supplier-quotes$/)
      if (sqm && req.method === 'POST') {
        const body = await readBody(req)
        if (!db.prepare('SELECT id FROM skus WHERE id=?').get(sqm[1]))
          throw new ApiError(404, 'SKU 不存在')
        const supplier = text(body.supplier, '供应商', true, 200)
        const quotedOn = text(body.quotedOn, '报价日期', true, 10)
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(quotedOn) ||
          Number.isNaN(Date.parse(quotedOn)) ||
          new Date(quotedOn).toISOString().slice(0, 10) !== quotedOn
        )
          throw new ApiError(400, '报价日期无效')
        const amountMinor = body.amountMinor
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 10000000000)
          throw new ApiError(400, '供应商报价无效')
        const notes = text(body.notes, '报价备注', false, 500)
        const id = randomUUID()
        transaction(db, () => {
          db.prepare('INSERT INTO supplier_quotes VALUES(?,?,?,?,?,?,?)').run(
            id,
            sqm[1],
            supplier,
            quotedOn,
            amountMinor,
            notes,
            now(),
          )
          audit(user, 'supplier_quote.create', id)
        })
        return json(res, 201, sku(db.prepare('SELECT * FROM skus WHERE id=?').get(sqm[1])))
      }
      if ((path === '/api/skus' && req.method === 'POST') || (sm && req.method === 'PUT')) {
        const body = await readBody(req)
        const prior = sm ? db.prepare('SELECT * FROM skus WHERE id=?').get(sm[1]) : null
        const hasSupplyDictionary = Boolean(
          db
            .prepare(
              "SELECT 1 FROM dictionary_groups WHERE scope='sku_foundation' AND code='supply_type'",
            )
            .get(),
        )
        const dictionaryLabels = (dictionaryCode) =>
          db
            .prepare(
              "SELECT label FROM dictionary_items WHERE scope='sku_foundation' AND dictionary_code=? AND status='active'",
            )
            .all(dictionaryCode)
            .map((row) => row.label)
        const hasDictionary = (dictionaryCode) =>
          Boolean(
            db
              .prepare("SELECT 1 FROM dictionary_groups WHERE scope='sku_foundation' AND code=?")
              .get(dictionaryCode),
          )
        const value = skuInput(body, {
          categories: [
            prior?.category,
            ...db
              .prepare(
                "SELECT label FROM dictionary_items WHERE scope='sku_foundation' AND dictionary_code='category' AND status='active'",
              )
              .all()
              .map((row) => row.label),
          ].filter(Boolean),
          units: [
            prior?.unit,
            ...db
              .prepare(
                "SELECT label FROM dictionary_items WHERE scope='sku_foundation' AND dictionary_code='unit' AND status='active'",
              )
              .all()
              .map((row) => row.label),
          ].filter(Boolean),
          brands: hasDictionary('product_brand')
            ? [prior?.brand, ...dictionaryLabels('product_brand')].filter(Boolean)
            : undefined,
          positions: hasDictionary('position')
            ? [
                ...(prior?.position ? prior.position.split('、') : []),
                ...dictionaryLabels('position'),
              ].filter(Boolean)
            : undefined,
          vehicleBrands: hasDictionary('vehicle_brand')
            ? [
                ...(sm
                  ? db
                      .prepare('SELECT DISTINCT make FROM fitments WHERE sku_id=?')
                      .all(sm[1])
                      .map((row) => row.make)
                  : []),
                ...dictionaryLabels('vehicle_brand'),
              ].filter(Boolean)
            : undefined,
          natures: [
            ...(hasSupplyDictionary
              ? db
                  .prepare(
                    "SELECT code FROM dictionary_items WHERE scope='sku_foundation' AND dictionary_code='supply_type' AND status='active'",
                  )
                  .all()
                  .map((row) => row.code)
              : catalog.supplyTypes.map((item) => item.code)),
            prior?.nature,
          ].filter(Boolean),
        })
        const id = sm?.[1] ?? randomUUID()
        if (sm) checkVersion(body, prior)
        return json(res, sm ? 200 : 201, saveSku(id, value, Boolean(sm), user))
      }
      throw new ApiError(404, '接口不存在')
    } catch (error) {
      if (res.headersSent) return res.end()
      if (error instanceof ApiError) return json(res, error.status, { error: error.message })
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(error.message))
        return json(res, 409, { error: '编码或账号已存在，请使用其他值' })
      console.error('Request failed:', error.message)
      json(res, 500, { error: '服务暂时不可用，请稍后重试' })
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return {
    server,
    db,
    close: () =>
      new Promise((resolveClose) =>
        server.close(() => {
          db.close()
          resolveClose()
        }),
      ),
  }
}
