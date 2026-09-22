import { useEffect, useState, type FormEvent } from 'react'
import {
  IconCheck,
  IconClipboard,
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

type Part = { id: string; vehicle: string; name: string; brand: string; note?: string }
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

type PartForm = Omit<Part, 'id'>
const blankPart: PartForm = { vehicle: '', name: '', brand: '', note: '' }

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
  const [partForm, setPartForm] = useState<PartForm>(blankPart)
  const [editingPartId, setEditingPartId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    'part' | 'name' | 'draft' | 'manage' | 'confirm-delete' | null
  >(null)
  const [nameForm, setNameForm] = useState({ name: '', customer: '', note: '', isCommon: false })
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [copyStatus, setCopyStatus] = useState('')
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([])

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

  const selected =
    templates.find((template) => template.id === selectedId) ?? templates[0] ?? emptyTemplate
  const groups = groupParts(selected.parts)
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

  function openPart(part?: Part, vehicle = '') {
    setEditingPartId(part?.id ?? null)
    setPartForm(
      part
        ? { vehicle: part.vehicle, name: part.name, brand: part.brand, note: part.note ?? '' }
        : { ...blankPart, vehicle },
    )
    setDialog('part')
  }

  async function savePart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const vehicle = partForm.vehicle.trim()
    const name = partForm.name.trim()
    const brand = partForm.brand.trim()
    const note = partForm.note?.trim() ?? ''
    if (!vehicle || !name) return
    const saved = await updateSelected((template) => ({
      ...template,
      parts: editingPartId
        ? template.parts.map((part) =>
            part.id === editingPartId ? { ...part, vehicle, name, brand, note } : part,
          )
        : [...template.parts, { id: crypto.randomUUID(), vehicle, name, brand, note }],
    }))
    if (saved) setDialog(null)
  }

  async function removePart(id: string) {
    const saved = await updateSelected((template) => ({
      ...template,
      parts: template.parts.filter((part) => part.id !== id),
    }))
    if (saved) setSelectedPartIds((current) => current.filter((selectedId) => selectedId !== id))
  }

  function togglePart(id: string) {
    setSelectedPartIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    )
  }

  async function removeSelectedParts() {
    const saved = await updateSelected((template) => ({
      ...template,
      parts: template.parts.filter((part) => !selectedPartIds.includes(part.id)),
    }))
    if (saved) setSelectedPartIds([])
  }

  function editTemplate(template: Template) {
    setSelectedId(template.id)
    setSelectedPartIds([])
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
        setSelectedPartIds([])
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
            setSelectedPartIds([])
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
    setPrices({})
    setCopyStatus('')
    setDialog('draft')
  }

  async function copyQuote() {
    const lines = selected.parts.map(
      (part, index) =>
        `${index + 1}. ${part.vehicle}｜${part.brand ? `${part.brand} ` : ''}${part.name}｜${prices[part.id]?.trim() ? `¥${prices[part.id]}` : '价格待确认'}`,
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
        <div className="quotes-section-heading">
          <h3>
            包含的车型与配件{' '}
            <span>
              共 {groups.length} 个车型 · {selected.parts.length} 个配件
            </span>
          </h3>
          <div className="quotes-heading-actions">
            {selected.id && selectedPartIds.length > 0 && (
              <button
                className="quotes-bulk-delete"
                disabled={!writable || busy}
                onClick={() => void removeSelectedParts()}
                type="button"
              >
                删除已选（{selectedPartIds.length}）
              </button>
            )}
            <button
              className="quotes-outline-action"
              disabled={!writable || !selected.id || busy}
              onClick={() => openPart()}
              type="button"
            >
              <IconPlus size={18} /> 加入其他车型或配件
            </button>
          </div>
        </div>
        <div className="quotes-groups">
          {groups.length === 0 && (
            <div className="quotes-empty">
              这个模板还没有配件。点击“加入其他车型或配件”开始添加。
            </div>
          )}
          {groups.map(([vehicle, parts], index) => (
            <section className="quotes-vehicle-group" key={vehicle}>
              <div className="quotes-vehicle-heading">
                <span className="quotes-number">{index + 1}</span>
                <strong>{vehicle}</strong>
                <span>（{parts.length} 个配件）</span>
                <button
                  type="button"
                  disabled={!writable || busy}
                  onClick={() => openPart(undefined, vehicle)}
                  aria-label={`为${vehicle}添加配件`}
                >
                  <IconDotsVertical size={20} />
                </button>
              </div>
              <div className="quotes-parts-head">
                <span aria-hidden="true" />
                <span>配件名称</span>
                <span>品牌</span>
                <span>备注</span>
                <span>操作</span>
              </div>
              {parts.map((part) => (
                <div className="quotes-part-row" key={part.id}>
                  <input
                    type="checkbox"
                    checked={selectedPartIds.includes(part.id)}
                    onChange={() => togglePart(part.id)}
                    aria-label={`选择${vehicle}的${part.name}`}
                  />
                  <span>{part.name}</span>
                  <span>{part.brand || '待填写'}</span>
                  <span>{part.note || '—'}</span>
                  <span className="quotes-row-actions">
                    <button
                      type="button"
                      disabled={!writable || busy}
                      onClick={() => openPart(part)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={!writable || busy}
                      onClick={() => void removePart(part.id)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </section>
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
            onClick={() => openPart()}
            type="button"
          >
            <IconPlus size={19} /> 加入其他车型或配件
          </button>
        </div>
      </section>

      {dialog && (
        <div
          className="quotes-modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!busy) setDialog(null)
          }}
        >
          {dialog === 'part' && (
            <form
              className="quotes-modal"
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={(event) => void savePart(event)}
              aria-label={editingPartId ? '编辑配件' : '添加配件'}
            >
              <div className="quotes-modal-heading">
                <h2>{editingPartId ? '编辑配件' : '添加车型与配件'}</h2>
                <button type="button" onClick={() => setDialog(null)} aria-label="关闭">
                  <IconX size={20} />
                </button>
              </div>
              <label>
                车型
                <input
                  required
                  value={partForm.vehicle}
                  onChange={(event) => setPartForm({ ...partForm, vehicle: event.target.value })}
                  placeholder="例如：卡宴 E3"
                />
              </label>
              <label>
                配件名称
                <input
                  required
                  value={partForm.name}
                  onChange={(event) => setPartForm({ ...partForm, name: event.target.value })}
                  placeholder="例如：刹车片、火花塞"
                />
              </label>
              <label>
                品牌
                <input
                  value={partForm.brand}
                  onChange={(event) => setPartForm({ ...partForm, brand: event.target.value })}
                  placeholder="例如：马勒"
                />
              </label>
              <label>
                备注
                <input
                  value={partForm.note ?? ''}
                  onChange={(event) => setPartForm({ ...partForm, note: event.target.value })}
                  placeholder="可选，例如需核对年款"
                />
              </label>
              <p>模板只保存常用需求，报价时仍需核对具体零件号与适配。</p>
              {error && (
                <p className="quotes-error" role="alert">
                  {error}
                </p>
              )}
              <div className="quotes-modal-actions">
                <button type="button" disabled={busy} onClick={() => setDialog(null)}>
                  取消
                </button>
                <button className="quotes-primary-action" type="submit" disabled={busy}>
                  <IconCheck size={18} /> {busy ? '保存中…' : '保存配件'}
                </button>
              </div>
            </form>
          )}
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
