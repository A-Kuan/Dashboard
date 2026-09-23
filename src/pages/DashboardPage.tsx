import { useEffect, useMemo, useState } from 'react'
import { IconChevronRight, IconDots, IconPlus } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { Customer, Sku } from '../features/catalog/types'
import { api, errorMessage } from '../lib/api'
import './dashboard.css'

type TemplateSummary = {
  id: string
  name: string
  customer: string
  updatedAt: string
  isCommon: boolean
  parts: unknown[]
}

type DashboardData = {
  customers: Customer[]
  skuTotal: number
  templates: TemplateSummary[]
}

const stageDefinitions = [
  { label: '需求沟通', tone: 'neutral' },
  { label: '报价进行中', tone: 'orange' },
  { label: '待客户确认', tone: 'blue' },
  { label: '已成交', tone: 'green' },
] as const

function displayDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
}

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>({ customers: [], skuTotal: 0, templates: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')

  useEffect(() => {
    let alive = true
    void Promise.all([
      api<Customer[]>('/customers'),
      api<{ rows: Sku[]; total: number }>('/skus/page?page=1&enabled=true&sort=code'),
      api<TemplateSummary[]>('/quote-templates'),
    ])
      .then(([customers, skus, templates]) => {
        if (alive) setData({ customers, skuTotal: skus.total, templates })
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
  }, [])

  const activeCustomers = data.customers.filter((customer) => customer.enabled)
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const customer of activeCustomers) {
      const stage = customer.projectStage || '需求沟通'
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
    }
    return counts
  }, [activeCustomers])
  const priorities = [...activeCustomers]
    .filter((customer) => !customer.contact || !customer.phone || !customer.mainBrand)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4)
  const recentCustomers = [...activeCustomers]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
  const recentTemplates = [...data.templates]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)

  function copyTemplate(template: TemplateSummary) {
    void navigator.clipboard.writeText(template.name).then(() => {
      setCopiedId(template.id)
      window.setTimeout(() => setCopiedId(''), 1200)
    })
  }

  return (
    <div className="business home-page dashboard-home">
      <header className="dashboard-home-heading">
        <div>
          <div className="dashboard-breadcrumb">
            <span>客户与报价</span>
            <IconChevronRight size={15} />
            <span>首页</span>
          </div>
          <h1>客户与报价</h1>
          <p>管理客户项目与报价流程，提升成交效率。</p>
        </div>
        <Link className="dashboard-primary-action" to="/customers">
          <IconPlus size={22} />
          新建客户
        </Link>
      </header>

      {error && <p className="dashboard-error">{error}</p>}

      <div className="dashboard-home-grid">
        <section className="dashboard-panel dashboard-customer-progress">
          <div className="dashboard-panel-heading">
            <h2>客户项目进展</h2>
            <Link to="/customers">
              查看全部 <IconChevronRight size={16} />
            </Link>
          </div>
          <div className="dashboard-stage-strip">
            {stageDefinitions.map((stage, index) => (
              <div className={`dashboard-stage dashboard-stage-${stage.tone}`} key={stage.label}>
                <span>{index + 1}</span>
                <p>
                  <strong>{stage.label}</strong>
                  <small>{stageCounts.get(stage.label) ?? 0} 个项目</small>
                </p>
                {index < stageDefinitions.length - 1 && <IconChevronRight size={18} />}
              </div>
            ))}
          </div>
          <div className="dashboard-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>客户名称</th>
                  <th>项目/车型</th>
                  <th>需求商品</th>
                  <th>当前阶段</th>
                  <th>更新时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {recentCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name}</strong>
                    </td>
                    <td>{customer.mainBrand || '待补充'}</td>
                    <td>{customer.tags || '待补充'}</td>
                    <td>
                      <span className="dashboard-status">{customer.projectStage || '待跟进'}</span>
                    </td>
                    <td>{displayDate(customer.updatedAt)}</td>
                    <td className="dashboard-row-action">
                      <Link to="/customers" aria-label={`查看${customer.name}`}>
                        <IconDots size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !recentCustomers.length && (
              <p className="dashboard-empty-copy">还没有客户数据</p>
            )}
          </div>
        </section>

        <aside className="dashboard-panel dashboard-priorities">
          <div className="dashboard-panel-heading">
            <h2>今日优先处理</h2>
            <Link to="/customers">
              查看全部 <IconChevronRight size={16} />
            </Link>
          </div>
          <div className="dashboard-priority-list">
            {priorities.map((customer, index) => {
              const missing = [
                !customer.contact && '联系人',
                !customer.phone && '电话',
                !customer.mainBrand && '主营品牌',
              ]
                .filter(Boolean)
                .join('、')
              const highPriority = index < 2
              return (
                <Link key={customer.id} to="/customers">
                  <span className={`dashboard-priority-time${highPriority ? ' is-high' : ''}`}>
                    <i />
                    {displayTime(customer.updatedAt)}
                  </span>
                  <span className="dashboard-priority-copy">
                    <strong>补充客户资料</strong>
                    <small>
                      {customer.name} · 缺少{missing}
                    </small>
                  </span>
                  <span className={`dashboard-priority-badge${highPriority ? ' is-high' : ''}`}>
                    {highPriority ? '高' : '中'}
                  </span>
                  <IconChevronRight size={19} />
                </Link>
              )
            })}
            {!loading && !priorities.length && (
              <p className="dashboard-empty-copy">客户资料目前较完整</p>
            )}
          </div>
        </aside>
      </div>

      <section className="dashboard-panel dashboard-recent-templates">
        <div className="dashboard-panel-heading">
          <h2>最近报价模板</h2>
          <Link to="/quotes/templates">
            查看全部 <IconChevronRight size={16} />
          </Link>
        </div>
        <div className="dashboard-table-wrap">
          <table>
            <thead>
              <tr>
                <th>模板名称</th>
                <th>适用客户</th>
                <th>包含商品（SKU）</th>
                <th>更新时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {recentTemplates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.name}</strong>
                  </td>
                  <td>{template.customer || '未指定'}</td>
                  <td>{template.parts.length}</td>
                  <td>{displayDate(template.updatedAt)}</td>
                  <td>
                    <span className={template.isCommon ? 'dashboard-enabled' : 'dashboard-draft'}>
                      <i /> {template.isCommon ? '启用' : '草稿'}
                    </span>
                  </td>
                  <td className="dashboard-template-actions">
                    <Link to="/quotes/templates">编辑</Link>
                    <button type="button" onClick={() => copyTemplate(template)}>
                      {copiedId === template.id ? '已复制' : '复制'}
                    </button>
                    <IconDots size={18} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !recentTemplates.length && (
            <p className="dashboard-empty-copy">还没有报价模板</p>
          )}
        </div>
      </section>
    </div>
  )
}
