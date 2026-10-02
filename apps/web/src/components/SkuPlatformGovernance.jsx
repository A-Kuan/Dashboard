import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, CarProfile, CheckCircle, ClockCounterClockwise, FloppyDisk, MagnifyingGlass,
  Plus, ShieldWarning, Stack, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import {
  getCatalogVehiclePlatform, listCatalogFitmentConflicts, listCatalogVehiclePlatforms,
  resolveCatalogFitmentConflict, saveCatalogVehiclePlatform,
} from '../services/catalogApi'
import '../sku-platform-governance.css'

const emptyPlatform = {
  platformCode: '', brandCode: '', brandLabel: '', seriesCode: '', seriesLabel: '', generationLabel: '',
  yearFrom: '', yearTo: '', marketCodes: '', bodyStyles: '', aliases: '', lifecycleStatus: 'draft',
  sourceSystem: '', sourceReference: '', notes: '',
}

const statusMeta = {
  active: { label: '已启用', className: 'active' }, draft: { label: '草稿', className: 'draft' }, retired: { label: '已停用', className: 'retired' },
}

const conflictMeta = {
  unrecognized_platform: ['未知平台', '平台编码还没有对应主数据'],
  inactive_platform: ['平台未启用', '适配指向了草稿或已停用平台'],
  year_outside_platform: ['年款越界', '适配年款超出平台生产边界'],
  self_condition: ['条件自相矛盾', '包含与排除条件冲突'],
  overlapping_scope: ['范围重叠', '同 SKU 在重叠年款内出现不一致边界'],
  shared_oe_scope: ['同 OE 多资料', '相同 OE 在同一车型范围对应不同 SKU'],
}

function csv(value) { return Array.isArray(value) ? value.join('、') : value || '' }
function toDraft(item) {
  return { ...item, marketCodes: csv(item.marketCodes), bodyStyles: csv(item.bodyStyles), aliases: csv(item.aliases) }
}
function Field({ label, required, wide, children }) {
  return <label className={wide ? 'wide' : ''}><span>{label}{required ? <b>*</b> : null}</span>{children}</label>
}
function Side({ title, side }) {
  if (!side) return null
  return <section className="platform-conflict-side"><header><span>{title}</span><b>{side.skuCode}</b></header><h4>{side.skuName}</h4><p>{side.primaryOe || '无主 OE'} · {side.vehicleLabel}</p><dl><div><dt>平台 / 年款</dt><dd>{side.platformCode || '—'} · {side.years || `${side.yearFrom || '?'}–${side.yearTo || '?'}`}</dd></div><div><dt>位置</dt><dd>{side.position || '未限定'}</dd></div><div><dt>发动机 / PR</dt><dd>{[...(side.engineCodes || []), ...(side.prCodes || [])].join('、') || '未限定'}</dd></div></dl></section>
}

