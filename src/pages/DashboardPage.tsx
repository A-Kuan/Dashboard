import { useEffect, useMemo, useState } from 'react'
import {
  IconArrowRight,
  IconFileDescription,
  IconPackage,
  IconPlus,
  IconUsers,
} from '@tabler/icons-react'
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

function displayDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>({ customers: [], skuTotal: 0, templates: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
  const stages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const customer of activeCustomers) {
      const stage = customer.projectStage || '待跟进'
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).slice(0, 4)
  }, [activeCustomers])
  const priorities = activeCustomers
    .filter((customer) => !customer.contact || !customer.phone || !customer.mainBrand)
    .slice(0, 4)
  const recentCustomers = [...activeCustomers]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
  const recentTemplates = [...data.templates]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)

  return (
    <div className="business home-page dashboard-home">
      <header className="dashboard-home-heading">
        <div>
          <span className="dashboard-breadcrumb">工作台 / 首页</span>
          <h1>业务工作台</h1>
          <p>从真实客户、SKU 与报价模板中快速进入今天的工作。</p>
        </div>
        <Link className="dashboard-primary-action" to="/customers">
          <IconPlus size={18} />
          新增客户
        </Link>
      </header>

      {error && <p className="dashboard-error">{error}</p>}

      <section className="dashboard-module-strip" aria-label="业务概览">
        <Link to="/customers">
          <IconUsers size={22} />
          <span>
            <strong>客户项目</strong>
            <small>{loading ? '读取中…' : `${activeCustomers.length} 个启用客户`}</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/skus">
          <IconPackage size={22} />
          <span>
            <strong>SKU 档案</strong>
            <small>{loading ? '读取中…' : `${data.skuTotal} 个启用 SKU`}</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/quotes/templates">
          <IconFileDescription size={22} />
          <span>
            <strong>报价模板</strong>
            <small>{loading ? '读取中…' : `${data.templates.length} 个模板`}</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
      </section>

      <div className="dashboard-home-grid">
        <section className="dashboard-panel dashboard-customer-progress">
          <div className="dashboard-panel-heading">
            <h2>客户项目进展</h2>
            <Link to="/customers">
              查看全部 <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="dashboard-stage-strip">
            {stages.length ? (
              stages.map((stage, index) => (
                <div key={stage.name}>
                  <span>{index + 1}</span>
                  <p>
                    <strong>{stage.name}</strong>
                    <small>{stage.count} 个项目</small>
                  </p>
                </div>
              ))
            ) : (
              <p className="dashboard-empty-copy">暂无客户项目阶段</p>
            )}
          </div>
          <div className="dashboard-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>客户名称</th>
                  <th>客户类型</th>
                  <th>主营品牌</th>
                  <th>当前阶段</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {recentCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name}</strong>
                      <small>{customer.code}</small>
                    </td>
                    <td>{customer.customerType}</td>
                    <td>{customer.mainBrand || '待补充'}</td>
                    <td>
                      <span className="dashboard-status">{customer.projectStage}</span>
                    </td>
                    <td>{displayDate(customer.updatedAt)}</td>
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
            <h2>待补充资料</h2>
            <Link to="/customers">
              查看全部 <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="dashboard-priority-list">
            {priorities.map((customer) => {
              const missing = [
                !customer.contact && '联系人',
                !customer.phone && '电话',
                !customer.mainBrand && '主营品牌',
              ]
                .filter(Boolean)
                .join('、')
              return (
                <Link key={customer.id} to="/customers">
                  <span className="dashboard-priority-dot" />
                  <span>
                    <strong>{customer.name}</strong>
                    <small>缺少{missing}</small>
                  </span>
                  <IconArrowRight size={16} />
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
            查看全部 <IconArrowRight size={15} />
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
                      {template.isCommon ? '常用' : '普通'}
                    </span>
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
