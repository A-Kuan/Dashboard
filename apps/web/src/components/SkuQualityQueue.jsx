import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle, Clock, Cube, MagnifyingGlass, SealCheck, ShieldCheck,
  UserCircle, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import { getCatalogSku, listCatalogQuality, transitionCatalogSku } from '../services/catalogApi'
import { SkuQualityInsights } from './SkuQualityInsights'
import { SkuConflictCenter } from './SkuConflictCenter'
import { SkuFitmentGovernance } from './SkuFitmentGovernance'
import { SkuPlatformGovernance } from './SkuPlatformGovernance'
import '../sku-quality.css'

const issueMeta = {
  identity: { label: '缺少标准名称', passLabel: '标准名称完整', level: 'error' },
  classification: { label: '品牌或分类不完整', passLabel: '品牌与分类完整', level: 'warning' },
  primaryIdentifier: { label: '缺少主 OE', passLabel: '主 OE 已建立', level: 'error' },
  fitment: { label: '缺少适配车型', passLabel: '适配车型已建立', level: 'warning' },
  fitmentReview: { label: '适配关系待专项审核', passLabel: '适配关系已通过审核', level: 'warning' },
  fitmentConflict: { label: '车型平台或适配范围冲突', passLabel: '平台与适配范围无冲突', level: 'error' },
  evidence: { label: '缺少来源证据', passLabel: '来源证据可追溯', level: 'error' },
  duplicateIdentifier: { label: '编号疑似重复', passLabel: '未发现编号冲突', level: 'error' },
}

const statusMeta = {
  draft: { label: '草稿待完善', className: 'draft' },
  review: { label: '等待审核', className: 'review' },
  verified: { label: '已核验但有风险', className: 'verified' },
  discontinued: { label: '已停用', className: 'discontinued' },
}

const actionCopy = {
  approve_review: { title: '通过审核', placeholder: '可填写审核结论（选填）' },
  reject_review: { title: '退回修改', placeholder: '请说明需要修改的内容' },
  discontinue: { title: '停用资料', placeholder: '请填写停用原因' },
  reopen: { title: '重新启用为草稿', placeholder: '请填写重新启用原因' },
}

