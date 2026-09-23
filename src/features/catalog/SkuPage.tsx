import { useEffect, useState } from 'react'
import {
  IconPlus,
  IconSearch,
  IconDotsVertical,
  IconPackage,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react'
import catalog from '../../../shared/catalog.json'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import type { Customer, Sku } from './types'
import { SkuEditor } from './SkuEditor'
import { blankSku } from './defaults'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import { supplyTypeLabel, supplyTypeOptions, type SupplyTypeItem } from './supplyNature'

export function SkuPage() {
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
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({
    brand: '',
    category: '',
    nature: '',
    origin: '',
    vehicle: '',
  })
  const [customerId, setCustomerId] = useState('')
  const [view, setView] = useState('全部 SKU')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
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
      sort: view === '按分类' ? 'category' : view === '按车型' ? 'vehicle' : 'code',
      search,
      ...filters,
    })
    void Promise.all([
      api<{ rows: Sku[]; total: number; brands: string[] }>(`/skus/page?${params}`),
      api<Customer[]>('/customers'),
    ])
      .then(([result, c]) => {
        if (alive) {
          setRows(result.rows)
          setTotal(result.total)
          setBrands(result.brands)
          setCustomers(c)
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [disabled, reload, page, search, filters, view])
  const pages = Math.max(1, Math.ceil(total / 20))
  const currentPage = Math.min(page, pages)
  const visible = rows
  function clear() {
    setSearch('')
    setFilters({ brand: '', category: '', nature: '', origin: '', vehicle: '' })
    setPage(1)
  }
  function resolvedPrice(sku: Sku) {
    const customer = customers.find((c) => c.id === customerId)
    if (!customer) return { amount: null as number | null, source: '请选择客户' }
    const agreement = sku.prices.find((p) => p.customerId === customer.id)
    if (agreement) return { amount: agreement.amountMinor, source: '客户协议价' }
    if (customer.customerType === '同行') return { amount: sku.tradePriceMinor, source: '同行价' }
    if (customer.customerType === '修理厂')
      return { amount: sku.repairPriceMinor, source: '修理厂价' }
    return { amount: null, source: '客户待分类' }
  }
  function openQuote(sku: Sku) {
    const { amount } = resolvedPrice(sku)
    setQuoteAmount(amount == null ? '' : (amount / 100).toFixed(2))
    setCopyStatus('')
    setQuoting(sku)
  }
  return (
    <div className="business business-page sku-page">
      <header className="page-heading">
        <div>
          <h1>汽配 SKU</h1>
          <p>
            共 {total} 个{disabled ? '停用' : '已启用'} SKU
          </p>
        </div>
        <div className="heading-actions">
          <label className="search-field">
            <IconSearch size={19} />
            <input
              aria-label="搜索 SKU"
              placeholder="搜索 SKU、件号、车型或品牌"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </label>
          {writable && (
            <button className="primary" onClick={() => setEditing(structuredClone(blankSku))}>
              <IconPlus size={19} />
              新增 SKU
            </button>
          )}
        </div>
      </header>
      <div className="toolbar">
        <div className="tabs">
          {['全部 SKU', '按车型', '按分类'].map((v) => (
            <button
              key={v}
              className={view === v ? 'active' : ''}
              onClick={() => {
                setView(v)
                setPage(1)
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="filters">
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
              options={[{ value: '', label }, ...options.map((v) => ({ value: v, label: v }))]}
              value={filters[key]}
              onChange={(value) => {
                setFilters({ ...filters, [key]: value })
                setPage(1)
              }}
            />
          ))}
          <Select
            label="供货性质"
            options={[
              { value: '', label: '供货性质' },
              ...supplyTypeOptions(supplyTypes),
              ...catalog.natures
                .filter((value) => value !== '待确认')
                .map((value) => ({ value, label: `历史值 · ${value}` })),
            ]}
            value={filters.nature}
            onChange={(value) => {
              setFilters({ ...filters, nature: value })
              setPage(1)
            }}
          />
          <input
            aria-label="筛选适配车型"
            className="vehicle-filter"
            placeholder="适配车型"
            value={filters.vehicle}
            onChange={(e) => {
              setFilters({ ...filters, vehicle: e.target.value })
              setPage(1)
            }}
          />
          <button className="text-button" onClick={clear}>
            清空
          </button>
        </div>
      </div>
      <div className="customer-price-bar">
        <label>
          报价客户
          <Select
            label="报价客户"
            options={[
              { value: '', label: '选择客户' },
              ...customers
                .filter((c) => c.enabled)
                .map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` })),
            ]}
            value={customerId}
            onChange={setCustomerId}
          />
        </label>
        <span>协议价优先，其次按客户类型取价</span>
        {writable && (
          <button
            className="text-button"
            onClick={() => {
              setLoading(true)
              setError('')
              setDisabled(!disabled)
              setPage(1)
              setMessage('')
            }}
          >
            {disabled ? '返回已启用 SKU' : '管理停用 SKU'}
          </button>
        )}
      </div>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => setReload(reload + 1)}>重试</button>
        </p>
      )}
      <div className="table-scroll">
        <table className="sku-table">
          <thead>
            <tr>
              <th>SKU / 配件名称</th>
              <th>品牌 / 厂家件号</th>
              <th>供货性质</th>
              <th>产地属性</th>
              <th>OE / 替代件号</th>
              <th>适配车型</th>
              <th className="numeric">库存</th>
              <th>库位</th>
              <th className="numeric">适用售价</th>
              <th className="numeric">最近供应商报价</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const price = resolvedPrice(s)
              const latestSupplier = s.supplierQuotes[0]
              const fit = s.fitments[0]
              return (
                <tr key={s.id}>
                  <td>
                    <button className="cell-link" onClick={() => setEditing(s)}>
                      {s.code}
                    </button>
                    <small>{s.name}</small>
                  </td>
                  <td>
                    {s.brand || s.sourceManufacturer || '品牌待确认'}
                    <small>{s.partNumber || '未录入件号'}</small>
                  </td>
                  <td>
                    <span className="tag">{supplyTypeLabel(s.nature, supplyTypes)}</span>
                  </td>
                  <td>
                    {s.origin}
                    <small>{s.country}</small>
                  </td>
                  <td
                    className="cell-codes"
                    title={s.numbers.map((n) => `${n.type}: ${n.code}`).join('\n')}
                  >
                    {s.numbers[0]?.code || '—'}
                    {s.numbers.length > 1 && <small>另 {s.numbers.length - 1} 个件号</small>}
                  </td>
                  <td>
                    {fit ? (
                      <>
                        <span>
                          {fit.make} {fit.series} {fit.chassis}
                        </span>
                        <small>
                          {[
                            fit.yearFrom && `${fit.yearFrom}–${fit.yearTo || '至今'}`,
                            fit.power,
                            !fit.verified && '待核对',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {s.fitments.length > 1 && ` · +${s.fitments.length - 1} 车型`}
                        </small>
                      </>
                    ) : (
                      '未录入适配'
                    )}
                  </td>
                  <td className="numeric">
                    {s.stocks.length ? s.stocks.reduce((n, v) => n + v.quantity, 0) : '未录入'}
                    <small>{s.unit}</small>
                  </td>
                  <td title={s.stocks.map((v) => `${v.warehouse} / ${v.bin}`).join('\n')}>
                    {s.stocks[0]?.bin || '—'}
                    <small>
                      {s.stocks[0]?.warehouse}
                      {s.stocks.length > 1 && ` +${s.stocks.length - 1}`}
                    </small>
                  </td>
                  <td className="numeric">
                    {price.amount == null ? (
                      <span className="muted">未设置</span>
                    ) : (
                      `¥ ${(price.amount / 100).toFixed(2)}`
                    )}
                    <small>{price.source}</small>
                  </td>
                  <td className="numeric">
                    {latestSupplier
                      ? `¥ ${(latestSupplier.amountMinor / 100).toFixed(2)}`
                      : '未录入'}
                    {latestSupplier && (
                      <small>
                        {latestSupplier.supplier} · {latestSupplier.quotedOn}
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => openQuote(s)}
                      disabled={!customerId}
                    >
                      报价
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${writable ? '编辑' : '查看'}SKU ${s.code}`}
                      onClick={() => setEditing(s)}
                    >
                      <IconDotsVertical size={20} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <div className="empty-state">
          <IconPackage size={42} />
          <h2>
            {loading
              ? '正在读取 SKU…'
              : total
                ? '没有匹配的 SKU'
                : disabled
                  ? '没有停用的 SKU'
                  : '建立你的配件目录'}
          </h2>
          <p>
            {total
              ? '调整搜索关键词或筛选条件。'
              : '新增配件后，在这里查件、查看库存、售价及供应商报价。'}
          </p>
          {writable && !disabled && !loading && !total && (
            <button className="primary" onClick={() => setEditing(structuredClone(blankSku))}>
              <IconPlus size={18} />
              新增第一条 SKU
            </button>
          )}
        </div>
      )}
      <footer className="pagination">
        <span>共 {total} 条记录</span>
        <div>
          <span>每页 20 条</span>
          <button
            aria-label="上一页"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <IconChevronLeft size={17} />
          </button>
          <span>
            {currentPage} / {pages}
          </span>
          <button
            aria-label="下一页"
            disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <IconChevronRight size={17} />
          </button>
        </div>
      </footer>
      {editing && (
        <SkuEditor
          initial={editing}
          customers={customers}
          readOnly={!writable}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            setReload((value) => value + 1)
            setEditing(null)
            setMessage(saved.enabled ? 'SKU 已保存' : 'SKU 已停用，可在“管理停用 SKU”中恢复')
          }}
        />
      )}
      {quoting && (
        <Modal title={`快速报价 · ${quoting.name}`} onClose={() => setQuoting(null)}>
          <div className="quote-summary">
            <p>
              客户：{customers.find((c) => c.id === customerId)?.name} ·{' '}
              {resolvedPrice(quoting).source}
            </p>
            <p>
              档位或协议售价：
              {resolvedPrice(quoting).amount == null
                ? '未设置'
                : `¥ ${(resolvedPrice(quoting).amount! / 100).toFixed(2)}`}
            </p>
            <p>
              最近供应商报价：
              {quoting.supplierQuotes[0]
                ? `¥ ${(quoting.supplierQuotes[0].amountMinor / 100).toFixed(2)} · ${quoting.supplierQuotes[0].supplier} · ${quoting.supplierQuotes[0].quotedOn}`
                : '未录入'}
            </p>
          </div>
          <label>
            本次报价 ¥ / {quoting.unit}
            <input
              type="number"
              min="0"
              step="0.01"
              value={quoteAmount}
              onChange={(e) => setQuoteAmount(e.target.value)}
            />
          </label>
          {quoting.supplierQuotes[0] && quoteAmount !== '' && (
            <p className="muted">
              与供应商报价的差额：¥{' '}
              {(Number(quoteAmount) - quoting.supplierQuotes[0].amountMinor / 100).toFixed(2)} /{' '}
              {quoting.unit}（非实际利润）
            </p>
          )}
          <p className="muted">本次调整只用于复制报价，不改动 SKU 默认售价或协议价。</p>
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
                const customer = customers.find((c) => c.id === customerId)
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
