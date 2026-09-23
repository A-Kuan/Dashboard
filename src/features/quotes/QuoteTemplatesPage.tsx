import { useEffect, useState, type FormEvent } from 'react'
import {
  IconCheck,
  IconClipboard,
  IconDatabase,
  IconDotsVertical,
  IconEdit,
  IconFileDescription,
  IconInfoCircle,
  IconPlus,
  IconSearch,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import './quotes.css'
import { useAuth } from '../auth/context'
import { api, errorMessage } from '../../lib/api'
import type { Sku } from '../catalog/types'
import { Select } from '../../components/business/Select'

type DictionaryOption = { code: string; label: string; parentCode: string | null }

type Part = {
  id: string
  vehicle: string
  skuId: string
  skuCode: string
  name: string
  brand: string
  priceMinor: number | null
  note?: string
}
type Template = {
  id: string
  name: string
  customer: string
  note: string
  isCommon: boolean
  version: number
  updatedAt: string
  parts: Part[]
}
const emptyTemplate: Template = {
  id: '',
  name: '',
  customer: '',
  note: '',
  isCommon: false,
  version: 0,
  updatedAt: '',
  parts: [],
}

function groupParts(parts: Part[]) {
  const groups = new Map<string, Part[]>()
  for (const part of parts) groups.set(part.vehicle, [...(groups.get(part.vehicle) ?? []), part])
  return Array.from(groups)
}

export function QuoteTemplatesPage() {
  const { user } = useAuth()
  const writable = user.role !== 'viewer'
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<'name' | 'draft' | 'manage' | 'confirm-delete' | null>(null)
  const [nameForm, setNameForm] = useState({ name: '', customer: '', note: '', isCommon: false })
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [copyStatus, setCopyStatus] = useState('')
  const [skuDrawerOpen, setSkuDrawerOpen] = useState(false)
  const [skuSearch, setSkuSearch] = useState('')
  const [skuRows, setSkuRows] = useState<Sku[]>([])
  const [skuLoading, setSkuLoading] = useState(false)
  const [pickedSkuIds, setPickedSkuIds] = useState<string[]>([])
  const [manualSkuCode, setManualSkuCode] = useState('')
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void api<Template[]>('/quote-templates')
      .then((result) => {
        if (!alive) return
        setTemplates(result)
        setSelectedId((current) =>
          result.some((template) => template.id === current) ? current : (result[0]?.id ?? ''),
        )
        setError('')
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reload])

  useEffect(() => {
    let alive = true
    void api<DictionaryOption[]>('/dictionaries/options?scope=sku_foundation&code=product_brand')
      .then((result) => {
        if (alive) setBrandOptions(result.map((option) => option.label))
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!skuDrawerOpen) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSkuLoading(true)
      const params = new URLSearchParams({ page: '1', search: skuSearch.trim() })
      void api<{ rows: Sku[] }>(`/skus/page?${params}`)
        .then((result) => setSkuRows(result.rows))
        .catch((cause) => {
          if (!controller.signal.aborted) setError(errorMessage(cause))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSkuLoading(false)
        })
    }, 180)
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [skuDrawerOpen, skuSearch])

  const selected =
    templates.find((template) => template.id === selectedId) ?? templates[0] ?? emptyTemplate
  const filtered = templates.filter((template) =>
    `${template.name} ${template.customer}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const commonTemplates = filtered.filter((template) => template.isCommon)
  const otherTemplates = filtered.filter((template) => !template.isCommon)

  async function updateSelected(change: (template: Template) => Template) {
    if (!selected.id || busy) return false
    setBusy(true)
    setError('')
    try {
      const updated = await api<Template>(`/quote-templates/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify(change(selected)),
      })
      setTemplates((current) =>
        current.map((template) => (template.id === updated.id ? updated : template)),
      )
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function removePart(id: string) {
    await updateSelected((template) => ({
      ...template,
      parts: template.parts.filter((part) => part.id !== id),
    }))
  }

  function priceForSku(sku: Sku) {
    // 报价模板未绑定结构化客户类型，默认先取同行价，缺失时再取修理厂价。
    return sku.tradePriceMinor ?? sku.repairPriceMinor
  }

  function partFromSku(sku: Sku): Part {
    return {
      id: crypto.randomUUID(),
      vehicle: '',
      skuId: sku.id,
      skuCode: sku.code,
      name: sku.name,
      brand: sku.brand || sku.sourceManufacturer || '',
      priceMinor: priceForSku(sku),
      note: '',
    }
  }

  async function addManualSku(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = manualSkuCode.trim()
    if (!code) return
    try {
      const params = new URLSearchParams({ page: '1', search: code })
      const result = await api<{ rows: Sku[] }>(`/skus/page?${params}`)
      const match = result.rows.find((sku) => sku.code.toLowerCase() === code.toLowerCase())
      const added = match
        ? partFromSku(match)
        : {
            id: crypto.randomUUID(),
            vehicle: '',
            skuId: '',
            skuCode: code,
            name: '待填写名称',
            brand: '',
            priceMinor: null,
            note: '',
          }
      await updateSelected((template) => ({ ...template, parts: [...template.parts, added] }))
      setManualSkuCode('')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function addPickedSkus() {
    const additions = skuRows.filter((sku) => pickedSkuIds.includes(sku.id)).map(partFromSku)
    const saved = await updateSelected((template) => ({
      ...template,
      parts: [
        ...template.parts,
        ...additions.filter(
          (part) =>
            !template.parts.some(
              (existing) =>
                (part.skuId && existing.skuId === part.skuId) ||
                existing.skuCode.toLowerCase() === part.skuCode.toLowerCase(),
            ),
        ),
      ],
    }))
    if (saved) {
      setPickedSkuIds([])
      setSkuDrawerOpen(false)
    }
  }

  function updatePartField(id: string, field: 'brand' | 'name', value: string) {
    setTemplates((current) =>
      current.map((template) =>
        template.id === selected.id
          ? {
              ...template,
              parts: template.parts.map((part) =>
                part.id === id
                  ? {
                      ...part,
                      [field]: value,
                    }
                  : part,
              ),
            }
          : template,
      ),
    )
  }

  function commitPrice(id: string) {
    const draft = priceDrafts[id]
    if (draft === undefined) return
    if (draft !== '' && !/^\d+(\.\d{0,2})?$/.test(draft)) {
      setError('价格最多保留两位小数')
      setPriceDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      return
    }
    setTemplates((current) =>
      current.map((template) =>
        template.id === selected.id
          ? {
              ...template,
              parts: template.parts.map((part) =>
                part.id === id
                  ? { ...part, priceMinor: draft === '' ? null : Math.round(Number(draft) * 100) }
                  : part,
              ),
            }
          : template,
      ),
    )
    setPriceDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setError('')
  }

  async function saveInlineChanges() {
    await updateSelected((template) => template)
  }

  function editTemplate(template: Template) {
    setSelectedId(template.id)
    setEditingTemplateId(template.id)
    setNameForm({
      name: template.name,
      customer: template.customer,
      note: template.note,
      isCommon: template.isCommon,
    })
    setDialog('name')
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!nameForm.name.trim()) return
    setBusy(true)
    setError('')
    try {
      const existing = templates.find((template) => template.id === editingTemplateId)
      const updated = await api<Template>(
        existing ? `/quote-templates/${existing.id}` : '/quote-templates',
        {
          method: existing ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(existing ?? { parts: [] }),
            name: nameForm.name.trim(),
            customer: nameForm.customer.trim(),
            note: nameForm.note.trim(),
            isCommon: nameForm.isCommon,
          }),
        },
      )
      setTemplates((current) =>
        existing
          ? current.map((template) => (template.id === updated.id ? updated : template))
          : [...current, updated],
      )
      setSelectedId(updated.id)
      setDialog(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function createTemplate() {
    setEditingTemplateId(null)
    setNameForm({ name: '', customer: '', note: '', isCommon: false })
    setError('')
    setDialog('name')
  }

  async function removeTemplate(id: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/quote-templates/${id}`, { method: 'DELETE' })
      const remaining = templates.filter((template) => template.id !== id)
      setTemplates(remaining)
      if (selectedId === id) {
        setSelectedId(remaining[0]?.id ?? '')
      }
      setDeletingId(null)
      setDialog('manage')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function renderTemplate(template: Template) {
    return (
      <div
        className={`quotes-template-item${template.id === selected.id ? ' selected' : ''}`}
        key={template.id}
      >
        <button
          className="quotes-template-select"
          onClick={() => {
            setSelectedId(template.id)
          }}
          type="button"
        >
          <IconFileDescription size={25} stroke={1.8} aria-hidden="true" />
          <span>
            <strong>{template.name}</strong>
            <small>
              {template.parts.length
                ? `${groupParts(template.parts).length} 个车型 · ${template.parts.length} 个配件`
                : '尚未添加配件'}
            </small>
          </span>
        </button>
        <button
          className="quotes-item-edit"
          disabled={!writable}
          onClick={() => editTemplate(template)}
          type="button"
          aria-label={`编辑${template.name}模板信息`}
        >
          <IconDotsVertical className="quotes-item-dots" size={20} aria-hidden="true" />
        </button>
      </div>
    )
  }

  function beginQuote() {
    setPrices(
      Object.fromEntries(
        selected.parts.map((part) => [
          part.id,
          part.priceMinor === null ? '' : (part.priceMinor / 100).toFixed(2),
        ]),
      ),
    )
    setCopyStatus('')
    setDialog('draft')
  }

  async function copyQuote() {
    const lines = selected.parts.map(
      (part, index) =>
        `${index + 1}. ${part.skuCode ? `SKU ${part.skuCode}｜` : ''}${part.brand ? `${part.brand} ` : ''}${part.name}｜${prices[part.id]?.trim() ? `¥${prices[part.id]}` : '价格待确认'}`,
    )
    const message = `您好，以下为本次配件报价：\n${lines.join('\n')}\n具体适配请以车型信息及零件号核对结果为准。`
    try {
      await navigator.clipboard.writeText(message)
      setCopyStatus('报价文字已复制')
    } catch {
      setCopyStatus('复制失败，请检查剪贴板权限')
    }
  }

  return (
    <div className="quotes-workspace">
      <div className="quotes-template-list">
        <div className="quotes-list-controls">
          <label className="quotes-search">
            <IconSearch size={20} stroke={1.8} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模板名称"
              aria-label="搜索模板名称"
            />
          </label>
          <button
            className="quotes-create-action"
            disabled={!writable || busy}
            onClick={createTemplate}
            type="button"
          >
            <IconPlus size={20} /> 新建模板
          </button>
        </div>
        {error && (
          <p className="quotes-error" role="alert">
            {error}{' '}
            <button
              type="button"
              onClick={() => {
                setLoading(true)
                setReload((value) => value + 1)
              }}
            >
              刷新
            </button>
          </p>
        )}
        <div className="quotes-list-scroll">
          {loading ? (
            <p className="quotes-empty-search">正在加载模板…</p>
          ) : (
            filtered.length === 0 && (
              <p className="quotes-empty-search">
                {search ? '没有找到匹配的模板' : '暂无模板，点击“新建模板”开始。'}
              </p>
            )
          )}
          {commonTemplates.length > 0 && (
            <section className="quotes-template-section" aria-label="常用模板">
              <h2>常用模板</h2>
              <div className="quotes-template-items">{commonTemplates.map(renderTemplate)}</div>
            </section>
          )}
          {otherTemplates.length > 0 && (
            <section
              className="quotes-template-section quotes-other-templates"
              aria-label="其他模板"
            >
              <h2>其他模板</h2>
              <div className="quotes-template-items">{otherTemplates.map(renderTemplate)}</div>
            </section>
          )}
        </div>
        <div className="quotes-list-footer">
          <span>共 {templates.length} 个模板</span>
          <button disabled={!writable || busy} onClick={() => setDialog('manage')} type="button">
            <IconSettings size={20} stroke={1.7} /> 管理模板
          </button>
        </div>
      </div>

      <section className="quotes-detail" aria-label="报价模板详情">
        <div className="quotes-detail-heading">
          <div>
            <div className="quotes-title-line">
              <h2>{selected.name || '请选择或新建报价模板'}</h2>
              <button
                className="quotes-text-action"
                disabled={!writable || !selected.id || busy}
                onClick={() => editTemplate(selected)}
                type="button"
              >
                <IconEdit size={19} /> 编辑
              </button>
            </div>
            <p>适用客户：{selected.customer || '未指定'}</p>
            {selected.note && <p className="quotes-template-note">备注：{selected.note}</p>}
          </div>
        </div>
        <div className="quotes-notice">
          <IconInfoCircle size={23} aria-hidden="true" />
          <span>
            模板用于保存常用的车型与配件需求，帮助快速报价。每次新建报价时，请务必重新确认配件编号、适配车型、库存情况和最新价格。
          </span>
        </div>
        <div className="quotes-section-heading quotes-sku-heading">
          <h3>
            配件清单 <span>共 {selected.parts.length} 个配件</span>
          </h3>
        </div>
        <form className="quotes-sku-entry" onSubmit={(event) => void addManualSku(event)}>
          <label htmlFor="quote-sku-code">输入 SKU 编码</label>
          <input
            id="quote-sku-code"
            value={manualSkuCode}
            onChange={(event) => setManualSkuCode(event.target.value)}
            placeholder="请输入 SKU 编码，如 95850561100"
            disabled={!writable || !selected.id || busy}
          />
          <button type="submit" disabled={!manualSkuCode.trim() || !writable || busy}>
            添加
          </button>
          <button
            className="quotes-library-action"
            type="button"
            disabled={!writable || !selected.id || busy}
            onClick={() => setSkuDrawerOpen(true)}
          >
            <IconDatabase size={19} /> 从 SKU 库添加
          </button>
        </form>
        <div className="quotes-sku-table" role="table" aria-label="模板配件清单">
          <div className="quotes-sku-row quotes-sku-table-head" role="row">
            <span role="columnheader">SKU 编码</span>
            <span role="columnheader">品牌</span>
            <span role="columnheader">名称</span>
            <span role="columnheader">价格（CNY）</span>
            <span role="columnheader">操作</span>
          </div>
          {selected.parts.length === 0 && (
            <div className="quotes-empty">输入 SKU 编码，或从 SKU 库选择配件开始添加。</div>
          )}
          {selected.parts.map((part) => (
            <div className="quotes-sku-row" role="row" key={part.id}>
              <strong role="cell">{part.skuCode || '—'}</strong>
              <div className="quotes-brand-select" role="cell">
                <Select
                  label={`${part.skuCode}品牌`}
                  value={part.brand}
                  onChange={(value) => updatePartField(part.id, 'brand', value)}
                  disabled={!writable || busy}
                  options={Array.from(new Set([part.brand, ...brandOptions]))
                    .filter(Boolean)
                    .map((brand) => ({ value: brand, label: brand }))}
                />
              </div>
              <input
                role="cell"
                aria-label={`${part.skuCode}名称`}
                value={part.name}
                onChange={(event) => updatePartField(part.id, 'name', event.target.value)}
                disabled={!writable || busy}
                placeholder="填写名称"
              />
              <label className="quotes-price-input" role="cell">
                <span>¥</span>
                <input
                  aria-label={`${part.skuCode}价格`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    priceDrafts[part.id] ??
                    (part.priceMinor === null ? '' : (part.priceMinor / 100).toFixed(2))
                  }
                  onChange={(event) =>
                    setPriceDrafts((current) => ({
                      ...current,
                      [part.id]: event.target.value,
                    }))
                  }
                  onBlur={() => commitPrice(part.id)}
                  disabled={!writable || busy}
                  placeholder="待填写"
                />
              </label>
              <button
                type="button"
                disabled={!writable || busy}
                onClick={() => void removePart(part.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="quotes-bottom-actions">
          <button
            className="quotes-primary-action"
            onClick={beginQuote}
            disabled={selected.parts.length === 0 || busy}
            type="button"
          >
            <IconFileDescription size={21} /> 使用模板开始报价
          </button>
          <button
            className="quotes-secondary-action"
            disabled={!writable || !selected.id || busy}
            onClick={() => void saveInlineChanges()}
            type="button"
          >
            <IconCheck size={19} /> 保存修改
          </button>
        </div>
      </section>

      {skuDrawerOpen && (
        <div
          className="quotes-drawer-layer"
          role="presentation"
          onMouseDown={() => setSkuDrawerOpen(false)}
        >
          <aside
            className="quotes-sku-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="选择已有 SKU"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="quotes-drawer-heading">
              <h2>选择已有 SKU</h2>
              <button type="button" onClick={() => setSkuDrawerOpen(false)} aria-label="关闭">
                <IconX size={22} />
              </button>
            </div>
            <label className="quotes-drawer-search">
              <IconSearch size={20} />
              <input
                value={skuSearch}
                onChange={(event) => setSkuSearch(event.target.value)}
                placeholder="搜索 SKU、名称或品牌"
                autoFocus
              />
            </label>
            <div className="quotes-drawer-table">
              <div className="quotes-drawer-row quotes-drawer-head">
                <span />
                <span>SKU 编码</span>
                <span>品牌 / 名称</span>
                <span>价格</span>
              </div>
              {skuLoading && <p className="quotes-drawer-status">正在读取 SKU…</p>}
              {!skuLoading && skuRows.length === 0 && (
                <p className="quotes-drawer-status">没有匹配的 SKU</p>
              )}
              {!skuLoading &&
                skuRows.map((sku) => {
                  const checked = pickedSkuIds.includes(sku.id)
                  const price = priceForSku(sku)
                  return (
                    <label className="quotes-drawer-row" key={sku.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setPickedSkuIds((current) =>
                            checked ? current.filter((id) => id !== sku.id) : [...current, sku.id],
                          )
                        }
                      />
                      <strong>{sku.code}</strong>
                      <span>
                        <b>{sku.brand || sku.sourceManufacturer || '品牌待确认'}</b>
                        <small>{sku.name}</small>
                      </span>
                      <span>{price === null ? '待设置' : `¥ ${(price / 100).toFixed(2)}`}</span>
                    </label>
                  )
                })}
            </div>
            <div className="quotes-drawer-footer">
              <span>已选择 {pickedSkuIds.length} 个 SKU</span>
              <button type="button" onClick={() => setSkuDrawerOpen(false)}>
                取消
              </button>
              <button
                className="quotes-primary-action"
                type="button"
                disabled={pickedSkuIds.length === 0 || busy}
                onClick={() => void addPickedSkus()}
              >
                添加 {pickedSkuIds.length} 个 SKU
              </button>
            </div>
          </aside>
        </div>
      )}

      {dialog && (
        <div
          className="quotes-modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!busy) setDialog(null)
          }}
        >
          {dialog === 'name' && (
            <form
              className="quotes-modal quotes-template-editor"
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={(event) => void saveName(event)}
              role="dialog"
              aria-modal="true"
              aria-label="编辑模板信息"
            >
              <div className="quotes-modal-heading">
                <h2>{editingTemplateId ? '编辑模板信息' : '新建报价模板'}</h2>
                <button type="button" onClick={() => setDialog(null)} aria-label="关闭">
                  <IconX size={20} />
                </button>
              </div>
              <label>
                模板名称
                <input
                  required
                  value={nameForm.name}
                  onChange={(event) => setNameForm({ ...nameForm, name: event.target.value })}
                />
              </label>
              <label>
                适用客户
                <input
                  value={nameForm.customer}
                  onChange={(event) => setNameForm({ ...nameForm, customer: event.target.value })}
                  placeholder="可选"
                />
              </label>
              <label>
                备注
                <textarea
                  value={nameForm.note}
                  onChange={(event) => setNameForm({ ...nameForm, note: event.target.value })}
                  placeholder="添加备注（可选）"
                  maxLength={200}
                  rows={4}
                />
                <small>{nameForm.note.length}/200</small>
              </label>
              <button
                type="button"
                className="quotes-common-toggle"
                role="switch"
                aria-checked={nameForm.isCommon}
                onClick={() => setNameForm({ ...nameForm, isCommon: !nameForm.isCommon })}
              >
                <span className={nameForm.isCommon ? 'is-on' : ''} aria-hidden="true" />
                归入常用模板
              </button>
              {error && (
                <p className="quotes-error" role="alert">
                  {error}
                </p>
              )}
              <div className="quotes-modal-actions quotes-editor-actions">
                <button type="button" disabled={busy} onClick={() => setDialog(null)}>
                  取消
                </button>
                <button className="quotes-editor-save" type="submit" disabled={busy}>
                  {busy ? '保存中…' : '保存模板'}
                </button>
              </div>
            </form>
          )}
          {dialog === 'draft' && (
            <div
              className="quotes-modal quotes-draft"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="新报价草稿"
            >
              <div className="quotes-modal-heading">
                <div>
                  <h2>新报价草稿</h2>
                  <p>
                    {selected.name} · {selected.parts.length} 个配件
                  </p>
                </div>
                <button type="button" onClick={() => setDialog(null)} aria-label="关闭">
                  <IconX size={20} />
                </button>
              </div>
              <div className="quotes-draft-rows">
                {selected.parts.map((part) => (
                  <div className="quotes-draft-row" key={part.id}>
                    <span>
                      {part.vehicle}
                      <small>
                        {part.brand} · {part.name}
                      </small>
                    </span>
                    <label>
                      报价 ¥
                      <input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        value={prices[part.id] ?? ''}
                        onChange={(event) =>
                          setPrices({ ...prices, [part.id]: event.target.value })
                        }
                        placeholder="待填写"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <p className="quotes-draft-note">
                复制前请核对零件号、适配、库存和价格。未填价格的项目会标为“价格待确认”。
              </p>
              <div className="quotes-modal-actions">
                <span role="status">{copyStatus}</span>
                <button className="quotes-primary-action" onClick={copyQuote} type="button">
                  <IconClipboard size={18} /> 复制报价文字
                </button>
              </div>
            </div>
          )}
          {dialog === 'manage' && (
            <div
              className="quotes-modal"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="管理模板"
            >
              <div className="quotes-modal-heading">
                <h2>管理模板</h2>
                <button type="button" onClick={() => setDialog(null)} aria-label="关闭">
                  <IconX size={20} />
                </button>
              </div>
              <div className="quotes-manage-list">
                {templates.map((template) => (
                  <div className="quotes-manage-row" key={template.id}>
                    <span>{template.name}</span>
                    <button
                      type="button"
                      disabled={!writable || busy}
                      onClick={() => {
                        setDeletingId(template.id)
                        setDialog('confirm-delete')
                      }}
                      aria-label={`删除${template.name}`}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div className="quotes-modal-actions">
                <button type="button" onClick={() => setDialog(null)}>
                  关闭
                </button>
              </div>
            </div>
          )}
          {dialog === 'confirm-delete' && (
            <div
              className="quotes-modal"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="确认删除模板"
            >
              <div className="quotes-modal-heading">
                <h2>删除报价模板</h2>
              </div>
              <p>
                确定删除“{templates.find((template) => template.id === deletingId)?.name}
                ”吗？模板内的车型和配件也会删除。
              </p>
              {error && (
                <p className="quotes-error" role="alert">
                  {error}
                </p>
              )}
              <div className="quotes-modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDeletingId(null)
                    setDialog('manage')
                  }}
                >
                  取消
                </button>
                <button
                  className="quotes-delete-confirm"
                  type="button"
                  disabled={busy || !deletingId}
                  onClick={() => {
                    if (deletingId) void removeTemplate(deletingId)
                  }}
                >
                  {busy ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
