import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { openDatabase, transaction } from '../server/database.mjs'
import { skuInput } from '../server/validation.mjs'

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='))
if (!sourceArg) throw new Error('请传入 --source=旧站 NDJSON 快照')
const sourceFile = resolve(sourceArg.slice(9))
const dataDir = resolve(
  process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice(11) ?? '.data',
)
const apply = process.argv.includes('--apply')
const sourceSystem = 'parts-os-rewrite@121.41.24.42'
const categoryMap = {
  车身与外观: '车身附件',
  发动机: '发动机',
  电气与电子系统: '电气系统',
  电器系统: '电气系统',
  底盘与转向: '底盘悬挂',
  车轮与制动: '制动系统',
  制动系统: '制动系统',
  变速器与传动: '变速箱',
  变速箱: '变速箱',
  冷却系统: '冷却系统',
  点火系统: '点火系统',
}
function mapRow(record) {
  const s = record.sku
  const top = String(s.category_path ?? '')
    .split('/')[0]
    .trim()
  const numbers = record.numbers.map((item) => ({
    type: item.reference_type === 'primary' ? 'OE号' : '替代件号',
    code: item.oe_number,
  }))
  const fitments = record.fitments.map((f) => ({
    make: f.brand,
    series: f.model,
    chassis: f.generation ?? '',
    yearFrom: f.year_from == null ? '' : String(f.year_from),
    yearTo: f.year_to == null ? '' : String(f.year_to),
    power: '',
    engine: f.engine ?? '',
    notes: [f.displacement, f.note].filter(Boolean).join(' · '),
    verified: false,
  }))
  const image = s.image_path ?? ''
  const value = skuInput(
    {
      code: s.sku_code,
      name: s.name,
      category: categoryMap[top] ?? '其他',
      brand: s.brand ?? '',
      partNumber: s.internal_code ?? '',
      nature: '待确认',
      origin: '待确认',
      country: s.country_of_origin ?? '',
      unit: s.unit,
      specification: s.package_spec ?? '',
      position: '',
      packQuantity: 1,
      imageUrl: /^https?:\/\//.test(image) ? image : '',
      notes: s.notes ?? '',
      enabled: s.status === 'active',
      tradePriceMinor: null,
      repairPriceMinor: null,
      numbers,
      fitments,
      stocks: [],
      prices: [],
    },
    { natures: ['待确认'] },
  )
  return {
    id: s.id,
    sourceId: s.id,
    sourceCategoryPath: s.category_path,
    sourceManufacturer: s.manufacturer ?? '',
    sourceUpdatedAt: s.updated_at,
    top,
    value,
  }
}

const bytes = readFileSync(sourceFile)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const lines = bytes.toString('utf8').trimEnd().split('\n')
const parsed = lines.map((line) => ({ raw: line, record: JSON.parse(line) }))
const excludedDiscontinued = parsed.filter(({ record }) =>
  String(record.sku.name ?? '').includes('弃用零件'),
).length
const source = parsed
  .filter(({ record }) => !String(record.sku.name ?? '').includes('弃用零件'))
  .map(({ raw, record }) => ({ raw, mapped: mapRow(record) }))
const dbPath = join(dataDir, 'dashboard.sqlite')
if (!existsSync(dbPath)) throw new Error('目标数据库不存在')
const db = new DatabaseSync(dbPath, { readOnly: true })
const hasSourceTable = Boolean(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sku_source'").get(),
)
const existing = new Map(
  db
    .prepare(
      hasSourceTable
        ? 'SELECT s.code,src.source_id AS sourceId FROM skus s LEFT JOIN sku_source src ON src.sku_id=s.id'
        : 'SELECT code,NULL AS sourceId FROM skus',
    )
    .all()
    .map((r) => [r.code.toLowerCase(), r.sourceId]),
)
const seen = new Set()
const categoryCounts = {}
let insertCount = 0,
  skipCount = 0
