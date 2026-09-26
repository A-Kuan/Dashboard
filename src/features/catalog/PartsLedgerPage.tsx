import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  IconAlertCircle,
  IconBell,
  IconBriefcase2Filled,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleFilled,
  IconCopy,
  IconHistory,
  IconPackage,
  IconPlus,
  IconSearch,
  IconStar,
  IconX,
} from '@tabler/icons-react'
import catalog from '../../../shared/catalog.json'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import { blankSku } from './defaults'
import { SkuEditor } from './SkuEditor'
import { supplyTypeLabel, supplyTypeOptions, type SupplyTypeItem } from './supplyNature'
import type { Customer, Sku } from './types'
import './parts-ledger.css'

function productImage(sku: Sku) {
  const text = `${sku.name} ${sku.category} ${sku.position}`
  if (/制动盘|刹车盘/.test(text)) return '/parts/brake-disc.png'
  if (/水管|冷却/.test(text)) return '/parts/coolant-hose.png'
  if (/制动摩擦片|刹车片|刹车皮/.test(text)) return '/parts/brake-pads.png'
  return sku.imageUrl
}

function amount(value: number | null) {
  return value == null ? '未设置' : `¥ ${(value / 100).toFixed(2)}`
}

function tableAmount(value: number | null) {
  return value == null
    ? '—'
    : (value / 100).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
}

