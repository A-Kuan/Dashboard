import { useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, ChartLineUp, CheckCircle, Clock, FileArrowUp, WarningCircle } from '@phosphor-icons/react'
import { getCatalogMetrics } from '../services/catalogApi'

const issueLabels = {
  identity: '标准名称缺失', classification: '品牌或分类缺失', primaryIdentifier: '主 OE 缺失',
  fitment: '适配车型缺失', evidence: '来源证据缺失', duplicateIdentifier: '编号冲突',
}

const statusLabels = { draft: '草稿', review: '待审核', verified: '已核验', discontinued: '已停用' }
const statusColors = { draft: '#9aa5b1', review: '#e7c52d', verified: '#22a447', discontinued: '#d45a50' }

function percent(part, total) {
  return total ? Math.round((Number(part) / Number(total)) * 100) : 0
}

function ActivityChart({ activity }) {
  const visible = activity.slice(-30)
  const max = Math.max(1, ...visible.flatMap((item) => [item.created, item.submitted, item.approved, item.rejected]))
  const width = 760
  const height = 210
  const pad = 24
  const points = (field) => visible.map((item, index) => {
    const x = visible.length === 1 ? width / 2 : pad + (index / (visible.length - 1)) * (width - pad * 2)
    const y = height - pad - (Number(item[field]) / max) * (height - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return <div className="quality-activity-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="SKU 资料处理趋势图"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} /><line x1={pad} y1={pad} x2={pad} y2={height - pad} /><polyline className="created" points={points('created')} /><polyline className="submitted" points={points('submitted')} /><polyline className="approved" points={points('approved')} /><polyline className="rejected" points={points('rejected')} /></svg><div className="quality-chart-axis"><span>{visible[0]?.day?.slice(5) || '—'}</span><span>{visible[Math.floor(visible.length / 2)]?.day?.slice(5) || '—'}</span><span>{visible.at(-1)?.day?.slice(5) || '—'}</span></div></div>
}

export function SkuQualityInsights() {
  const [days, setDays] = useState(30)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getCatalogMetrics(days).then((result) => { if (active) setMetrics(result) }).catch((reason) => { if (active) setError(reason.message || '统计数据加载失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days])

  const derived = useMemo(() => {
    if (!metrics) return null
    const total = Object.values(metrics.statusCounts || {}).reduce((sum, value) => sum + Number(value), 0)
    const reviews = metrics.reviews || {}
    const decisions = Number(reviews.approved) + Number(reviews.rejected)
    const completeness = metrics.completeness || {}
    const completeRate = percent(completeness.complete, Number(completeness.low) + Number(completeness.medium) + Number(completeness.complete))
    return { total, approvalRate: percent(reviews.approved, decisions), completeRate }
  }, [metrics])

  if (loading && !metrics) return <div className="quality-insights-state"><ArrowClockwise size={30} /><strong>正在汇总运营数据…</strong></div>
  if (error && !metrics) return <div className="quality-insights-state error"><WarningCircle size={30} /><strong>{error}</strong></div>
  const reviews = metrics.reviews || {}
  const imports = metrics.imports || {}
  const statusEntries = Object.entries(metrics.statusCounts || {})
  const issueEntries = Object.entries(metrics.issueCounts || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
  const completeness = metrics.completeness || { low: 0, medium: 0, complete: 0 }

  return <div className="quality-insights">
    <div className="quality-insights-head"><div><h2>运营洞察</h2><p>只统计真实资料、审核事件与导入批次。</p></div><label>统计周期<select aria-label="统计周期" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={14}>最近 14 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></select></label></div>
    <section className="quality-insight-kpis">
      <article><span><CheckCircle size={20} weight="duotone" />审核通过率</span><strong>{derived.approvalRate}%</strong><small>{reviews.approved || 0} 通过 · {reviews.rejected || 0} 退回</small></article>
      <article><span><Clock size={20} weight="duotone" />平均审核耗时</span><strong>{Number(reviews.avg_hours || 0).toFixed(1)}h</strong><small>{reviews.overdue || 0} 条已超过审核期限</small></article>
      <article><span><FileArrowUp size={20} weight="duotone" />导入成功率</span><strong>{imports.successRate || 0}%</strong><small>{imports.batches || 0} 个批次 · {imports.imported_rows || 0} 条写入</small></article>
      <article><span><ChartLineUp size={20} weight="duotone" />资料完整率</span><strong>{derived.completeRate}%</strong><small>{completeness.complete || 0} 条达到 100%</small></article>
    </section>
    <section className="quality-insight-grid">
      <article className="quality-trend-card"><header><div><h3>资料处理趋势</h3><p>创建、提交审核、通过与退回</p></div><div className="quality-chart-legend"><span className="created">创建</span><span className="submitted">提交</span><span className="approved">通过</span><span className="rejected">退回</span></div></header><ActivityChart activity={metrics.activity || []} /></article>
      <article className="quality-status-card"><header><h3>当前资料结构</h3><span>共 {derived.total} 条</span></header><div className="quality-status-bars">{statusEntries.length ? statusEntries.map(([key, value]) => <div key={key}><span><b>{statusLabels[key] || key}</b><em>{value} 条 · {percent(value, derived.total)}%</em></span><i><b style={{ width: `${percent(value, derived.total)}%`, background: statusColors[key] || '#8996a5' }} /></i></div>) : <p>暂无资料</p>}</div><div className="quality-completeness"><div style={{ '--complete': `${derived.completeRate * 3.6}deg` }}><strong>{derived.completeRate}%</strong><span>完整</span></div><dl><div><dt>完整</dt><dd>{completeness.complete || 0}</dd></div><div><dt>待补充</dt><dd>{completeness.medium || 0}</dd></div><div><dt>严重缺失</dt><dd>{completeness.low || 0}</dd></div></dl></div></article>
      <article className="quality-issues-card"><header><div><h3>质量问题分布</h3><p>同一条资料可能包含多个问题</p></div><span>{issueEntries.reduce((sum, [, value]) => sum + Number(value), 0)} 项</span></header><div>{issueEntries.length ? issueEntries.map(([key, value]) => { const max = Math.max(...issueEntries.map(([, count]) => Number(count)), 1); return <div key={key}><span><b>{issueLabels[key] || key}</b><em>{value}</em></span><i><b style={{ width: `${(Number(value) / max) * 100}%` }} /></i></div> }) : <p className="quality-insight-empty"><CheckCircle size={24} weight="duotone" />当前没有质量问题</p>}</div></article>
      <article className="quality-efficiency-card"><header><h3>审核效率</h3><span>{days} 天</span></header><div><article><span>提交审核</span><strong>{reviews.submitted || 0}</strong></article><article><span>完成决策</span><strong>{Number(reviews.approved || 0) + Number(reviews.rejected || 0)}</strong></article><article><span>逾期队列</span><strong className={Number(reviews.overdue) ? 'alert' : ''}>{reviews.overdue || 0}</strong></article></div><p>{Number(reviews.overdue) ? '存在逾期审核，请优先处理质量队列。' : reviews.submitted ? '当前审核节奏正常，没有逾期任务。' : '尚无审核事件，数据会在提交审核后自动形成。'}</p></article>
    </section>
  </div>
}
