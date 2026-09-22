import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { openDatabase, transaction } from '../server/database.mjs'

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='))
if (!sourceArg) throw new Error('请传入 --source=旧站字典 NDJSON 快照')
const sourcePath = resolve(sourceArg.slice(9))
const dataDir = resolve(
  process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice(11) ?? '.data',
)
const apply = process.argv.includes('--apply')
const bytes = readFileSync(sourcePath)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const rows = bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse)
const expected = {
  'configuration:dictionary': 18,
  'configuration:item': 3149,
  'sku_foundation:dictionary': 10,
  'sku_foundation:item': 87,
  'sku_foundation:logo': 5,
}
const counts = {}
const keys = new Set()
for (const row of rows) {
  const kind = `${row.scope}:${row.kind}`
  if (!(kind in expected)) throw new Error(`未知来源类型：${kind}`)
  counts[kind] = (counts[kind] ?? 0) + 1
  const p = row.payload
  const key = `${kind}:${row.kind === 'dictionary' ? p.code : row.kind === 'logo' ? p.id : row.scope === 'configuration' ? p.id : `${p.dictionary_code}:${p.code}`}`
  if (keys.has(key)) throw new Error(`来源键重复：${key}`)
  keys.add(key)
}
for (const [kind, count] of Object.entries(expected))
  if (counts[kind] !== count) throw new Error(`${kind} 数量变化：${counts[kind]}，预期 ${count}`)

const dbPath = join(dataDir, 'dashboard.sqlite')
if (!existsSync(dbPath)) throw new Error('目标数据库不存在')
const inspect = new DatabaseSync(dbPath, { readOnly: true })
const hasTables = Boolean(
  inspect.prepare("SELECT name FROM sqlite_master WHERE name='dictionary_groups'").get(),
)
const targetBefore = hasTables
  ? {
      groups: inspect.prepare('SELECT COUNT(*) AS count FROM dictionary_groups').get().count,
      items: inspect.prepare('SELECT COUNT(*) AS count FROM dictionary_items').get().count,
      logos: inspect.prepare('SELECT COUNT(*) AS count FROM dictionary_logos').get().count,
    }
  : { groups: 0, items: 0, logos: 0 }
inspect.close()
const report = { sha256, counts, targetBefore, mode: apply ? 'apply' : 'dry-run' }
mkdirSync(join(dataDir, 'import'), { recursive: true })
const reportPath = join(dataDir, 'import', 'dictionary-migration-report.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, reportPath }))
if (!apply) process.exit(0)

const db = openDatabase(dataDir)
const backupDir = join(dataDir, 'backups')
mkdirSync(backupDir, { recursive: true })
const backupPath = join(
  backupDir,
  `dashboard-before-dictionary-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
)
await backup(db, backupPath)
const group = db.prepare(
  'INSERT OR IGNORE INTO dictionary_groups(scope,code,name,description,editable,status,maintenance_mode,sort_order,source_id,source_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
)
const item = db.prepare(
  'INSERT OR IGNORE INTO dictionary_items(scope,dictionary_code,code,label,description,sort_order,status,parent_code,metadata_json,navigation_rule_json,source_id,source_json,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
)
const logo = db.prepare(
  'INSERT OR IGNORE INTO dictionary_logos(id,scope,dictionary_code,item_code,content,width,height) VALUES(?,?,?,?,?,?,?)',
)
const written = { groups: 0, items: 0, logos: 0 }
transaction(db, () => {
  for (const { scope, payload: p } of rows.filter((r) => r.kind === 'dictionary')) {
    written.groups += Number(
      group.run(
        scope,
        p.code,
        p.name,
        p.description ?? '',
        scope === 'configuration' ? Number(p.maintenance_mode !== 'system') : Number(p.editable),
        p.status ?? 'active',
        p.maintenance_mode ?? 'user',
        p.sort_order ?? 0,
        p.id ?? p.code,
        JSON.stringify(p),
      ).changes,
    )
  }
  const groupCodes = new Map(
    db
      .prepare(
        "SELECT id,code FROM (SELECT json_extract(source_json,'$.id') AS id,code FROM dictionary_groups WHERE scope='configuration')",
      )
      .all()
      .map((r) => [r.id, r.code]),
  )
  for (const { scope, payload: p } of rows.filter((r) => r.kind === 'item')) {
    const dictionaryCode =
      scope === 'configuration' ? groupCodes.get(p.dictionary_id) : p.dictionary_code
    if (!dictionaryCode) throw new Error(`字典项没有对应分组：${p.id ?? p.code}`)
    written.items += Number(
      item.run(
        scope,
        dictionaryCode,
        p.code,
        p.label_zh_cn ?? p.label,
        p.description ?? '',
        p.sort_order ?? 0,
        p.status,
        p.parent_code ?? null,
        JSON.stringify(p.metadata ?? {}),
        JSON.stringify(p.navigation_rule ?? null),
        p.id ?? `${dictionaryCode}:${p.code}`,
        JSON.stringify(p),
        p.version ?? 1,
      ).changes,
    )
  }
  for (const { payload: p } of rows.filter((r) => r.kind === 'logo'))
    written.logos += Number(
      logo.run(
        p.id,
        'sku_foundation',
        p.dictionary_code,
        p.item_code,
        Buffer.from(p.content_base64, 'base64'),
        p.width,
        p.height,
      ).changes,
    )
  const actor = db
    .prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1")
    .get()
  if (actor && Object.values(written).some(Boolean))
    db.prepare('INSERT INTO audit_log(user_id,action,entity_id,created_at) VALUES(?,?,?,?)').run(
      actor.id,
      'dictionary.import',
      sha256,
      new Date().toISOString(),
    )
})
const after = {
  groups: db.prepare('SELECT COUNT(*) AS count FROM dictionary_groups').get().count,
  items: db.prepare('SELECT COUNT(*) AS count FROM dictionary_items').get().count,
  logos: db.prepare('SELECT COUNT(*) AS count FROM dictionary_logos').get().count,
}
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
db.close()
if (integrity !== 'ok' || after.groups < 28 || after.items < 3236 || after.logos < 5)
  throw new Error('导入后核对失败')
console.log(JSON.stringify({ written, after, integrity, backupPath }))
