import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowsLeftRight, Check, CheckCircle, ClockCounterClockwise, Cube, Database,
  MagnifyingGlass, ShieldCheck, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import {
  commitLegacyMigrationPlan, createLegacyMigrationPlan, getCatalogDictionaries, getLegacyMigrationPlan,
  getLegacySkuMigrationPreview, listLegacyMigrationPlans, reviewLegacyMigrationPlan,
} from '../services/catalogApi'
import '../sku-legacy-migration.css'

const filters = [
  { id: 'all', label: '全部' }, { id: 'recommended', label: '建议迁移' },
  { id: 'blocked', label: '存在阻断' }, { id: 'migrated', label: '已迁移' },
]
const planStateLabels = { submitted: '待审核', approved: '已批准', committing: '执行中', rejected: '已退回', committed: '已执行', cancelled: '已取消' }
const planEventLabels = { submitted: '提交方案', approved: '批准方案', rejected: '退回方案', commit_started: '开始执行', committed: '执行完成', commit_failed: '执行失败' }

function formatTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function stateLabel(item) {
  if (item.migrated) return item.migrated.sourceChanged ? '来源有更新' : '已迁移'
  if (item.blocking) return '需先处理'
  return item.issues.length ? '可迁移·需复核' : '可直接迁移'
}

function dictionaryOptions(dictionaries, code) {
  return (dictionaries?.[code]?.items || []).filter((item) => item.enabled !== false && item.value !== '__all__')
}

