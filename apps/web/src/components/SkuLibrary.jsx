import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
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
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Stack,
  X,
} from '@phosphor-icons/react'
import { skuRecords, skuStatusFilters } from '../data/skuMockData'
import { assetPath } from '../utils/assetPath'
import { WorkbenchSidebar } from './WorkbenchSidebar'
import { SkuEditor } from './SkuEditor'
import { SkuImportDialog } from './SkuImportDialog'
import { SkuQualityQueue } from './SkuQualityQueue'
import { SkuVersionDialog } from './SkuVersionDialog'
import { CatalogOperatorMenu } from './CatalogOperatorMenu'
import { SkuBulkActionDialog } from './SkuBulkActionDialog'
import { getCatalogDictionaries, getCatalogSku, listCatalogSkus } from '../services/catalogApi'
import '../sku-library.css'

const sources = [
  { id: 'epc', title: '从 EPC / VIN 创建', note: '保留目录、图组、位置与适配条件', icon: SealCheck, recommended: true },
  { id: 'oe', title: '从 OE 查询创建', note: '先核对编号关系与来源', icon: MagnifyingGlass },
  { id: 'import', title: '批量导入资料', note: '适合供应商表格与品牌目录', icon: FileArrowUp },
  { id: 'manual', title: '手工建立空白 SKU', note: '用于暂无外部来源的自有商品', icon: ClipboardText },
]

const changeActionLabels = {
  create_draft: '创建资料草稿', update_draft: '更新资料草稿', verify: '资料核验通过', submit_review: '提交资料审核',
  approve_review: '审核通过', reject_review: '退回修改', assign_review: '分配审核人', discontinue: '停用资料', reopen: '恢复为草稿',
  restore_version: '恢复历史版本', update_requires_review: '编辑后重新审核',
}
const pageSize = 30
const emptyRecord = {
  id: 'empty', code: '—', name: '暂无匹配资料', englishName: '', primaryOe: '—', brand: '—', category: '—', status: 'draft', statusLabel: '无结果',
  fitmentCount: 0, completeness: 0, source: '—', updated: '—', identifiers: [], fitments: [], evidence: { system: '—', catalog: '—', figure: '—', originalName: '—', syncedAt: '—', confidence: '待核验' },
  inventory: { available: '—', locked: '—', inbound: '—' }, price: { oemReference: '—', purchase: '—', sale: '—' }, changes: [], dataOrigin: 'empty', version: 0,
}

function changeTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export function SkuLibrary({ onNavigate, sidebarCollapsed, onToggleSidebar }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState(skuRecords[0].id)
  const [detailTab, setDetailTab] = useState('identity')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [versionDialogChange, setVersionDialogChange] = useState(null)
  const [bulkAction, setBulkAction] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [catalogSession, setCatalogSession] = useState(null)
  const [editorContext, setEditorContext] = useState(null)
  const [toast, setToast] = useState('')
  const [allRecords, setAllRecords] = useState(skuRecords)
  const [totalRecords, setTotalRecords] = useState(skuRecords.length)
  const [dataMode, setDataMode] = useState('loading')
  const [page, setPage] = useState(1)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusCounts, setStatusCounts] = useState({})
  const [dictionaries, setDictionaries] = useState({})

  const loadCatalog = useCallback(async () => {
    setDataMode('loading')
    try {
      const result = await listCatalogSkus({ query: debouncedQuery, status, page, pageSize })
      if (result.records.length) {
        setAllRecords(result.records)
        setTotalRecords(result.total)
        setStatusCounts(result.statusCounts || {})
        setSelectedId((current) => result.records.some((item) => item.id === current) ? current : result.records[0].id)
        setDataMode('live')
      } else if (!debouncedQuery && status === 'all' && page === 1) {
        setAllRecords(skuRecords)
        setTotalRecords(0)
        setStatusCounts({})
        setSelectedId(skuRecords[0].id)
        setDataMode('demo-empty')
      } else {
        setAllRecords([])
        setTotalRecords(0)
        setStatusCounts(result.statusCounts || {})
        setSelectedId('empty')
        setDataMode('live')
      }
    } catch {
      setAllRecords(skuRecords)
      setTotalRecords(skuRecords.length)
      setDataMode('demo-offline')
    }
  }, [debouncedQuery, page, status])

  useEffect(() => { loadCatalog() }, [loadCatalog])
  useEffect(() => {
    if (query.trim() === debouncedQuery) return undefined
    const timeout = window.setTimeout(() => { setPage(1); setDebouncedQuery(query.trim()) }, 260)
    return () => window.clearTimeout(timeout)
  }, [debouncedQuery, query])
  useEffect(() => { getCatalogDictionaries().then(setDictionaries).catch(() => setDictionaries({})) }, [])
  useEffect(() => {
    if (dataMode !== 'live' || selectedId === 'empty') return
    const summary = allRecords.find((item) => item.id === selectedId)
    if (!summary || summary.aggregate) return
    let active = true
    getCatalogSku(selectedId).then((detail) => {
      if (!active) return
      setAllRecords((current) => current.map((item) => item.id === detail.id ? detail : item))
    }).catch(() => { if (active) notify('详情加载失败，请稍后重试') })
    return () => { active = false }
  }, [allRecords, dataMode, selectedId])

  const records = useMemo(() => {
    if (dataMode === 'live' || dataMode === 'loading') return allRecords
    const keyword = query.trim().toLowerCase()
    return allRecords.filter((item) => {
      const statusMatches = status === 'all' || item.status === status
      const keywordMatches = !keyword || [item.code, item.name, item.englishName, item.primaryOe, item.brand, item.category, item.source].join(' ').toLowerCase().includes(keyword)
      return statusMatches && keywordMatches
    })
  }, [allRecords, dataMode, query, status])

  const selected = allRecords.find((item) => item.id === selectedId) || records[0] || allRecords[0] || emptyRecord
  const selectedRecords = records.filter((record) => selectedIds.includes(record.id))
  const hasCapability = (capability) => catalogSession?.capabilities?.includes(capability) ?? true
  const statusFilters = useMemo(() => skuStatusFilters.map((item) => ({
    ...item,
    count: dataMode === 'live'
      ? item.id === 'all' ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0) : statusCounts[item.id] || 0
      : item.id === 'all' ? allRecords.length : allRecords.filter((record) => record.status === item.id).length,
  })), [allRecords, dataMode, statusCounts])
  const overallCount = dataMode === 'live' ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0) : allRecords.length
  const verifiedCount = dataMode === 'live' ? statusCounts.verified || 0 : allRecords.filter((item) => item.status === 'verified').length
  const verifiedPercent = overallCount ? Math.round((verifiedCount / overallCount) * 100) : 0

  const notify = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const handleSaved = (saved) => {
    const previous = allRecords.find((item) => item.id === saved.id)
    setAllRecords((current) => {
      const exists = current.some((item) => item.id === saved.id)
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.filter((item) => item.dataOrigin === 'live')]
    })
    setSelectedId(saved.id)
    setDataMode('live')
    setTotalRecords((current) => current + (allRecords.some((item) => item.id === saved.id) ? 0 : 1))
    setStatusCounts((current) => {
      const next = { ...current }
      if (previous?.status && previous.status !== saved.status) next[previous.status] = Math.max(0, (next[previous.status] || 0) - 1)
      if (!previous || previous.status !== saved.status) next[saved.status] = (next[saved.status] || 0) + 1
      return next
    })
  }

  const openSelectedEditor = async () => {
    if (selected.dataOrigin === 'empty' || !hasCapability('catalog.edit')) return
    let record = selected
    if (selected.dataOrigin === 'live' && !selected.aggregate) {
      try {
        record = await getCatalogSku(selected.id)
        setAllRecords((current) => current.map((item) => item.id === record.id ? record : item))
      } catch {
        notify('完整资料加载失败，暂时不能编辑')
        return
      }
    }
    setEditorContext({ source: 'epc', record })
  }

  if (editorContext) {
    return (
      <div className={`workbench-home sku-workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <WorkbenchSidebar active="sku" collapsed={sidebarCollapsed} onToggle={onToggleSidebar} onNavigate={onNavigate} onUnavailable={(label) => notify(`${label}将在后续业务阶段接入`)} />
        <SkuEditor source={editorContext.source} record={editorContext.record} dictionaries={dictionaries} onBack={() => setEditorContext(null)} onNotify={notify} onSaved={handleSaved} />
        {toast ? <div className="workbench-toast"><Check size={17} weight="bold" />{toast}</div> : null}
      </div>
    )
  }

  if (qualityOpen) {
    return (
      <div className={`workbench-home sku-workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <WorkbenchSidebar active="sku" collapsed={sidebarCollapsed} onToggle={onToggleSidebar} onNavigate={onNavigate} onUnavailable={(label) => notify(`${label}将在后续业务阶段接入`)} />
        <SkuQualityQueue capabilities={catalogSession?.capabilities || ['catalog.edit', 'catalog.submit', 'catalog.review', 'catalog.assign', 'catalog.lifecycle']} onBack={() => { setQualityOpen(false); loadCatalog() }} onEdit={(record) => { setQualityOpen(false); setEditorContext({ source: 'epc', record }) }} onSaved={handleSaved} onNotify={notify} />
        {toast ? <div className="workbench-toast"><Check size={17} weight="bold" />{toast}</div> : null}
      </div>
    )
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
            <CatalogOperatorMenu onSession={(next) => { setCatalogSession(next); setSelectedIds([]) }} />
          </div>
        </header>

        <div className="sku-content">
          <section className="sku-toolbar" aria-label="SKU 搜索和操作">
            <div className="sku-searchbox"><MagnifyingGlass size={25} weight="bold" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、OE 号、配件名称、品牌或适配车型" /><kbd>Ctrl K</kbd></div>
            <button className="sku-secondary-action" type="button" onClick={() => setQualityOpen(true)}><ShieldCheck size={20} weight="bold" />质量审核</button>
            <button className="sku-secondary-action" type="button" disabled={!hasCapability('catalog.import')} onClick={() => setImportOpen(true)}><FileArrowUp size={20} weight="bold" />批量导入</button>
            <button className="sku-primary-action" type="button" disabled={!hasCapability('catalog.edit')} onClick={() => setSourceOpen(true)}><Plus size={21} weight="bold" />新建 SKU</button>
          </section>

          <section className="sku-summarybar">
            <div className="sku-filter-tabs">
              {statusFilters.map((item) => <button type="button" className={status === item.id ? 'active' : ''} key={item.id} onClick={() => { setPage(1); setStatus(item.id) }}><span>{item.label}</span><b>{item.count}</b></button>)}
            </div>
            <div className="sku-summary-note"><SealCheck size={18} weight="fill" /><span><strong>{verifiedPercent}%</strong> 已完成来源核验</span><i /> <span><strong>{Math.max(0, allRecords.length - verifiedCount)}</strong> 条待处理</span></div>
          </section>

          <section className="sku-splitview">
            <article className="sku-list-panel">
              <div className={`sku-list-heading ${selectedRecords.length ? 'selection-active' : ''}`}>
                {selectedRecords.length ? <div className="sku-bulk-bar"><strong>已选 {selectedRecords.length} 条</strong><button type="button" disabled={!hasCapability('catalog.submit') || selectedRecords.some((item) => item.status !== 'draft')} onClick={() => setBulkAction('submit_review')}>提交审核</button><button type="button" disabled={!hasCapability('catalog.assign') || selectedRecords.some((item) => item.status !== 'review')} onClick={() => setBulkAction('assign_review')}>分配审核人</button><button type="button" disabled={!hasCapability('catalog.lifecycle') || selectedRecords.some((item) => item.status !== 'verified')} onClick={() => setBulkAction('discontinue')}>停用资料</button><button type="button" onClick={() => setSelectedIds([])}>取消选择</button></div> : <><div><h2>零件资料</h2><span>{dataMode === 'live' ? `当前显示 ${records.length} 条真实资料` : dataMode === 'loading' ? '正在连接资料库…' : `当前显示 ${records.length} 条演示资料`}</span></div><div><button type="button" onClick={() => notify('高级筛选将在字段字典接入后开放')}><Funnel size={17} weight="bold" />筛选</button><button type="button" onClick={() => notify('当前采用已确定的表格 + 详情视图')}><SlidersHorizontal size={17} weight="bold" />视图</button></div></>}
              </div>
              <div className="sku-table-wrap">
                <table className="sku-table">
                  <thead><tr><th className="sku-select-cell"><input type="checkbox" aria-label="选择当前页全部 SKU" disabled={dataMode !== 'live' || !records.length} checked={Boolean(records.length) && selectedRecords.length === records.length} onChange={(event) => setSelectedIds(event.target.checked ? records.map((record) => record.id) : [])} /></th><th>SKU / 配件名称</th><th>主 OE</th><th>品牌 / 分类</th><th>适配</th><th>资料状态</th><th>更新时间</th></tr></thead>
                  <tbody>
                    {records.map((item) => (
                      <tr className={selected.id === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedId(item.id)}>
                        <td className="sku-select-cell"><input type="checkbox" aria-label={`选择 ${item.name}`} disabled={dataMode !== 'live'} checked={selectedIds.includes(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
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
              <footer className="sku-list-footer"><span>{dataMode === 'live' ? `共 ${totalRecords} 条 SKU · 第 ${page} 页` : dataMode === 'demo-empty' ? '真实资料库为空，当前为演示数据' : dataMode === 'demo-offline' ? 'API 未连接，当前为演示数据' : '正在读取资料库'}</span><div><button type="button" disabled={dataMode !== 'live' || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><b>{page}</b><button type="button" disabled={dataMode !== 'live' || page * pageSize >= totalRecords} onClick={() => setPage((current) => current + 1)}>下一页</button></div></footer>
            </article>

            <aside className="sku-inspector">
              <div className="sku-inspector-head">
                <div className="sku-inspector-kicker"><span className={`sku-state ${selected.status}`}>{selected.statusLabel}</span><span>{selected.completeness}% 完整</span></div>
                <h2>{selected.name}</h2><p>{selected.englishName}</p>
                <div className="sku-inspector-code"><span>SKU</span><strong>{selected.code}</strong><button type="button" onClick={async () => { await navigator.clipboard?.writeText(selected.code); notify('SKU 编码已复制') }}><ClipboardText size={17} /></button></div>
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
                  <section className="inspector-section"><div className="inspector-section-title"><h3>库存概览</h3><span>{selected.dataOrigin === 'live' ? '尚未接入' : '演示数据'}</span></div><div className="inventory-grid"><div><span>可用</span><strong>{selected.inventory.available}</strong></div><div><span>已锁定</span><strong>{selected.inventory.locked}</strong></div><div><span>在途</span><strong>{selected.inventory.inbound}</strong></div></div></section>
                  <section className="inspector-section"><div className="inspector-section-title"><h3>价格信息</h3><span>{selected.dataOrigin === 'live' ? '尚未接入' : '人民币含税'}</span></div><div className="price-row"><span>OEM 参考价<small>来源只读</small></span><strong>{selected.price.oemReference}</strong></div><div className="price-row"><span>最近采购价</span><strong>{selected.price.purchase}</strong></div><div className="price-row"><span>建议销售价</span><strong>{selected.price.sale}</strong></div></section>
                </> : null}
                {detailTab === 'history' ? <section className="inspector-section history-list"><div className="inspector-section-title"><h3>最近变更</h3><span>版本 {selected.version || 1}</span></div>{selected.dataOrigin === 'live' ? selected.changes.map((change) => <button type="button" key={change.id || `${change.version}-${change.action}`} onClick={() => setVersionDialogChange(change)}><CheckCircle size={19} weight="fill" /><span><strong>v{change.version} · {changeActionLabels[change.action] || change.action}</strong><small>{change.changedBy || '系统操作员'} · {changeTime(change.changedAt)}</small></span><ArrowRight size={15} /></button>) : <><div><CheckCircle size={19} weight="fill" /><span><strong>来源核验通过</strong><small>演示记录</small></span></div><div><ClockCounterClockwise size={19} /><span><strong>更新适配条件</strong><small>演示记录</small></span></div><div><Stack size={19} /><span><strong>同步 EPC 原始记录</strong><small>演示记录</small></span></div></>}{selected.dataOrigin === 'live' && !selected.changes.length ? <div><ClockCounterClockwise size={19} /><span><strong>暂无变更记录</strong><small>保存后将在此显示</small></span></div> : null}</section> : null}
              </div>
              <footer className="sku-inspector-actions"><button type="button" disabled={selected.dataOrigin === 'empty'} onClick={() => notify('当前右侧已展示完整身份资料')}>查看完整资料</button><button type="button" disabled={selected.dataOrigin === 'empty' || !hasCapability('catalog.edit')} onClick={openSelectedEditor}>编辑 SKU</button></footer>
            </aside>
          </section>
        </div>
      </main>

      {sourceOpen ? <div className="sku-modal-backdrop" onMouseDown={() => setSourceOpen(false)}><div className="sku-source-modal" role="dialog" aria-modal="true" aria-label="选择 SKU 创建来源" onMouseDown={(event) => event.stopPropagation()}><header><div><span><Sparkle size={22} weight="fill" /></span><div><h2>选择 SKU 创建来源</h2><p>优先从可追溯的数据生成，后续核验更快、更可靠。</p></div></div><button type="button" aria-label="关闭" onClick={() => setSourceOpen(false)}><X size={21} weight="bold" /></button></header><div className="sku-source-list">{sources.map((source) => { const Icon = source.icon; return <button type="button" key={source.id} onClick={() => { setSourceOpen(false); setEditorContext({ source: source.id }) }}><span className="source-icon"><Icon size={25} weight="duotone" /></span><span><strong>{source.title}{source.recommended ? <em>推荐</em> : null}</strong><small>{source.note}</small></span><ArrowRight size={18} weight="bold" /></button> })}</div><footer>草稿将写入新资料库；核验前不会进入正式可用状态。</footer></div></div> : null}
      {importOpen ? <SkuImportDialog onClose={() => setImportOpen(false)} onCompleted={() => loadCatalog()} onNotify={notify} /> : null}
      {versionDialogChange && selected.dataOrigin === 'live' ? <SkuVersionDialog record={selected} initialChange={versionDialogChange} canRestore={hasCapability('catalog.restore')} onClose={() => setVersionDialogChange(null)} onRestored={handleSaved} onNotify={notify} /> : null}
      {bulkAction ? <SkuBulkActionDialog records={selectedRecords} action={bulkAction} onClose={() => setBulkAction('')} onCompleted={() => { setSelectedIds([]); loadCatalog() }} onNotify={notify} /> : null}
      {toast ? <div className="workbench-toast"><Check size={17} weight="bold" />{toast}</div> : null}
    </div>
  )
}