export function SkuPlatformGovernance({ canManage = false, canResolve = false, onNotify, onOpenFitments }) {
  const [view, setView] = useState('platforms')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [platformResult, setPlatformResult] = useState({ items: [], total: 0, statusCounts: {} })
  const [overview, setOverview] = useState({ platformTotal: 0, active: 0, open: 0, resolved: 0 })
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState(null)
  const [conflictState, setConflictState] = useState('open')
  const [conflictResult, setConflictResult] = useState({ items: [], total: 0, counts: {} })
  const [selectedConflictKey, setSelectedConflictKey] = useState('')
  const [resolutionType, setResolutionType] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    try {
      const [platforms, conflicts] = await Promise.all([listCatalogVehiclePlatforms(), listCatalogFitmentConflicts({ state: '' })])
      setOverview({ platformTotal: platforms.total || 0, active: platforms.statusCounts?.active || 0, open: conflicts.counts?.open || 0, resolved: conflicts.counts?.resolved || 0 })
    } catch { /* detailed loaders surface actionable errors */ }
  }, [])

  const loadPlatforms = useCallback(async (preferredId = '') => {
    setLoading(true); setError('')
    try {
      const result = await listCatalogVehiclePlatforms({ query, status })
      setPlatformResult(result)
      const id = result.items.some((item) => item.id === preferredId) ? preferredId : result.items[0]?.id || ''
      setSelectedId(id)
      if (id) setDraft(toDraft(await getCatalogVehiclePlatform(id)))
      else setDraft((current) => current && !current.id ? current : null)
    } catch (reason) { setError(reason.message || '车型平台加载失败') } finally { setLoading(false) }
  }, [query, status])

  const loadConflicts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await listCatalogFitmentConflicts({ state: conflictState, query })
      setConflictResult(result)
      setSelectedConflictKey((current) => result.items.some((item) => item.key === current) ? current : result.items[0]?.key || '')
    } catch (reason) { setError(reason.message || '适配冲突加载失败') } finally { setLoading(false) }
  }, [conflictState, query])

  useEffect(() => {
    const timer = window.setTimeout(() => { if (view === 'platforms') loadPlatforms(); else loadConflicts() }, 180)
    return () => window.clearTimeout(timer)
  }, [loadConflicts, loadPlatforms, view])
  useEffect(() => { loadOverview() }, [loadOverview])

  const selectPlatform = async (id) => {
    setSelectedId(id); setError('')
    try { setDraft(toDraft(await getCatalogVehiclePlatform(id))) } catch (reason) { setError(reason.message) }
  }
  const selectedConflict = useMemo(() => conflictResult.items.find((item) => item.key === selectedConflictKey) || null, [conflictResult.items, selectedConflictKey])
  const pairConflict = Boolean(selectedConflict?.right)

  const savePlatform = async () => {
    if (!draft || !canManage) return
    setBusy(true); setError('')
    try {
      const saved = await saveCatalogVehiclePlatform({ ...draft, expectedVersion: draft.version })
      setDraft(toDraft(saved)); setSelectedId(saved.id); onNotify?.(draft.id ? '车型平台已更新' : '车型平台已建立')
      await Promise.all([loadPlatforms(saved.id), loadOverview()])
    } catch (reason) { setError(reason.message || '保存失败') } finally { setBusy(false) }
  }

  const resolveConflict = async () => {
    if (!selectedConflict || !pairConflict || !resolutionType || !note.trim()) { setError('请选择结论并填写处理依据'); return }
    setBusy(true); setError('')
    try {
      await resolveCatalogFitmentConflict(selectedConflict, resolutionType, note.trim())
      onNotify?.(resolutionType === 'correction_required' ? '已标记为需要修正' : '适配冲突已留痕处理')
      setResolutionType(''); setNote(''); await Promise.all([loadConflicts(), loadOverview()])
    } catch (reason) { setError(reason.message || '冲突处理失败') } finally { setBusy(false) }
  }

  return <section className="platform-governance">
    <div className="platform-metrics">
      <article><span><Stack size={19} weight="duotone" />平台总数</span><strong>{overview.platformTotal}</strong><small>独立于旧车型业务的主数据</small></article>
      <article><span><CheckCircle size={19} weight="duotone" />已启用</span><strong>{overview.active}</strong><small>可用于适配审核</small></article>
      <article><span><ShieldWarning size={19} weight="duotone" />开放冲突</span><strong>{overview.open}</strong><small>发布前必须处理</small></article>
      <article><span><ClockCounterClockwise size={19} weight="duotone" />已处理</span><strong>{overview.resolved}</strong><small>结论与依据永久留痕</small></article>
    </div>
    <div className="platform-toolbar">
      <div className="quality-view-tabs"><button type="button" className={view === 'platforms' ? 'active' : ''} onClick={() => { setView('platforms'); setQuery('') }}>平台档案</button><button type="button" className={view === 'conflicts' ? 'active' : ''} onClick={() => { setView('conflicts'); setQuery('') }}>冲突扫描 <b>{overview.open}</b></button></div>
      <label><MagnifyingGlass size={18} /><input aria-label="搜索车型平台治理" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'platforms' ? '搜索平台、品牌或车系' : '搜索 SKU、OE 或平台'} /></label>
    </div>

    {view === 'platforms' ? <div className="platform-workspace">
      <article className="platform-list-panel"><header><div><h2>车型平台</h2><span>{loading ? '加载中…' : `${platformResult.items.length} 条`}</span></div><button type="button" disabled={!canManage} onClick={() => { setSelectedId(''); setDraft({ ...emptyPlatform }) }}><Plus size={16} weight="bold" />新建平台</button></header><div className="platform-list-filters"><button className={!status ? 'active' : ''} onClick={() => setStatus('')} type="button">全部</button>{Object.entries(statusMeta).map(([value, meta]) => <button className={status === value ? 'active' : ''} onClick={() => setStatus(value)} type="button" key={value}>{meta.label}</button>)}</div><div>{platformResult.items.map((item) => <button type="button" className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => selectPlatform(item.id)}><span className="platform-code">{item.platformCode}</span><span><strong>{item.brandLabel} {item.seriesLabel}</strong><small>{item.generationLabel || '未填写代际'} · {item.yearFrom || '?'}–{item.yearTo || '?'}</small><em>{item.fitmentCount} 条适配 · {item.aliases.length} 个别名</em></span><span><b className={`platform-state ${item.lifecycleStatus}`}>{statusMeta[item.lifecycleStatus]?.label}</b>{item.openRiskCount ? <small>{item.openRiskCount} 条越界</small> : null}</span></button>)}{!platformResult.items.length && !loading ? <div className="platform-empty"><CarProfile size={42} weight="duotone" /><strong>还没有车型平台</strong><span>先建立有来源依据的平台档案</span></div> : null}</div></article>
      <aside className="platform-editor-panel">{draft ? <><header><div><span className={`platform-state ${draft.lifecycleStatus}`}>{statusMeta[draft.lifecycleStatus]?.label}</span><span>{draft.id ? `v${draft.version}` : '新建草稿'}</span></div><h2>{draft.platformCode || '新车型平台'}</h2><p>平台编码作为适配关系的稳定键，不使用市场名称代替。</p></header><div className="platform-form">
        <section><div className="quality-section-title"><h3>标准身份</h3><span>启用后供适配审核使用</span></div><div className="platform-form-grid"><Field label="平台编码" required><input value={draft.platformCode} onChange={(event) => setDraft({ ...draft, platformCode: event.target.value.toUpperCase() })} placeholder="例如：9YA" /></Field><Field label="状态"><select value={draft.lifecycleStatus} onChange={(event) => setDraft({ ...draft, lifecycleStatus: event.target.value })}><option value="draft">草稿</option><option value="active">启用</option><option value="retired">停用</option></select></Field><Field label="品牌名称" required><input value={draft.brandLabel} onChange={(event) => setDraft({ ...draft, brandLabel: event.target.value })} placeholder="Porsche" /></Field><Field label="品牌编码"><input value={draft.brandCode} onChange={(event) => setDraft({ ...draft, brandCode: event.target.value.toUpperCase() })} placeholder="POR" /></Field><Field label="车系名称" required><input value={draft.seriesLabel} onChange={(event) => setDraft({ ...draft, seriesLabel: event.target.value })} placeholder="Cayenne" /></Field><Field label="车系编码"><input value={draft.seriesCode} onChange={(event) => setDraft({ ...draft, seriesCode: event.target.value.toUpperCase() })} /></Field><Field label="代际名称"><input value={draft.generationLabel} onChange={(event) => setDraft({ ...draft, generationLabel: event.target.value })} placeholder="第三代" /></Field><Field label="别名"><input value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} placeholder="多个别名用逗号分隔" /></Field></div></section>
        <section><div className="quality-section-title"><h3>生产边界</h3><span>年款越界将阻止审核</span></div><div className="platform-form-grid"><Field label="起始年款"><input type="number" value={draft.yearFrom} onChange={(event) => setDraft({ ...draft, yearFrom: event.target.value })} /></Field><Field label="结束年款"><input type="number" value={draft.yearTo} onChange={(event) => setDraft({ ...draft, yearTo: event.target.value })} /></Field><Field label="市场代码"><input value={draft.marketCodes} onChange={(event) => setDraft({ ...draft, marketCodes: event.target.value })} placeholder="CN, EU, US" /></Field><Field label="车身形式"><input value={draft.bodyStyles} onChange={(event) => setDraft({ ...draft, bodyStyles: event.target.value })} placeholder="SUV, Coupe" /></Field></div></section>
        <section><div className="quality-section-title"><h3>来源与留痕</h3><span>启用前必填</span></div><div className="platform-form-grid"><Field label="来源系统" required><input value={draft.sourceSystem} onChange={(event) => setDraft({ ...draft, sourceSystem: event.target.value })} placeholder="Porsche PET / Audi ETKA" /></Field><Field label="来源引用" required><input value={draft.sourceReference} onChange={(event) => setDraft({ ...draft, sourceReference: event.target.value })} placeholder="目录、文件或记录编号" /></Field><Field label="备注" wide><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="记录边界例外或核验说明" /></Field></div></section>
        {error ? <p className="platform-error"><WarningCircle size={17} weight="fill" />{error}</p> : null}
      </div><footer><span>{canManage ? '修改会生成新版本并保留快照' : '当前角色只读'}</span><button type="button" disabled={!canManage || busy} onClick={savePlatform}><FloppyDisk size={17} weight="bold" />{busy ? '正在保存…' : '保存平台'}</button></footer></> : <div className="platform-no-selection"><Stack size={44} weight="duotone" /><strong>选择平台或新建档案</strong></div>}</aside>
    </div> : <div className="platform-conflict-workspace">
      <article className="platform-conflict-list"><header><div><h2>适配冲突</h2><span>{loading ? '正在扫描…' : `${conflictResult.total} 条`}</span></div><div className="platform-conflict-tabs"><button className={conflictState === 'open' ? 'active' : ''} onClick={() => setConflictState('open')} type="button">待处理</button><button className={conflictState === 'resolved' ? 'active' : ''} onClick={() => setConflictState('resolved')} type="button">已处理</button></div></header><div>{conflictResult.items.map((item) => <button type="button" className={selectedConflictKey === item.key ? 'selected' : ''} onClick={() => { setSelectedConflictKey(item.key); setResolutionType(''); setNote(''); setError('') }} key={item.key}><span><ShieldWarning size={21} weight="duotone" /></span><span><strong>{conflictMeta[item.type]?.[0] || item.title}</strong><small>{item.left.skuName} · {item.left.platformCode || '未知平台'}</small><em>{item.left.years || `${item.left.yearFrom || '?'}–${item.left.yearTo || '?'}`}{item.right ? ` ↔ ${item.right.years || `${item.right.yearFrom || '?'}–${item.right.yearTo || '?'}`}` : ''}</em></span><ArrowRight size={16} /></button>)}{!conflictResult.items.length && !loading ? <div className="platform-empty"><CheckCircle size={42} weight="duotone" /><strong>当前没有{conflictState === 'open' ? '开放' : '已处理'}冲突</strong><span>扫描会在适配或平台变更后自动重算</span></div> : null}</div></article>
      <aside className="platform-conflict-detail">{selectedConflict ? <><header><div><span>阻断性冲突</span><b>{conflictMeta[selectedConflict.type]?.[0] || selectedConflict.title}</b></div><p>{selectedConflict.explanation}</p></header><div className="platform-conflict-scroll"><section className="platform-conflict-compare"><Side title="资料 A" side={selectedConflict.left} /><Side title="资料 B" side={selectedConflict.right} /></section><section><div className="quality-section-title"><h3>自动判断</h3><span>{selectedConflict.platform?.platformCode || '未匹配平台'}</span></div><div className="platform-conflict-reason"><XCircle size={19} weight="fill" /><span><strong>{selectedConflict.title}</strong><small>{conflictMeta[selectedConflict.type]?.[1] || selectedConflict.explanation}</small></span></div></section>{pairConflict ? <section className="platform-resolution"><div className="quality-section-title"><h3>人工处理结论</h3><span>{canResolve ? '必填依据' : '当前角色只读'}</span></div><div className="platform-resolution-options">{[['accepted_overlap','允许重叠','条件能明确区分，两条关系都有效'],['same_application','同一应用','两条资料表达的是同一适配范围'],['correction_required','需要修正','保持阻断，返回适配关系修正']].map(([value,title,desc]) => <label className={resolutionType === value ? 'selected' : ''} key={value}><input type="radio" disabled={!canResolve} checked={resolutionType === value} onChange={() => setResolutionType(value)} /><span><strong>{title}</strong><small>{desc}</small></span></label>)}</div><textarea aria-label="适配冲突处理依据" disabled={!canResolve} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明 EPC、VIN、PR 码或品牌目录依据" />{error ? <p className="platform-error"><WarningCircle size={17} weight="fill" />{error}</p> : null}<button type="button" disabled={!canResolve || busy} onClick={resolveConflict}>{busy ? '正在提交…' : '提交处理结论'}</button></section> : <section className="platform-single-action"><WarningCircle size={20} weight="fill" /><span><strong>这类问题不允许人工忽略</strong><small>请先建立/启用平台，或修正适配边界后重新扫描。</small></span><button type="button" onClick={onOpenFitments}>前往适配治理</button></section>}</div></> : <div className="platform-no-selection"><ShieldWarning size={44} weight="duotone" /><strong>选择一条冲突查看边界</strong></div>}</aside>
    </div>}
  </section>
}
