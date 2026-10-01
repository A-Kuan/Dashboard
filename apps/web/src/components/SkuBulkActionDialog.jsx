import { useState } from 'react'
import { CheckCircle, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react'
import { bulkTransitionCatalogSkus } from '../services/catalogApi'

const actionMeta = {
  submit_review: { title: '批量提交审核', description: '完整性与编号冲突会逐条检查，不合格资料不会进入审核。', confirm: '提交审核' },
  assign_review: { title: '批量分配审核人', description: '只更新审核中的资料，每条记录仍保留独立审计事件。', confirm: '确认分配' },
  discontinue: { title: '批量停用资料', description: '停用不会删除历史数据；恢复后仍需重新审核。', confirm: '确认停用', danger: true },
}

export function SkuBulkActionDialog({ records, action, onClose, onCompleted, onNotify }) {
  const meta = actionMeta[action]
  const [assignee, setAssignee] = useState('资料审核员')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const execute = async () => {
    if (action === 'discontinue' && !note.trim()) { setError('批量停用必须填写原因'); return }
    if (action === 'assign_review' && !assignee.trim()) { setError('请选择或填写审核人'); return }
    setBusy(true)
    setError('')
    try {
      const next = await bulkTransitionCatalogSkus(records, action, { note: note.trim(), assignee: assignee.trim() })
      setResult(next)
      onCompleted?.(next)
      onNotify?.(`批量操作完成：成功 ${next.succeeded} 条，失败 ${next.failed} 条`)
    } catch (actionError) {
      setError(actionError.message || '批量操作失败')
    } finally {
      setBusy(false)
    }
  }

  return <div className="sku-bulk-backdrop" onMouseDown={onClose}><section className="sku-bulk-dialog" role="dialog" aria-modal="true" aria-label={meta.title} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className={meta.danger ? 'danger' : ''}><ShieldCheck size={22} weight="duotone" /></span><div><h2>{meta.title}</h2><p>{meta.description}</p></div></div><button type="button" aria-label="关闭批量操作" onClick={onClose}><X size={20} weight="bold" /></button></header>
    {!result ? <><div className="sku-bulk-selection"><strong>已选择 {records.length} 条资料</strong><div>{records.slice(0, 6).map((record) => <span key={record.id}>{record.name}<small>{record.code} · v{record.version}</small></span>)}{records.length > 6 ? <em>另有 {records.length - 6} 条</em> : null}</div></div>
      {action !== 'discontinue' ? <label className="sku-bulk-field"><span>审核人</span><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="输入审核人" /></label> : null}
      <label className="sku-bulk-field"><span>{action === 'discontinue' ? '停用原因（必填）' : '操作说明（选填）'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === 'discontinue' ? '说明停用原因，例如：编号已被新件号替代' : '补充本次批量操作的说明'} /></label>
      {error ? <p className="sku-bulk-error"><WarningCircle size={17} />{error}</p> : null}
      <footer><button type="button" onClick={onClose}>取消</button><button className={meta.danger ? 'danger' : 'primary'} type="button" disabled={busy} onClick={execute}>{busy ? '正在处理…' : `${meta.confirm} ${records.length} 条`}</button></footer></> : <div className="sku-bulk-result"><CheckCircle size={42} weight="fill" /><h3>批量操作已完成</h3><p>成功 {result.succeeded} 条，失败 {result.failed} 条</p>{result.failures?.length ? <div>{result.failures.map((failure) => <span key={failure.id}><strong>{failure.id}</strong>{failure.message}</span>)}</div> : null}<button type="button" onClick={onClose}>返回资料库</button></div>}
  </section></div>
}
