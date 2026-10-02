import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowsLeftRight, Check, CheckCircle, ClockCounterClockwise, Cube, Database,
  MagnifyingGlass, ShieldCheck, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import { commitLegacySkuMigration, getLegacySkuMigrationPreview } from '../services/catalogApi'
import '../sku-legacy-migration.css'

const filters = [
  { id: 'all', label: '全部' },
  { id: 'recommended', label: '建议迁移' },
  { id: 'blocked', label: '存在阻断' },
  { id: 'migrated', label: '已迁移' },
]

function formatTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function stateLabel(item) {
  if (item.migrated) return item.migrated.sourceChanged ? '来源有更新' : '已迁移'
  if (item.blocking) return '需先处理'
  return item.issues.length ? '可迁移·需复核' : '可直接迁移'
}

export function SkuLegacyMigration({ capabilities = [], onBack, onCompleted, onNotify }) {
  const [preview, setPreview] = useState({ items: [], summary: {} })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [reason, setReason] = useState('经人工预览确认，将合格旧 SKU 转为新资料库草稿')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const canImport = capabilities.includes('catalog.import')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getLegacySkuMigrationPreview({ query, pageSize: 100 })
      setPreview(data)
      setSelectedId((current) => data.items.some((item) => item.legacySkuId === current) ? current : data.items[0]?.legacySkuId || '')
      setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.legacySkuId === id && item.recommended)))
    } catch (requestError) {
      setError(requestError.message || '旧资料预览加载失败')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timeout = window.setTimeout(load, 220)
    return () => window.clearTimeout(timeout)
  }, [load])

  const visibleItems = useMemo(() => preview.items.filter((item) => {
    if (filter === 'recommended') return item.recommended
    if (filter === 'blocked') return !item.migrated && item.blocking
    if (filter === 'migrated') return Boolean(item.migrated)
    return true
  }), [filter, preview.items])
  const selected = preview.items.find((item) => item.legacySkuId === selectedId) || visibleItems[0] || null
  const selectedItems = preview.items.filter((item) => selectedIds.includes(item.legacySkuId) && item.recommended)
  const selectableVisible = visibleItems.filter((item) => item.recommended)

  const toggleAll = (checked) => {
    const visibleSet = new Set(selectableVisible.map((item) => item.legacySkuId))
    setSelectedIds((current) => checked ? [...new Set([...current, ...visibleSet])] : current.filter((id) => !visibleSet.has(id)))
  }

  const submit = async () => {
    if (!selectedItems.length || !reason.trim() || !canImport) return
    setSubmitting(true)
    setError('')
    try {
      const nextResult = await commitLegacySkuMigration(selectedItems, reason.trim())
      setResult(nextResult)
      setSelectedIds([])
      await load()
      onNotify?.(`迁移完成：${nextResult.summary.migrated} 条已生成草稿`)
      onCompleted?.(nextResult)
    } catch (requestError) {
      setError(requestError.message || '迁移提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="legacy-migration-main">
      <header className="legacy-migration-topbar">
        <div>
          <button type="button" aria-label="返回 SKU 资料库" onClick={onBack}><ArrowLeft size={20} weight="bold" /></button>
          <span><h1>旧 SKU 迁移预览</h1><p>旧资料保持不变；仅将人工选中的记录生成新资料库草稿</p></span>
        </div>
        <span className="legacy-migration-safety"><ShieldCheck size={19} weight="fill" />可回查 · 不覆盖 · 不自动发布</span>
      </header>

      <div className="legacy-migration-content">
        <section className="legacy-migration-metrics" aria-label="迁移概览">
          <div><span>旧资料总数</span><strong>{preview.summary.total ?? '—'}</strong><small>当前迁移范围</small></div>
          <div className="accent"><span>建议迁移</span><strong>{preview.summary.recommended ?? '—'}</strong><small>无阻断风险</small></div>
          <div><span>需先处理</span><strong>{preview.summary.blocked ?? '—'}</strong><small>编号或字段冲突</small></div>
          <div><span>已迁移</span><strong>{preview.summary.migrated ?? '—'}</strong><small>已生成草稿</small></div>
          <div><span>来源有更新</span><strong>{preview.summary.sourceChanged ?? '—'}</strong><small>需重新核对</small></div>
        </section>

        <section className="legacy-migration-toolbar">
          <label><MagnifyingGlass size={20} weight="bold" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索旧 SKU、OE、名称、品牌" /></label>
          <nav>{filters.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</nav>
          <button type="button" className="legacy-select-recommended" disabled={!canImport || !preview.summary.recommended} onClick={() => setSelectedIds(preview.items.filter((item) => item.recommended).map((item) => item.legacySkuId))}><Check size={17} weight="bold" />选择全部建议项</button>
        </section>

        <section className="legacy-migration-workspace">
          <article className="legacy-migration-list">
            <div className="legacy-migration-list-head"><span><input type="checkbox" aria-label="选择当前可迁移记录" disabled={!canImport || !selectableVisible.length} checked={Boolean(selectableVisible.length) && selectableVisible.every((item) => selectedIds.includes(item.legacySkuId))} onChange={(event) => toggleAll(event.target.checked)} /></span><span>旧 SKU / 配件名称</span><span>目标映射</span><span>关联数据</span><span>迁移判断</span></div>
            <div className="legacy-migration-rows">
              {visibleItems.map((item) => (
                <button type="button" className={`legacy-migration-row ${selected?.legacySkuId === item.legacySkuId ? 'active' : ''}`} key={item.legacySkuId} onClick={() => setSelectedId(item.legacySkuId)}>
                  <span onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${item.legacy.name}`} disabled={!canImport || !item.recommended} checked={selectedIds.includes(item.legacySkuId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.legacySkuId] : current.filter((id) => id !== item.legacySkuId))} /></span>
                  <span className="legacy-part"><i><Cube size={22} weight="duotone" /></i><b>{item.legacy.name || '未命名零件'}<small>{item.legacy.skuCode}</small></b></span>
                  <span><b>{item.target.identity.brandLabel || '待补充'}</b><small>{item.target.identity.categoryLabel || '待补充分类'}</small></span>
                  <span><b>{item.legacy.identifierCount} 个编号</b><small>{item.legacy.fitmentCount} 条适配 · {item.legacy.oeRelationCount} 个关系</small></span>
                  <span><em className={item.migrated ? 'done' : item.blocking ? 'blocked' : item.issues.length ? 'review' : 'ready'}>{stateLabel(item)}</em><small>{item.issues.length ? `${item.issues.length} 项提示` : '字段映射完整'}</small></span>
                </button>
              ))}
              {!loading && !visibleItems.length ? <div className="legacy-migration-empty"><Database size={34} /><strong>当前筛选下没有记录</strong><span>可以切换筛选条件或调整搜索词。</span></div> : null}
              {loading ? <div className="legacy-migration-empty"><ClockCounterClockwise size={34} /><strong>正在检查旧资料</strong><span>正在比对字段、编号与来源快照。</span></div> : null}
            </div>
          </article>

          <aside className="legacy-migration-inspector">
            {selected ? <>
              <header><span className="legacy-migration-inspector-state">{stateLabel(selected)}</span><h2>{selected.legacy.name}</h2><p>{selected.legacy.skuCode} · 更新于 {formatTime(selected.legacy.updatedAt)}</p></header>
              <div className="legacy-migration-inspector-body">
                <section><h3><ArrowsLeftRight size={18} />字段映射</h3><dl>
                  <div><dt>品牌</dt><dd><span>{selected.legacy.brand || '—'}</span><b>→</b><strong>{selected.target.identity.brandLabel || '待补充'}</strong></dd></div>
                  <div><dt>分类</dt><dd><span>{selected.legacy.category || '—'}</span><b>→</b><strong>{selected.target.identity.categoryLabel || '待补充'}</strong></dd></div>
                  <div><dt>单位</dt><dd><span>{selected.legacy.unit || '—'}</span><b>→</b><strong>{selected.target.identity.unitLabel}</strong></dd></div>
                  <div><dt>状态</dt><dd><span>{selected.legacy.lifecycleStatus}</span><b>→</b><strong>草稿 · 未核验</strong></dd></div>
                </dl></section>
                <section><h3><Database size={18} />将写入的编号</h3><div className="legacy-identifier-list">{selected.target.identifiers.map((item) => <span key={`${item.type}-${item.normalizedValue}`}><b>{item.isPrimary ? '主编号' : item.type.toUpperCase()}</b><strong>{item.rawValue}</strong><small>{item.verificationStatus === 'pending' ? '待核验' : item.verificationStatus}</small></span>)}</div></section>
                <section><h3><WarningCircle size={18} />检查结果</h3>{selected.issues.length ? <div className="legacy-issue-list">{selected.issues.map((issue) => <div className={issue.blocking ? 'blocking' : ''} key={issue.code}>{issue.blocking ? <XCircle size={17} weight="fill" /> : <WarningCircle size={17} weight="fill" />}<span><strong>{issue.blocking ? '阻止迁移' : '迁移后复核'}</strong><small>{issue.label}</small></span></div>)}</div> : <div className="legacy-all-clear"><CheckCircle size={20} weight="fill" /><span><strong>未发现风险项</strong><small>仍将以草稿状态进入资料库。</small></span></div>}</section>
                <section className="legacy-preservation-note"><ShieldCheck size={20} weight="fill" /><span><strong>旧资料不会被修改</strong><small>完整旧记录、OE 关系、适配条件和图片地址会写入不可变来源快照。</small></span></section>
              </div>
            </> : <div className="legacy-migration-empty"><Database size={34} /><strong>选择一条旧资料</strong><span>在这里核对映射和风险。</span></div>}
          </aside>
        </section>

        <footer className="legacy-migration-footer">
          <div><strong>已选择 {selectedItems.length} 条</strong><span>只会生成草稿，之后仍需在质量审核中逐条核验。</span></div>
          <label><span>迁移原因</span><input value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canImport || submitting} /></label>
          <button type="button" disabled={!canImport || !selectedItems.length || !reason.trim() || submitting} onClick={submit}>{submitting ? '正在生成草稿…' : `确认迁移 ${selectedItems.length} 条`}</button>
        </footer>
        {error ? <div className="legacy-migration-error"><XCircle size={18} weight="fill" />{error}</div> : null}
        {result ? <div className="legacy-migration-result"><CheckCircle size={18} weight="fill" />批次已完成：成功 {result.summary.migrated}，跳过 {result.summary.skipped}，失败 {result.summary.failed}</div> : null}
      </div>
    </main>
  )
}
