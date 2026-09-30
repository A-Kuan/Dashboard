import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bell,
  CarProfile,
  ChartBar,
  Check,
  ClipboardText,
  Clock,
  Cube,
  FileText,
  GearSix,
  House,
  MagnifyingGlass,
  Package,
  Robot,
  ShoppingCart,
  Storefront,
  Tag,
  User,
  UsersThree,
  Wrench,
  X,
} from '@phosphor-icons/react'
import { assetPath } from '../utils/assetPath'
import '../workbench.css'

const navGroups = [
  {
    items: [
      { label: '工作台', icon: House, active: true },
      { label: 'SKU 资料库', icon: Cube },
      { label: '车型库', icon: CarProfile },
      { label: '客户管理', icon: User },
      { label: '报价管理', icon: ClipboardText },
      { label: '采购管理', icon: ShoppingCart },
      { label: '订单管理', icon: FileText },
      { label: '供应商管理', icon: Storefront },
      { label: '数据报表', icon: ChartBar },
    ],
  },
  {
    title: '工具',
    items: [
      { label: '多家比价', icon: Wrench },
      { label: 'VIN 解析', icon: X },
      { label: 'OE 查询', icon: Tag },
      { label: '图纸资料', icon: FileText },
    ],
  },
  {
    title: 'AI',
    items: [{ label: 'Pi 助手', icon: Robot }],
  },
]

const stats = [
  { label: '待处理询价', value: '12', note: '较昨日', delta: '▲ 3', tone: 'blue', icon: ClipboardText },
  { label: '待采购订单', value: '8', note: '较昨日', delta: '↓ 2', tone: 'orange', icon: ShoppingCart },
  { label: '本月客户', value: '26', note: '新增客户', delta: '▲ 4', tone: 'blue', icon: User },
  { label: '本月已报价', value: '48', note: '较上月', delta: '▲ 12', tone: 'green', icon: Tag },
  { label: '本月成交', value: '26', note: '较上月', delta: '▲ 18%', tone: 'blue', icon: ChartBar },
]

const businessRows = [
  { customer: '王师傅汽修', need: '前刹车片（前轮）', vehicle: 'Cayenne (E3)', status: '已报价', statusTone: 'green', amount: '¥ 1,270', next: '等待客户回复', updated: '今天 10:24' },
  { customer: '嘉诚汽修', need: '保养件 5 项', vehicle: 'Audi Q7 (4M)', status: '待报价', statusTone: 'yellow', amount: '—', next: '去报价', updated: '今天 09:17', primary: true },
  { customer: '兴达车行', need: '空调滤芯', vehicle: 'Panamera (971)', status: '客户询价', statusTone: 'blue', amount: '—', next: '查询价格', updated: '今天 08:50' },
  { customer: '宏远汽修', need: '发动机机脚', vehicle: 'Macan (95B)', status: '比价中', statusTone: 'violet', amount: '¥ 4,860', next: '继续比价', updated: '昨天 16:30' },
  { customer: '恒信名车', need: '后减震器', vehicle: 'Audi Q5 (FY)', status: '待采购', statusTone: 'orange', amount: '¥ 2,350', next: '确认供应商', updated: '昨天 14:08' },
]

const initialTodos = [
  { text: '确认采购单 #PO250918', day: '今天', time: '14:00' },
  { text: '新供应商价格录入（5个SKU）', day: '今天', time: '16:00' },
  { text: '回访王师傅 - 报价反馈', day: '今天', time: '17:00' },
  { text: '奥迪 Q7 保养件方案', day: '明天', time: '09:30' },
  { text: '整理上周未成交客户', day: '09-20', time: '10:00' },
]

const quickActions = [
  { label: '新建报价', icon: FileText },
  { label: '多家比价', icon: ChartBar },
  { label: 'VIN 解析', icon: CarProfile },
  { label: 'SKU 录入', icon: Cube },
  { label: '客户管理', icon: UsersThree },
]

const vehicles = [
  { model: 'Cayenne', brand: '卡宴', image: 'vehicle-cayenne.png' },
  { model: 'Macan', brand: '迈凯', image: 'vehicle-macan.png' },
  { model: 'Panamera', brand: '帕美', image: 'vehicle-panamera.png' },
  { model: 'Q7', brand: '奥迪 Q7', image: 'vehicle-q7.png' },
  { model: 'Q5', brand: '奥迪 Q5', image: 'vehicle-q5.png' },
]

