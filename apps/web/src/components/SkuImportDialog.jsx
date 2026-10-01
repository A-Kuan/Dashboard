import { useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCircle, DownloadSimple, FileCsv, UploadSimple, WarningCircle, X } from '@phosphor-icons/react'
import { commitCatalogImport, parseCatalogCsv, previewCatalogImport } from '../services/catalogApi'
import '../sku-import.css'

const template = `中文名称,英文名称,品牌,分类,单位,主 OE,车型,年款范围,适配条件,来源系统,来源记录ID
前刹车片,"Brake pad set, front",Porsche OE,制动系统 / 制动片,件,95B 698 151 H,Macan (95B),2014-2018,前轴且排除 PSCB,Porsche PET,698-05-12`

const rowState = {
  ready: { label: '可导入', className: 'ready' },
  duplicate: { label: '疑似重复', className: 'duplicate' },
  invalid: { label: '不可导入', className: 'invalid' },
  imported: { label: '已写入', className: 'imported' },
  skipped: { label: '已跳过', className: 'skipped' },
  failed: { label: '写入失败', className: 'invalid' },
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([`\uFEFF${template}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'SKU资料导入模板.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function SkuImportDialog({ onClose, onCompleted, onNotify }) {
  const inputRef = useRef(null)
  const [step, setStep] = useState('upload')
  const [job, setJob] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.csv')) return setError('目前支持 CSV 文件，请先下载模板整理字段')
    if (file.size > 2 * 1024 * 1024) return setError('文件超过 2 MB，请拆分后导入')
    setBusy(true)
    try {
      const rows = parseCatalogCsv(await file.text())
      const preview = await previewCatalogImport(file.name, rows)
      setJob(preview)
      setSelected(new Set(preview.rows.filter((row) => row.state === 'ready').map((row) => row.id)))
      setStep('preview')
    } catch (reason) {
      setError(reason.message || '文件解析失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleRow = (row) => {
    if (!['ready', 'duplicate'].includes(row.state)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const commit = async () => {
    if (!selected.size) return setError('至少选择一条可导入记录')
    setBusy(true)
    setError('')
    try {
      const result = await commitCatalogImport(job.id, job.version, [...selected])
      setJob(result)
      setStep('result')
      onCompleted?.(result)
      onNotify?.(`已导入 ${result.importedRows} 条 SKU 草稿`)
    } catch (reason) {
      setError(reason.message || '导入提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sku-modal-backdrop" onMouseDown={onClose}>
      <section className="sku-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入 SKU" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sku-import-head">
          <div><span className="sku-import-icon"><FileCsv size={23} weight="duotone" /></span><div><h2>批量导入 SKU</h2><p>先预检查，再选择写入；原始文件与每行结果都会保留。</p></div></div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button>
        </header>

        <nav className="sku-import-steps" aria-label="导入步骤">
          {['选择文件', '预检查', '写入结果'].map((label, index) => {
            const current = { upload: 0, preview: 1, result: 2 }[step]
            return <span className={index === current ? 'active' : index < current ? 'done' : ''} key={label}><i>{index < current ? <Check size={13} weight="bold" /> : index + 1}</i>{label}</span>
          })}
        </nav>

        <div className="sku-import-body">
          {step === 'upload' ? <>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => handleFile(event.target.files?.[0])} />
            <button className={`sku-import-dropzone ${dragging ? 'dragging' : ''}`} type="button" onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files?.[0]) }}>
              <span><UploadSimple size={28} weight="bold" /></span><strong>{busy ? '正在预检查…' : '选择或拖入 CSV 文件'}</strong><small>最多 500 行、2 MB；不会直接写入资料库</small>
            </button>
            <div className="sku-import-guidance"><div><strong>必需列</strong><span>中文名称或英文名称、主 OE</span></div><div><strong>建议列</strong><span>品牌、分类、车型、年款、来源系统</span></div><button type="button" onClick={downloadTemplate}><DownloadSimple size={17} />下载 CSV 模板</button></div>
          </> : null}

          {step === 'preview' ? <>
            <div className="sku-import-summary"><div><span>总行数</span><strong>{job.totalRows}</strong></div><div className="ready"><span>可导入</span><strong>{job.readyRows}</strong></div><div className="duplicate"><span>疑似重复</span><strong>{job.duplicateRows}</strong></div><div className="invalid"><span>不可导入</span><strong>{job.invalidRows}</strong></div></div>
            <div className="sku-import-table-wrap"><table className="sku-import-table"><thead><tr><th>选择</th><th>行</th><th>名称 / 主 OE</th><th>品牌 / 分类</th><th>车型</th><th>检查结果</th></tr></thead><tbody>{job.rows.map((row) => { const state = rowState[row.state]; const identity = row.payload.identity; const primary = row.payload.identifiers?.find((item) => item.isPrimary); return <tr key={row.id}><td><input aria-label={`选择第 ${row.rowNumber} 行`} type="checkbox" disabled={row.state === 'invalid'} checked={selected.has(row.id)} onChange={() => toggleRow(row)} /></td><td>{row.rowNumber}</td><td><strong>{identity.nameZh || identity.nameEn || '—'}</strong><small>{primary?.rawValue || '缺少主 OE'}</small></td><td><span>{identity.brandLabel || '待补充'}</span><small>{identity.categoryLabel || '待补充'}</small></td><td>{row.payload.fitments?.[0]?.vehicleLabel || '待补充'}</td><td><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.state === 'duplicate' ? `匹配 ${row.duplicateMatches.length} 条已有资料` : row.issues.map((issue) => issue.message).join('、') || '字段检查通过'}</small></td></tr> })}</tbody></table></div>
            <div className="sku-import-warning"><WarningCircle size={18} weight="fill" /><span>疑似重复项默认不选中。勾选表示你已确认它应作为独立 SKU 写入，系统不会自动覆盖已有资料。</span></div>
          </> : null}

          {step === 'result' ? <div className="sku-import-result"><span><CheckCircle size={36} weight="fill" /></span><h3>导入批次已完成</h3><p>成功写入 {job.importedRows} 条，失败 {job.failedRows} 条；未选择或不可导入的行未写入。</p><div><strong>{job.sourceName}</strong><span>批次 {job.id.slice(0, 8)} · 版本 {job.version}</span></div></div> : null}

          {error ? <div className="sku-import-error"><WarningCircle size={18} weight="fill" />{error}</div> : null}
        </div>

        <footer className="sku-import-actions">
          {step === 'preview' ? <button type="button" onClick={() => { setStep('upload'); setJob(null); setError('') }}><ArrowLeft size={17} />重新选择</button> : <span />}
          {step === 'upload' ? <button className="secondary" type="button" onClick={onClose}>取消</button> : null}
          {step === 'preview' ? <button className="primary" type="button" disabled={busy || !selected.size} onClick={commit}>{busy ? '正在写入…' : `写入 ${selected.size} 条草稿`}</button> : null}
          {step === 'result' ? <button className="primary" type="button" onClick={onClose}>完成并返回资料库</button> : null}
        </footer>
      </section>
    </div>
  )
}
