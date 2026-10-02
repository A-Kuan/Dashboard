export const skuRecords = [
  {
    id: 'SKU-POR-000184',
    code: 'SKU-POR-000184',
    name: '前制动片套装',
    englishName: 'Brake pad set, front axle',
    primaryOe: '95B 698 151 H',
    brand: 'Porsche OE',
    category: '制动系统 / 制动片',
    status: 'verified',
    statusLabel: '已核验',
    fitmentCount: 8,
    completeness: 96,
    source: 'Porsche PET',
    updated: '今天 10:28',
    identifiers: [
      { type: '主 OE', value: '95B 698 151 H', relation: '当前号' },
      { type: '历史 OE', value: '95B 698 151 F', relation: '被替代' },
      { type: '品牌号', value: '8DB 355 020-901', relation: '可互换' },
    ],
    fitments: [
      { vehicle: 'Macan (95B)', years: '2014–2018', condition: '前轴 · 不含 PSCB' },
      { vehicle: 'Macan II (95B)', years: '2019–2021', condition: '前轴 · 18 英寸制动器' },
      { vehicle: 'Cayenne (9YA)', years: '2018–2023', condition: '前轴 · PR 1LA' },
    ],
    evidence: { system: 'Porsche PET', catalog: 'Macan 95B / 698-05', figure: '位置 12', originalName: '1 set of brake pads for disc brake', syncedAt: '2026-09-30 09:42', confidence: '高' },
    inventory: { available: 6, locked: 2, inbound: 12 },
    price: { oemReference: '¥ 2,864.00', purchase: '¥ 1,180.00', sale: '¥ 1,580.00' },
  },
  {
    id: 'SKU-AUD-000319', code: 'SKU-AUD-000319', name: '机油滤清器', englishName: 'Oil filter element', primaryOe: '06M 198 405 F', brand: 'MANN-FILTER', category: '保养件 / 机油滤芯', status: 'verified', statusLabel: '已核验', fitmentCount: 16, completeness: 92, source: 'Audi ETKA', updated: '今天 09:54',
    identifiers: [{ type: '主 OE', value: '06M 198 405 F', relation: '当前号' }, { type: '品牌号', value: 'HU 7029 z', relation: '制造商号' }],
    fitments: [{ vehicle: 'Audi Q7 (4M)', years: '2016–2024', condition: '3.0 TFSI' }, { vehicle: 'Audi A8 (4N)', years: '2018–2024', condition: '3.0 TFSI' }],
    evidence: { system: 'Audi ETKA', catalog: 'Q7 4M / 115-10', figure: '位置 4', originalName: 'Oil filter with gasket', syncedAt: '2026-09-29 17:20', confidence: '高' }, inventory: { available: 23, locked: 4, inbound: 30 }, price: { oemReference: '¥ 426.00', purchase: '¥ 88.00', sale: '¥ 138.00' },
  },
  {
    id: 'SKU-POR-000207', code: 'SKU-POR-000207', name: '右侧发动机支承', englishName: 'Engine mounting, right', primaryOe: '9A7 199 132 02', brand: 'Porsche OE', category: '发动机 / 机脚胶', status: 'review', statusLabel: '待核验', fitmentCount: 3, completeness: 74, source: 'VIN EPC', updated: '昨天 16:31',
    identifiers: [{ type: '主 OE', value: '9A7 199 132 02', relation: '当前号' }],
    fitments: [{ vehicle: 'Panamera (971)', years: '2017–2020', condition: '右侧 · 需核对发动机代码' }],
    evidence: { system: 'VIN EPC', catalog: 'VIN: WP0AA2A7••••4182', figure: '图组 199-05 / 位置 6', originalName: 'Hydromount, right', syncedAt: '2026-09-29 16:24', confidence: '中' }, inventory: { available: 0, locked: 0, inbound: 2 }, price: { oemReference: '¥ 5,436.00', purchase: '¥ 2,760.00', sale: '—' },
  },
  {
    id: 'SKU-AUD-000488', code: 'SKU-AUD-000488', name: '空调滤清器', englishName: 'Cabin air filter', primaryOe: '4M0 819 439 B', brand: 'MAHLE', category: '保养件 / 空调滤芯', status: 'verified', statusLabel: '已核验', fitmentCount: 12, completeness: 88, source: 'Audi ETKA', updated: '昨天 14:06',
    identifiers: [{ type: '主 OE', value: '4M0 819 439 B', relation: '当前号' }, { type: '品牌号', value: 'LAK 1297', relation: '制造商号' }], fitments: [{ vehicle: 'Audi Q7 (4M)', years: '2016–2025', condition: '活性炭型' }, { vehicle: 'Audi Q8 (4M8)', years: '2019–2025', condition: '活性炭型' }], evidence: { system: 'Audi ETKA', catalog: 'Q7 4M / 819-30', figure: '位置 8', originalName: 'Filter element with activated charcoal', syncedAt: '2026-09-28 10:11', confidence: '高' }, inventory: { available: 18, locked: 1, inbound: 20 }, price: { oemReference: '¥ 668.00', purchase: '¥ 126.00', sale: '¥ 198.00' },
  },
  {
    id: 'SKU-POR-000512', code: 'SKU-POR-000512', name: '左前控制臂', englishName: 'Control arm, front left', primaryOe: '9Y0 407 151 G', brand: 'LEMFÖRDER', category: '底盘 / 控制臂', status: 'draft', statusLabel: '草稿', fitmentCount: 1, completeness: 58, source: '供应商资料', updated: '09-28 11:42',
    identifiers: [{ type: '主 OE', value: '9Y0 407 151 G', relation: '待核验' }], fitments: [{ vehicle: 'Cayenne (9YA)', years: '2018–2023', condition: '左前 · 排除主动悬架' }], evidence: { system: '供应商资料', catalog: 'LEMFÖRDER 供应商目录', figure: '—', originalName: 'Track control arm', syncedAt: '2026-09-28 11:36', confidence: '低' }, inventory: { available: 1, locked: 0, inbound: 0 }, price: { oemReference: '—', purchase: '¥ 920.00', sale: '—' },
  },
]

export const skuStatusFilters = [
  { id: 'all', label: '全部', count: 1286 },
  { id: 'verified', label: '已核验', count: 1098 },
  { id: 'review', label: '待核验', count: 126 },
  { id: 'draft', label: '草稿', count: 62 },
  { id: 'discontinued', label: '已停用', count: 0 },
]
