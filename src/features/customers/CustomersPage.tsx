import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  IconCalendar,
  IconCar,
  IconFileText,
  IconId,
  IconMessageCircle,
  IconMapPin,
  IconReceipt,
  IconTag,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import type { Customer } from '../catalog/types'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import './customers.css'

type Activity = { id: string; content: string; createdAt: string; author: string }
type DictionaryOption = { code: string; label: string; parentCode: string | null }
type TypeFilter = '全部客户' | string
const blank: Customer = {
  id: '',
  code: '',
  name: '',
  customerType: '待分类',
  projectStage: '待跟进',
  contact: '',
  phone: '',
  source: '',
  owner: '',
  wechat: '',
  email: '',
  mainBrand: '',
  tags: '',
  invoiceTitle: '',
  taxId: '',
  settlementMethod: '',
  region: '',
  address: '',
  additionalContacts: [],
  notes: '',
  enabled: true,
  version: 0,
  updatedAt: '',
}
function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getMonth() + 1}月${date.getDate()}日`
}

export function CustomersPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const writable = user.role !== 'viewer'
  const [rows, setRows] = useState<Customer[]>([])
  const [customerTypes, setCustomerTypes] = useState<string[]>([])
  const [stages, setStages] = useState<string[]>([])
  const [brands, setBrands] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('全部客户')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Customer | null>(null)
  const [formSection, setFormSection] = useState('basic')
  const [activities, setActivities] = useState<Activity[]>([])
  const [activityText, setActivityText] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const types: TypeFilter[] = ['全部客户', ...customerTypes]
  const stageOptions = stages.map((stage) => ({ value: stage, label: stage }))
  const customerTypeOptions = customerTypes.map((type) => ({ value: type, label: type }))
  function load() {
    setLoading(true)
    setError('')
    void api<Customer[]>('/customers')
      .then(setRows)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    void Promise.all([
      api<Customer[]>('/customers'),
      api<DictionaryOption[]>('/dictionaries/options?scope=configuration&code=customer_type'),
      api<DictionaryOption[]>('/dictionaries/options?scope=configuration&code=customer_stage'),
      api<DictionaryOption[]>('/dictionaries/options?scope=sku_foundation&code=product_brand'),
    ])
      .then(([customers, typeOptions, stageRows, brandRows]) => {
        setRows(customers)
        setCustomerTypes(typeOptions.map((option) => option.label))
        setStages(stageRows.map((option) => option.label))
        setBrands(brandRows.map((option) => option.label))
      })
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
    setFormSection('basic')
    setForm(
      customer
        ? { ...customer, additionalContacts: customer.additionalContacts ?? [] }
        : {
            ...blank,
            customerType: customerTypes.includes(blank.customerType)
              ? blank.customerType
              : (customerTypes[0] ?? blank.customerType),
            projectStage:
              stage ??
              (stages.includes(blank.projectStage)
                ? blank.projectStage
                : (stages[0] ?? blank.projectStage)),
          },
    )
    setFormError('')
  }
  const formSections = [
    { id: 'basic', label: '基本资料', icon: IconId },
    { id: 'contact', label: '联系方式', icon: IconUser },
    { id: 'business', label: '业务偏好', icon: IconTag },
    { id: 'billing', label: '开票与结算', icon: IconReceipt },
    { id: 'address', label: '地址备注', icon: IconMapPin },
  ]
  const completionFields: (keyof Customer)[] = [
    'name',
    'customerType',
    'projectStage',
    'contact',
    'phone',
    'source',
    'owner',
    'mainBrand',
    'invoiceTitle',
    'settlementMethod',
    'region',
    'address',
  ]
  const completion = form
    ? Math.round(
        (completionFields.filter((key) => String(form[key] ?? '').trim()).length /
          completionFields.length) *
          100,
      )
    : 0
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
        <div
          className="customer-projects-board"
          style={{
            gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(150px, 1fr))`,
          }}
        >
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
                            options={stageOptions}
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
              <button
                className="customer-projects-garage"
                onClick={() => navigate(`/customers/${selected.id}/garage`)}
              >
                <IconCar size={16} />
                车主、车辆与询价
              </button>
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
                  <dt>负责人</dt>
                  <dd>{selected.owner || '未填写'}</dd>
                </div>
                <div>
                  <dt>客户来源</dt>
                  <dd>{selected.source || '未填写'}</dd>
                </div>
                <div>
                  <dt>最近更新</dt>
                  <dd>{shortDate(selected.updatedAt)}</dd>
                </div>
              </dl>
            </section>
            <section className="customer-projects-detail-section">
              <h3>联系与业务资料</h3>
              <dl>
                <div>
                  <dt>微信</dt>
                  <dd>{selected.wechat || '未填写'}</dd>
                </div>
                <div>
                  <dt>邮箱</dt>
                  <dd>{selected.email || '未填写'}</dd>
                </div>
                <div>
                  <dt>主营品牌</dt>
                  <dd>{selected.mainBrand || '未填写'}</dd>
                </div>
                <div>
                  <dt>客户标签</dt>
                  <dd>{selected.tags || '未填写'}</dd>
                </div>
                <div>
                  <dt>结算方式</dt>
                  <dd>{selected.settlementMethod || '未填写'}</dd>
                </div>
                <div>
                  <dt>所在地区</dt>
                  <dd>{selected.region || '未填写'}</dd>
                </div>
                <div>
                  <dt>详细地址</dt>
                  <dd>{selected.address || '未填写'}</dd>
                </div>
              </dl>
              {(selected.additionalContacts?.length ?? 0) > 0 && (
                <div className="customer-projects-extra-contacts">
                  <strong>其他联系人</strong>
                  {selected.additionalContacts?.map((contact) => (
                    <p key={contact.id}>
                      {contact.name}
                      <span>
                        {[contact.phone, contact.wechat, contact.email].filter(Boolean).join(' · ')}
                      </span>
                    </p>
                  ))}
                </div>
              )}
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
          wide
          title={form.id ? '编辑客户项目' : '新增客户项目'}
          onClose={() => {
            if (!busy) setForm(null)
          }}
        >
          <form className="customer-editor" onSubmit={save}>
            <aside className="customer-editor-nav">
              <div className="customer-editor-avatar" aria-hidden="true">
                {form.name.trim().charAt(0) || '客'}
              </div>
              <span className="customer-editor-status">{form.enabled ? '启用中' : '已停用'}</span>
              <strong>{form.name || '新客户项目'}</strong>
              <small>{form.id ? form.code : '客户编号将在保存后生成'}</small>
              <nav aria-label="客户资料分区">
                {formSections.map((section) => {
                  const Icon = section.icon
                  return (
                    <button
                      type="button"
                      className={formSection === section.id ? 'active' : ''}
                      key={section.id}
                      onClick={() => setFormSection(section.id)}
                    >
                      <Icon size={19} />
                      {section.label}
                    </button>
                  )
                })}
              </nav>
            </aside>
            <div className="customer-editor-main">
              <header className="customer-editor-heading">
                <h3>{formSections.find((section) => section.id === formSection)?.label}</h3>
                <p>完善客户资料，便于后续业务跟进与服务管理。</p>
              </header>
              {formSection === 'basic' && (
                <div className="customer-editor-panel form-grid">
                  <label>
                    客户名称 <span className="required">*</span>
                    <input
                      required
                      maxLength={200}
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  </label>
                  <label>
                    客户编号（自动生成）
                    <input disabled value={form.id ? form.code : '保存后自动生成'} />
                  </label>
                  <label>
                    客户类型 <span className="required">*</span>
                    <Select
                      label="客户类型"
                      options={customerTypeOptions}
                      value={form.customerType}
                      onChange={(value) => setForm({ ...form, customerType: value })}
                    />
                  </label>
                  <label>
                    跟进阶段 <span className="required">*</span>
                    <Select
                      label="跟进阶段"
                      options={stageOptions}
                      value={form.projectStage}
                      onChange={(value) => setForm({ ...form, projectStage: value })}
                    />
                  </label>
                  <label>
                    客户来源
                    <input
                      maxLength={120}
                      placeholder="例如：老客户推荐"
                      value={form.source}
                      onChange={(event) => setForm({ ...form, source: event.target.value })}
                    />
                  </label>
                  <label>
                    负责人
                    <input
                      maxLength={120}
                      value={form.owner}
                      onChange={(event) => setForm({ ...form, owner: event.target.value })}
                    />
                  </label>
                  <label className="checkbox-label customer-editor-enabled">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                    />
                    启用客户
                  </label>
                </div>
              )}
              {formSection === 'contact' && (
                <div className="customer-editor-panel customer-editor-contacts">
                  <div className="customer-editor-panel-heading">
                    <strong>主联系人</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          additionalContacts: [
                            ...form.additionalContacts,
                            { id: crypto.randomUUID(), name: '', phone: '', wechat: '', email: '' },
                          ],
                        })
                      }
                    >
                      <IconPlus size={16} />
                      添加联系人
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      姓名
                      <input
                        maxLength={200}
                        value={form.contact}
                        onChange={(event) => setForm({ ...form, contact: event.target.value })}
                      />
                    </label>
                    <label>
                      联系电话
                      <input
                        maxLength={60}
                        value={form.phone}
                        onChange={(event) => setForm({ ...form, phone: event.target.value })}
                      />
                    </label>
                    <label>
                      微信
                      <input
                        maxLength={120}
                        value={form.wechat}
                        onChange={(event) => setForm({ ...form, wechat: event.target.value })}
                      />
                    </label>
                    <label>
                      邮箱
                      <input
                        type="email"
                        maxLength={200}
                        value={form.email}
                        onChange={(event) => setForm({ ...form, email: event.target.value })}
                      />
                    </label>
                  </div>
                  {form.additionalContacts.map((contact, index) => (
                    <div className="customer-editor-extra-contact" key={contact.id}>
                      <div className="customer-editor-panel-heading">
                        <strong>其他联系人 {index + 1}</strong>
                        <button
                          type="button"
                          aria-label={`删除其他联系人 ${index + 1}`}
                          onClick={() =>
                            setForm({
                              ...form,
                              additionalContacts: form.additionalContacts.filter(
                                (item) => item.id !== contact.id,
                              ),
                            })
                          }
                        >
                          <IconTrash size={16} />
                          删除
                        </button>
                      </div>
                      <div className="form-grid">
                        {(['name', 'phone', 'wechat', 'email'] as const).map((key) => (
                          <label key={key}>
                            {
                              { name: '姓名', phone: '联系电话', wechat: '微信', email: '邮箱' }[
                                key
                              ]
                            }
                            <input
                              required={key === 'name'}
                              type={key === 'email' ? 'email' : 'text'}
                              maxLength={key === 'phone' ? 60 : key === 'email' ? 200 : 120}
                              value={contact[key]}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  additionalContacts: form.additionalContacts.map((item) =>
                                    item.id === contact.id
                                      ? { ...item, [key]: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {formSection === 'business' && (
                <div className="customer-editor-panel form-grid">
                  <label>
                    主营品牌
                    <Select
                      label="主营品牌"
                      options={[
                        { value: '', label: '未选择' },
                        ...brands.map((brand) => ({ value: brand, label: brand })),
                      ]}
                      value={form.mainBrand}
                      onChange={(value) => setForm({ ...form, mainBrand: value })}
                    />
                  </label>
                  <label>
                    客户标签
                    <input
                      maxLength={300}
                      placeholder="例如：重点客户、华东区"
                      value={form.tags}
                      onChange={(event) => setForm({ ...form, tags: event.target.value })}
                    />
                  </label>
                </div>
              )}
              {formSection === 'billing' && (
                <div className="customer-editor-panel form-grid">
                  <label>
                    发票抬头
                    <input
                      maxLength={200}
                      value={form.invoiceTitle}
                      onChange={(event) => setForm({ ...form, invoiceTitle: event.target.value })}
                    />
                  </label>
                  <label>
                    税号
                    <input
                      maxLength={100}
                      value={form.taxId}
                      onChange={(event) => setForm({ ...form, taxId: event.target.value })}
                    />
                  </label>
                  <label>
                    结算方式
                    <input
                      maxLength={120}
                      placeholder="例如：月结"
                      value={form.settlementMethod}
                      onChange={(event) =>
                        setForm({ ...form, settlementMethod: event.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {formSection === 'address' && (
                <div className="customer-editor-panel form-grid">
                  <label>
                    所在地区
                    <input
                      maxLength={200}
                      placeholder="省 / 市 / 区"
                      value={form.region}
                      onChange={(event) => setForm({ ...form, region: event.target.value })}
                    />
                  </label>
                  <label>
                    详细地址
                    <input
                      maxLength={500}
                      value={form.address}
                      onChange={(event) => setForm({ ...form, address: event.target.value })}
                    />
                  </label>
                  <label className="customer-editor-notes">
                    项目备注
                    <textarea
                      value={form.notes}
                      maxLength={2000}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    />
                  </label>
                </div>
              )}
              <div className="customer-editor-completion">
                <span>资料完整度</span>
                <strong>{completion}%</strong>
                <div aria-label={`资料完整度 ${completion}%`}>
                  <span style={{ width: `${completion}%` }} />
                </div>
                <small>继续完善更多信息，提升客户管理效果。</small>
              </div>
            </div>
            {formError && (
              <p role="alert" className="error">
                {formError}
              </p>
            )}
            <footer className="form-actions customer-editor-actions">
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
