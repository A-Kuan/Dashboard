import { useState } from 'react'
import { BracketsCurly, Database, DownloadSimple, FileCsv, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react'
import { downloadCatalogExport } from '../services/catalogApi'
import '../sku-export.css'

const formats = [
  { id: 'json', title: '完整审计包', note: '包含 SKU、编号、适配、来源证据、版本历史、冲突结论与合并索引。', icon: BracketsCurly },
  { id: 'csv', title: '业务表格', note: '每个 SKU 一行，适合 Excel 查阅、盘点和人工复核。', icon: FileCsv },
]

const scopes = [
  { id: 'all', label: '全部状态' }, { id: 'draft', label: '仅草稿' }, { id: 'review', label: '仅待审核' },
  { id: 'verified', label: '仅已核验' }, { id: 'discontinued', label: '仅已停用' },
]

export function SkuExportDialog({ currentStatus = 'all', total = 0, onClose, onNotify }) {
  const [format, setFormat] = useState('json')
  const [scope, setScope] = useState(currentStatus || 'all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await downloadCatalogExport(format, scope)
      onNotify?.(`已生成 ${result.filename}`)
      onClose()
    } catch (reason) {
      setError(reason.message || '导出失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return <div className="sku-export-backdrop" onMouseDown={onClose}>
    <section className="sku-export-dialog" role="dialog" aria-modal="true" aria-label="导出 SKU 资料" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span><Database size={23} weight="duotone" /></span><div><h2>导出 SKU 资料</h2><p>生成可留档、可核对的资料副本，不会修改现有数据。</p></div></div><button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button></header>
      <div className="sku-export-body">
        <section><div className="sku-export-section-title"><h3>选择导出格式</h3><span>推荐同时保留 JSON 审计包</span></div><div className="sku-export-formats">{formats.map((item) => { const Icon = item.icon; return <label className={format === item.id ? 'selected' : ''} key={item.id}><input type="radio" name="export-format" checked={format === item.id} onChange={() => setFormat(item.id)} /><Icon size={24} weight="duotone" /><span><strong>{item.title}</strong><small>{item.note}</small></span><em>.{item.id}</em></label> })}</div></section>
        <section className="sku-export-scope"><div><h3>导出范围</h3><p>当前资料库共 {total} 条真实 SKU</p></div><select aria-label="导出范围" value={scope} onChange={(event) => setScope(event.target.value)}>{scopes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></section>
        <section className="sku-export-integrity"><ShieldCheck size={21} weight="duotone" /><div><strong>审计包自带完整性信息</strong><p>JSON 文件包含架构版本、生成时间、数据计数和 SHA-256 内容校验值，便于交接与核对。</p></div></section>
        <section className="sku-export-warning"><WarningCircle size={19} /><p><strong>业务导出不等于数据库备份。</strong>数据库备份还会保留导入任务、配置和内部关联；上线后应按发布流程定期生成 PostgreSQL 备份。</p></section>
        {error ? <p className="sku-export-error"><WarningCircle size={17} />{error}</p> : null}
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy} onClick={download}><DownloadSimple size={18} weight="bold" />{busy ? '正在生成…' : `下载 ${format.toUpperCase()}`}</button></footer>
    </section>
  </div>
}
