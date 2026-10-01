import { useEffect, useMemo, useState } from 'react'
import { ArrowsLeftRight, CheckCircle, GitMerge, Scales, WarningCircle } from '@phosphor-icons/react'
import { getCatalogSku, listCatalogConflicts, resolveCatalogConflict } from '../services/catalogApi'
import { SkuMergeDialog } from './SkuMergeDialog'

const resolutionOptions = [
  { value: 'shared_reference', label: '合法共用参考号', description: '套装、单件或关联商品确实允许共用该参考编号。', icon: ArrowsLeftRight },
  { value: 'separate_scope', label: '适用范围不同', description: '品牌、市场、年款或适配条件不同，应保留两条独立资料。', icon: Scales },
  { value: 'merge_required', label: '确认为重复，待合并', description: '两条资料代表同一零件，继续保留冲突并进入后续合并。', icon: GitMerge },
]

function itemFacts(record) {
  if (!record) return []
  const aggregate = record.aggregate || {}
  return [
    ['品牌 / 分类', `${record.brand} · ${record.category}`],
    ['零件编号', record.identifiers.map((item) => item.value).join('、') || '—'],
    ['适配车型', record.fitments.map((item) => `${item.vehicle} ${item.years}`).join('；') || '—'],
    ['来源证据', `${record.evidence.system} · ${record.evidence.sourceRecordId || record.evidence.catalog}`],
    ['资料版本', `v${aggregate.version || record.version}`],
  ]
}

export function SkuConflictCenter({ canResolve = false, canMerge = false, onNotify, onResolved }) {
  const [conflicts, setConflicts] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [details, setDetails] = useState([])
  const [resolutionType, setResolutionType] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)

  const load = async (preferredKey = '') => {
    setLoading(true)
    setError('')
    try {
      const result = await listCatalogConflicts()
      setConflicts(result.items || [])
      setSelectedKey((current) => (result.items || []).some((item) => item.key === (preferredKey || current)) ? preferredKey || current : result.items?.[0]?.key || '')
    } catch (reason) {
      setError(reason.message || '编号冲突加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  const selected = useMemo(() => conflicts.find((item) => item.key === selectedKey) || null, [conflicts, selectedKey])
  useEffect(() => {
    if (!selected) { setDetails([]); return undefined }
    let active = true
    setResolutionType(selected.resolution?.type || '')
    setNote(selected.resolution?.note || '')
    Promise.all([getCatalogSku(selected.left.id), getCatalogSku(selected.right.id)]).then((records) => { if (active) setDetails(records) }).catch((reason) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [selected])

  const resolve = async () => {
    if (!resolutionType) { setError('请选择处理结论'); return }
    if (!note.trim()) { setError('请填写判断依据'); return }
    setBusy(true)
    setError('')
    try {
      const result = await resolveCatalogConflict(selected, resolutionType, note.trim())
      onNotify?.(resolutionType === 'merge_required' ? '已标记为待合并，冲突继续保留' : '冲突结论已保存，质量阻断已解除')
      onResolved?.(result.items)
      await load(selected.key)
    } catch (reason) {
      setError(reason.message || '冲突处理失败')
    } finally {
      setBusy(false)
    }
  }

  return <><section className="conflict-workspace">
    <article className="conflict-list-panel"><header><div><h2>编号冲突</h2><span>{loading ? '正在检查…' : `${conflicts.length} 组冲突`}</span></div><p>相同规范编号出现在多条有效 SKU 中</p></header><div>{conflicts.map((conflict) => <button type="button" className={selectedKey === conflict.key ? 'selected' : ''} key={conflict.key} onClick={() => setSelectedKey(conflict.key)}><span><WarningCircle size={20} weight="fill" /></span><div><strong>{conflict.rawValues[0]}</strong><small>{conflict.left.nameZh} ↔ {conflict.right.nameZh}</small><em className={conflict.resolution ? conflict.resolution.type : ''}>{conflict.resolution ? resolutionOptions.find((option) => option.value === conflict.resolution.type)?.label : '待处理'}</em></div></button>)}{!conflicts.length && !loading ? <div className="conflict-empty"><CheckCircle size={38} weight="duotone" /><strong>没有编号冲突</strong><span>当前所有有效 SKU 的编号关系清晰</span></div> : null}</div></article>
    <article className="conflict-detail-panel">{selected ? <><header><div><span>规范编号</span><strong>{selected.normalizedValue}</strong></div><p>处理结论只解释这两条 SKU 的编号关系，不会删除或自动合并资料。</p></header><div className="conflict-compare">{[selected.left, selected.right].map((summary, index) => { const record = details[index]; return <section key={summary.id}><div><span className={`sku-state ${summary.lifecycleStatus}`}>{record?.statusLabel || summary.lifecycleStatus}</span><small>v{summary.version}</small></div><h3>{record?.name || summary.nameZh}</h3><p>{summary.skuCode}</p><dl>{itemFacts(record).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section> })}</div><div className="conflict-resolution"><h3>处理结论</h3><div>{resolutionOptions.map((option) => { const Icon = option.icon; return <label className={resolutionType === option.value ? 'selected' : ''} key={option.value}><input type="radio" name="resolution" value={option.value} checked={resolutionType === option.value} disabled={!canResolve || busy} onChange={() => setResolutionType(option.value)} /><Icon size={20} weight="duotone" /><span><strong>{option.label}</strong><small>{option.description}</small></span></label> })}</div><label className="conflict-note"><span>判断依据</span><textarea value={note} disabled={!canResolve || busy} onChange={(event) => setNote(event.target.value)} placeholder={canResolve ? '记录品牌目录、EPC 图组、适用范围或人工复核依据' : '当前角色没有处理冲突的权限'} /></label>{error ? <p><WarningCircle size={17} />{error}</p> : null}<div className="conflict-actions">{selected.resolution?.type === 'merge_required' ? <button type="button" className="merge" disabled={!canMerge || busy} onClick={() => setMergeOpen(true)}><GitMerge size={17} />{canMerge ? '进入安全合并' : '仅管理员可合并'}</button> : null}<button type="button" disabled={!canResolve || busy} onClick={resolve}>{busy ? '正在保存…' : selected.resolution ? '更新处理结论' : '保存处理结论'}</button></div></div></> : <div className="conflict-no-selection"><ArrowsLeftRight size={44} weight="duotone" /><strong>选择一组冲突开始核对</strong></div>}</article>
  </section>{mergeOpen && selected ? <SkuMergeDialog conflict={selected} onClose={() => setMergeOpen(false)} onNotify={onNotify} onMerged={() => { load(); onResolved?.() }} /> : null}</>
}
