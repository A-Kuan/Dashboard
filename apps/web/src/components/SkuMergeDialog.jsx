import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle, GitMerge, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react'
import { mergeCatalogSkus, previewCatalogMerge } from '../services/catalogApi'
import '../sku-merge.css'

const identityLabels = { nameZh: '中文名称', nameEn: '英文名称', brandLabel: '品牌', categoryLabel: '分类', unitLabel: '单位' }

export function SkuMergeDialog({ conflict, onClose, onMerged, onNotify }) {
  const [survivorId, setSurvivorId] = useState(conflict.left.id)
  const [preview, setPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setConfirmed(false)
    previewCatalogMerge(conflict, survivorId).then((result) => { if (active) setPreview(result) }).catch((reasonValue) => { if (active) setError(reasonValue.message || '合并预览加载失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [conflict, survivorId])

  const execute = async () => {
    if (!reason.trim()) { setError('请填写本次合并依据'); return }
    if (!confirmed) { setError('请确认已核对保留项与停用项'); return }
    setBusy(true)
    setError('')
    try {
      const result = await mergeCatalogSkus(conflict, survivorId, reason.trim())
      onNotify?.(`已合并至 ${result.survivor.identity.skuCode}，原 SKU 已安全停用`)
      onMerged?.(result)
      onClose()
    } catch (reasonValue) {
      setError(reasonValue.message || 'SKU 合并失败')
    } finally {
      setBusy(false)
    }
  }

  return <div className="sku-merge-backdrop" onMouseDown={onClose}>
    <section className="sku-merge-dialog" role="dialog" aria-modal="true" aria-label="安全合并重复 SKU" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span><GitMerge size={24} weight="duotone" /></span><div><h2>安全合并重复 SKU</h2><p>保留主资料，迁移编号、适配和来源；原资料仅停用，不物理删除。</p></div></div><button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button></header>
      <div className="sku-merge-scroll">
        <section className="sku-merge-choice"><div><h3>1. 选择保留的主 SKU</h3><small>名称、品牌、分类和单位以主 SKU 为准</small></div><div>{[conflict.left, conflict.right].map((item) => <label className={survivorId === item.id ? 'selected' : ''} key={item.id}><input type="radio" name="survivor" checked={survivorId === item.id} onChange={() => setSurvivorId(item.id)} /><span><b>{item.nameZh}</b><small>{item.skuCode} · v{item.version}</small></span>{survivorId === item.id ? <em><ShieldCheck size={16} />保留</em> : <em className="retire">停用</em>}</label>)}</div></section>
        {loading ? <div className="sku-merge-state">正在计算迁移方案…</div> : preview ? <>
          <section className="sku-merge-flow"><article><span>主 SKU · 接收资料</span><strong>{preview.survivor.identity.skuCode}</strong><small>{preview.survivor.identity.nameZh}</small></article><ArrowLeft size={24} weight="bold" /><article className="retired"><span>汇入后停用</span><strong>{preview.retired.identity.skuCode}</strong><small>{preview.retired.identity.nameZh}</small></article></section>
          <section className="sku-merge-plan"><div><h3>2. 核对自动迁移方案</h3><small>相同内容自动去重，所有动作写入版本历史</small></div><div className="sku-merge-metrics"><article><strong>+{preview.summary.identifiersAdded}</strong><span>新增编号</span><small>{preview.summary.identifiersDeduplicated} 条去重</small></article><article><strong>+{preview.summary.fitmentsAdded}</strong><span>新增适配</span><small>{preview.summary.fitmentsDeduplicated} 条去重</small></article><article><strong>+{preview.summary.evidenceAdded}</strong><span>新增证据</span><small>{preview.summary.evidenceDeduplicated} 条去重</small></article><article><strong>{preview.summary.interchangesReviewed}</strong><span>互换关系</span><small>重新归属主 SKU</small></article></div></section>
          {preview.identityDifferences.length ? <section className="sku-merge-differences"><h3>不会自动覆盖的主资料差异</h3><div>{preview.identityDifferences.map((item) => <div key={item.field}><span>{identityLabels[item.field] || item.field}</span><b>{item.survivor}</b><small>{item.retired}</small></div>)}</div><p><WarningCircle size={17} />右侧停用资料的这些字段不会覆盖主 SKU，合并后可在草稿中人工调整。</p></section> : <section className="sku-merge-aligned"><CheckCircle size={19} weight="fill" />两条 SKU 的主资料字段一致</section>}
          <section className="sku-merge-reason"><h3>3. 记录合并依据</h3><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：经 Porsche EPC 图组 601-05 和实物标签复核，两条资料为同一前刹车片。" /><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对保留项与停用项，确认原 SKU 将变为“已停用”，主 SKU 将回到草稿并重新审核。</span></label></section>
        </> : null}
        {error ? <p className="sku-merge-error"><WarningCircle size={17} />{error}</p> : null}
      </div>
      <footer><div><ShieldCheck size={17} weight="duotone" /><span>版本锁、双份快照和操作人留痕已开启</span></div><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={!preview || loading || busy || !confirmed || !reason.trim()} onClick={execute}>{busy ? '正在合并…' : '确认安全合并'}</button></footer>
    </section>
  </div>
}