for (const item of source) {
  const { mapped } = item
  const code = mapped.value.code.toLowerCase()
  if (seen.has(code)) throw new Error(`来源中 SKU 编码重复：${mapped.value.code}`)
  seen.add(code)
  categoryCounts[mapped.top] = (categoryCounts[mapped.top] ?? 0) + 1
  const occupied = existing.get(code)
  if (occupied === undefined) insertCount++
  else if (occupied === mapped.sourceId) skipCount++
  else throw new Error(`目标库有同编码但不同来源的 SKU：${mapped.value.code}`)
}
db.close()
const report = {
  source: sourceSystem,
  sourceTotal: parsed.length,
  excludedDiscontinued,
  sourceRows: source.length,
  sourceSha256: sha256,
  targetExisting: existing.size,
  toInsert: insertCount,
  alreadyImported: skipCount,
  categoryCounts,
  pricing: '保留旧站价格快照，不将其推断为同行价/修理厂价',
  nature: '待确认',
  origin: '待确认',
}
const reportPath = join(dataDir, 'import', 'migration-report.json')
mkdirSync(join(dataDir, 'import'), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(
  JSON.stringify({
    sourceTotal: report.sourceTotal,
    excludedDiscontinued,
    sourceRows: report.sourceRows,
    toInsert: insertCount,
    alreadyImported: skipCount,
    sha256,
    reportPath,
    mode: apply ? 'apply' : 'dry-run',
  }),
)
if (!apply) process.exit(0)

const target = openDatabase(dataDir)
const backupDir = join(dataDir, 'backups')
mkdirSync(backupDir, { recursive: true })
const backupPath = join(
  backupDir,
  `dashboard-before-sku-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
)
await backup(target, backupPath)
console.log(`backup: ${backupPath}`)
const insertSku = target.prepare(
  'INSERT INTO skus(id,code,name,category,brand,part_number,nature,origin,country,unit,specification,position,pack_quantity,image_url,notes,enabled,version,updated_at,trade_price_minor,repair_price_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
)
const insertSource = target.prepare(
  'INSERT INTO sku_source(sku_id,source_system,source_id,category_path,manufacturer,payload_json) VALUES(?,?,?,?,?,?)',
)
const insertNumber = target.prepare('INSERT INTO sku_numbers VALUES(?,?,?)')
const insertFitment = target.prepare('INSERT INTO fitments VALUES(?,?,?,?,?,?,?,?,?,?,?)')
let written = 0,
  numberCount = 0,
  fitmentCount = 0
transaction(target, () => {
  for (const { raw, mapped } of source) {
    if (existing.get(mapped.value.code.toLowerCase()) === mapped.sourceId) continue
    const v = mapped.value
    insertSku.run(
      mapped.id,
      v.code,
      v.name,
      v.category,
      v.brand,
      v.partNumber,
      v.nature,
      v.origin,
      v.country,
      v.unit,
      v.specification,
      v.position,
      v.packQuantity,
      v.imageUrl,
      v.notes,
      Number(v.enabled),
      mapped.sourceUpdatedAt,
      v.tradePriceMinor,
      v.repairPriceMinor,
    )
    insertSource.run(
      mapped.id,
      sourceSystem,
      mapped.sourceId,
      mapped.sourceCategoryPath,
      mapped.sourceManufacturer,
      raw,
    )
    for (const n of v.numbers) {
      insertNumber.run(mapped.id, n.type, n.code)
      numberCount++
    }
    for (const f of v.fitments) {
      insertFitment.run(
        randomUUID(),
        mapped.id,
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
      fitmentCount++
    }
    written++
  }
  const actor = target
    .prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1")
    .get()
  if (actor && written)
    target
      .prepare('INSERT INTO audit_log(user_id,action,entity_id,created_at) VALUES(?,?,?,?)')
      .run(actor.id, 'sku.import', sha256, new Date().toISOString())
})
const after = target.prepare('SELECT COUNT(*) AS total FROM skus').get().total
const imported = target
  .prepare('SELECT COUNT(*) AS total FROM sku_source WHERE source_system=?')
  .get(sourceSystem).total
const integrity = target.prepare('PRAGMA integrity_check').get().integrity_check
target.close()
if (written !== insertCount || imported !== source.length || integrity !== 'ok')
  throw new Error('导入后核对失败')
console.log(
  JSON.stringify({
    written,
    numberCount,
    fitmentCount,
    targetSkuCount: after,
    imported,
    integrity,
    backupPath,
  }),
)
