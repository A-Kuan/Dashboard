import { useMemo, useState } from 'react'
import { ArrowCounterClockwise, CheckCircle, ClockCounterClockwise, GitDiff, X } from '@phosphor-icons/react'
import { restoreCatalogSkuVersion } from '../services/catalogApi'

const actionLabels = {
  create_draft: '创建资料草稿', update_draft: '更新资料草稿', update_requires_review: '编辑后重新审核', verify: '资料核验通过',
  submit_review: '提交资料审核', approve_review: '审核通过', reject_review: '退回修改', assign_review: '分配审核人',
  discontinue: '停用资料', reopen: '恢复为草稿', restore_version: '恢复历史版本',
}

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function text(value) {
  return String(value ?? '').trim() || '—'
}

function joinIdentifiers(value) {
  return (value || []).map((item) => `${item.isPrimary ? '主 OE' : item.type || '编号'} ${item.rawValue}`).join('；') || '—'
}

function joinFitments(value) {
  return (value || []).map((item) => [item.vehicleLabel, item.years, item.position].filter(Boolean).join(' · ')).join('；') || '—'
}

function joinEvidence(value) {
  return (value || []).map((item) => [item.sourceSystem, item.sourceRecordId, item.catalogPath].filter(Boolean).join(' · ')).join('；') || '—'
}

function comparisonRows(current, historical) {
  const currentIdentity = current.identity || {}
  const historyIdentity = historical.identity || {}
  return [
    ['中文名称', text(currentIdentity.nameZh), text(historyIdentity.nameZh)],
    ['英文名称', text(currentIdentity.nameEn), text(historyIdentity.nameEn)],
    ['品牌', text(currentIdentity.brandLabel || currentIdentity.brandCode), text(historyIdentity.brandLabel || historyIdentity.brandCode)],
    ['分类', text(currentIdentity.categoryLabel || currentIdentity.categoryCode), text(historyIdentity.categoryLabel || historyIdentity.categoryCode)],
    ['计量单位', text(currentIdentity.unitLabel || currentIdentity.unitCode), text(historyIdentity.unitLabel || historyIdentity.unitCode)],
    ['零件编号', joinIdentifiers(current.identifiers), joinIdentifiers(historical.identifiers)],
    ['适配车型', joinFitments(current.fitments), joinFitments(historical.fitments)],
    ['来源证据', joinEvidence(current.evidence), joinEvidence(historical.evidence)],
  ].map(([label, currentValue, historyValue]) => ({ label, currentValue, historyValue, changed: currentValue !== historyValue }))
}

export function SkuVersionDialog({ record, initialChange, onClose, onRestored, onNotify }) {
  const [selectedId, setSelectedId] = useState(initialChange?.id || record.changes?.[0]?.id)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = record.changes?.find((item) => item.id === selectedId) || initialChange || record.changes?.[0]
  const rows = useMemo(() => comparisonRows(record.aggregate || {}, selected?.snapshot || {}), [record, selected])
  const changedCount = rows.filter((row) => row.changed).length
  const canRestore = Boolean(selected && selected.version < record.version)

  const restore = async () => {
    if (!reason.trim()) { setError('请填写恢复原因，便于后续审计'); return }
    setBusy(true)
    setError('')
    try {
      const restored = await restoreCatalogSkuVersion(record, selected.version, reason.trim())
      onRestored(restored)
      onNotify?.(`已从 v${selected.version} 恢复为新草稿 v${restored.version}`)
      onClose()
    } catch (restoreError) {
      setError(restoreError.message || '版本恢复失败')
    } finally {
      setBusy(false)
    }
  }

  return <div className="sku-version-backdrop" onMouseDown={onClose}>
    <div className="sku-version-dialog" role="dialog" aria-modal="true" aria-label="SKU 版本对比" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span><GitDiff size={23} weight="duotone" /></span><div><h2>版本对比</h2><p>{record.name} · 当前 v{record.version}</p></div></div><button type="button" aria-label="关闭版本对比" onClick={onClose}><X size={20} weight="bold" /></button></header>
      <div className="sku-version-layout">
        <aside><div><strong>变更时间线</strong><span>{record.changes?.length || 0} 个版本</span></div><nav>{(record.changes || []).map((change) => <button type="button" className={change.id === selected?.id ? 'active' : ''} key={change.id} onClick={() => { setSelectedId(change.id); setError('') }}><span>{change.action === 'restore_version' ? <ArrowCounterClockwise size={18} /> : change.version === record.version ? <CheckCircle size={18} /> : <ClockCounterClockwise size={18} />}</span><div><strong>v{change.version} · {actionLabels[change.action] || change.action}</strong><small>{change.changedBy || '系统操作员'} · {displayTime(change.changedAt)}</small></div></button>)}</nav></aside>
        <main><div className="sku-version-summary"><div><span>选择版本</span><strong>v{selected?.version || '—'}</strong></div><div><span>与当前不同</span><strong>{changedCount} 项</strong></div><p>恢复只复制业务资料内容，并生成新的草稿版本；审核状态不会回退。</p></div>
          <section className="sku-version-compare"><div className="sku-version-compare-head"><span>字段</span><span>当前 v{record.version}</span><span>历史 v{selected?.version || '—'}</span></div>{rows.map((row) => <div className={row.changed ? 'changed' : ''} key={row.label}><strong>{row.label}</strong><span>{row.currentValue}</span><span>{row.historyValue}</span></div>)}</section>
          <div className="sku-version-restore"><label><span>恢复原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canRestore || busy} placeholder={canRestore ? '例如：撤销错误的 OE 与车型适配修改' : '当前版本无需恢复'} /></label>{error ? <p>{error}</p> : null}<div><button type="button" onClick={onClose}>取消</button><button className="primary" type="button" disabled={!canRestore || busy} onClick={restore}><ArrowCounterClockwise size={17} weight="bold" />{busy ? '正在恢复…' : `恢复 v${selected?.version || ''} 为新草稿`}</button></div></div>
        </main>
      </div>
    </div>
  </div>
}