export function SkuLegacyMigration({ session = null, capabilities = [], onBack, onCompleted, onNotify }) {
  const [surface, setSurface] = useState('preview')
  const [preview, setPreview] = useState({ items: [], summary: {} })
  const [plans, setPlans] = useState([])
  const [planDetail, setPlanDetail] = useState(null)
  const [dictionaries, setDictionaries] = useState({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [decisions, setDecisions] = useState({})
  const [reason, setReason] = useState('经人工核对，将合格旧 SKU 提交为新资料库迁移方案')
  const [reviewNote, setReviewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const canPlan = capabilities.includes('catalog.migration.plan')
  const canReview = capabilities.includes('catalog.migration.review')
  const canExecute = capabilities.includes('catalog.migration.execute')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [data, nextPlans, nextDictionaries] = await Promise.all([
        getLegacySkuMigrationPreview({ query, pageSize: 100 }), listLegacyMigrationPlans(), getCatalogDictionaries(),
      ])
      setPreview(data); setPlans(nextPlans.items || []); setDictionaries(nextDictionaries)
      setSelectedId((current) => data.items.some((item) => item.legacySkuId === current) ? current : data.items[0]?.legacySkuId || '')
      setDecisions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => data.items.some((item) => item.legacySkuId === id && !item.migrated))))
    } catch (requestError) { setError(requestError.message || '旧资料预览加载失败') } finally { setLoading(false) }
  }, [query])

  useEffect(() => { const timeout = window.setTimeout(load, 220); return () => window.clearTimeout(timeout) }, [load])

  const visibleItems = useMemo(() => preview.items.filter((item) => {
    if (filter === 'recommended') return item.recommended
    if (filter === 'blocked') return !item.migrated && item.blocking
    if (filter === 'migrated') return Boolean(item.migrated)
    return true
  }), [filter, preview.items])
  const selected = preview.items.find((item) => item.legacySkuId === selectedId) || visibleItems[0] || null
  const selectedDecision = selected ? decisions[selected.legacySkuId] : null
  const planItems = preview.items.filter((item) => decisions[item.legacySkuId]).map((item) => ({
    legacySkuId: item.legacySkuId, sourceHash: item.sourceHash, ...decisions[item.legacySkuId],
  }))
  const migrationCount = planItems.filter((item) => item.decision === 'migrate').length
  const invalidExclusion = planItems.some((item) => item.decision === 'exclude' && !item.exclusionReason?.trim())
  const selectableVisible = visibleItems.filter((item) => item.recommended)

  const updateDecision = (id, patch) => setDecisions((current) => ({ ...current, [id]: { decision: 'migrate', exclusionReason: '', overrides: {}, ...current[id], ...patch } }))
  const removeDecision = (id) => setDecisions((current) => { const next = { ...current }; delete next[id]; return next })
  const toggleAll = (checked) => setDecisions((current) => {
    const next = { ...current }
    selectableVisible.forEach((item) => { if (checked) next[item.legacySkuId] ||= { decision: 'migrate', exclusionReason: '', overrides: {} }; else delete next[item.legacySkuId] })
    return next
  })

  const submitPlan = async () => {
    if (!migrationCount || !reason.trim() || invalidExclusion || !canPlan) return
    setSubmitting(true); setError('')
    try {
      const created = await createLegacyMigrationPlan(planItems, reason.trim())
      setDecisions({}); setPlans((current) => [created, ...current]); setPlanDetail(created); setSurface('plans')
      onNotify?.(`迁移方案已提交：${created.migrateCount} 条待审核`)
    } catch (requestError) { setError(requestError.message || '迁移方案提交失败') } finally { setSubmitting(false) }
  }

  const openPlan = async (plan) => {
    setError('')
    try { setPlanDetail(await getLegacyMigrationPlan(plan.id)) } catch (requestError) { setError(requestError.message || '方案详情加载失败') }
  }

  const reviewPlan = async (decision) => {
    if (!planDetail || !canReview || planDetail.createdById === session?.id || (decision === 'reject' && !reviewNote.trim())) return
    setSubmitting(true); setError('')
    try {
      const next = await reviewLegacyMigrationPlan(planDetail, decision, reviewNote.trim())
      setPlanDetail(next); setPlans((current) => current.map((item) => item.id === next.id ? next : item)); setReviewNote('')
      onNotify?.(decision === 'approve' ? '迁移方案已批准，等待管理员执行' : '迁移方案已退回')
    } catch (requestError) { setError(requestError.message || '审核失败') } finally { setSubmitting(false) }
  }

  const commitPlan = async () => {
    if (!planDetail || !canExecute) return
    setSubmitting(true); setError('')
    try {
      const next = await commitLegacyMigrationPlan(planDetail)
      setPlanDetail(next); setPlans((current) => current.map((item) => item.id === next.id ? next : item)); await load()
      onNotify?.(`方案已执行：${next.batch.summary.migrated} 条生成草稿`); onCompleted?.(next.batch)
    } catch (requestError) { setError(requestError.message || '方案执行失败') } finally { setSubmitting(false) }
  }

  const renderMappingSelect = (label, code, currentLabel, originalLabel) => {
    const decision = selectedDecision || { overrides: {} }
    const overrideKey = `${code}Code`
    const dictionaryCode = code === 'brand' ? 'sku_brand' : code === 'category' ? 'part_category' : 'unit'
    return <div><dt>{label}</dt><dd><span>{originalLabel || '—'}</span><b>→</b><select aria-label={`修正${label}`} disabled={!canPlan || selected?.migrated || selectedDecision?.decision === 'exclude'} value={decision.overrides?.[overrideKey] || ''} onChange={(event) => updateDecision(selected.legacySkuId, { overrides: { ...(decision.overrides || {}), [overrideKey]: event.target.value } })}><option value="">{currentLabel || '待补充'}</option>{dictionaryOptions(dictionaries, dictionaryCode).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></dd></div>
  }

  return <main className="legacy-migration-main">
    <header className="legacy-migration-topbar"><div><button type="button" aria-label="返回 SKU 资料库" onClick={onBack}><ArrowLeft size={20} weight="bold" /></button><span><h1>旧 SKU 迁移治理</h1><p>先形成可审核方案，批准后才允许生成新资料库草稿</p></span></div><span className="legacy-migration-safety"><ShieldCheck size={19} weight="fill" />可回查 · 不覆盖 · 审批后写入</span></header>
    <div className="legacy-migration-content">
      <section className="legacy-migration-metrics" aria-label="迁移概览"><div><span>旧资料总数</span><strong>{preview.summary.total ?? '—'}</strong><small>当前迁移范围</small></div><div className="accent"><span>建议迁移</span><strong>{preview.summary.recommended ?? '—'}</strong><small>无阻断风险</small></div><div><span>需先处理</span><strong>{preview.summary.blocked ?? '—'}</strong><small>编号或字段冲突</small></div><div><span>待审核方案</span><strong>{plans.filter((item) => item.state === 'submitted').length}</strong><small>等待审核角色处理</small></div><div><span>已迁移</span><strong>{preview.summary.migrated ?? '—'}</strong><small>已生成草稿</small></div></section>
      <section className="legacy-migration-toolbar"><div className="legacy-surface-tabs"><button type="button" className={surface === 'preview' ? 'active' : ''} onClick={() => setSurface('preview')}>资料治理</button><button type="button" className={surface === 'plans' ? 'active' : ''} onClick={() => setSurface('plans')}>审批记录 <b>{plans.filter((item) => item.state === 'submitted').length}</b></button></div>{surface === 'preview' ? <><label><MagnifyingGlass size={20} weight="bold" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索旧 SKU、OE、名称、品牌" /></label><nav>{filters.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</nav><button type="button" className="legacy-select-recommended" disabled={!canPlan || !preview.summary.recommended} onClick={() => setDecisions(Object.fromEntries(preview.items.filter((item) => item.recommended).map((item) => [item.legacySkuId, { decision: 'migrate', exclusionReason: '', overrides: {} }])))}><Check size={17} weight="bold" />选择全部建议项</button></> : null}</section>
      {surface === 'preview' ? <PreviewWorkspace {...{ visibleItems, selected, decisions, selectedDecision, canPlan, selectableVisible, loading, setSelectedId, updateDecision, removeDecision, toggleAll, renderMappingSelect }} /> : <PlanWorkspace {...{ plans, planDetail, canReview, canExecute, isSelfReview: Boolean(planDetail?.createdById && planDetail.createdById === session?.id), submitting, reviewNote, setReviewNote, openPlan, reviewPlan, commitPlan }} />}
      {surface === 'preview' ? <footer className="legacy-migration-footer"><div><strong>方案内 {migrationCount} 条迁移 · {planItems.length - migrationCount} 条排除</strong><span>提交后由审核角色批准，不会立即写入新资料库。</span></div><label><span>方案说明</span><input value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canPlan || submitting} /></label><button type="button" disabled={!canPlan || !migrationCount || !reason.trim() || invalidExclusion || submitting} onClick={submitPlan}>{submitting ? '正在提交…' : `提交审核 ${migrationCount} 条`}</button></footer> : <footer className="legacy-migration-footer legacy-plan-footer"><div><strong>迁移审批与执行已分离</strong><span>审核人确认方案，管理员执行后只生成待核验草稿。</span></div></footer>}
      {error ? <div className="legacy-migration-error"><XCircle size={18} weight="fill" />{error}</div> : null}
    </div>
  </main>
}