export function PartsLedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const writable = user.role !== 'viewer'
  const [rows, setRows] = useState<Sku[]>([])
  const [total, setTotal] = useState(0)
  const [brands, setBrands] = useState<string[]>([])
  const [dictionaryBrands, setDictionaryBrands] = useState<string[]>([])
  const [dictionaryCategories, setDictionaryCategories] = useState<string[]>([])
  const [supplyTypes, setSupplyTypes] = useState<SupplyTypeItem[] | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Sku | null>(null)
  const [quoting, setQuoting] = useState<Sku | null>(null)
  const [quoteAmount, setQuoteAmount] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [stockOnly, setStockOnly] = useState(false)
  const [moreFilters, setMoreFilters] = useState(false)
  const [priceSource, setPriceSource] = useState('')
  const [verification, setVerification] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [filters, setFilters] = useState({
    brand: '',
    category: '',
    nature: '',
    origin: '',
    vehicle: '',
  })
  const [customerId, setCustomerId] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [inspectingId, setInspectingId] = useState('')
  const search = searchParams.get('search') ?? localSearch

  useEffect(() => {
    void api<{ code: string; label: string }[]>(
      '/dictionaries/options?scope=sku_foundation&code=category',
    )
      .then((items) => setDictionaryCategories(items.map((item) => item.label)))
      .catch(() => {})
    void api<{ code: string; label: string }[]>(
      '/dictionaries/options?scope=sku_foundation&code=product_brand',
    )
      .then((items) => setDictionaryBrands(items.map((item) => item.label)))
      .catch(() => {})
    void Promise.all([
      api<SupplyTypeItem[]>('/dictionaries/options?scope=sku_foundation&code=supply_type'),
      api<{ code: string }[]>('/dictionaries/groups?scope=sku_foundation'),
    ])
      .then(([items, groups]) =>
        setSupplyTypes(groups.some((group) => group.code === 'supply_type') ? items : null),
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    const params = new URLSearchParams({
      enabled: String(!disabled),
      page: String(page),
      sort: 'code',
      search,
      ...filters,
    })
    void Promise.all([
      api<{ rows: Sku[]; total: number; brands: string[] }>(`/skus/page?${params}`),
      api<Customer[]>('/customers'),
    ])
      .then(([result, customerRows]) => {
        if (!alive) return
        setRows(result.rows)
        setTotal(result.total)
        setBrands(result.brands)
        setCustomers(customerRows)
        setInspectingId((current) =>
          result.rows.some((row) => row.id === current) ? current : (result.rows[0]?.id ?? ''),
        )
        setSelectedIds((current) =>
          current.filter((id) => result.rows.some((row) => row.id === id)),
        )
      })
      .catch((reason) => {
        if (alive) setError(errorMessage(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [disabled, reload, page, search, filters])

  const pages = Math.max(1, Math.ceil(total / 20))
  const currentPage = Math.min(page, pages)
  const visibleRows = rows.filter((row) => {
    if (stockOnly && row.stocks.reduce((sum, stock) => sum + stock.quantity, 0) <= 0) return false
    if (priceSource === 'supplier' && !row.supplierQuotes.length) return false
    if (priceSource === 'customer' && resolvedPrice(row).amount == null) return false
    const verified = row.fitments.some((fitment) => fitment.verified)
    if (verification === 'verified' && !verified) return false
    if (verification === 'pending' && verified) return false
    return true
  })
  const inspecting = rows.find((row) => row.id === inspectingId) ?? null
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id))
  const vehicleGroups = [
    {
      brand: '保时捷',
      items: [
        ['911', '911 (992)'],
        ['718', '718 (982)'],
        ['Cayenne', 'Cayenne (9Y0)'],
        ['Macan', 'Macan (95B)'],
        ['Panamera', 'Panamera (971)'],
        ['Taycan', 'Taycan (Y1A)'],
      ],
    },
    {
      brand: '奥迪',
      items: [
        ['A4', 'A4 (8W)'],
        ['A6', 'A6 (4A)'],
        ['Q5', 'Q5 (FY)'],
        ['Q7', 'Q7 (4M)'],
        ['Q8', 'Q8 (4M8)'],
        ['A8', 'A8 (4N)'],
        ['e-tron', 'e-tron (GE)'],
      ],
    },
  ]

  function clear() {
    updateSearch('')
    setFilters({ brand: '', category: '', nature: '', origin: '', vehicle: '' })
    setStockOnly(false)
    setPriceSource('')
    setVerification('')
    setPage(1)
  }

  function updateSearch(value: string) {
    setLocalSearch(value)
    if (searchParams.has('search')) {
      const next = new URLSearchParams(searchParams)
      next.delete('search')
      setSearchParams(next, { replace: true })
    }
  }

  function resolvedPrice(sku: Sku) {
    const customer = customers.find((row) => row.id === customerId)
    if (!customer) return { amount: null as number | null, source: '未选择客户' }
    const agreement = sku.prices.find((price) => price.customerId === customer.id)
    if (agreement) return { amount: agreement.amountMinor, source: '协议价' }
    if (customer.customerType === '同行') return { amount: sku.tradePriceMinor, source: '同行价' }
    if (customer.customerType === '修理厂')
      return { amount: sku.repairPriceMinor, source: '修理厂价' }
    return { amount: null, source: '客户待分类' }
  }

  function openQuote(sku: Sku) {
    const price = resolvedPrice(sku)
    setQuoteAmount(price.amount == null ? '' : (price.amount / 100).toFixed(2))
    setCopyStatus('')
    setQuoting(sku)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  const inspectorImage = inspecting ? productImage(inspecting) : ''
  const inspectorStock = inspecting?.stocks.reduce((sum, row) => sum + row.quantity, 0) ?? 0

  return (
    <div className="business parts-ledger">
      <aside className="parts-ledger-sidebar" aria-label="SKU 快捷查询">
        <button
          className="parts-ledger-new-search"
          onClick={() => {
            clear()
            document.querySelector<HTMLInputElement>('#parts-ledger-search')?.focus()
          }}
        >
          <IconSearch size={17} />
          新建查询
          <kbd>Ctrl K</kbd>
        </button>
        <nav>
          <strong>我的收藏</strong>
          <button className={!filters.vehicle ? 'active' : ''} onClick={() => clear()}>
            <IconBriefcase2Filled size={16} /> 全部配件
          </button>
          <button disabled title="常用查询将在后续接入">
            <IconHistory size={16} /> 常用查询 <em>待接入</em>
          </button>
          <button disabled title="今日询价汇总将在后续接入">
            <IconBell size={16} /> 今日询价 <em>待接入</em>
          </button>
          <button disabled title="低库存预警将在后续接入">
            <IconAlertCircle size={16} /> 低库存预警 <em>待接入</em>
          </button>
          <button disabled title="近期新增汇总将在后续接入">
            <IconPlus size={16} /> 近期新增 <em>待接入</em>
          </button>
          <button disabled title="待核实任务队列将在后续接入">
            <IconAlertCircle size={16} /> 待核实件号 <em>待接入</em>
          </button>
        </nav>
        <div className="parts-ledger-tree">
          <strong>车型系列</strong>
          {vehicleGroups.map((group) => (
            <section key={group.brand}>
              <h3>
                <IconChevronDown size={15} /> {group.brand}
              </h3>
              {group.items.map(([value, label]) => (
                <button
                  className={filters.vehicle === value ? 'active' : ''}
                  key={value}
                  onClick={() => {
                    setFilters({ ...filters, vehicle: filters.vehicle === value ? '' : value })
                    setPage(1)
                  }}
                >
                  {label}
                </button>
              ))}
            </section>
          ))}
        </div>
        {writable && (
          <button className="parts-ledger-add" disabled title="自定义分组将在后续接入">
            <IconPlus size={16} /> 添加自定义分组
          </button>
        )}
      </aside>

      <main className="parts-ledger-main">
        <header className="parts-ledger-query">
          <div className="parts-ledger-search-row">
            <Select
              label="搜索字段"
              value="all"
              options={[{ value: 'all', label: 'OE / SKU' }]}
              onChange={() => {}}
            />
            <label className="parts-ledger-search-field">
              <IconSearch size={18} />
              <input
                id="parts-ledger-search"
                aria-label="搜索 SKU"
                placeholder="输入件号、配件名称、车型或 SKU"
                value={search}
                onChange={(event) => {
                  updateSearch(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            <button className="primary">搜索</button>
            <button onClick={clear}>重置</button>
            <button
              className={`parts-ledger-more${moreFilters ? ' active' : ''}`}
              onClick={() => setMoreFilters((value) => !value)}
            >
              更多筛选 <IconChevronDown size={14} />
            </button>
          </div>
          <div className="parts-ledger-filter-row">
            <Select
              label="车型"
              value={filters.vehicle}
              options={[
                { value: '', label: '车型：全部' },
                ...vehicleGroups.flatMap((group) =>
                  group.items.map(([value, label]) => ({
                    value,
                    label: `${group.brand} ${label}`,
                  })),
                ),
              ]}
              onChange={(value) => {
                setFilters({ ...filters, vehicle: value })
                setPage(1)
              }}
            />
            <Select
              label="供货性质"
              value={filters.nature}
              options={[
                { value: '', label: '供货性质：全部' },
                ...supplyTypeOptions(supplyTypes),
                ...catalog.natures
                  .filter((value) => value !== '待确认')
                  .map((value) => ({ value, label: `历史值 · ${value}` })),
              ]}
              onChange={(value) => {
                setFilters({ ...filters, nature: value })
                setPage(1)
              }}
            />
            <Select
              label="库存"
              value={stockOnly ? 'in_stock' : ''}
              options={[
                { value: '', label: '库存：全部' },
                { value: 'in_stock', label: '库存：有库存' },
              ]}
              onChange={(value) => setStockOnly(value === 'in_stock')}
            />
            <Select
              label="价格来源"
              value={priceSource}
              options={[
                { value: '', label: '价格来源：全部' },
                { value: 'supplier', label: '有供应商报价' },
                { value: 'customer', label: '有客户售价' },
              ]}
              onChange={setPriceSource}
            />
            <Select
              label="核实状态"
              value={verification}
              options={[
                { value: '', label: '核实状态：全部' },
                { value: 'verified', label: '已核实' },
                { value: 'pending', label: '待核实' },
              ]}
              onChange={setVerification}
            />
            <label className="parts-ledger-stock-toggle">
              <input
                type="checkbox"
                checked={stockOnly}
                onChange={(event) => setStockOnly(event.target.checked)}
              />
              仅显示有库存
            </label>
            <button disabled className="parts-ledger-save-query" title="保存查询将在后续接入">
              <IconStar size={15} /> 保存查询
            </button>
          </div>
          {moreFilters && (
            <div className="parts-ledger-advanced-row">
              {(
                [
                  ['brand', '品牌', [...new Set([...dictionaryBrands, ...brands])]],
                  [
                    'category',
                    '配件分类',
                    [...new Set([...catalog.categories, ...dictionaryCategories])],
                  ],
                  ['origin', '产地属性', catalog.origins],
                ] as const
              ).map(([key, label, options]) => (
                <Select
                  key={key}
                  label={label}
                  value={filters[key]}
                  options={[
                    { value: '', label: `${label}：全部` },
                    ...options.map((value) => ({ value, label: value })),
                  ]}
                  onChange={(value) => {
                    setFilters({ ...filters, [key]: value })
                    setPage(1)
                  }}
                />
              ))}
              <span>
                已显示 {visibleRows.length} / {total} 条
              </span>
              {writable && (
                <button
                  className="parts-ledger-create-sku"
                  onClick={() => setEditing(structuredClone(blankSku))}
                >
                  <IconPlus size={15} /> 新增 SKU
                </button>
              )}
              <button
                className="parts-ledger-disabled-toggle"
                onClick={() => {
                  setDisabled(!disabled)
                  setPage(1)
                }}
              >
                {disabled ? '查看已启用' : '管理停用 SKU'}
              </button>
            </div>
          )}
        </header>

        {message && (
          <p className="parts-ledger-message" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="parts-ledger-error" role="alert">
            {error} <button onClick={() => setReload((value) => value + 1)}>重试</button>
          </p>
        )}

        <div className="parts-ledger-table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择当前页全部 SKU"
                    checked={
                      visibleRows.length > 0 &&
                      visibleRows.every((row) => selectedIds.includes(row.id))
                    }
                    onChange={() =>
                      setSelectedIds(
                        visibleRows.every((row) => selectedIds.includes(row.id))
                          ? []
                          : visibleRows.map((row) => row.id),
                      )
                    }
                  />
                </th>
                <th>OE / SKU</th>
                <th>配件名称</th>
                <th>适配车型</th>
                <th>供货性质</th>
                <th className="numeric">最新进价 (¥)</th>
                <th className="numeric">客户价 (¥)</th>
                <th>库存</th>
                <th>核实状态</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((sku) => {
                const price = resolvedPrice(sku)
                const supplier = sku.supplierQuotes[0]
                const stock = sku.stocks.reduce((sum, row) => sum + row.quantity, 0)
                const fitment = sku.fitments[0]
                const selected = selectedIds.includes(sku.id)
                const partNumber = sku.partNumber || sku.numbers[0]?.code || sku.code
                return (
                  <tr
                    className={`${selected ? 'selected' : ''}${inspectingId === sku.id ? ' inspecting' : ''}`}
                    key={sku.id}
                    onClick={() => setInspectingId(sku.id)}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${sku.code}`}
                        checked={selected}
                        onChange={() => toggleSelected(sku.id)}
                      />
                    </td>
                    <td>
                      <div className="parts-ledger-code-line">
                        <button
                          className="parts-ledger-code"
                          onClick={() => setInspectingId(sku.id)}
                        >
                          {partNumber}
                        </button>
                        <button
                          className="parts-ledger-row-copy"
                          aria-label={`复制件号 ${partNumber}`}
                          title="复制件号"
                          onClick={(event) => {
                            event.stopPropagation()
                            void navigator.clipboard
                              .writeText(partNumber)
                              .then(() => setMessage('件号已复制'))
                              .catch(() => setError('复制失败，请检查浏览器剪贴板权限'))
                          }}
                        >
                          <IconCopy size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="parts-ledger-primary">{sku.name}</span>
                    </td>
                    <td>
                      <span className="parts-ledger-primary">
                        {fitment ? `${fitment.make} ${fitment.series} ${fitment.chassis}` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="parts-ledger-nature">
                        {supplyTypeLabel(sku.nature, supplyTypes).split(' · ')[0]}
                      </span>
                    </td>
                    <td className="numeric">{tableAmount(supplier?.amountMinor ?? null)}</td>
                    <td className="numeric">{tableAmount(price.amount)}</td>
                    <td>
                      {sku.stocks.length ? (
                        <>
                          <span className="parts-ledger-stock-value">{stock}</span>
                          <small>{`${sku.stocks[0].warehouse} ${sku.stocks[0].bin}`}</small>
                        </>
                      ) : (
                        <span className="parts-ledger-empty-value">—</span>
                      )}
                    </td>
                    <td>
                      <span className={fitment?.verified ? 'verified' : 'pending'}>
                        <IconCircleFilled size={8} aria-hidden="true" />
                        {fitment?.verified ? '已核实' : '待核实'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!visibleRows.length && (
            <div className="parts-ledger-empty">
              <IconPackage size={40} />
              <strong>
                {loading ? '正在读取 SKU…' : stockOnly ? '当前页没有库存记录' : '没有匹配的 SKU'}
              </strong>
              <span>
                {stockOnly ? '关闭库存筛选或切换分页继续查看。' : '调整搜索关键词或筛选条件。'}
              </span>
            </div>
          )}
        </div>

        {selectedRows.length > 0 && (
          <div className="parts-ledger-selection-dock">
            <strong>已选择 {selectedRows.length} 条</strong>
            <div className="parts-ledger-selected-codes">
              {selectedRows.slice(0, 3).map((row) => (
                <span key={row.id}>{row.partNumber || row.code}</span>
              ))}
              {selectedRows.length > 3 && <span>+{selectedRows.length - 3}</span>}
            </div>
            <button
              className="primary"
              disabled={!customerId || selectedRows.length !== 1}
              onClick={() => openQuote(selectedRows[0])}
            >
              <IconPlus size={17} /> 加入报价
            </button>
            <button disabled title="对比价格将在后续接入">
              对比价格
            </button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(selectedRows.map((row) => row.partNumber || row.code).join('\n'))
                  .then(() => setMessage('件号已复制'))
                  .catch(() => setError('复制失败，请检查浏览器剪贴板权限'))
              }
            >
              <IconCopy size={16} /> 复制件号
            </button>
            <button disabled aria-label="更多批量操作">
              •••
            </button>
          </div>
        )}

        <footer className="parts-ledger-footer">
          <span>
            共 {total} 条记录{stockOnly ? ` · 当前页有库存 ${visibleRows.length} 条` : ''}
          </span>
          <div>
            <span>每页 20 条</span>
            <button
              aria-label="上一页"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <IconChevronLeft size={16} />
            </button>
            <strong>{currentPage}</strong>
            <span>/ {pages}</span>
            <button
              aria-label="下一页"
              disabled={currentPage >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </footer>
      </main>

      <aside className="parts-ledger-inspector" aria-label="配件详情">
        {inspecting ? (
          <>
            <header>
              <div>
                <small>配件详情</small>
                <h2>{inspecting.partNumber || inspecting.numbers[0]?.code || inspecting.code}</h2>
                <p>{inspecting.name}</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭配件详情"
                onClick={() => setInspectingId('')}
              >
                <IconX size={19} />
              </button>
            </header>
            <div className="parts-ledger-inspector-tags">
              <span>{supplyTypeLabel(inspecting.nature, supplyTypes)}</span>
              <span>{inspecting.category}</span>
            </div>
            <div className="parts-ledger-product-visual">
              {inspectorImage ? (
                <>
                  <span>
                    <img src={inspectorImage} alt={inspecting.name} />
                  </span>
                  <span>
                    <img src={inspectorImage} alt="" />
                  </span>
                </>
              ) : (
                <div>
                  <IconPackage size={38} />
                  <small>暂无商品图片</small>
                </div>
              )}
            </div>
            <section>
              <h3>替代号与关联件号</h3>
              <ol className="parts-ledger-number-chain">
                <li>
                  <span />
                  <strong>{inspecting.partNumber || inspecting.code}</strong>
                  <em>当前</em>
                </li>
                {inspecting.numbers.slice(0, 4).map((number) => (
                  <li key={`${number.type}-${number.code}`}>
                    <span />
                    <strong>{number.code}</strong>
                    <em>{number.type}</em>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>适配车型</h3>
              {inspecting.fitments.length ? (
                inspecting.fitments.slice(0, 3).map((fitment) => (
                  <p
                    className="parts-ledger-fitment"
                    key={`${fitment.make}-${fitment.series}-${fitment.chassis}`}
                  >
                    <strong>
                      {fitment.make} {fitment.series} {fitment.chassis}
                    </strong>
                    <span>
                      {[fitment.yearFrom, fitment.yearTo, fitment.engine]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </p>
                ))
              ) : (
                <p className="parts-ledger-muted">尚未录入适配车型</p>
              )}
            </section>
            <section className="parts-ledger-stock-summary">
              <h3>库存信息</h3>
              <strong>{inspecting.stocks.length ? inspectorStock : '未录入'}</strong>
              <span>{inspecting.unit}</span>
              <p>
                {inspecting.stocks[0]
                  ? `${inspecting.stocks[0].warehouse} · ${inspecting.stocks[0].bin}`
                  : '暂无库位'}
              </p>
            </section>
            <section>
              <h3 className="parts-ledger-section-heading">
                价格信息
                <button onClick={() => setEditing(inspecting)} disabled={!writable}>
                  编辑
                </button>
              </h3>
              <dl className="parts-ledger-prices">
                <div>
                  <dt>最新进价</dt>
                  <dd>{amount(inspecting.supplierQuotes[0]?.amountMinor ?? null)}</dd>
                </div>
                <div>
                  <dt>同行价</dt>
                  <dd>{amount(inspecting.tradePriceMinor)}</dd>
                </div>
                <div>
                  <dt>修理厂价</dt>
                  <dd>{amount(inspecting.repairPriceMinor)}</dd>
                </div>
                <div className="customer-price">
                  <dt>当前客户价</dt>
                  <dd>{amount(resolvedPrice(inspecting).amount)}</dd>
                </div>
              </dl>
            </section>
            <section className="parts-ledger-supplier-history">
              <h3 className="parts-ledger-section-heading">
                供应商报价历史
                <span>
                  {inspecting.supplierQuotes.length
                    ? `共 ${inspecting.supplierQuotes.length} 条`
                    : ''}
                </span>
              </h3>
              {inspecting.supplierQuotes.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>供应商</th>
                      <th>价格（¥）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspecting.supplierQuotes.slice(0, 4).map((quote) => (
                      <tr key={quote.id}>
                        <td>{quote.quotedOn}</td>
                        <td>{quote.supplier || '未填写'}</td>
                        <td>{(quote.amountMinor / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="parts-ledger-muted">尚无供应商报价记录</p>
              )}
            </section>
            <div className="parts-ledger-customer-select">
              <label>报价客户</label>
              <Select
                label="报价客户"
                value={customerId}
                options={[
                  { value: '', label: '选择客户后显示适用售价' },
                  ...customers
                    .filter((customer) => customer.enabled)
                    .map((customer) => ({
                      value: customer.id,
                      label: `${customer.name} · ${customer.code}`,
                    })),
                ]}
                onChange={setCustomerId}
              />
              <button
                className="primary"
                disabled={!customerId}
                onClick={() => openQuote(inspecting)}
              >
                加入报价
              </button>
            </div>
          </>
        ) : (
          <div className="parts-ledger-inspector-empty">
            <IconPackage size={38} />
            <strong>选择一条 SKU</strong>
            <span>查看适配、库存与价格详情。</span>
          </div>
        )}
      </aside>

      {editing && (
        <SkuEditor
          initial={editing}
          customers={customers}
          readOnly={!writable}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            setReload((value) => value + 1)
            setEditing(null)
            setMessage(saved.enabled ? 'SKU 已保存' : 'SKU 已停用')
          }}
        />
      )}
      {quoting && (
        <Modal title={`快速报价 · ${quoting.name}`} onClose={() => setQuoting(null)}>
          <div className="quote-summary">
            <p>
              客户：{customers.find((customer) => customer.id === customerId)?.name} ·{' '}
              {resolvedPrice(quoting).source}
            </p>
            <p>适用售价：{amount(resolvedPrice(quoting).amount)}</p>
            <p>
              最近供应商报价：{amount(quoting.supplierQuotes[0]?.amountMinor ?? null)}
              {quoting.supplierQuotes[0] && ` · ${quoting.supplierQuotes[0].quotedOn}`}
            </p>
          </div>
          <label>
            本次报价 ¥ / {quoting.unit}
            <input
              type="number"
              min="0"
              step="0.01"
              value={quoteAmount}
              onChange={(event) => setQuoteAmount(event.target.value)}
            />
          </label>
          <p className="muted">本次调整仅用于复制报价，不改动 SKU 默认售价或协议价。</p>
          {copyStatus && (
            <p role="status" className="success">
              {copyStatus}
            </p>
          )}
          <footer className="form-actions">
            <button onClick={() => setQuoting(null)}>关闭</button>
            <button
              className="primary"
              disabled={!/^\d+(\.\d{1,2})?$/.test(quoteAmount)}
              onClick={() => {
                const customer = customers.find((row) => row.id === customerId)
                if (!customer) return
                void navigator.clipboard
                  .writeText(
                    `${customer.name}：${quoting.name}（${quoting.brand}，SKU ${quoting.code}）¥${Number(quoteAmount).toFixed(2)}/${quoting.unit}。具体适配请以车型与件号核对为准。`,
                  )
                  .then(() => setCopyStatus('报价文字已复制'))
                  .catch(() => setCopyStatus('复制失败，请检查浏览器剪贴板权限'))
              }}
            >
              复制报价文字
            </button>
          </footer>
        </Modal>
      )}
    </div>
  )
}