export function WorkbenchHome() {
  const [query, setQuery] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [doneTodos, setDoneTodos] = useState([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const searchMatches = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return businessRows.slice(0, 3)
    return businessRows.filter((row) => Object.values(row).join(' ').toLowerCase().includes(value))
  }, [query])

  const navigate = (item) => {
    if (!item.active) setToast(`${item.label}将在后续业务阶段接入`)
  }

  return (
    <div className="workbench-home">
      <aside className="workbench-sidebar">
        <img className="workbench-logo" src={assetPath('assets/workbench/logo-transparent.png')} alt="虎山行 Auto Parts" />
        <div className="workbench-nav-scroll">
          {navGroups.map((group, groupIndex) => (
            <div className={`workbench-nav-group group-${groupIndex}`} key={group.title || 'main'}>
              {group.title ? <span className="workbench-nav-title">{group.title}</span> : null}
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button className={`workbench-nav-item ${item.active ? 'active' : ''}`} key={item.label} onClick={() => navigate(item)} type="button">
                    <Icon size={20} weight={item.active ? 'fill' : 'bold'} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <button className="workbench-settings" type="button" onClick={() => setToast('设置将在后续阶段接入')}><GearSix size={20} weight="bold" />设置</button>
        <p className="workbench-slogan">更好的配件<br />让每一程更安心</p>
      </aside>

      <main className="workbench-main">
        <header className="workbench-hero">
          <div className="hero-copy">
            <h1>下午好，虎山行</h1>
            <p>高效连接配件与需求，让每一次出发都更安心。</p>
          </div>
          <img className="hero-cars" src={assetPath('assets/workbench/hero-cars.png')} alt="保时捷与奥迪车型" />
          <div className="hero-profile">
            <button className="hero-bell" aria-label="查看通知" type="button" onClick={() => setToast('当前没有新通知')}><Bell size={25} weight="bold" /><i /></button>
            <img src={assetPath('assets/workbench/avatar.png')} alt="虎山行头像" />
            <strong>虎山行</strong>
            <span>⌄</span>
          </div>
          <div className="hero-brandline"><span>专注保时捷 · 奥迪原厂及高品质配件</span><small>RIGHT PARTS. BRIGHTER ROADS.</small><b>—<br />PORSCHE<br />AUDI</b></div>
        </header>

        <div className="workbench-content">
          <section className="workbench-search-row">
            <form className="workbench-search" onSubmit={(event) => { event.preventDefault(); setCommandOpen(true) }}>
              <MagnifyingGlass size={33} weight="bold" />
              <input aria-label="工作台搜索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 OE 号 / 配件名称 / VIN 码 / 车型 / 客户 / 供应商..." />
              <button type="submit"><MagnifyingGlass size={26} weight="bold" />搜索</button>
            </form>
            <button className="command-card" type="button" onClick={() => setCommandOpen(true)}><strong>Ctrl + K</strong><span>打开命令中心</span></button>
          </section>

          <section className="workbench-stats" aria-label="核心指标">
            {stats.map((stat) => {
              const Icon = stat.icon
              return <article className="stat-card" key={stat.label}><span className={`stat-icon ${stat.tone}`}><Icon size={30} weight="bold" /></span><div><strong className="stat-label">{stat.label}</strong><b>{stat.value}</b><span>{stat.note}</span></div><em className={stat.tone === 'orange' ? 'down' : ''}>{stat.delta}</em></article>
            })}
          </section>

          <section className="workbench-center-grid">
            <article className="workbench-card business-card">
              <div className="workbench-card-heading"><div><h2>业务跟进</h2><span>当前进行中的客户需求与订单</span></div><button type="button">全部状态⌄</button></div>
              <div className="business-table-wrap">
                <table className="business-table">
                  <thead><tr><th>客户 / 门店</th><th>需求内容</th><th>车型</th><th>状态</th><th>金额</th><th>下一步</th><th>更新时间</th><th /></tr></thead>
                  <tbody>{businessRows.map((row) => <tr key={row.customer}><td><strong>{row.customer}</strong></td><td>{row.need}</td><td>{row.vehicle}</td><td><span className={`business-status ${row.statusTone}`}>{row.status}</span></td><td><strong>{row.amount}</strong></td><td><button className={row.primary ? 'row-action primary' : 'row-action'} type="button" onClick={() => setToast(`${row.customer}：${row.next}`)}>{row.next}</button></td><td>{row.updated}</td><td><button className="row-more" aria-label={`${row.customer}更多操作`} type="button">•••</button></td></tr>)}</tbody>
                </table>
              </div>
              <button className="view-all" type="button" onClick={() => setToast('已加载全部业务跟进')}>查看全部 <ArrowRight size={14} /></button>
            </article>

            <div className="workbench-side-stack">
              <article className="workbench-card todo-card">
                <div className="workbench-card-heading"><h2>我的待办</h2><button type="button">全部⌄</button></div>
                <div className="todo-rows">{initialTodos.map((todo, index) => { const done = doneTodos.includes(index); return <button className={`todo-row ${done ? 'done' : ''}`} key={todo.text} type="button" onClick={() => setDoneTodos((items) => done ? items.filter((item) => item !== index) : [...items, index])}><span className="todo-box">{done ? <Check size={13} weight="bold" /> : null}</span><strong>{todo.text}</strong><em className={todo.day === '今天' ? 'today' : ''}>{todo.day}</em><time>{todo.time}</time></button> })}</div>
              </article>

              <article className="workbench-card pi-card">
                <div className="pi-heading"><Robot size={22} weight="fill" /><strong>Pi 助手</strong><span>用自然语言处理你的汽配工作</span></div>
                <form onSubmit={(event) => { event.preventDefault(); setToast('Pi 助手将在下一阶段接入业务数据') }}><input aria-label="询问 Pi 助手" defaultValue="查一下 95B698151H 的适配车型" /><button type="submit"><ArrowRight size={21} weight="bold" /></button></form>
                <div className="pi-suggestions"><button type="button">“对比 3 家供应商的价格”</button><button type="button">“生成一份报价单”</button><button type="button">“这个 OE 有替代号码？”</button></div>
              </article>
            </div>
          </section>

          <section className="workbench-bottom-grid">
            <article className="workbench-card quick-card"><div className="workbench-card-heading"><h2>快捷操作</h2></div><div className="quick-actions">{quickActions.map((item) => { const Icon = item.icon; return <button key={item.label} type="button" onClick={() => setToast(`${item.label}将在后续阶段接入`)}><span><Icon size={27} weight="bold" /></span><strong>{item.label}</strong></button> })}</div></article>
            <article className="workbench-card common-vehicles"><div className="workbench-card-heading"><h2>常用车型</h2><button type="button">管理 <ArrowRight size={14} /></button></div><div className="vehicle-tiles">{vehicles.map((vehicle) => <button key={vehicle.model} type="button" onClick={() => { setQuery(vehicle.model); setCommandOpen(true) }}><img src={assetPath(`assets/workbench/${vehicle.image}`)} alt={vehicle.model} /><strong>{vehicle.model}</strong><span>{vehicle.brand}</span></button>)}</div></article>
            <button className="quality-banner" type="button" onClick={() => setToast('品质配件专题将在后续阶段接入')}><img src={assetPath('assets/workbench/quality-banner.png')} alt="品质，是长期主义的答案" /></button>
          </section>
        </div>
      </main>

      {commandOpen ? <div className="workbench-command-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}><div className="workbench-command" role="dialog" aria-modal="true" aria-label="命令中心" onMouseDown={(event) => event.stopPropagation()}><div className="command-search"><MagnifyingGlass size={24} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 OE、配件、VIN、车型或客户..." /><kbd>Esc</kbd></div><span className="command-caption">{query ? `“${query}”的匹配结果` : '最近业务'}</span>{searchMatches.length ? searchMatches.map((row) => <button className="command-result" key={row.customer} type="button" onClick={() => { setCommandOpen(false); setToast(`已打开 ${row.customer} 的业务跟进`) }}><span><strong>{row.need}</strong><small>{row.customer} · {row.vehicle}</small></span><ArrowRight size={17} /></button>) : <div className="command-empty">暂未找到匹配结果</div>}</div></div> : null}
      {toast ? <div className="workbench-toast"><Check size={17} weight="bold" />{toast}</div> : null}
    </div>
  )
}
