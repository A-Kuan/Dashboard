import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowsClockwise, Check, CheckCircle, ClockCounterClockwise, DownloadSimple, FileCsv, UploadSimple, WarningCircle, X } from '@phosphor-icons/react'
import { commitCatalogImport, getCatalogImport, listCatalogImports, parseCatalogCsv, previewCatalogImport, retryCatalogImport } from '../services/catalogApi'
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
  retrying: { label: '正在重试', className: 'duplicate' },
}

const jobState = {
  preview: { label: '待确认', className: 'duplicate' }, committing: { label: '写入中', className: 'duplicate' },
  retrying: { label: '重试中', className: 'duplicate' }, completed: { label: '已完成', className: 'ready' }, partial: { label: '部分失败', className: 'invalid' },
}

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
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
  const [mode, setMode] = useState('new')
  const [step, setStep] = useState('upload')
  const [job, setJob] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [history, setHistory] = useState([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyState, setHistoryState] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setError('')
    try {
      const result = await listCatalogImports({ state: historyState, pageSize: 50 })
      setHistory(result.items || [])
      setHistoryTotal(result.total || 0)
    } catch (reason) {
      setError(reason.message || '导入记录加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [historyState])

  useEffect(() => { if (mode === 'history' && !selectedJob) loadHistory() }, [loadHistory, mode, selectedJob])

  const openHistoryJob = async (id) => {
    setHistoryLoading(true)
    setError('')
    try { setSelectedJob(await getCatalogImport(id)) } catch (reason) { setError(reason.message || '批次详情加载失败') } finally { setHistoryLoading(false) }
  }

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

  const retryFailed = async () => {
    if (!selectedJob?.failedRows) return
    setBusy(true)
    setError('')
    try {
      const failedIds = selectedJob.rows.filter((row) => row.state === 'failed').map((row) => row.id)
      const result = await retryCatalogImport(selectedJob.id, selectedJob.version, failedIds)
      setSelectedJob(result)
      onCompleted?.(result)
      onNotify?.(result.failedRows ? `重试完成，仍有 ${result.failedRows} 条失败` : '失败记录已全部重试成功')
    } catch (reason) {
      setError(reason.message || '重试失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sku-modal-backdrop" onMouseDown={onClose}>
      <section className="sku-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入 SKU" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sku-import-head">
          <div><span className="sku-import-icon"><FileCsv size={23} weight="duotone" /></span><div><h2>SKU 导入中心</h2><p>预检查、写入结果和每次重试都可追溯。</p></div></div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button>
        </header>

        <div className="sku-import-modebar">
          <div><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setSelectedJob(null); setError('') }}><UploadSimple size={17} />新建导入</button><button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => { setMode('history'); setSelectedJob(null); setError('') }}><ClockCounterClockwise size={17} />导入记录</button></div>
          {mode === 'new' ? <nav className="sku-import-steps" aria-label="导入步骤">{['选择文件', '预检查', '写入结果'].map((label, index) => { const current = { upload: 0, preview: 1, result: 2 }[step]; return <span className={index === current ? 'active' : index < current ? 'done' : ''} key={label}><i>{index < current ? <Check size={13} weight="bold" /> : index + 1}</i>{label}</span> })}</nav> : <label className="sku-import-history-filter"><select aria-label="导入状态筛选" value={historyState} onChange={(event) => { setHistoryState(event.target.value); setSelectedJob(null) }}><option value="">全部状态</option><option value="completed">已完成</option><option value="partial">部分失败</option><option value="preview">待确认</option></select></label>}
        </div>

        <div className="sku-import-body">
          {mode === 'new' && step === 'upload' ? <>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => handleFile(event.target.files?.[0])} />
            <button className={`sku-import-dropzone ${dragging ? 'dragging' : ''}`} type="button" onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files?.[0]) }}>
              <span><UploadSimple size={28} weight="bold" /></span><strong>{busy ? '正在预检查…' : '选择或拖入 CSV 文件'}</strong><small>最多 500 行、2 MB；不会直接写入资料库</small>
            </button>
            <div className="sku-import-guidance"><div><strong>必需列</strong><span>中文名称或英文名称、主 OE</span></div><div><strong>建议列</strong><span>品牌、分类、车型、年款、来源系统</span></div><button type="button" onClick={downloadTemplate}><DownloadSimple size={17} />下载 CSV 模板</button></div>
          </> : null}

          {mode === 'new' && step === 'preview' ? <>
            <div className="sku-import-summary"><div><span>总行数</span><strong>{job.totalRows}</strong></div><div className="ready"><span>可导入</span><strong>{job.readyRows}</strong></div><div className="duplicate"><span>疑似重复</span><strong>{job.duplicateRows}</strong></div><div className="invalid"><span>不可导入</span><strong>{job.invalidRows}</strong></div></div>
            <div className="sku-import-table-wrap"><table className="sku-import-table"><thead><tr><th>选择</th><th>行</th><th>名称 / 主 OE</th><th>品牌 / 分类</th><th>车型</th><th>检查结果</th></tr></thead><tbody>{job.rows.map((row) => { const state = rowState[row.state]; const identity = row.payload.identity; const primary = row.payload.identifiers?.find((item) => item.isPrimary); return <tr key={row.id}><td><input aria-label={`选择第 ${row.rowNumber} 行`} type="checkbox" disabled={row.state === 'invalid'} checked={selected.has(row.id)} onChange={() => toggleRow(row)} /></td><td>{row.rowNumber}</td><td><strong>{identity.nameZh || identity.nameEn || '—'}</strong><small>{primary?.rawValue || '缺少主 OE'}</small></td><td><span>{identity.brandLabel || '待补充'}</span><small>{identity.categoryLabel || '待补充'}</small></td><td>{row.payload.fitments?.[0]?.vehicleLabel || '待补充'}</td><td><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.state === 'duplicate' ? `匹配 ${row.duplicateMatches.length} 条已有资料` : row.issues.map((issue) => issue.message).join('、') || '字段检查通过'}</small></td></tr> })}</tbody></table></div>
            <div className="sku-import-warning"><WarningCircle size={18} weight="fill" /><span>疑似重复项默认不选中。勾选表示你已确认它应作为独立 SKU 写入，系统不会自动覆盖已有资料。</span></div>
          </> : null}

          {mode === 'new' && step === 'result' ? <div className="sku-import-result"><span><CheckCircle size={36} weight="fill" /></span><h3>导入批次已完成</h3><p>成功写入 {job.importedRows} 条，失败 {job.failedRows} 条；未选择或不可导入的行未写入。</p><div><strong>{job.sourceName}</strong><span>批次 {job.id.slice(0, 8)} · 版本 {job.version}</span></div><button type="button" onClick={() => { setMode('history'); setSelectedJob(job) }}>查看本次导入记录 <ArrowRight size={16} /></button></div> : null}

          {mode === 'history' && !selectedJob ? <div className="sku-import-history">
            <div className="sku-import-history-summary"><div><span>批次总数</span><strong>{historyTotal}</strong></div><div><span>部分失败</span><strong>{history.filter((item) => item.state === 'partial').length}</strong></div><div><span>本页写入</span><strong>{history.reduce((sum, item) => sum + item.importedRows, 0)}</strong></div></div>
            <div className="sku-import-history-list"><div className="history-list-head"><span>文件 / 批次</span><span>写入结果</span><span>执行记录</span><span>状态</span><span /></div>{history.map((item) => { const state = jobState[item.state] || { label: item.state, className: 'skipped' }; return <button type="button" key={item.id} onClick={() => openHistoryJob(item.id)}><span><strong>{item.sourceName}</strong><small>{displayTime(item.createdAt)} · {item.id.slice(0, 8)}</small></span><span><strong>{item.importedRows} / {item.totalRows}</strong><small>{item.failedRows ? `${item.failedRows} 条失败` : '无失败记录'}</small></span><span><strong>{item.attemptCount || 0} 次</strong><small>{displayTime(item.lastAttemptAt || item.committedAt)}</small></span><span className={`import-state ${state.className}`}>{state.label}</span><ArrowRight size={17} /></button> })}{!history.length && !historyLoading ? <div className="sku-import-history-empty"><ClockCounterClockwise size={34} /><strong>暂无导入记录</strong><span>完成第一次导入后会在这里留下完整记录</span></div> : null}</div>
          </div> : null}

          {mode === 'history' && selectedJob ? <div className="sku-import-history-detail">
            <button className="history-back" type="button" onClick={() => { setSelectedJob(null); loadHistory() }}><ArrowLeft size={16} />返回批次列表</button>
            <div className="history-detail-title"><div><h3>{selectedJob.sourceName}</h3><p>批次 {selectedJob.id.slice(0, 8)} · 创建于 {displayTime(selectedJob.createdAt)}</p></div><span className={`import-state ${(jobState[selectedJob.state] || {}).className || 'skipped'}`}>{(jobState[selectedJob.state] || {}).label || selectedJob.state}</span></div>
            <div className="sku-import-summary"><div><span>总行数</span><strong>{selectedJob.totalRows}</strong></div><div className="ready"><span>成功写入</span><strong>{selectedJob.importedRows}</strong></div><div className="duplicate"><span>跳过 / 无效</span><strong>{selectedJob.rows.filter((row) => ['skipped', 'invalid'].includes(row.state)).length}</strong></div><div className="invalid"><span>写入失败</span><strong>{selectedJob.failedRows}</strong></div></div>
            <div className="history-detail-grid"><section><h4>逐行结果</h4><div className="history-row-list">{selectedJob.rows.map((row) => { const state = rowState[row.state] || { label: row.state, className: 'skipped' }; const identity = row.payload?.identity || {}; const primary = row.payload?.identifiers?.find((item) => item.isPrimary); return <div key={row.id}><span>{row.rowNumber}</span><span><strong>{identity.nameZh || identity.nameEn || '未命名'}</strong><small>{primary?.rawValue || '无主 OE'}</small></span><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.errorMessage || row.issues?.map((item) => item.message).join('、') || '—'}</small></div> })}</div></section><section><h4>执行记录</h4><div className="history-attempts">{selectedJob.attempts.map((attempt) => <div key={attempt.id}><span><ArrowsClockwise size={18} weight="bold" /></span><div><strong>{attempt.attemptType === 'retry' ? `第 ${attempt.attemptNumber} 次 · 失败重试` : '首次写入'}</strong><small>{attempt.startedBy} · {displayTime(attempt.startedAt)}</small><p>选中 {attempt.selectedRows} · 成功 {attempt.importedRows} · 失败 {attempt.failedRows}</p></div></div>)}{!selectedJob.attempts.length ? <p className="history-no-attempt">尚未执行写入</p> : null}</div></section></div>
          </div> : null}

          {error ? <div className="sku-import-error"><WarningCircle size={18} weight="fill" />{error}</div> : null}
        </div>

        <footer className="sku-import-actions">
          {mode === 'new' && step === 'preview' ? <button type="button" onClick={() => { setStep('upload'); setJob(null); setError('') }}><ArrowLeft size={17} />重新选择</button> : <span />}
          {mode === 'new' && step === 'upload' ? <button className="secondary" type="button" onClick={onClose}>取消</button> : null}
          {mode === 'new' && step === 'preview' ? <button className="primary" type="button" disabled={busy || !selected.size} onClick={commit}>{busy ? '正在写入…' : `写入 ${selected.size} 条草稿`}</button> : null}
          {mode === 'new' && step === 'result' ? <button className="primary" type="button" onClick={onClose}>完成并返回资料库</button> : null}
          {mode === 'history' ? <button className="secondary" type="button" onClick={onClose}>关闭</button> : null}
          {mode === 'history' && selectedJob?.state === 'partial' ? <button className="primary" type="button" disabled={busy} onClick={retryFailed}><ArrowsClockwise size={17} />{busy ? '正在重试…' : `重试 ${selectedJob.failedRows} 条失败记录`}</button> : null}
        </footer>
      </section>
    </div>
  )
}
