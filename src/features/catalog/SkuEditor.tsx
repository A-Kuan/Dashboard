import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import catalog from '../../../shared/catalog.json'
import type { Customer, Fitment, Sku } from './types'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import { api, errorMessage } from '../../lib/api'
import { supplyTypeOptions, type SupplyTypeItem } from './supplyNature'

const blankFitment: Fitment = {
  make: '',
  series: '',
  chassis: '',
  yearFrom: '',
  yearTo: '',
  power: '',
  engine: '',
  notes: '',
  verified: false,
}
const tabs = ['基本信息', '件号与适配', '库存库位', '售价与供应商报价'] as const

export function SkuEditor({
  initial,
  customers,
  onClose,
  onSave,
  readOnly = false,
}: {
  initial: Sku
  customers: Customer[]
  onClose: () => void
  onSave: (sku: Sku) => void
  readOnly?: boolean
}) {
  const [form, setForm] = useState<Sku>(structuredClone(initial))
  const [tab, setTab] = useState<(typeof tabs)[number]>('基本信息')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [supplier, setSupplier] = useState('')
  const [quotedOn, setQuotedOn] = useState(new Date().toISOString().slice(0, 10))
  const [supplierAmount, setSupplierAmount] = useState('')
  const [supplierNotes, setSupplierNotes] = useState('')
  const [foundation, setFoundation] = useState<{
    categories: string[]
    units: string[]
    supplyTypes: SupplyTypeItem[] | null
  } | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all([
      api<{ code: string; label: string }[]>(
        '/dictionaries/options?scope=sku_foundation&code=category',
      ),
      api<{ code: string; label: string }[]>(
        '/dictionaries/options?scope=sku_foundation&code=unit',
      ),
      api<SupplyTypeItem[]>('/dictionaries/options?scope=sku_foundation&code=supply_type'),
      api<{ code: string }[]>('/dictionaries/groups?scope=sku_foundation'),
    ])
      .then(([categories, units, supplyTypes, groups]) => {
        if (alive)
          setFoundation({
            categories: categories.map((v) => v.label),
            units: units.map((v) => v.label),
            supplyTypes: groups.some((group) => group.code === 'supply_type') ? supplyTypes : null,
          })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const categoryOptions = [
    ...new Set([...(foundation?.categories ?? catalog.categories), form.category]),
  ]
  const unitOptions = [...new Set([...(foundation?.units ?? catalog.units), form.unit])]
  const natureOptions = supplyTypeOptions(foundation?.supplyTypes ?? null)
  if (form.nature && !natureOptions.some((item) => item.value === form.nature))
    natureOptions.push({ value: form.nature, label: `${form.nature}（旧值）` })
  const set = <K extends keyof Sku>(key: K, value: Sku[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const stringInput = (
    key:
      | 'code'
      | 'name'
      | 'brand'
      | 'partNumber'
      | 'country'
      | 'specification'
      | 'position'
      | 'imageUrl',
    label: string,
    required = false,
  ) => (
    <label>
      {label}
      {required && <span className="required"> *</span>}
      <input
        required={required}
        value={form[key]}
        maxLength={
          key === 'imageUrl'
            ? 2000
            : key === 'code' || key === 'brand' || key === 'country' || key === 'position'
              ? 80
              : key === 'partNumber'
                ? 100
                : 200
        }
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  )
  function selectInput(key: 'category' | 'origin' | 'unit', label: string, values: string[]) {
    return (
      <label>
        {label}
        <Select
          label={label}
          options={values.map((value) => ({ value, label: value }))}
          value={form[key]}
          disabled={
            key === 'origin' && ['进口原厂', 'imported_volkswagen', 'germany'].includes(form.nature)
          }
          onChange={(value) => {
            set(key, value)
          }}
        />
      </label>
    )
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      onSave(
        await api<Sku>(`/skus${form.id ? '/' + form.id : ''}`, {
          method: form.id ? 'PUT' : 'POST',
          body: JSON.stringify(form),
        }),
      )
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function addSupplierQuote() {
    if (!form.id || !supplier.trim() || !/^\d+(\.\d{1,2})?$/.test(supplierAmount)) return
    if (
      JSON.stringify({ ...form, supplierQuotes: [] }) !==
      JSON.stringify({ ...initial, supplierQuotes: [] })
    ) {
      setError('请先保存 SKU 的其他修改，再添加供应商报价')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await api<Sku>(`/skus/${form.id}/supplier-quotes`, {
        method: 'POST',
        body: JSON.stringify({
          supplier,
          quotedOn,
          amountMinor: Math.round(Number(supplierAmount) * 100),
          notes: supplierNotes,
        }),
      })
      setForm(saved)
      setSupplierAmount('')
      setSupplierNotes('')
      onSave(saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={readOnly ? 'SKU 详情' : form.id ? '编辑 SKU' : '新增 SKU'}
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="tabs editor-tabs" role="tablist" aria-label="SKU 信息分类">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <form onSubmit={save}>
        <fieldset disabled={readOnly || busy}>
          <div hidden={tab !== '基本信息'} className="editor-panel">
            <div className="form-grid">
              {stringInput('code', 'SKU 编码', true)}
              {stringInput('name', '配件名称', true)}
              {selectInput('category', '配件分类', categoryOptions)}
              {stringInput('brand', '品牌')}
              {form.sourceCategoryPath && (
                <p className="inline-notice">
                  旧站分类：{form.sourceCategoryPath} · 旧站厂家标注：
                  {form.sourceManufacturer || '未录入'}
                </p>
              )}
              {stringInput('partNumber', '厂家件号')}
              {selectInput('unit', '销售单位', unitOptions)}
              <label>
                供货性质
                <Select
                  label="供货性质"
                  options={natureOptions}
                  value={form.nature}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      nature: value,
                      origin: ['imported_volkswagen', 'germany'].includes(value)
                        ? '进口'
                        : current.origin,
                    }))
                  }
                />
              </label>
              {selectInput('origin', '产地属性', catalog.origins)}
              {stringInput('country', '生产国家／地区')}
              {stringInput('position', '安装位置')}
              {stringInput('specification', '规格／型号')}
              <label>
                包装数量
                <input
                  type="number"
                  required
                  min="1"
                  max="100000"
                  step="1"
                  value={form.packQuantity}
                  onChange={(e) => set('packQuantity', Number(e.target.value))}
                />
              </label>
            </div>
            {stringInput('imageUrl', '产品图片地址（可选）')}
            <label>
              {form.nature === '拆车件' ? '成色／使用情况及备注' : '备注'}
              <textarea
                maxLength={2000}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              启用 SKU
            </label>
          </div>
          <div hidden={tab !== '件号与适配'} className="editor-panel">
            <div className="subheading">
              <h3>关联件号</h3>
              <button
                type="button"
                onClick={() => set('numbers', [...form.numbers, { type: 'OE号', code: '' }])}
              >
                <IconPlus size={16} />
                添加件号
              </button>
            </div>
            {!form.numbers.length && <p className="muted">可添加多个 OE 号、替代件号或条码。</p>}
            {form.numbers.map((n, i) => (
              <div className="inline-fields" key={i}>
                <label>
                  类型
                  <Select
                    label="件号类型"
                    options={catalog.numberTypes.map((type) => ({ value: type, label: type }))}
                    value={n.type}
                    onChange={(value) =>
                      set(
                        'numbers',
                        form.numbers.map((v, j) => (j === i ? { ...v, type: value } : v)),
                      )
                    }
                  />
                </label>
                <label>
                  件号
                  <input
                    value={n.code}
                    onChange={(e) =>
                      set(
                        'numbers',
                        form.numbers.map((v, j) => (j === i ? { ...v, code: e.target.value } : v)),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除件号${i + 1}`}
                  onClick={() =>
                    set(
                      'numbers',
                      form.numbers.filter((_, j) => i !== j),
                    )
                  }
                >
                  <IconTrash size={19} />
                </button>
              </div>
            ))}
            <div className="subheading">
              <h3>适配车型</h3>
              <button
                type="button"
                onClick={() => set('fitments', [...form.fitments, { ...blankFitment }])}
              >
                <IconPlus size={16} />
                添加车型
              </button>
            </div>
            {!form.fitments.length && (
              <p className="muted">一条 SKU 可以关联多个车型，未核对的适配会保留待核对标记。</p>
            )}
            {form.fitments.map((f, i) => (
              <section className="repeated-card" key={i}>
                <div className="subheading">
                  <strong>车型 {i + 1}</strong>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`移除车型${i + 1}`}
                    onClick={() =>
                      set(
                        'fitments',
                        form.fitments.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <IconTrash size={19} />
                  </button>
                </div>
                <div className="form-grid">
                  {(['make', 'series', 'chassis', 'yearFrom', 'yearTo', 'engine'] as const).map(
                    (key) => (
                      <label key={key}>
                        {
                          {
                            make: '汽车品牌',
                            series: '车系',
                            chassis: '车型代号（如 E3、92A）',
                            yearFrom: '起始年款',
                            yearTo: '截止年款',
                            engine: '发动机',
                          }[key]
                        }
                        <input
                          value={f[key]}
                          onChange={(e) =>
                            set(
                              'fitments',
                              form.fitments.map((v, j) =>
                                j === i ? { ...v, [key]: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                  <label>
                    动力类型
                    <Select
                      label="动力类型"
                      options={[
                        { value: '', label: '未指定' },
                        ...catalog.powerTypes.map((p) => ({ value: p, label: p })),
                      ]}
                      value={f.power}
                      onChange={(value) =>
                        set(
                          'fitments',
                          form.fitments.map((v, j) => (j === i ? { ...v, power: value } : v)),
                        )
                      }
                    />
                  </label>
                  <label>
                    适配说明
                    <input
                      value={f.notes}
                      onChange={(e) =>
                        set(
                          'fitments',
                          form.fitments.map((v, j) =>
                            j === i ? { ...v, notes: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={f.verified}
                    onChange={(e) =>
                      set(
                        'fitments',
                        form.fitments.map((v, j) =>
                          j === i ? { ...v, verified: e.target.checked } : v,
                        ),
                      )
                    }
                  />
                  适配信息已核对
                </label>
              </section>
            ))}
          </div>
          <div hidden={tab !== '库存库位'} className="editor-panel">
            <div className="subheading">
              <h3>库存库位</h3>
              <button
                type="button"
                onClick={() =>
                  set('stocks', [...form.stocks, { warehouse: '', bin: '', quantity: 0 }])
                }
              >
                <IconPlus size={16} />
                添加库位
              </button>
            </div>
            <p className="muted">录入各库位的当前库存，列表汇总展示。此处不设置库存预警。</p>
            {form.stocks.map((s, i) => (
              <div className="inline-fields" key={i}>
                {(['warehouse', 'bin'] as const).map((key) => (
                  <label key={key}>
                    {key === 'warehouse' ? '仓库' : '库位'}
                    <input
                      value={s[key]}
                      onChange={(e) =>
                        set(
                          'stocks',
                          form.stocks.map((v, j) =>
                            i === j ? { ...v, [key]: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  库存数量
                  <input
                    type="number"
                    min="0"
                    max="100000000"
                    step="1"
                    value={s.quantity}
                    onChange={(e) =>
                      set(
                        'stocks',
                        form.stocks.map((v, j) =>
                          i === j ? { ...v, quantity: Number(e.target.value) } : v,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除库位${i + 1}`}
                  onClick={() =>
                    set(
                      'stocks',
                      form.stocks.filter((_, j) => i !== j),
                    )
                  }
                >
                  <IconTrash size={19} />
                </button>
              </div>
            ))}
          </div>
          <div hidden={tab !== '售价与供应商报价'} className="editor-panel">
            <h3>客户类型售价</h3>
            <p className="muted">人民币／{form.unit}。未设置档位价时不会自动填入其他价格。</p>
            <div className="form-grid">
              {(
                [
                  ['tradePriceMinor', '同行价'],
                  ['repairPriceMinor', '修理厂价'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label} ¥
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form[key] == null ? '' : (form[key] / 100).toFixed(2)}
                    onChange={(e) =>
                      set(
                        key,
                        e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div className="subheading">
              <h3>客户协议价（例外）</h3>
              <button
                type="button"
                disabled={!customers.some((c) => c.enabled)}
                onClick={() => set('prices', [...form.prices, { customerId: '', amountMinor: 0 }])}
              >
                <IconPlus size={16} />
                添加客户价格
              </button>
            </div>
            <p className="muted">协议价优先于客户类型售价。只需为有长期约定的客户单独设置。</p>
            {!customers.length && (
              <p className="inline-notice">
                请先在“客户档案”中新增客户，保存 SKU 后可继续设置价格。
              </p>
            )}
            {form.prices.map((p, i) => (
              <div className="inline-fields" key={i}>
                <label>
                  客户
                  <Select
                    label="协议价客户"
                    options={[
                      { value: '', label: '请选择客户' },
                      ...customers
                        .filter((c) => c.enabled || c.id === p.customerId)
                        .map((c) => ({
                          value: c.id,
                          label: `${c.name} · ${c.code}${c.enabled ? '' : '（已停用）'}`,
                        })),
                    ]}
                    value={p.customerId}
                    onChange={(value) =>
                      set(
                        'prices',
                        form.prices.map((v, j) => (i === j ? { ...v, customerId: value } : v)),
                      )
                    }
                  />
                </label>
                <label>
                  客户单价 ¥
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    max="100000000"
                    value={p.amountMinor / 100}
                    onChange={(e) =>
                      set(
                        'prices',
                        form.prices.map((v, j) =>
                          i === j
                            ? { ...v, amountMinor: Math.round(Number(e.target.value) * 100) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除客户价格${i + 1}`}
                  onClick={() =>
                    set(
                      'prices',
                      form.prices.filter((_, j) => i !== j),
                    )
                  }
                >
                  <IconTrash size={19} />
                </button>
              </div>
            ))}
            <div className="subheading">
              <h3>供应商报价历史</h3>
            </div>
            <p className="muted">记录供应商给出的报价，仅供内部参考，不代表实际到货成本。</p>
            {!form.id && <p className="inline-notice">先保存 SKU，再添加供应商报价。</p>}
            {form.supplierQuotes.map((quote) => (
              <p className="supplier-quote" key={quote.id}>
                <strong>{quote.supplier}</strong> · {quote.quotedOn} · ¥{' '}
                {(quote.amountMinor / 100).toFixed(2)} / {form.unit}
                {quote.notes && <small>{quote.notes}</small>}
              </p>
            ))}
            {form.id && !readOnly && (
              <div className="repeated-card">
                <div className="form-grid">
                  <label>
                    供应商
                    <input
                      value={supplier}
                      maxLength={200}
                      onChange={(e) => setSupplier(e.target.value)}
                    />
                  </label>
                  <label>
                    报价日期
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="YYYY-MM-DD"
                      pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                      title="请输入 YYYY-MM-DD 格式的日期"
                      value={quotedOn}
                      onChange={(e) => setQuotedOn(e.target.value)}
                    />
                  </label>
                  <label>
                    供应商报价 ¥
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={supplierAmount}
                      onChange={(e) => setSupplierAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    备注
                    <input
                      value={supplierNotes}
                      maxLength={500}
                      onChange={(e) => setSupplierNotes(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={busy || !supplier.trim() || !supplierAmount}
                  onClick={() => void addSupplierQuote()}
                >
                  保存供应商报价
                </button>
              </div>
            )}
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {readOnly ? '关闭' : '取消'}
          </button>
          {!readOnly && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                if (!form.code.trim() || !form.name.trim()) setTab('基本信息')
              }}
            >
              {busy ? '保存中…' : '保存 SKU'}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  )
}
