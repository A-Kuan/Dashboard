import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import {
  IconCar,
  IconCheck,
  IconCircleDot,
  IconChevronUp,
  IconDeviceFloppy,
  IconDroplet,
  IconFileInvoice,
  IconFilter,
  IconLayoutGrid,
  IconMinus,
  IconPackage,
  IconPlus,
  IconSearch,
  IconSend,
  IconSwitchHorizontal,
  IconTool,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import type {
  CustomerGarage,
  GarageInquiry,
  GarageInquiryItem,
  GarageOwner,
  GarageVehicle,
  Sku,
} from '../catalog/types'
import './garage.css'

type OwnerDraft = Pick<GarageOwner, 'name' | 'phone' | 'wechat' | 'notes'>
type VehicleDraft = Pick<
  GarageVehicle,
  | 'ownerId'
  | 'brand'
  | 'series'
  | 'generationCode'
  | 'modelYear'
  | 'engine'
  | 'vin'
  | 'plateNumber'
  | 'notes'
  | 'enabled'
>
type InquiryItemDraft = Omit<GarageInquiryItem, 'id'>
type InquiryDraft = {
  ownerId: string
  vehicleId: string
  source: string
  notes: string
  items: InquiryItemDraft[]
}

const inquiryStatuses: GarageInquiry['status'][] = [
  '待识别',
  '待核价',
  '待报价',
  '已报价',
  '已关闭',
]
const emptyOwner: OwnerDraft = { name: '', phone: '', wechat: '', notes: '' }
const emptyVehicle: VehicleDraft = {
  ownerId: '',
  brand: '保时捷',
  series: '',
  generationCode: '',
  modelYear: '',
  engine: '',
  vin: '',
  plateNumber: '',
  notes: '',
  enabled: true,
}
const emptyItem = (): InquiryItemDraft => ({
  skuId: '',
  oeNumber: '',
  name: '',
  quantity: 1,
  priceMinor: null,
  notes: '',
})

const demoSkus: Sku[] = [
  {
    id: 'demo-sku-brake-pad',
    code: 'BRK-992-001',
    name: '前制动片（前刹车片）',
    category: '制动系统',
    brand: '优选品牌',
    partNumber: '9A7.615.301',
    nature: '原厂品质',
    origin: '德国',
    country: '德国',
    unit: '套',
    specification: '前轴一套（4片）',
    position: '前轴',
    packQuantity: 1,
    imageUrl: '/parts/brake-pads.png',
    tradePriceMinor: 168000,
    repairPriceMinor: 168000,
    notes: '左右通用，一轴一套（4片）。建议同时检查制动盘与报警线。',
    enabled: true,
    version: 1,
    updatedAt: '2026-09-26T08:00:00.000Z',
    numbers: [
      { type: '升级替代，推荐使用', code: '9P1.615.301.E' },
      { type: '原始号', code: '9A7.615.301' },
    ],
    fitments: [
      {
        make: '保时捷',
        series: '911',
        chassis: '992',
        yearFrom: '2019',
        yearTo: '2024',
        power: '3.0T / 3.8T',
        engine: '3.0T',
        notes: '安装前请再次核对 VIN 与 OE 号。',
        verified: true,
      },
    ],
    stocks: [{ warehouse: '上海仓', bin: 'A-03-18', quantity: 8 }],
    prices: [],
    supplierQuotes: [],
  },
  {
    id: 'demo-sku-brake-disc',
    code: 'BRK-992-002',
    name: '前制动盘（左/右通用）',
    category: '制动系统',
    brand: '优选品牌',
    partNumber: '9A7.615.301.A',
    nature: '替代件可用',
    origin: '德国',
    country: '德国',
    unit: '个',
    specification: '前轴制动盘',
    position: '前轴',
    packQuantity: 1,
    imageUrl: '/parts/brake-disc.png',
    tradePriceMinor: 428000,
    repairPriceMinor: 428000,
    notes: '左右通用，建议成对更换并同时检查制动片。',
    enabled: true,
    version: 1,
    updatedAt: '2026-09-26T08:00:00.000Z',
    numbers: [{ type: '替代号', code: '9P1.615.301.F' }],
    fitments: [
      {
        make: '保时捷',
        series: '911',
        chassis: '992',
        yearFrom: '2019',
        yearTo: '2024',
        power: '3.0T',
        engine: '3.0T',
        notes: '',
        verified: true,
      },
    ],
    stocks: [],
    prices: [],
    supplierQuotes: [],
  },
  {
    id: 'demo-sku-coolant-hose',
    code: 'CLT-992-013',
    name: '冷却水管',
    category: '冷却系统',
    brand: '优选品牌',
    partNumber: '4M0.121.251',
    nature: '有替代号',
    origin: '德国',
    country: '德国',
    unit: '根',
    specification: '发动机冷却系统软管',
    position: '发动机舱',
    packQuantity: 1,
    imageUrl: '/parts/coolant-hose.png',
    tradePriceMinor: 86000,
    repairPriceMinor: 86000,
    notes: '安装时检查卡箍和接口密封状态。',
    enabled: true,
    version: 1,
    updatedAt: '2026-09-26T08:00:00.000Z',
    numbers: [{ type: '升级号', code: '4M0.121.251.B' }],
    fitments: [
      {
        make: '保时捷',
        series: '911',
        chassis: '992',
        yearFrom: '2019',
        yearTo: '2024',
        power: '3.0T',
        engine: '3.0T',
        notes: '',
        verified: true,
      },
    ],
    stocks: [],
    prices: [],
    supplierQuotes: [],
  },
]

function createDemoGarage(base: CustomerGarage): CustomerGarage {
  const updatedAt = '2026-09-26T08:00:00.000Z'
  const owners: GarageOwner[] = [
    ['demo-owner-1', '张先生', '138 0000 1234'],
    ['demo-owner-2', '李女士', '139 0000 2861'],
    ['demo-owner-3', '王先生', '136 0000 5198'],
    ['demo-owner-4', '陈先生', '137 0000 6320'],
    ['demo-owner-5', '赵先生', '135 0000 7742'],
  ].map(([id, name, phone]) => ({
    id,
    customerId: base.customer.id,
    name,
    phone,
    wechat: '',
    notes: '界面演示数据',
    createdAt: updatedAt,
    updatedAt,
  }))
  const vehicles: GarageVehicle[] = [
    [
      'demo-vehicle-1',
      'demo-owner-1',
      '保时捷',
      '911',
      '992',
      '2021',
      '3.0T Carrera',
      'WP0ZZZ992MS123456',
      '沪A·8F3K9',
    ],
    [
      'demo-vehicle-2',
      'demo-owner-2',
      '奥迪',
      'Q7',
      '4M',
      '2020',
      '3.0T',
      'WAUZZZ4M6LD012345',
      '沪A·7D6P1',
    ],
    [
      'demo-vehicle-3',
      'demo-owner-3',
      '保时捷',
      'Macan',
      '95B',
      '2019',
      '2.0T',
      'WP1ZZZ95ZKLB67890',
      '沪A·3C9L2',
    ],
    [
      'demo-vehicle-4',
      'demo-owner-4',
      '奥迪',
      'A6L',
      'C8',
      '2022',
      '2.0T',
      'WAUZZZF28NN123789',
      '沪A·1H8N7',
    ],
    [
      'demo-vehicle-5',
      'demo-owner-5',
      '保时捷',
      'Cayenne',
      '9YA',
      '2021',
      '3.0T',
      'WP1ZZZ9YZMBA24680',
      '沪A·5K2M0',
    ],
  ].map(([id, ownerId, brand, series, generationCode, modelYear, engine, vin, plateNumber]) => ({
    id,
    customerId: base.customer.id,
    ownerId,
    brand,
    series,
    generationCode,
    modelYear,
    engine,
    vin,
    plateNumber,
    notes: '界面演示数据',
    enabled: true,
    version: 1,
    updatedAt,
  }))
  const inquiry: GarageInquiry = {
    id: 'demo-inquiry-1',
    customerId: base.customer.id,
    ownerId: owners[0].id,
    vehicleId: vehicles[0].id,
    code: 'BJ-20260926-001',
    status: '待报价',
    source: '标准售价',
    notes: '界面演示数据',
    quotedTotalMinor: null,
    quotedAt: null,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    items: demoSkus.map((sku) => ({
      id: `demo-item-${sku.id}`,
      skuId: sku.id,
      oeNumber: sku.partNumber,
      name: sku.name,
      quantity: 1,
      priceMinor: sku.repairPriceMinor,
      notes: '',
    })),
  }
  return { ...base, owners, vehicles, inquiries: [inquiry] }
}

function money(value: number | null) {
  return value == null
    ? '待核价'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value / 100)
}

