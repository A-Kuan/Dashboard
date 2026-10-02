import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CarProfile, CheckCircle, Clock, MagnifyingGlass, SealCheck, ShieldWarning, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import { listCatalogFitmentReview, reviewCatalogFitment } from '../services/catalogApi'
import '../sku-fitment-governance.css'

const statusMeta = {
  pending: { label: '待审核', className: 'pending' },
  verified: { label: '已通过', className: 'verified' },
  rejected: { label: '已退回', className: 'rejected' },
  conflict: { label: '存在冲突', className: 'conflict' },
}

function values(items = []) {
  return items.length ? items.join('、') : '—'
}

function conditionText(value) {
  if (!value || !Object.keys(value).length) return '—'
  const fieldLabels = { engineCode: '发动机', transmissionCode: '变速箱', marketCode: '市场', bodyStyle: '车身', driveType: '驱动', prCode: 'PR', position: '位置' }
  const operatorLabels = { in: '包含', equals: '等于', not_in: '排除' }
  const rules = (value.rules || []).map((rule) => `${fieldLabels[rule.field] || rule.field} ${operatorLabels[rule.operator] || rule.operator} ${(rule.values || []).join('、')}`)
  return [...rules, value.note].filter(Boolean).join('；') || '—'
}

export function SkuFitmentGovernance({ canReview = false, onNotify, onChanged }) {
  const [state, setState] = useState('pending')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState({ items: [], total: 0, statusCounts: {} })
  const [selectedId, setSelectedId] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (preferredId = '') => {
    setLoading(true)
    setError('')
    try {
      const next = await listCatalogFitmentReview({ state, query, pageSize: 100 })
      setResult(next)
      setSelectedId((current) => {
        const candidate = preferredId || current
        return next.items.some((item) => item.id === candidate) ? candidate : next.items[0]?.id || ''
      })
    } catch (reason) {
      setError(reason.message || '适配审核队列加载失败')
    } finally {
      setLoading(false)
    }
  }, [query, state])

  useEffect(() => { const timer = window.setTimeout(() => load(), 180); return () => window.clearTimeout(timer) }, [load])

  const selected = useMemo(() => result.items.find((item) => item.id === selectedId) || null, [result.items, selectedId])
  const blockingRisks = selected?.risks.filter((risk) => risk.blocking) || []

  const decide = async (decision) => {
    if (!selected || !note.trim()) {
      setError('请先填写适配审核结论')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await reviewCatalogFitment(selected, decision, note.trim())
      setNote('')
      onNotify?.({ approve: '适配关系已通过审核', reject: '适配关系已退回补充', conflict: '适配关系已标记冲突' }[decision])
      onChanged?.(response.sku)
      await load()
    } catch (reason) {
      setError(reason.message || '适配审核失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className="fitment-governance">
    <div className="fitment-governance-metrics">
      <article><span><Clock size={19} weight="duotone" />待审核</span><strong>{result.statusCounts.pending || 0}</strong><small>需要核对边界与证据</small></article>
      <article><span><CheckCircle size={19} weight="duotone" />已通过</span><strong>{result.statusCounts.verified || 0}</strong><small>可进入 SKU 正式核验</small></article>
      <article><span><XCircle size={19} weight="duotone" />已退回</span><strong>{result.statusCounts.rejected || 0}</strong><small>等待录入员补充资料</small></article>
      <article><span><ShieldWarning size={19} weight="duotone" />存在冲突</span><strong>{result.statusCounts.conflict || 0}</strong><small>车型或条件互相矛盾</small></article>
    </div>

    <div className="fitment-governance-toolbar">
      <div className="quality-view-tabs">{[
        ['pending', '待审核'], ['', '全部'], ['verified', '已通过'], ['rejected', '已退回'], ['conflict', '冲突'],
      ].map(([value, label]) => <button type="button" className={state === value ? 'active' : ''} key={label} onClick={() => setState(value)}>{label}</button>)}</div>
      <label><MagnifyingGlass size={18} /><input aria-label="搜索适配审核队列" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、OE、车型或平台" /></label>
    </div>

    <div className="fitment-governance-workspace">
      <article className="fitment-governance-list">
        <header><div><h2>适配关系</h2><span>{loading ? '正在计算…' : `${result.total} 条结果`}</span></div><small>逐条审核，不批量猜测</small></header>
        <div>{result.items.map((item) => {
          const meta = statusMeta[item.fitment.verificationStatus] || statusMeta.pending
          return <button type="button" className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => { setSelectedId(item.id); setNote(''); setError('') }}>
            <span className="fitment-vehicle-icon"><CarProfile size={23} weight="duotone" /></span>
            <span><strong>{item.fitment.vehicleLabel}</strong><small>{item.skuName} · {item.primaryOe || item.skuCode}</small><em>{item.fitment.vehiclePlatformId || '平台待补充'} · {item.fitment.years || '年款待补充'}</em></span>
            <span><b className={`fitment-review-state ${meta.className}`}>{meta.label}</b><small>{item.risks.length ? `${item.risks.length} 项风险` : '边界完整'}</small></span>
          </button>
        })}{!result.items.length && !loading ? <div className="fitment-governance-empty"><SealCheck size={39} weight="duotone" /><strong>当前队列没有适配关系</strong><span>可切换状态查看已处理记录</span></div> : null}</div>
      </article>

      <aside className="fitment-governance-detail">
        {selected ? <>
          <header><div><span className={`fitment-review-state ${(statusMeta[selected.fitment.verificationStatus] || statusMeta.pending).className}`}>{(statusMeta[selected.fitment.verificationStatus] || statusMeta.pending).label}</span><span>关系 v{selected.fitment.reviewVersion} · SKU v{selected.skuVersion}</span></div><h2>{selected.fitment.vehicleLabel}</h2><p>{selected.skuName} · {selected.primaryOe || selected.skuCode}</p></header>
          <div className="fitment-governance-scroll">
            <section><div className="quality-section-title"><h3>适配边界</h3><span>{selected.risks.length ? `${selected.risks.length} 项提示` : '字段完整'}</span></div><dl className="fitment-boundaries"><div><dt>平台编码</dt><dd>{selected.fitment.vehiclePlatformId || '—'}</dd></div><div><dt>车型版本</dt><dd>{selected.fitment.variantCode ? `${selected.fitment.variantCode} · ${selected.fitment.variantLabel}` : '平台级适配'}</dd></div><div><dt>年款</dt><dd>{selected.fitment.years || '—'}</dd></div><div><dt>发动机</dt><dd>{values(selected.fitment.engineCodes)}</dd></div><div><dt>变速箱</dt><dd>{values(selected.fitment.transmissionCodes)}</dd></div><div><dt>市场</dt><dd>{values(selected.fitment.marketCodes)}</dd></div><div><dt>车身 / 驱动</dt><dd>{[...selected.fitment.bodyStyles, ...selected.fitment.driveTypes].join('、') || '—'}</dd></div><div><dt>PR 代码</dt><dd>{values(selected.fitment.prCodes)}</dd></div><div><dt>安装位置</dt><dd>{selected.fitment.position || '—'}</dd></div><div className="wide"><dt>包含条件</dt><dd>{conditionText(selected.fitment.includeConditions)}</dd></div><div className="wide"><dt>排除条件</dt><dd>{conditionText(selected.fitment.excludeConditions)}</dd></div></dl></section>
            <section><div className="quality-section-title"><h3>风险检查</h3></div><div className="fitment-risk-list">{selected.risks.map((risk) => <div className={risk.blocking ? 'blocking' : ''} key={risk.code}>{risk.blocking ? <XCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}<span><strong>{risk.label}</strong><small>{risk.blocking ? '通过前必须补齐' : '建议审核时确认'}</small></span></div>)}{!selected.risks.length ? <div className="clear"><CheckCircle size={18} weight="fill" /><span><strong>关键边界完整</strong><small>仍需人工核对真实性</small></span></div> : null}</div></section>
            <section><div className="quality-section-title"><h3>来源证据</h3></div>{selected.evidence ? <dl className="fitment-evidence"><div><dt>来源系统</dt><dd>{selected.evidence.sourceSystem || '—'}</dd></div><div><dt>目录 / 记录</dt><dd>{selected.evidence.catalogPath || selected.evidence.sourceRecordId || '—'}</dd></div><div><dt>图例位置</dt><dd>{selected.evidence.figurePosition || '—'}</dd></div><div><dt>原始名称</dt><dd>{selected.evidence.originalName || '—'}</dd></div></dl> : <div className="fitment-no-evidence"><WarningCircle size={18} weight="fill" />没有关联来源证据</div>}</section>
            {selected.fitment.reviewNote ? <section><div className="quality-section-title"><h3>最近审核</h3><span>{selected.fitment.reviewedBy || '—'}</span></div><p className="fitment-last-note">{selected.fitment.reviewNote}</p></section> : null}
            <section className="fitment-decision"><div className="quality-section-title"><h3>审核结论</h3><span>{canReview ? '结论将永久留痕' : '当前角色只读'}</span></div><textarea aria-label="适配审核结论" value={note} disabled={!canReview || busy} onChange={(event) => setNote(event.target.value)} placeholder="说明核验依据、适配边界或需要补充的资料" />{error ? <p><WarningCircle size={17} weight="fill" />{error}</p> : null}<div><button type="button" disabled={!canReview || busy} onClick={() => decide('conflict')}>标记冲突</button><button type="button" disabled={!canReview || busy} onClick={() => decide('reject')}>退回补充</button><button className="approve" type="button" disabled={!canReview || busy || blockingRisks.length > 0} onClick={() => decide('approve')}>{busy ? '正在提交…' : '通过适配'}</button></div></section>
          </div>
        </> : <div className="quality-no-selection"><CarProfile size={43} weight="duotone" /><strong>选择一条适配关系开始审核</strong></div>}
      </aside>
    </div>
  </section>
}