function PreviewWorkspace({ visibleItems, selected, decisions, selectedDecision, canPlan, selectableVisible, loading, setSelectedId, updateDecision, removeDecision, toggleAll, renderMappingSelect }) {
  return <section className="legacy-migration-workspace"><article className="legacy-migration-list"><div className="legacy-migration-list-head"><span><input type="checkbox" aria-label="选择当前可迁移记录" disabled={!canPlan || !selectableVisible.length} checked={Boolean(selectableVisible.length) && selectableVisible.every((item) => decisions[item.legacySkuId]?.decision === 'migrate')} onChange={(event) => toggleAll(event.target.checked)} /></span><span>旧 SKU / 配件名称</span><span>目标映射</span><span>关联数据</span><span>迁移判断</span></div><div className="legacy-migration-rows">{visibleItems.map((item) => <button type="button" className={`legacy-migration-row ${selected?.legacySkuId === item.legacySkuId ? 'active' : ''}`} key={item.legacySkuId} onClick={() => setSelectedId(item.legacySkuId)}><span onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${item.legacy.name}`} disabled={!canPlan || !item.recommended} checked={decisions[item.legacySkuId]?.decision === 'migrate'} onChange={(event) => event.target.checked ? updateDecision(item.legacySkuId, { decision: 'migrate' }) : removeDecision(item.legacySkuId)} /></span><span className="legacy-part"><i><Cube size={22} weight="duotone" /></i><b>{item.legacy.name || '未命名零件'}<small>{item.legacy.skuCode}</small></b></span><span><b>{item.target.identity.brandLabel || '待补充'}</b><small>{item.target.identity.categoryLabel || '待补充分类'}</small></span><span><b>{item.legacy.identifierCount} 个编号</b><small>{item.legacy.fitmentCount} 条适配 · {item.legacy.oeRelationCount} 个关系</small></span><span><em className={item.migrated ? 'done' : item.blocking ? 'blocked' : item.issues.length ? 'review' : 'ready'}>{decisions[item.legacySkuId]?.decision === 'exclude' ? '方案中排除' : stateLabel(item)}</em><small>{item.issues.length ? `${item.issues.length} 项提示` : '字段映射完整'}</small></span></button>)}{!loading && !visibleItems.length ? <div className="legacy-migration-empty"><Database size={34} /><strong>当前筛选下没有记录</strong><span>可以切换筛选条件或调整搜索词。</span></div> : null}{loading ? <div className="legacy-migration-empty"><ClockCounterClockwise size={34} /><strong>正在检查旧资料</strong><span>正在比对字段、编号与来源快照。</span></div> : null}</div></article>
    <aside className="legacy-migration-inspector">{selected ? <><header><span className="legacy-migration-inspector-state">{stateLabel(selected)}</span><h2>{selected.legacy.name}</h2><p>{selected.legacy.skuCode} · 更新于 {formatTime(selected.legacy.updatedAt)}</p></header><div className="legacy-migration-inspector-body"><section><h3><ArrowsLeftRight size={18} />字段映射</h3><dl>{renderMappingSelect('品牌', 'brand', selected.target.identity.brandLabel, selected.legacy.brand)}{renderMappingSelect('分类', 'category', selected.target.identity.categoryLabel, selected.legacy.category)}{renderMappingSelect('单位', 'unit', selected.target.identity.unitLabel, selected.legacy.unit)}<div><dt>状态</dt><dd><span>{selected.legacy.lifecycleStatus}</span><b>→</b><strong>草稿 · 未核验</strong></dd></div></dl></section><section className="legacy-decision"><h3><ShieldCheck size={18} />方案决定</h3><div><button type="button" disabled={!canPlan || selected.migrated || selected.blocking} className={selectedDecision?.decision === 'migrate' ? 'active' : ''} onClick={() => updateDecision(selected.legacySkuId, { decision: 'migrate', exclusionReason: '' })}>纳入迁移</button><button type="button" disabled={!canPlan || selected.migrated} className={selectedDecision?.decision === 'exclude' ? 'active danger' : ''} onClick={() => updateDecision(selected.legacySkuId, { decision: 'exclude' })}>从本方案排除</button></div>{selectedDecision?.decision === 'exclude' ? <textarea aria-label="排除原因" value={selectedDecision.exclusionReason || ''} onChange={(event) => updateDecision(selected.legacySkuId, { exclusionReason: event.target.value })} placeholder="必填：说明为什么暂不迁移这条资料" /> : null}</section><section><h3><WarningCircle size={18} />检查结果</h3>{selected.issues.length ? <div className="legacy-issue-list">{selected.issues.map((issue) => <div className={issue.blocking ? 'blocking' : ''} key={issue.code}>{issue.blocking ? <XCircle size={17} weight="fill" /> : <WarningCircle size={17} weight="fill" />}<span><strong>{issue.blocking ? '阻止迁移' : '迁移后复核'}</strong><small>{issue.label}</small></span></div>)}</div> : <div className="legacy-all-clear"><CheckCircle size={20} weight="fill" /><span><strong>未发现风险项</strong><small>仍将以草稿状态进入资料库。</small></span></div>}</section><section className="legacy-preservation-note"><ShieldCheck size={20} weight="fill" /><span><strong>旧资料不会被修改</strong><small>字段修正和排除决定只保存在迁移方案中。</small></span></section></div></> : <div className="legacy-migration-empty"><Database size={34} /><strong>选择一条旧资料</strong><span>在这里核对映射和风险。</span></div>}</aside></section>
}

function PlanWorkspace({ plans, planDetail, canReview, canExecute, isSelfReview, submitting, reviewNote, setReviewNote, openPlan, reviewPlan, commitPlan }) {
  return <section className="legacy-migration-workspace legacy-plan-workspace"><article className="legacy-migration-list"><div className="legacy-plan-head"><span>状态</span><span>方案说明</span><span>范围</span><span>提交信息</span></div><div className="legacy-migration-rows">{plans.map((plan) => <button type="button" className={`legacy-plan-row ${planDetail?.id === plan.id ? 'active' : ''}`} key={plan.id} onClick={() => openPlan(plan)}><em className={plan.state}>{planStateLabels[plan.state] || plan.state}</em><span><strong>{plan.reason}</strong><small>{plan.id.slice(0, 8)}</small></span><span><strong>{plan.migrateCount} 条迁移</strong><small>{plan.excludeCount} 条排除</small></span><span><strong>{plan.createdBy}</strong><small>{formatTime(plan.createdAt)}</small></span></button>)}{!plans.length ? <div className="legacy-migration-empty"><Database size={34} /><strong>还没有迁移方案</strong><span>在资料治理中选择记录后提交。</span></div> : null}</div></article><aside className="legacy-migration-inspector legacy-plan-inspector">{planDetail ? <><header><span className="legacy-migration-inspector-state">{planStateLabels[planDetail.state]}</span><h2>{planDetail.reason}</h2><p>版本 {planDetail.version} · {formatTime(planDetail.createdAt)}</p></header><div className="legacy-migration-inspector-body"><section><h3>方案范围</h3><div className="legacy-plan-counts"><span><strong>{planDetail.migrateCount}</strong>迁移</span><span><strong>{planDetail.excludeCount}</strong>排除</span></div></section><section><h3>处理记录</h3><div className="legacy-plan-items">{planDetail.items?.map((item) => <div key={item.id}><span><strong>{item.preview?.legacy?.name || item.legacySkuId}</strong><small>{item.preview?.legacy?.skuCode}</small></span><em className={item.decision}>{item.decision === 'migrate' ? '迁移' : '排除'}</em>{item.exclusionReason ? <small>{item.exclusionReason}</small> : null}</div>)}</div></section>{planDetail.events?.length ? <section><h3>审批轨迹</h3><div className="legacy-plan-events">{planDetail.events.map((event) => <div key={event.id}><span>{planEventLabels[event.action] || event.action}</span><strong>{event.actorName}</strong><small>{event.actorRole || event.identityProvider} · {formatTime(event.createdAt)}</small>{event.note ? <p>{event.note}</p> : null}</div>)}</div></section> : null}{planDetail.reviewedAt ? <section><h3>审核结果</h3><p className="legacy-review-copy">{planDetail.reviewedBy} · {formatTime(planDetail.reviewedAt)}<br />{planDetail.reviewNote || '审核通过'}</p></section> : null}{planDetail.state === 'submitted' ? <section className="legacy-review-actions"><h3>审核决定</h3>{isSelfReview ? <p className="legacy-self-review">提交人不能审核自己的方案，请切换至独立审核角色。</p> : null}<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="通过可选填；退回时必须说明原因" /><div><button type="button" disabled={!canReview || isSelfReview || submitting || !reviewNote.trim()} onClick={() => reviewPlan('reject')}>退回</button><button type="button" className="primary" disabled={!canReview || isSelfReview || submitting} onClick={() => reviewPlan('approve')}>批准方案</button></div></section> : null}{planDetail.state === 'approved' ? <section className="legacy-commit-panel"><ShieldCheck size={20} weight="fill" /><span><strong>方案已获批准</strong><small>只有资料管理员可执行；执行前会再次检查来源版本和编号冲突。</small></span><button type="button" disabled={!canExecute || submitting} onClick={commitPlan}>正式执行迁移</button></section> : null}</div></> : <div className="legacy-migration-empty"><Database size={34} /><strong>选择一个方案</strong><span>查看处理记录、审核和执行状态。</span></div>}</aside></section>
}