function vehicleImage(vehicle: GarageVehicle | null) {
  if (!vehicle) return ''
  const series = vehicle.series.toLowerCase()
  if (vehicle.brand.includes('奥迪')) {
    if (series.includes('q7')) return '/vehicles/audi-q7-transparent.png'
    if (series.includes('a6')) return '/vehicles/audi-a6l-transparent.png'
    return ''
  }
  if (!vehicle.brand.includes('保时捷')) return ''
  for (const key of ['911', '718', 'cayenne', 'macan', 'panamera', 'taycan'])
    if (series.includes(key)) return `/vehicles/${key}-transparent.png`
  return ''
}

function partImage(sku: Sku) {
  const haystack = `${sku.name} ${sku.category} ${sku.position}`
  if (/制动盘|刹车盘/.test(haystack)) return '/parts/brake-disc.png'
  if (/水管|冷却/.test(haystack)) return '/parts/coolant-hose.png'
  if (/制动|刹车|摩擦片/.test(haystack)) return '/parts/brake-pads.png'
  return sku.imageUrl
}

export function CustomerGaragePage() {
  const { customerId = '' } = useParams()
  const { user } = useAuth()
  const writable = user.role !== 'viewer'
  const [workspace, setWorkspace] = useState<CustomerGarage | null>(null)
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [selectedInquiryId, setSelectedInquiryId] = useState('')
  const [ownerDraft, setOwnerDraft] = useState<OwnerDraft | null>(null)
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft | null>(null)
  const [inquiryDraft, setInquiryDraft] = useState<InquiryDraft | null>(null)
  const [pricingDraft, setPricingDraft] = useState<GarageInquiry | null>(null)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [skuRows, setSkuRows] = useState<Sku[]>([])
  const [skuSearch, setSkuSearch] = useState('')
  const [partCategory, setPartCategory] = useState('制动系统')
  const [partBrand, setPartBrand] = useState('')
  const [partSort, setPartSort] = useState('relevance')
  const [stockOnly, setStockOnly] = useState(false)
  const [skuQuantities, setSkuQuantities] = useState<Record<string, number>>({})
  const [quotePriceSource, setQuotePriceSource] = useState('standard')
  const [vehicleListMode, setVehicleListMode] = useState<'recent' | 'all'>('recent')
  const [selectedSkuId, setSelectedSkuId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load(preferred?: { ownerId?: string; vehicleId?: string; inquiryId?: string }) {
    setLoading(true)
    setError('')
    try {
      const result = await api<CustomerGarage>(`/customers/${customerId}/garage`)
      const resolved =
        !result.owners.length && !result.vehicles.length ? createDemoGarage(result) : result
      setWorkspace(resolved)
      const ownerId = preferred?.ownerId || selectedOwnerId || resolved.owners[0]?.id || ''
      const vehicleId =
        preferred?.vehicleId ||
        (resolved.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)
          ? selectedVehicleId
          : resolved.vehicles.find((vehicle) => vehicle.ownerId === ownerId)?.id) ||
        ''
      const inquiryId =
        preferred?.inquiryId ||
        (resolved.inquiries.some((inquiry) => inquiry.id === selectedInquiryId)
          ? selectedInquiryId
          : resolved.inquiries.find((inquiry) => inquiry.vehicleId === vehicleId)?.id) ||
        ''
      setSelectedOwnerId(ownerId)
      setSelectedVehicleId(vehicleId)
      setSelectedInquiryId(inquiryId)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // The current selections are intentionally retained by load between saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const selectedOwner = workspace?.owners.find((owner) => owner.id === selectedOwnerId) ?? null
  const selectedVehicle =
    workspace?.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null
  const selectedInquiry =
    workspace?.inquiries.find((inquiry) => inquiry.id === selectedInquiryId) ?? null
  const vehicleInquiries =
    workspace?.inquiries.filter((inquiry) => inquiry.vehicleId === selectedVehicleId) ?? []
  const visibleOwners = useMemo(() => {
    if (!workspace) return []
    const keyword = ownerSearch.trim().toLowerCase()
    if (!keyword) return workspace.owners
    return workspace.owners.filter((owner) => {
      const vehicles = workspace.vehicles.filter((vehicle) => vehicle.ownerId === owner.id)
      return [
        owner.name,
        owner.phone,
        owner.wechat,
        ...vehicles.flatMap((vehicle) => [
          vehicle.brand,
          vehicle.series,
          vehicle.generationCode,
          vehicle.vin,
          vehicle.plateNumber,
        ]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [ownerSearch, workspace])
  const image = vehicleImage(selectedVehicle)
  const visibleVehicleRecords = visibleOwners.flatMap((owner) =>
    (workspace?.vehicles ?? [])
      .filter((vehicle) => vehicle.ownerId === owner.id)
      .map((vehicle) => ({ owner, vehicle })),
  )
  const displayedVehicleRecords =
    vehicleListMode === 'recent' ? visibleVehicleRecords.slice(0, 5) : visibleVehicleRecords
  const vehicleQuery = selectedVehicle ? selectedVehicle.series.trim() : ''

  useEffect(() => {
    if (!selectedVehicle) {
      setSkuRows([])
      return
    }
    if (selectedVehicle.id.startsWith('demo-')) {
      const keyword = skuSearch.trim().toLowerCase()
      let rows = demoSkus.filter((sku) => {
        if (keyword && !`${sku.name} ${sku.code} ${sku.partNumber}`.toLowerCase().includes(keyword))
          return false
        if (partCategory && partCategory !== '制动系统' && sku.category !== partCategory)
          return false
        if (partBrand && sku.brand !== partBrand) return false
        if (stockOnly && !sku.stocks.some((stock) => stock.quantity > 0)) return false
        return true
      })
      if (partSort === 'price-asc')
        rows = [...rows].sort((a, b) => (a.repairPriceMinor ?? 0) - (b.repairPriceMinor ?? 0))
      if (partSort === 'price-desc')
        rows = [...rows].sort((a, b) => (b.repairPriceMinor ?? 0) - (a.repairPriceMinor ?? 0))
      setSkuRows(rows)
      return
    }
    const params = new URLSearchParams({
      enabled: 'true',
      page: '1',
      search: skuSearch,
      vehicle: vehicleQuery,
      category: partCategory,
      brand: partBrand,
    })
    let active = true
    void api<{ rows: Sku[] }>(`/skus/page?${params}`)
      .then((result) => {
        if (active) setSkuRows(result.rows.slice(0, 8))
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [partBrand, partCategory, partSort, selectedVehicle, skuSearch, stockOnly, vehicleQuery])

  const inquiryTotal = useMemo(
    () =>
      selectedInquiry?.items.reduce(
        (total, item) => total + (item.priceMinor ?? 0) * item.quantity,
        0,
      ) ?? 0,
    [selectedInquiry],
  )
  const selectedSku = skuRows.find((sku) => sku.id === selectedSkuId) ?? skuRows[0] ?? null

  async function createOwner(event: FormEvent) {
    event.preventDefault()
    if (!ownerDraft) return
    setBusy(true)
    setError('')
    try {
      const saved = await api<GarageOwner>(`/customers/${customerId}/garage/owners`, {
        method: 'POST',
        body: JSON.stringify(ownerDraft),
      })
      setOwnerDraft(null)
      setMessage('车主已保存')
      await load({ ownerId: saved.id })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function createVehicle(event: FormEvent) {
    event.preventDefault()
    if (!vehicleDraft) return
    setBusy(true)
    setError('')
    try {
      const saved = await api<GarageVehicle>(`/customers/${customerId}/garage/vehicles`, {
        method: 'POST',
        body: JSON.stringify(vehicleDraft),
      })
      setVehicleDraft(null)
      setMessage('车辆已保存')
      await load({ ownerId: saved.ownerId, vehicleId: saved.id })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function createInquiry(event: FormEvent) {
    event.preventDefault()
    if (!inquiryDraft) return
    setBusy(true)
    setError('')
    try {
      const saved = await api<GarageInquiry>(`/customers/${customerId}/garage/inquiries`, {
        method: 'POST',
        body: JSON.stringify({ ...inquiryDraft, status: '待识别' }),
      })
      setInquiryDraft(null)
      setMessage('询价单已创建')
      await load({
        ownerId: saved.ownerId,
        vehicleId: saved.vehicleId,
        inquiryId: saved.id,
      })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function saveInquiry(next: GarageInquiry, success: string) {
    if (next.id.startsWith('demo-')) {
      setWorkspace((current) =>
        current
          ? {
              ...current,
              inquiries: current.inquiries.map((inquiry) =>
                inquiry.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : inquiry,
              ),
            }
          : current,
      )
      setMessage(success)
      return true
    }
    setBusy(true)
    setError('')
    try {
      const saved = await api<GarageInquiry>(
        `/customers/${customerId}/garage/inquiries/${next.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(next),
        },
      )
      setMessage(success)
      await load({
        ownerId: saved.ownerId,
        vehicleId: saved.vehicleId,
        inquiryId: saved.id,
      })
      return true
    } catch (reason) {
      setError(errorMessage(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  function suggestedPrice(sku: Sku) {
    const agreement = sku.prices.find((price) => price.customerId === customerId)
    if (agreement) return agreement.amountMinor
    if (workspace?.customer.customerType === '同行') return sku.tradePriceMinor
    if (workspace?.customer.customerType === '修理厂') return sku.repairPriceMinor
    return null
  }

  async function addSkuToInquiry(sku: Sku) {
    if (!selectedVehicle || !selectedOwner) return
    const quantity = skuQuantities[sku.id] ?? 1
    const item: InquiryItemDraft = {
      skuId: sku.id,
      oeNumber: sku.partNumber || sku.numbers[0]?.code || sku.code,
      name: sku.name,
      quantity,
      priceMinor: suggestedPrice(sku),
      notes: '',
    }
    if (!selectedInquiry) {
      setInquiryDraft({
        ownerId: selectedOwner.id,
        vehicleId: selectedVehicle.id,
        source: '',
        notes: '',
        items: [item],
      })
      return
    }
    const existing = selectedInquiry.items.find((row) => row.skuId === sku.id)
    await saveInquiry(
      {
        ...selectedInquiry,
        status: selectedInquiry.status === '待识别' ? '待核价' : selectedInquiry.status,
        items: existing
          ? selectedInquiry.items.map((row) =>
              row.id === existing.id ? { ...row, quantity: row.quantity + quantity } : row,
            )
          : [...selectedInquiry.items, { ...item, id: crypto.randomUUID() }],
      },
      existing ? '询价数量已更新' : '配件已加入报价单',
    )
  }

  function setSkuQuantity(skuId: string, quantity: number) {
    setSkuQuantities((current) => ({ ...current, [skuId]: Math.max(1, quantity) }))
  }

  function updateInquiryItemQuantity(itemId: string, quantity: number) {
    if (!selectedInquiry) return
    void saveInquiry(
      {
        ...selectedInquiry,
        items: selectedInquiry.items.map((item) =>
          item.id === itemId ? { ...item, quantity: Math.max(1, quantity) } : item,
        ),
      },
      '报价数量已更新',
    )
  }

  function removeInquiryItem(itemId: string) {
    if (!selectedInquiry) return
    void saveInquiry(
      {
        ...selectedInquiry,
        items: selectedInquiry.items.filter((item) => item.id !== itemId),
      },
      '已从报价单移除',
    )
  }

  if (!workspace && loading) return <div className="garage-loading">正在读取客户车辆与询价单…</div>

  return (
    <div className="business garage-workbench">
      {message && (
        <p className="garage-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="garage-error" role="alert">
          {error} <button onClick={() => void load()}>重试</button>
        </p>
      )}
      <div className="garage-grid">
        <aside className="garage-people" aria-label="车主与车辆">
          <div className="garage-rail-title">
            <strong>我的车库 / 客户车辆</strong>
          </div>
          <label className="garage-search">
            <IconSearch size={17} />
            <input
              aria-label="搜索车主或车辆"
              placeholder="搜索车主、VIN 或车牌"
              value={ownerSearch}
              onChange={(event) => setOwnerSearch(event.target.value)}
            />
          </label>
          {writable && (
            <button
              className="garage-add-vehicle"
              onClick={() =>
                selectedOwner
                  ? setVehicleDraft({ ...emptyVehicle, ownerId: selectedOwner.id })
                  : setOwnerDraft({ ...emptyOwner })
              }
            >
              <IconPlus size={19} /> 添加客户车辆
            </button>
          )}
          <div className="garage-rail-tabs">
            <button
              className={vehicleListMode === 'recent' ? 'active' : ''}
              onClick={() => setVehicleListMode('recent')}
            >
              最近车辆
            </button>
            <button
              className={vehicleListMode === 'all' ? 'active' : ''}
              onClick={() => setVehicleListMode('all')}
            >
              全部车辆
            </button>
            {writable && (
              <button
                className="garage-add-owner-link"
                onClick={() => setOwnerDraft({ ...emptyOwner })}
              >
                + 新增车主
              </button>
            )}
          </div>
          <div className="garage-owner-list">
            {displayedVehicleRecords.map(({ owner, vehicle }) => {
              const railImage = vehicleImage(vehicle)
              return (
                <button
                  className={`garage-vehicle-card${vehicle.id === selectedVehicleId ? ' active' : ''}`}
                  key={vehicle.id}
                  onClick={() => {
                    setSelectedOwnerId(owner.id)
                    setSelectedVehicleId(vehicle.id)
                    setSelectedInquiryId(
                      workspace!.inquiries.find((inquiry) => inquiry.vehicleId === vehicle.id)
                        ?.id ?? '',
                    )
                  }}
                >
                  <span className="garage-rail-vehicle-image">
                    {railImage ? <img src={railImage} alt="" /> : <IconCar size={36} />}
                  </span>
                  <span>
                    <strong>
                      {vehicle.brand} {vehicle.series}{' '}
                      {vehicle.generationCode && `(${vehicle.generationCode})`}
                    </strong>
                    <small>
                      {[vehicle.modelYear, vehicle.engine].filter(Boolean).join(' ') ||
                        '车辆资料待补充'}
                    </small>
                    <small>
                      {owner.name} · {vehicle.plateNumber || '车牌待补充'}
                    </small>
                    <small>VIN: {vehicle.vin || '待补充'}</small>
                  </span>
                </button>
              )
            })}
            {!workspace?.owners.length && (
              <div className="garage-empty-rail">
                <IconUser size={26} />
                <strong>先添加车主</strong>
                <span>车主归属于当前直接客户。</span>
              </div>
            )}
            {!!workspace?.owners.length && !visibleOwners.length && (
              <div className="garage-empty-rail">
                <IconSearch size={26} />
                <strong>没有匹配结果</strong>
                <span>换一个姓名、VIN 或车牌关键词。</span>
              </div>
            )}
            {!!displayedVehicleRecords.length && vehicleListMode === 'recent' && (
              <p className="garage-rail-end">没有更多了</p>
            )}
          </div>
        </aside>

        <main className="garage-main">
          {selectedVehicle ? (
            <>
              <div className="garage-vehicle-title">
                <div>
                  <h1>
                    {selectedVehicle.brand} {selectedVehicle.series}{' '}
                    {selectedVehicle.generationCode && `(${selectedVehicle.generationCode})`}{' '}
                    {selectedVehicle.modelYear} {selectedVehicle.engine}
                  </h1>
                  <p>
                    VIN: {selectedVehicle.vin || '待补充'} <i /> 车辆年份：
                    {selectedVehicle.modelYear || '待补充'} <i />
                    发动机：{selectedVehicle.engine || '待补充'}
                  </p>
                </div>
                <button onClick={() => setVehicleListMode('all')}>
                  <IconSwitchHorizontal size={17} /> 更换车辆
                </button>
              </div>
              <section className="garage-vehicle-hero">
                {image ? (
                  <img src={image} alt={`${selectedVehicle.brand} ${selectedVehicle.series}`} />
                ) : (
                  <div className="garage-vehicle-no-image">
                    <IconCar size={64} />
                    <span>当前车型暂无项目图片</span>
                  </div>
                )}
                {image && (
                  <div className="garage-vehicle-thumbs" aria-label="车辆视图">
                    {[0, 1, 2, 3].map((view) => (
                      <button
                        className={view === 0 ? 'active' : ''}
                        key={view}
                        title="车辆图片视图"
                      >
                        <img src={image} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <div className="garage-system-tabs" role="group" aria-label="配件系统">
                {[
                  { label: '制动系统', category: '制动系统', icon: IconCircleDot },
                  { label: '冷却系统', category: '冷却系统', icon: IconDroplet },
                  { label: '滤清系统', category: '滤清系统', icon: IconFilter },
                  { label: '悬挂系统', category: '悬挂系统', icon: IconTool },
                  { label: '车身部件', category: '车身部件', icon: IconCar },
                  { label: '全部配件', category: '', icon: IconLayoutGrid },
                ].map(({ label, category, icon: Icon }) => (
                  <button
                    className={partCategory === category ? 'active' : ''}
                    key={label}
                    onClick={() => setPartCategory(category)}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="garage-part-toolbar">
                <label className="garage-part-search">
                  <IconSearch size={18} />
                  <input
                    aria-label="搜索适配配件"
                    placeholder="搜索配件名称、OE 号或 SKU"
                    value={skuSearch}
                    onChange={(event) => setSkuSearch(event.target.value)}
                  />
                  {!skuSearch && <span>例如：9A7.615.301</span>}
                </label>
                <button className="garage-search-button">
                  <IconSearch size={17} /> 搜索
                </button>
                <Select
                  label="品牌"
                  value={partBrand}
                  options={[
                    { value: '', label: '品牌：全部' },
                    { value: '优选品牌', label: '优选品牌' },
                  ]}
                  onChange={setPartBrand}
                />
                <Select
                  label="排序"
                  value={partSort}
                  options={[
                    { value: 'relevance', label: '排序：相关性' },
                    { value: 'price-asc', label: '价格从低到高' },
                    { value: 'price-desc', label: '价格从高到低' },
                  ]}
                  onChange={setPartSort}
                />
                <label className="garage-stock-only">
                  <input
                    type="checkbox"
                    checked={stockOnly}
                    onChange={(event) => setStockOnly(event.target.checked)}
                  />
                  仅显示有库存
                </label>
              </div>
              <div className="garage-parts-list">
                {skuRows.map((sku) => {
                  const imageUrl = partImage(sku)
                  const stock = sku.stocks.reduce((sum, row) => sum + row.quantity, 0)
                  return (
                    <article
                      className={(selectedSku?.id ?? skuRows[0]?.id) === sku.id ? 'selected' : ''}
                      key={sku.id}
                      onClick={() => setSelectedSkuId(sku.id)}
                    >
                      <div className="garage-part-image">
                        {imageUrl ? <img src={imageUrl} alt="" /> : <IconPackage size={30} />}
                      </div>
                      <div className="garage-part-name">
                        <strong>{sku.name}</strong>
                        <span>OE 号：{sku.partNumber || sku.code}</span>
                        <span>
                          适用：{sku.fitments[0]?.series || selectedVehicle.series}{' '}
                          {sku.fitments[0]?.chassis && `(${sku.fitments[0].chassis})`}{' '}
                          {[sku.fitments[0]?.yearFrom, sku.fitments[0]?.yearTo]
                            .filter(Boolean)
                            .join('-')}{' '}
                          {sku.fitments[0]?.power}
                        </span>
                        <div>
                          <small className="verified">
                            <IconCheck size={12} />
                            {sku.fitments[0]?.verified ? '适配已验证' : '适配待核对'}
                          </small>
                          <small>{sku.nature}</small>
                        </div>
                      </div>
                      <div className="garage-part-meta">
                        <span>SKU：{sku.code}</span>
                        <span>品牌：{sku.brand || '待确认'}</span>
                        <strong className={sku.stocks.length ? '' : 'pending'}>
                          库存：{sku.stocks.length ? `${stock} 套` : '待确认'}
                        </strong>
                      </div>
                      <div className="garage-part-price">
                        <strong>{money(suggestedPrice(sku))}</strong>
                        <span>/ {sku.unit}</span>
                      </div>
                      <div className="garage-quantity-stepper" aria-label={`${sku.name} 数量`}>
                        <button
                          aria-label={`减少 ${sku.name} 数量`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSkuQuantity(sku.id, (skuQuantities[sku.id] ?? 1) - 1)
                          }}
                        >
                          <IconMinus size={14} />
                        </button>
                        <span>{skuQuantities[sku.id] ?? 1}</span>
                        <button
                          aria-label={`增加 ${sku.name} 数量`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSkuQuantity(sku.id, (skuQuantities[sku.id] ?? 1) + 1)
                          }}
                        >
                          <IconPlus size={14} />
                        </button>
                      </div>
                      <button
                        disabled={!writable || busy}
                        onClick={(event) => {
                          event.stopPropagation()
                          void addSkuToInquiry(sku)
                        }}
                      >
                        加入报价
                      </button>
                    </article>
                  )
                })}
                {!skuRows.length && (
                  <div className="garage-empty-results">
                    <IconPackage size={34} />
                    <strong>没有匹配当前车型的 SKU</strong>
                    <span>可清空关键词，或先到 SKU 档案补充适配车型。</span>
                  </div>
                )}
              </div>
              {selectedSku && (
                <section className="garage-fitment-panel">
                  <header>
                    <strong>适配说明与替代号</strong>
                    <IconChevronUp size={16} />
                  </header>
                  <div>
                    <p>
                      <strong>当前零件：{selectedSku.name}</strong>
                      <span>OE 号：{selectedSku.partNumber || selectedSku.code}</span>
                      <em>{selectedSku.fitments[0]?.verified ? '适配已验证' : '适配待核对'}</em>
                    </p>
                    <p>
                      <strong>替代号 / 升级号</strong>
                      {selectedSku.numbers.slice(0, 2).map((number) => (
                        <span key={`${number.type}-${number.code}`}>
                          {number.code} · {number.type}
                        </span>
                      ))}
                    </p>
                    <p>
                      <strong>技术说明</strong>
                      <span>
                        {selectedSku.notes || '暂无技术说明，安装前请再次核对 VIN 与 OE 号。'}
                      </span>
                    </p>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="garage-main-empty">
              <IconCar size={52} />
              <h2>选择或添加车辆</h2>
              <p>车辆必须先归属一位车主，再用于记录询价和核对适配。</p>
            </div>
          )}
        </main>

        <aside className="garage-inquiries" aria-label="询价单">
          <div className="garage-quote-heading">
            <h2>报价单</h2>
            <button
              disabled={!selectedInquiry?.items.length}
              onClick={() =>
                selectedInquiry &&
                void saveInquiry({ ...selectedInquiry, items: [] }, '报价明细已清空')
              }
            >
              <IconTrash size={16} /> 清空
            </button>
            <button onClick={() => setMessage('保存为模板功能待接入')}>
              <IconDeviceFloppy size={16} /> 保存为模板
            </button>
          </div>
          {vehicleInquiries.length > 1 && (
            <div className="garage-inquiry-tabs">
              {vehicleInquiries.map((inquiry) => (
                <button
                  className={inquiry.id === selectedInquiryId ? 'active' : ''}
                  key={inquiry.id}
                  onClick={() => setSelectedInquiryId(inquiry.id)}
                >
                  <span>{inquiry.code}</span>
                  <small>{inquiry.status}</small>
                </button>
              ))}
            </div>
          )}
          {selectedInquiry ? (
            <div className="garage-inquiry-sheet">
              <section className="garage-customer-card">
                <header>
                  <strong>客户信息</strong>
                  <button onClick={() => setMessage('客户信息编辑入口待接入')}>编辑</button>
                </header>
                <dl>
                  <div>
                    <dt>客户姓名</dt>
                    <dd>{selectedOwner?.name || workspace?.customer.name}</dd>
                  </div>
                  <div>
                    <dt>联系电话</dt>
                    <dd>{selectedOwner?.phone || workspace?.customer.phone || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>车牌号码</dt>
                    <dd>{selectedVehicle?.plateNumber || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>VIN</dt>
                    <dd>{selectedVehicle?.vin || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>车型</dt>
                    <dd>
                      {selectedVehicle
                        ? `${selectedVehicle.brand} ${selectedVehicle.series} ${selectedVehicle.generationCode ? `(${selectedVehicle.generationCode})` : ''} ${selectedVehicle.modelYear} ${selectedVehicle.engine}`
                        : '未填写'}
                    </dd>
                  </div>
                </dl>
              </section>
              <div className="garage-quote-items-heading">
                <strong>报价明细（{selectedInquiry.items.length}）</strong>
                <span>
                  <IconPlus size={15} /> 从车库添加
                </span>
              </div>
              <div className="garage-inquiry-items">
                {selectedInquiry.items.map((item) => {
                  const sku = [...demoSkus, ...skuRows].find((row) => row.id === item.skuId)
                  const imageUrl = sku ? partImage(sku) : ''
                  return (
                    <div className="garage-quote-item" key={item.id}>
                      <span className="garage-inquiry-item-icon">
                        {imageUrl ? <img src={imageUrl} alt="" /> : <IconPackage size={18} />}
                      </span>
                      <span className="garage-quote-item-name">
                        <strong>{item.name}</strong>
                        <small>OE: {item.oeNumber || '未填写件号'}</small>
                      </span>
                      <button
                        className="garage-quote-remove"
                        aria-label={`移除 ${item.name}`}
                        onClick={() => removeInquiryItem(item.id)}
                      >
                        <IconTrash size={14} />
                      </button>
                      <em>{money(item.priceMinor)}</em>
                      <div className="garage-quantity-stepper compact">
                        <button
                          aria-label={`减少 ${item.name} 数量`}
                          onClick={() => updateInquiryItemQuantity(item.id, item.quantity - 1)}
                        >
                          <IconMinus size={13} />
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          aria-label={`增加 ${item.name} 数量`}
                          onClick={() => updateInquiryItemQuantity(item.id, item.quantity + 1)}
                        >
                          <IconPlus size={13} />
                        </button>
                      </div>
                      <strong className="garage-quote-line-total">
                        {money(item.priceMinor == null ? null : item.priceMinor * item.quantity)}
                      </strong>
                    </div>
                  )
                })}
                {!selectedInquiry.items.length && <p>该询价单还没有配件。</p>}
              </div>
              <dl className="garage-inquiry-total">
                <div>
                  <dt>价格来源</dt>
                  <dd>
                    <Select
                      label="价格来源"
                      value={quotePriceSource}
                      options={[
                        { value: 'standard', label: '标准售价' },
                        { value: 'agreement', label: '协议价格' },
                      ]}
                      onChange={setQuotePriceSource}
                    />
                  </dd>
                </div>
                <div>
                  <dt>合计金额</dt>
                  <dd>{money(inquiryTotal)}</dd>
                </div>
              </dl>
              {writable && (
                <button
                  className="garage-generate-quote"
                  disabled={
                    busy ||
                    !selectedInquiry.items.length ||
                    selectedInquiry.items.some((item) => item.priceMinor == null)
                  }
                  title={
                    selectedInquiry.items.some((item) => item.priceMinor == null)
                      ? '请先完成全部配件核价'
                      : undefined
                  }
                  onClick={() =>
                    void saveInquiry(
                      { ...selectedInquiry, status: '已报价' },
                      '报价已生成并保存到询价记录',
                    )
                  }
                >
                  <IconFileInvoice size={18} />
                  生成报价
                </button>
              )}
              <div className="garage-send-row">
                <button disabled title="客户发送功能待接入">
                  <IconSend size={17} /> 发送给客户（待接入）
                </button>
                <span>邮件 / 微信发送功能 待接入</span>
              </div>
            </div>
          ) : (
            <div className="garage-empty-inquiry">
              <IconFileInvoice size={34} />
              <strong>暂无询价单</strong>
              <span>为当前车主和车辆创建第一张询价单。</span>
              {writable && selectedVehicle && (
                <button
                  onClick={() =>
                    setInquiryDraft({
                      ownerId: selectedOwnerId,
                      vehicleId: selectedVehicleId,
                      source: '',
                      notes: '',
                      items: [emptyItem()],
                    })
                  }
                >
                  <IconPlus size={16} /> 新建询价
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {ownerDraft && (
        <Modal title="新增车主" onClose={() => setOwnerDraft(null)}>
          <form onSubmit={createOwner}>
            <div className="form-grid">
              <label>
                车主姓名 <span className="required">*</span>
                <input
                  required
                  value={ownerDraft.name}
                  onChange={(event) => setOwnerDraft({ ...ownerDraft, name: event.target.value })}
                />
              </label>
              <label>
                联系电话
                <input
                  value={ownerDraft.phone}
                  onChange={(event) => setOwnerDraft({ ...ownerDraft, phone: event.target.value })}
                />
              </label>
              <label>
                微信
                <input
                  value={ownerDraft.wechat}
                  onChange={(event) => setOwnerDraft({ ...ownerDraft, wechat: event.target.value })}
                />
              </label>
              <label>
                备注
                <input
                  value={ownerDraft.notes}
                  onChange={(event) => setOwnerDraft({ ...ownerDraft, notes: event.target.value })}
                />
              </label>
            </div>
            <footer className="form-actions">
              <button type="button" onClick={() => setOwnerDraft(null)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                保存车主
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {vehicleDraft && (
        <Modal title="新增车辆" onClose={() => setVehicleDraft(null)}>
          <form onSubmit={createVehicle}>
            <div className="form-grid">
              <label>
                所属车主
                <Select
                  label="所属车主"
                  value={vehicleDraft.ownerId}
                  options={(workspace?.owners ?? []).map((owner) => ({
                    value: owner.id,
                    label: owner.name,
                  }))}
                  onChange={(ownerId) => setVehicleDraft({ ...vehicleDraft, ownerId })}
                />
              </label>
              <label>
                品牌
                <Select
                  label="车辆品牌"
                  value={vehicleDraft.brand}
                  options={['保时捷', '奥迪'].map((brand) => ({ value: brand, label: brand }))}
                  onChange={(brand) => setVehicleDraft({ ...vehicleDraft, brand })}
                />
              </label>
              <label>
                车系 <span className="required">*</span>
                <input
                  required
                  placeholder="例如：911、Q7"
                  value={vehicleDraft.series}
                  onChange={(event) =>
                    setVehicleDraft({ ...vehicleDraft, series: event.target.value })
                  }
                />
              </label>
              <label>
                车型代号
                <input
                  placeholder="例如：992、4M"
                  value={vehicleDraft.generationCode}
                  onChange={(event) =>
                    setVehicleDraft({ ...vehicleDraft, generationCode: event.target.value })
                  }
                />
              </label>
              <label>
                年款
                <input
                  inputMode="numeric"
                  placeholder="2021"
                  value={vehicleDraft.modelYear}
                  onChange={(event) =>
                    setVehicleDraft({ ...vehicleDraft, modelYear: event.target.value })
                  }
                />
              </label>
              <label>
                发动机
                <input
                  placeholder="例如：3.0T"
                  value={vehicleDraft.engine}
                  onChange={(event) =>
                    setVehicleDraft({ ...vehicleDraft, engine: event.target.value })
                  }
                />
              </label>
              <label>
                VIN
                <input
                  value={vehicleDraft.vin}
                  onChange={(event) =>
                    setVehicleDraft({ ...vehicleDraft, vin: event.target.value.toUpperCase() })
                  }
                />
              </label>
              <label>
                车牌号
                <input
                  value={vehicleDraft.plateNumber}
                  onChange={(event) =>
                    setVehicleDraft({
                      ...vehicleDraft,
                      plateNumber: event.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
            </div>
            <label>
              车辆备注
              <textarea
                value={vehicleDraft.notes}
                onChange={(event) =>
                  setVehicleDraft({ ...vehicleDraft, notes: event.target.value })
                }
              />
            </label>
            <footer className="form-actions">
              <button type="button" onClick={() => setVehicleDraft(null)}>
                取消
              </button>
              <button className="primary" disabled={busy || !vehicleDraft.ownerId}>
                保存车辆
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {inquiryDraft && (
        <Modal wide title="新建询价单" onClose={() => setInquiryDraft(null)}>
          <form onSubmit={createInquiry}>
            <div className="form-grid">
              <label>
                车主
                <Select
                  label="询价车主"
                  value={inquiryDraft.ownerId}
                  options={(workspace?.owners ?? []).map((owner) => ({
                    value: owner.id,
                    label: owner.name,
                  }))}
                  onChange={(ownerId) =>
                    setInquiryDraft({ ...inquiryDraft, ownerId, vehicleId: '' })
                  }
                />
              </label>
              <label>
                车辆
                <Select
                  label="询价车辆"
                  value={inquiryDraft.vehicleId}
                  options={(workspace?.vehicles ?? [])
                    .filter((vehicle) => vehicle.ownerId === inquiryDraft.ownerId)
                    .map((vehicle) => ({
                      value: vehicle.id,
                      label: `${vehicle.brand} ${vehicle.series} ${vehicle.generationCode}`,
                    }))}
                  onChange={(vehicleId) => setInquiryDraft({ ...inquiryDraft, vehicleId })}
                />
              </label>
              <label>
                询价来源
                <Select
                  label="询价来源"
                  value={inquiryDraft.source}
                  options={['', '微信', '电话', '到店', '其他'].map((source) => ({
                    value: source,
                    label: source || '未选择',
                  }))}
                  onChange={(source) => setInquiryDraft({ ...inquiryDraft, source })}
                />
              </label>
              <label>
                询价备注
                <input
                  value={inquiryDraft.notes}
                  onChange={(event) =>
                    setInquiryDraft({ ...inquiryDraft, notes: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="garage-inquiry-editor-heading">
              <h3>询价配件</h3>
              <button
                type="button"
                onClick={() =>
                  setInquiryDraft({
                    ...inquiryDraft,
                    items: [...inquiryDraft.items, emptyItem()],
                  })
                }
              >
                <IconPlus size={16} /> 添加配件
              </button>
            </div>
            {inquiryDraft.items.map((item, index) => (
              <div className="garage-inquiry-editor-row" key={index}>
                <input
                  aria-label={`配件 ${index + 1} OE 件号`}
                  placeholder="OE 件号"
                  value={item.oeNumber}
                  onChange={(event) =>
                    setInquiryDraft({
                      ...inquiryDraft,
                      items: inquiryDraft.items.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, oeNumber: event.target.value } : row,
                      ),
                    })
                  }
                />
                <input
                  required
                  aria-label={`配件 ${index + 1} 名称`}
                  placeholder="配件名称"
                  value={item.name}
                  onChange={(event) =>
                    setInquiryDraft({
                      ...inquiryDraft,
                      items: inquiryDraft.items.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, name: event.target.value } : row,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`配件 ${index + 1} 数量`}
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(event) =>
                    setInquiryDraft({
                      ...inquiryDraft,
                      items: inquiryDraft.items.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`配件 ${index + 1} 单价`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="单价"
                  value={item.priceMinor == null ? '' : item.priceMinor / 100}
                  onChange={(event) =>
                    setInquiryDraft({
                      ...inquiryDraft,
                      items: inquiryDraft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? {
                              ...row,
                              priceMinor:
                                event.target.value === ''
                                  ? null
                                  : Math.round(Number(event.target.value) * 100),
                            }
                          : row,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`移除配件 ${index + 1}`}
                  onClick={() =>
                    setInquiryDraft({
                      ...inquiryDraft,
                      items: inquiryDraft.items.filter((_, rowIndex) => rowIndex !== index),
                    })
                  }
                >
                  移除
                </button>
              </div>
            ))}
            <footer className="form-actions">
              <button type="button" onClick={() => setInquiryDraft(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !inquiryDraft.ownerId || !inquiryDraft.vehicleId}
              >
                <IconCheck size={17} /> 保存询价单
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {pricingDraft && (
        <Modal wide title={`编辑核价 · ${pricingDraft.code}`} onClose={() => setPricingDraft(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveInquiry(pricingDraft, '询价与核价已保存').then((saved) => {
                if (saved) setPricingDraft(null)
              })
            }}
          >
            <div className="form-grid">
              <label>
                询价状态
                <Select
                  label="询价状态"
                  value={pricingDraft.status}
                  options={inquiryStatuses.map((status) => ({ value: status, label: status }))}
                  onChange={(status) =>
                    setPricingDraft({
                      ...pricingDraft,
                      status: status as GarageInquiry['status'],
                    })
                  }
                />
              </label>
              <label>
                询价来源
                <Select
                  label="询价来源"
                  value={pricingDraft.source}
                  options={['', '微信', '电话', '到店', '其他'].map((source) => ({
                    value: source,
                    label: source || '未选择',
                  }))}
                  onChange={(source) => setPricingDraft({ ...pricingDraft, source })}
                />
              </label>
            </div>
            <div className="garage-inquiry-editor-heading">
              <h3>配件与销售单价</h3>
              <span>金额单位：元</span>
            </div>
            {pricingDraft.items.map((item, index) => (
              <div className="garage-pricing-row" key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.oeNumber || '未填写件号'}</small>
                </span>
                <label>
                  数量
                  <input
                    aria-label={`${item.name} 数量`}
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(event) =>
                      setPricingDraft({
                        ...pricingDraft,
                        items: pricingDraft.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, quantity: Number(event.target.value) }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  销售单价
                  <input
                    aria-label={`${item.name} 销售单价`}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="待核价"
                    value={item.priceMinor == null ? '' : item.priceMinor / 100}
                    onChange={(event) =>
                      setPricingDraft({
                        ...pricingDraft,
                        items: pricingDraft.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                priceMinor:
                                  event.target.value === ''
                                    ? null
                                    : Math.round(Number(event.target.value) * 100),
                              }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <label>
              询价备注
              <textarea
                value={pricingDraft.notes}
                onChange={(event) =>
                  setPricingDraft({ ...pricingDraft, notes: event.target.value })
                }
              />
            </label>
            <footer className="form-actions">
              <button type="button" onClick={() => setPricingDraft(null)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                <IconCheck size={17} /> 保存核价
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
