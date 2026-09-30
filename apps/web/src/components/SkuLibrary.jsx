import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Cube,
  FileArrowUp,
  Funnel,
  MagnifyingGlass,
  Plus,
  SealCheck,
  SlidersHorizontal,
  Sparkle,
  Stack,
  X,
} from '@phosphor-icons/react'
import { skuRecords, skuStatusFilters } from '../data/skuMockData'
import { assetPath } from '../utils/assetPath'
import { WorkbenchSidebar } from './WorkbenchSidebar'
import '../sku-library.css'

const sources = [
  { id: 'epc', title: '从 EPC / VIN 创建', note: '保留目录、图组、位置与适配条件', icon: SealCheck, recommended: true },
  { id: 'oe', title: '从 OE 查询创建', note: '先核对编号关系与来源', icon: MagnifyingGlass },
  { id: 'import', title: '批量导入资料', note: '适合供应商表格与品牌目录', icon: FileArrowUp },
  { id: 'manual', title: '手工建立空白 SKU', note: '用于暂无外部来源的自有商品', icon: ClipboardText },
]

export function SkuLibrary({ onNavigate, sidebarCollapsed, onToggleSidebar }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState(skuRecords[0].id)
  const [detailTab, setDetailTab] = useState('identity')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [toast, setToast] = useState('')

  const records = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return skuRecords.filter((item) => {
      const statusMatches = status === 'all' || item.status === status
      const keywordMatches = !keyword || [item.code, item.name, item.englishName, item.primaryOe, item.brand, item.category, item.source].join(' ').toLowerCase().includes(keyword)
      return statusMatches && keywordMatches
    })
  }, [query, status])

  const selected = skuRecords.find((item) => item.id === selectedId) || records[0] || skuRecords[0]

  const notify = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  return (
    <div className={`workbench-home sku-workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <WorkbenchSidebar active="sku" collapsed={sidebarCollapsed} onToggle={onToggleSidebar} onNavigate={onNavigate} onUnavailable={(label) => notify(`${label}将在后续业务阶段接入`)} />
      <main className="sku-main">
        <header className="sku-topbar">
          <div className="sku-titleblock">
            <button type="button" aria-label="返回工作台" onClick={() => onNavigate?.('home')}><ArrowLeft size={20} weight="bold" /></button>
            <div><h1>SKU 资料库</h1><p>统一管理零件身份、适配关系与来源证据</p></div>
          </div>
          <div className="sku-profile">
            <button type="button" aria-label="通知"><Bell size={23} weight="bold" /><i /></button>
            <img src={assetPath('assets/workbench/avatar.png')} alt="虎山行头像" />
            <strong>虎山行</strong><CaretDown size={15} weight="bold" />
          </div>
        </header>

        <div className="sku-content">
          <section className="sku-toolbar" aria-label="SKU 搜索和操作">
            <div className="sku-searchbox"><MagnifyingGlass size={25} weight="bold" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、OE 号、配件名称、品牌或适配车型" /><kbd>Ctrl K</kbd></div>
            <button className="sku-secondary-action" type="button" onClick={() => notify('批量导入将在数据模板确认后接入')}><FileArrowUp size={20} weight="bold" />批量导入</button>
            <button className="sku-primary-action" type="button" onClick={() => setSourceOpen(true)}><Plus size={21} weight="bold" />新建 SKU</button>
          </section>

          <section className="sku-summarybar">
            <div className="sku-filter-tabs">
              {skuStatusFilters.map((item) => <button type="button" className={status === item.id ? 'active' : ''} key={item.id} onClick={() => setStatus(item.id)}><span>{item.label}</span><b>{item.count}</b></button>)}
            </div>
            <div className="sku-summary-note"><SealCheck size={18} weight="fill" /><span><strong>85%</strong> 已完成来源核验</span><i /> <span><strong>126</strong> 条待处理</span></div>
          </section>

          <section className="sku-splitview">
            <article className="sku-list-panel">
              <div className="sku-list-heading">
                <div><h2>零件资料</h2><span>当前显示 {records.length} 条模拟记录</span></div>
                <div><button type="button"><Funnel size={17} weight="bold" />筛选</button><button type="button"><SlidersHorizontal size={17} weight="bold" />视图</button></div>
              </div>
              <div className="sku-table-wrap">
                <table className="sku-table">
                  <thead><tr><th>SKU / 配件名称</th><th>主 OE</th><th>品牌 / 分类</th><th>适配</th><th>资料状态</th><th>更新时间</th></tr></thead>
                  <tbody>
                    {records.map((item) => (
                      <tr className={selected.id === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedId(item.id)}>
                        <td><span className="sku-part-cell"><span className="sku-part-icon"><Cube size={24} weight="duotone" /></span><span><strong>{item.name}</strong><small>{item.code}</small></span></span></td>
                        <td><b className="sku-oe">{item.primaryOe}</b></td>
                        <td><strong>{item.brand}</strong><small>{item.category}</small></td>
                        <td><strong>{item.fitmentCount} 个车型</strong><small>已关联适配条件</small></td>
                        <td><span className={`sku-state ${item.status}`}>{item.statusLabel}</span><small className="sku-completeness">完整度 {item.completeness}%</small></td>
                        <td><span>{item.updated}</span><small>{item.source}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!records.length ? <div className="sku-empty"><MagnifyingGlass size={34} /><strong>没有找到匹配的 SKU</strong><span>尝试更换关键词或状态筛选</span></div> : null}
              </div>
              <footer className="sku-list-footer"><span>共 1,286 条 SKU</span><div><button type="button" disabled>上一页</button><b>1</b><button type="button">2</button><button type="button">3</button><button type="button">下一页</button></div></footer>
            </article>

            <aside className="sku-inspector">
              <div className="sku-inspector-head">
                <div className="sku-inspector-kicker"><span className={`sku-state ${selected.status}`}>{selected.statusLabel}</span><span>{selected.completeness}% 完整</span></div>
                <h2>{selected.name}</h2><p>{selected.englishName}</p>
                <div className="sku-inspector-code"><span>SKU</span><strong>{selected.code}</strong><button type="button" onClick={() => notify('SKU 编码已复制')}><ClipboardText size={17} /></button></div>
              </div>
              <div className="sku-inspector-tabs">
                <button className={detailTab === 'identity' ? 'active' : ''} type="button" onClick={() => setDetailTab('identity')}>身份与适配</button>
                <button className={detailTab === 'business' ? 'active' : ''} type="button" onClick={() => setDetailTab('business')}>库存与价格</button>
                <button className={detailTab === 'history' ? 'active' : ''} type="button" onClick={() => setDetailTab('history')}>变更记录</button>
              </div>
              <div className="sku-inspector-body">
                {detailTab === 'identity' ? <>
                  <section className="inspector-section"><div className="inspector-section-title"><h3>编号关系</h3><button type="button">查看全部</button></div>{selected.identifiers.map((identifier) => <div className="identifier-row" key={identifier.value}><span>{identifier.type}</span><strong>{identifier.value}</strong><em>{identifier.relation}</em></div>)}</section>
                  <section className="inspector-section"><div className="inspector-section-title"><h3>适配车型</h3><span>{selected.fitmentCount} 项</span></div>{selected.fitments.map((fitment) => <div className="fitment-row" key={`${fitment.vehicle}-${fitment.years}`}><span className="fitment-line"><strong>{fitment.vehicle}</strong><b>{fitment.years}</b></span><small>{fitment.condition}</small></div>)}{selected.fitmentCount > selected.fitments.length ? <button className="inspector-more" type="button">再查看 {selected.fitmentCount - selected.fitments.length} 项适配 <ArrowRight size={14} /></button> : null}</section>
                  <section className="inspector-section evidence-card"><div className="inspector-section-title"><h3><SealCheck size={18} weight="fill" />来源证据</h3><span className={`confidence ${selected.evidence.confidence}`}>{selected.evidence.confidence}可信</span></div><dl><div><dt>来源系统</dt><dd>{selected.evidence.system}</dd></div><div><dt>目录 / 图组</dt><dd>{selected.evidence.catalog}</dd></div><div><dt>图例位置</dt><dd>{selected.evidence.figure}</dd></div><div className="wide"><dt>原始名称</dt><dd>{selected.evidence.originalName}</dd></div><div className="wide"><dt>同步时间</dt><dd>{selected.evidence.syncedAt}</dd></div></dl></section>
                </> : null}
                {detailTab === 'business' ? <>
                  <section className="inspector-section"><div className="inspector-section-title"><h3>库存概览</h3><span>模拟数据</span></div><div className="inventory-grid"><div><span>可用</span><strong>{selected.inventory.available}</strong></div><div><span>已锁定</span><strong>{selected.inventory.locked}</strong></div><div><span>在途</span><strong>{selected.inventory.inbound}</strong></div></div></section>
                  <section className="inspector-section"><div className="inspector-section-title"><h3>价格信息</h3><span>人民币含税</span></div><div className="price-row"><span>OEM 参考价<small>来源只读</small></span><strong>{selected.price.oemReference}</strong></div><div className="price-row"><span>最近采购价</span><strong>{selected.price.purchase}</strong></div><div className="price-row"><span>建议销售价</span><strong>{selected.price.sale}</strong></div></section>
                </> : null}
                {detailTab === 'history' ? <section className="inspector-section history-list"><div className="inspector-section-title"><h3>最近变更</h3><span>版本 12</span></div><div><CheckCircle size={19} weight="fill" /><span><strong>来源核验通过</strong><small>系统操作员 · 今天 10:28</small></span></div><div><ClockCounterClockwise size={19} /><span><strong>更新 2 条适配条件</strong><small>系统操作员 · 昨天 17:42</small></span></div><div><Stack size={19} /><span><strong>同步 EPC 原始记录</strong><small>数据任务 · 09-28 09:16</small></span></div></section> : null}
              </div>
              <footer className="sku-inspector-actions"><button type="button" onClick={() => notify('已打开完整资料预览')}>查看完整资料</button><button type="button" onClick={() => notify('编辑能力将在下一开发阶段接入')}>编辑 SKU</button></footer>
            </aside>
          </section>
        </div>
      </main>

      {sourceOpen ? <div className="sku-modal-backdrop" onMouseDown={() => setSourceOpen(false)}><div className="sku-source-modal" role="dialog" aria-modal="true" aria-label="选择 SKU 创建来源" onMouseDown={(event) => event.stopPropagation()}><header><div><span><Sparkle size={22} weight="fill" /></span><div><h2>选择 SKU 创建来源</h2><p>优先从可追溯的数据生成，后续核验更快、更可靠。</p></div></div><button type="button" aria-label="关闭" onClick={() => setSourceOpen(false)}><X size={21} weight="bold" /></button></header><div className="sku-source-list">{sources.map((source) => { const Icon = source.icon; return <button type="button" key={source.id} onClick={() => { setSourceOpen(false); notify(`${source.title}将在下一开发阶段接入`) }}><span className="source-icon"><Icon size={25} weight="duotone" /></span><span><strong>{source.title}{source.recommended ? <em>推荐</em> : null}</strong><small>{source.note}</small></span><ArrowRight size={18} weight="bold" /></button> })}</div><footer>当前为视觉与交互原型，不会写入真实数据库。</footer></div></div> : null}
      {toast ? <div className="workbench-toast"><Check size={17} weight="bold" />{toast}</div> : null}
    </div>
  )
}