function shortTime(value) {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export function SkuQualityQueue({ capabilities = [], onBack, onEdit, onSaved, onNotify }) {
  const [surface, setSurface] = useState('queue')
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState(null)
  const [issue, setIssue] = useState('')
  const [status, setStatus] = useState('')
  const [counts, setCounts] = useState({ issues: {}, statuses: {} })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState('资料审核员')
  const [error, setError] = useState('')

  const loadQueue = useCallback(async (preferredId = '') => {
    setLoading(true)
    setError('')
    try {
      const result = await listCatalogQuality({ issue, status, pageSize: 100 })
      setRecords(result.records)
      setTotal(result.total)
      setCounts({ issues: result.issueCounts || {}, statuses: result.statusCounts || {} })
      setSelectedId((current) => {
        const candidate = preferredId || current
        return result.records.some((item) => item.id === candidate) ? candidate : result.records[0]?.id || ''
      })
    } catch (reason) {
      setError(reason.message || '质量队列加载失败')
    } finally {
      setLoading(false)
    }
  }, [issue, status])

  useEffect(() => { loadQueue() }, [loadQueue])
  useEffect(() => {
    if (!selectedId) { setSelected(null); return undefined }
    let active = true
    getCatalogSku(selectedId).then((record) => { if (active) setSelected(record) }).catch((reason) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [selectedId, surface])

  const visibleIssues = useMemo(() => selected?.qualityIssues || [], [selected])
  const submitBlockingIssues = useMemo(() => visibleIssues.filter((code) => code !== 'fitmentReview'), [visibleIssues])
  const hasCapability = (capability) => capabilities.includes(capability)

  const runAction = async (nextAction) => {
    if (!selected) return
    if (['reject_review', 'discontinue', 'reopen'].includes(nextAction) && !note.trim()) {
      setError('请先填写操作原因')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await transitionCatalogSku(selected, nextAction, { note: note.trim(), assignee })
      setSelected(saved)
      setAction('')
      setNote('')
      onSaved?.(saved)
      onNotify?.({ approve_review: '审核已通过', reject_review: '资料已退回修改', discontinue: '资料已停用', reopen: '资料已恢复为草稿', assign_review: '审核人已更新', submit_review: '资料已提交审核' }[nextAction])
      await loadQueue(saved.id)
    } catch (reason) {
      setError(reason.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sku-main quality-main">
      <header className="quality-topbar">
        <div><button type="button" aria-label="返回 SKU 资料库" onClick={onBack}><ArrowLeft size={20} weight="bold" /></button><span><b>数据质量与审核</b><small>集中处理缺失字段、编号冲突和待核验资料</small></span></div>
        <div className="quality-top-actions"><div className="quality-surface-tabs"><button type="button" className={surface === 'queue' ? 'active' : ''} onClick={() => setSurface('queue')}>处理队列</button><button type="button" className={surface === 'fitments' ? 'active' : ''} onClick={() => setSurface('fitments')}>适配治理</button><button type="button" className={surface === 'platforms' ? 'active' : ''} onClick={() => setSurface('platforms')}>车型平台</button><button type="button" className={surface === 'conflicts' ? 'active' : ''} onClick={() => setSurface('conflicts')}>编号冲突</button><button type="button" className={surface === 'insights' ? 'active' : ''} onClick={() => setSurface('insights')}>运营洞察</button></div><div className="quality-live"><i />规则实时计算 · 版本写入留痕</div></div>
      </header>

      <div className="quality-content">
        {surface === 'insights' ? <SkuQualityInsights /> : surface === 'fitments' ? <SkuFitmentGovernance canReview={hasCapability('catalog.review_fitment')} onNotify={onNotify} onChanged={() => loadQueue()} /> : surface === 'platforms' ? <SkuPlatformGovernance canManage={hasCapability('catalog.manage_platform')} canResolve={hasCapability('catalog.resolve_fitment_conflict')} onNotify={onNotify} onOpenFitments={() => setSurface('fitments')} /> : surface === 'conflicts' ? <SkuConflictCenter canResolve={hasCapability('catalog.resolve_conflict')} canMerge={hasCapability('catalog.merge')} onNotify={onNotify} onResolved={() => loadQueue()} /> : <>
        <section className="quality-metrics" aria-label="质量队列概览">
          <article><span><ShieldCheck size={20} weight="duotone" />待处理总数</span><strong>{total}</strong><small>草稿、待审核及风险资料</small></article>
          <article><span><Clock size={20} weight="duotone" />等待审核</span><strong>{counts.statuses.review || 0}</strong><small>优先处理已提交资料</small></article>
          <article><span><WarningCircle size={20} weight="duotone" />来源缺失</span><strong>{counts.issues.evidence || 0}</strong><small>无法追溯原始依据</small></article>
          <article><span><XCircle size={20} weight="duotone" />编号冲突</span><strong>{counts.issues.duplicateIdentifier || 0}</strong><small>核验前必须消除</small></article>
        </section>

        <section className="quality-filterbar">
          <div className="quality-view-tabs"><button type="button" className={!status ? 'active' : ''} onClick={() => setStatus('')}>全部队列</button><button type="button" className={status === 'review' ? 'active' : ''} onClick={() => setStatus('review')}>等待审核 <b>{counts.statuses.review || 0}</b></button><button type="button" className={status === 'draft' ? 'active' : ''} onClick={() => setStatus('draft')}>草稿待完善 <b>{counts.statuses.draft || 0}</b></button></div>
          <label><MagnifyingGlass size={17} /><select aria-label="质量问题筛选" value={issue} onChange={(event) => setIssue(event.target.value)}><option value="">全部质量问题</option>{Object.entries(issueMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label>
        </section>

        <section className="quality-workspace">
          <article className="quality-list-panel">
            <header><div><h2>处理队列</h2><span>{loading ? '正在计算…' : `${records.length} 条当前结果`}</span></div><span>按状态与截止时间排序</span></header>
            <div className="quality-list">
              {records.map((record) => {
                const meta = statusMeta[record.status] || statusMeta.draft
                return <button type="button" className={selectedId === record.id ? 'selected' : ''} key={record.id} onClick={() => setSelectedId(record.id)}>
                  <span className="quality-part-icon"><Cube size={23} weight="duotone" /></span>
                  <span className="quality-row-main"><strong>{record.name}</strong><small>{record.primaryOe} · {record.code}</small><span>{record.qualityIssues.slice(0, 2).map((code) => <em className={issueMeta[code]?.level || 'warning'} key={code}>{issueMeta[code]?.label || code}</em>)}{record.qualityIssues.length > 2 ? <em>+{record.qualityIssues.length - 2}</em> : null}{!record.qualityIssues.length ? <em className="clear">基础检查通过</em> : null}</span></span>
                  <span className="quality-row-meta"><b className={`sku-state ${meta.className}`}>{meta.label}</b><small>{record.reviewAssignee || '未分配'}</small></span><ArrowRight size={16} />
                </button>
              })}
              {!records.length && !loading ? <div className="quality-empty"><CheckCircle size={38} weight="duotone" /><strong>当前队列已清空</strong><span>这个筛选条件下没有待处理资料</span></div> : null}
            </div>
          </article>

          <aside className="quality-review-panel">
            {selected ? <>
              <header><div><span className={`sku-state ${selected.status}`}>{selected.statusLabel}</span><span>v{selected.version}</span></div><h2>{selected.name}</h2><p>{selected.primaryOe} · {selected.brand}</p></header>
              <div className="quality-review-scroll">
                <section><div className="quality-section-title"><h3>自动质量检查</h3><span>{visibleIssues.length ? `${visibleIssues.length} 项待处理` : '全部通过'}</span></div><div className="quality-checks">{Object.entries(issueMeta).map(([code, meta]) => { const failed = visibleIssues.includes(code); return <div className={failed ? 'failed' : 'passed'} key={code}>{failed ? <WarningCircle size={19} weight="fill" /> : <CheckCircle size={19} weight="fill" />}<span><strong>{failed ? meta.label : meta.passLabel}</strong><small>{failed ? '需要补充或人工确认' : '检查通过'}</small></span></div> })}</div></section>
                <section><div className="quality-section-title"><h3>审核信息</h3></div><dl className="quality-review-info"><div><dt>当前审核人</dt><dd>{selected.reviewAssignee || '未分配'}</dd></div><div><dt>审核截止</dt><dd>{shortTime(selected.reviewDueAt)}</dd></div><div><dt>完整度</dt><dd>{selected.completeness}%</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div></dl></section>
                <section><div className="quality-section-title"><h3>分配审核</h3></div><div className="quality-assignee"><UserCircle size={20} /><select aria-label="选择审核人" disabled={!hasCapability('catalog.assign')} value={assignee} onChange={(event) => setAssignee(event.target.value)}><option>资料审核员</option><option>虎山行</option><option>采购负责人</option></select><button type="button" disabled={!hasCapability('catalog.assign') || selected.status !== 'review' || busy} onClick={() => runAction('assign_review')}>保存分配</button></div></section>
                {action ? <section className="quality-decision"><div className="quality-section-title"><h3>{actionCopy[action].title}</h3><button type="button" onClick={() => { setAction(''); setNote(''); setError('') }}>取消</button></div><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder={actionCopy[action].placeholder} /><button type="button" disabled={busy} onClick={() => runAction(action)}>{busy ? '正在提交…' : `确认${actionCopy[action].title}`}</button></section> : null}
                {error ? <div className="quality-error"><WarningCircle size={18} weight="fill" />{error}</div> : null}
              </div>
              <footer>
                <button type="button" disabled={!hasCapability('catalog.edit')} onClick={() => onEdit?.(selected)}>编辑资料</button>
                {selected.status === 'draft' ? <button className="primary" type="button" disabled={!hasCapability('catalog.submit') || submitBlockingIssues.length > 0 || busy} onClick={() => runAction('submit_review')}>提交审核</button> : null}
                {selected.status === 'review' ? <><button className="danger" type="button" disabled={!hasCapability('catalog.review')} onClick={() => setAction('reject_review')}>退回修改</button><button className="primary" type="button" disabled={!hasCapability('catalog.review') || visibleIssues.length > 0 || busy} onClick={() => setAction('approve_review')}><SealCheck size={18} weight="fill" />通过审核</button></> : null}
                {selected.status === 'verified' ? <button className="danger" type="button" disabled={!hasCapability('catalog.lifecycle')} onClick={() => setAction('discontinue')}>停用资料</button> : null}
                {selected.status === 'discontinued' ? <button className="primary" type="button" disabled={!hasCapability('catalog.lifecycle')} onClick={() => setAction('reopen')}>恢复为草稿</button> : null}
              </footer>
            </> : <div className="quality-no-selection"><ShieldCheck size={42} weight="duotone" /><strong>选择一条资料开始审核</strong></div>}
          </aside>
        </section>
        </>}
      </div>
    </main>
  )
}
