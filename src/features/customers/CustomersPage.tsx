import { useEffect, useState, type FormEvent } from 'react'
import {
  IconCalendar,
  IconFileText,
  IconMessageCircle,
  IconPlus,
  IconSearch,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import type { Customer } from '../catalog/types'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import catalog from '../../../shared/catalog.json'
import './customers.css'

type Activity = { id: string; content: string; createdAt: string; author: string }
type TypeFilter = '全部客户' | Customer['customerType']
const stages = catalog.customerStages as Customer['projectStage'][]
const types: TypeFilter[] = ['全部客户', '同行', '修理厂', '待分类']
const blank: Customer = {
  id: '',
  code: '',
  name: '',
  customerType: '待分类',
  projectStage: '待跟进',
  contact: '',
  phone: '',
  notes: '',
  enabled: true,
  version: 0,
  updatedAt: '',
}
const options = stages.map((stage) => ({ value: stage, label: stage }))
function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getMonth() + 1}月${date.getDate()}日`
}

export function CustomersPage() {
  const { user } = useAuth()
  const writable = user.role !== 'viewer'
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('全部客户')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Customer | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [activityText, setActivityText] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  function load() {
    setLoading(true)
    setError('')
    void api<Customer[]>('/customers')
      .then(setRows)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    void api<Customer[]>('/customers')
      .then(setRows)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    if (!selectedId) return
    let active = true
    void api<Activity[]>(`/customers/${selectedId}/activities`)
      .then((result) => {
        if (active) setActivities(result)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
  }, [selectedId])
  const visible = rows.filter(
    (row) =>
      row.enabled &&
      (typeFilter === '全部客户' || row.customerType === typeFilter) &&
      `${row.code} ${row.name} ${row.contact} ${row.phone} ${row.notes}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  )
  const selected = rows.find((row) => row.id === selectedId) ?? null
  function openEditor(customer?: Customer, stage?: Customer['projectStage']) {
    setForm(customer ? { ...customer } : { ...blank, projectStage: stage ?? '待跟进' })
    setFormError('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    setFormError('')
    try {
      const saved = await api<Customer>(`/customers${form.id ? '/' + form.id : ''}`, {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      })
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)])
      setSelectedId(saved.id)
      setForm(null)
      setMessage('客户项目已保存')
    } catch (e) {
      setFormError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function changeStage(row: Customer, stage: Customer['projectStage']) {
    if (!writable || row.projectStage === stage) return
    setError('')
    try {
      const saved = await api<Customer>(`/customers/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...row, projectStage: stage }),
      })
      setRows((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      if (selectedId === row.id)
        setActivities(await api<Activity[]>(`/customers/${row.id}/activities`))
      setMessage(`已移至「${stage}」`)
    } catch (e) {
      setError(errorMessage(e))
      load()
    }
  }
  async function addActivity(event: FormEvent) {
    event.preventDefault()
    if (!selected || !activityText.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await api<Activity>(`/customers/${selected.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ content: activityText }),
      })
      setActivities((current) => [result, ...current])
      setActivityText('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="business customer-projects">
      <div className="customer-projects-main">
        <header className="customer-projects-heading">
          <div>
            <h1>客户项目</h1>
            <p>按跟进阶段管理客户与报价</p>
          </div>
          {writable && (
            <button className="customer-projects-create" onClick={() => openEditor()}>
              <IconPlus size={17} />
              新增客户
            </button>
          )}
        </header>
        <div className="customer-projects-toolbar">
          <div className="customer-projects-type-tabs" role="group" aria-label="客户类型">
            {types.map((type) => (
              <button
                key={type}
                className={typeFilter === type ? 'active' : ''}
                onClick={() => setTypeFilter(type)}
              >
                {type}
                <span>
                  {
                    rows.filter(
                      (row) => row.enabled && (type === '全部客户' || row.customerType === type),
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="customer-projects-tools">
            {showSearch && (
              <input
                autoFocus
                aria-label="搜索客户项目"
                placeholder="搜索名称、编码、联系人"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <button
              aria-label={showSearch ? '关闭搜索' : '搜索客户'}
              onClick={() => {
                setShowSearch(!showSearch)
                setSearch('')
              }}
            >
              {showSearch ? <IconX size={19} /> : <IconSearch size={19} />}
            </button>
          </div>
        </div>
        {message && (
          <p className="customer-projects-feedback" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="customer-projects-error" role="alert">
            {error} <button onClick={load}>重试</button>
          </p>
        )}
        <div className="customer-projects-board">
          {stages.map((stage, index) => {
            const stageRows = visible.filter((row) => row.projectStage === stage)
            return (
              <section
                className={`customer-projects-column stage-${index}`}
                key={stage}
                aria-label={stage}
              >
                <div className="customer-projects-column-heading">
                  <span className="customer-projects-stage-dot" />
                  <h2>{stage}</h2>
                  <small>{stageRows.length}</small>
                </div>
                <div className="customer-projects-cards">
                  {stageRows.map((row) => (
                    <article
                      className={`customer-project-card${row.id === selectedId ? ' selected' : ''}`}
                      key={row.id}
                    >
                      <button
                        className="customer-project-card-open"
                        onClick={() => setSelectedId(row.id)}
                        aria-label={`查看${row.name}项目`}
                      >
                        <span className="customer-project-card-top">
                          <span>
                            <IconCalendar size={14} />
                            {shortDate(row.updatedAt)}
                          </span>
                          <span className={`customer-project-card-type type-${row.customerType}`}>
                            {row.customerType}
                          </span>
                        </span>
                        <strong>{row.name}</strong>
                        <span className="customer-project-card-note">
                          {row.notes || '暂无项目备注'}
                        </span>
                        <span className="customer-project-card-bottom">
                          <span>
                            <IconUser size={15} />
                            {row.contact || '未填联系人'}
                          </span>
                          <span>
                            <IconMessageCircle size={15} />
                            详情
                          </span>
                        </span>
                      </button>
                      {writable && (
                        <div className="customer-project-card-stage">
                          <Select
                            label={`${row.name}的跟进阶段`}
                            value={row.projectStage}
                            options={options}
                            onChange={(value) =>
                              void changeStage(row, value as Customer['projectStage'])
                            }
                          />
                        </div>
                      )}
                    </article>
                  ))}
                  {!stageRows.length && (
                    <div className="customer-projects-column-empty">
                      {loading ? '正在读取客户…' : '暂无客户项目'}
                    </div>
                  )}
                </div>
                {writable && (
                  <button
                    className="customer-projects-add"
                    onClick={() => openEditor(undefined, stage)}
                  >
                    <IconPlus size={15} />
                    添加客户项目
                  </button>
                )}
              </section>
            )
          })}
        </div>
      </div>
      <aside className="customer-projects-detail" aria-label="客户项目详情">
        {selected ? (
          <>
            <div className="customer-projects-detail-heading">
              <div>
                <h2>{selected.name}</h2>
                <p>客户编号 {selected.code}</p>
              </div>
              <button aria-label="关闭详情" onClick={() => setSelectedId(null)}>
                <IconX size={19} />
              </button>
            </div>
            <div className="customer-projects-detail-tags">
              <span>{selected.customerType}</span>
              <span>{selected.projectStage}</span>
            </div>
            <section className="customer-projects-detail-section">
              <div className="customer-projects-section-heading">
                <h3>基本信息</h3>
                {writable && <button onClick={() => openEditor(selected)}>编辑</button>}
              </div>
              <dl>
                <div>
                  <dt>客户类型</dt>
                  <dd>{selected.customerType}</dd>
                </div>
                <div>
                  <dt>跟进阶段</dt>
                  <dd>{selected.projectStage}</dd>
                </div>
                <div>
                  <dt>联系人</dt>
                  <dd>{selected.contact || '未填写'}</dd>
                </div>
                <div>
                  <dt>联系电话</dt>
                  <dd>{selected.phone || '未填写'}</dd>
                </div>
                <div>
                  <dt>最近更新</dt>
                  <dd>{shortDate(selected.updatedAt)}</dd>
                </div>
              </dl>
            </section>
            <section className="customer-projects-detail-section">
              <h3>项目备注</h3>
              <p className="customer-projects-notes">
                {selected.notes || '暂无项目备注，可通过编辑客户添加。'}
              </p>
            </section>
            <section className="customer-projects-detail-section">
              <h3>跟进动态</h3>
              {writable && (
                <form className="customer-projects-activity-form" onSubmit={addActivity}>
                  <textarea
                    aria-label="跟进内容"
                    placeholder="记录沟通、询价或待办事项"
                    maxLength={1000}
                    value={activityText}
                    onChange={(e) => setActivityText(e.target.value)}
                  />
                  <button disabled={busy || !activityText.trim()}>添加记录</button>
                </form>
              )}
              {activities.length ? (
                <ol className="customer-projects-activity-list">
                  {activities.map((item) => (
                    <li key={item.id}>
                      <IconMessageCircle size={16} />
                      <div>
                        <strong>{item.content}</strong>
                        <small>
                          {item.author} · {new Date(item.createdAt).toLocaleString('zh-CN')}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="customer-projects-detail-empty">暂无跟进记录</p>
              )}
            </section>
            <section className="customer-projects-detail-section">
              <h3>报价记录</h3>
              <p className="customer-projects-detail-empty">
                <IconFileText size={18} />
                尚未关联客户报价记录
              </p>
            </section>
          </>
        ) : (
          <div className="customer-projects-detail-placeholder">
            <IconUser size={34} />
            <h2>选择客户项目</h2>
            <p>查看客户资料与跟进动态</p>
          </div>
        )}
      </aside>
      {form && (
        <Modal
          title={form.id ? '编辑客户项目' : '新增客户项目'}
          onClose={() => {
            if (!busy) setForm(null)
          }}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <label>
                客户类型
                <Select
                  label="客户类型"
                  options={catalog.customerTypes.map((type) => ({ value: type, label: type }))}
                  value={form.customerType}
                  onChange={(value) =>
                    setForm({ ...form, customerType: value as Customer['customerType'] })
                  }
                />
              </label>
              <label>
                跟进阶段
                <Select
                  label="跟进阶段"
                  options={options}
                  value={form.projectStage}
                  onChange={(value) =>
                    setForm({ ...form, projectStage: value as Customer['projectStage'] })
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              {(['code', 'name', 'contact', 'phone'] as const).map((key) => (
                <label key={key}>
                  {
                    { code: '客户编码', name: '客户名称', contact: '联系人', phone: '联系电话' }[
                      key
                    ]
                  }
                  <input
                    required={key === 'code' || key === 'name'}
                    maxLength={key === 'code' ? 50 : key === 'phone' ? 60 : 200}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label>
              项目备注
              <textarea
                value={form.notes}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              启用客户
            </label>
            {formError && (
              <p role="alert" className="error">
                {formError}
              </p>
            )}
            <footer className="form-actions">
              <button type="button" disabled={busy} onClick={() => setForm(null)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? '保存中…' : '保存客户'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
