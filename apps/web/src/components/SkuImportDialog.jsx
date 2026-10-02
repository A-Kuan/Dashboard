import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowsClockwise, ArrowsLeftRight, CaretDown, Check, CheckCircle, ClipboardText, ClockCounterClockwise, DownloadSimple, FileCsv, FingerprintSimple, ShieldCheck, UploadSimple, WarningCircle, X } from '@phosphor-icons/react'
import { catalogImportFieldDefinitions, commitCatalogImport, downloadCatalogImportTemplate, getCatalogImport, getCatalogImportTemplate, inspectCatalogCsv, listCatalogImports, mapCatalogCsvInspection, previewCatalogImport, retryCatalogImport } from '../services/catalogApi'
import '../sku-import.css'

const rowState = {
  ready: { label: '可导入', className: 'ready' },
  duplicate: { label: '疑似重复', className: 'duplicate' },
  invalid: { label: '不可导入', className: 'invalid' },
  imported: { label: '已写入', className: 'imported' },
  skipped: { label: '已跳过', className: 'skipped' },
  failed: { label: '写入失败', className: 'invalid' },
  retrying: { label: '正在重试', className: 'duplicate' },
}

const preflightDecision = {
  ready: { title: '可安全进入试运行', note: '未发现阻断项或重复记录。', className: 'ready' },
  ready_with_warnings: { title: '可导入，建议后续补全', note: '必需字段已通过，但部分业务资料仍不完整。', className: 'warning' },
  review_required: { title: '需要人工确认重复项', note: '已有资料中存在相同或高度相似的 OE 编号。', className: 'warning' },
  blocked: { title: '存在阻断项', note: '不完整行不会写入，请先修正原文件。', className: 'blocked' },
}

const jobState = {
  preview: { label: '待确认', className: 'duplicate' }, committing: { label: '写入中', className: 'duplicate' },
  retrying: { label: '重试中', className: 'duplicate' }, completed: { label: '已完成', className: 'ready' }, partial: { label: '部分失败', className: 'invalid' },
}

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function duplicateMessage(row) {
  const fileRows = (row.duplicateMatches || []).filter((match) => match.scope === 'file').map((match) => match.rowNumber)
  if (fileRows.length) return `与文件第 ${fileRows.join('、')} 行使用相同主 OE`
  return `匹配 ${(row.duplicateMatches || []).length} 条已有资料`
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
  const [templateSpec, setTemplateSpec] = useState(null)
  const [fieldGuideOpen, setFieldGuideOpen] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [mappingContext, setMappingContext] = useState(null)

  useEffect(() => {
    let active = true
    getCatalogImportTemplate().then((result) => { if (active) setTemplateSpec(result) }).catch(() => {})
    return () => { active = false }
  }, [])

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

  const downloadTemplate = async () => {
    setTemplateBusy(true)
    setError('')
    try {
      const result = await downloadCatalogImportTemplate()
      onNotify?.(`已下载 ${result.filename}`)
    } catch (reason) {
      setError(reason.message || '模板下载失败')
    } finally {
      setTemplateBusy(false)
    }
  }

  const openPreview = async (sourceName, rows) => {
    const preview = await previewCatalogImport(sourceName, rows)
    if (preview.duplicateUpload && preview.state !== 'preview') {
      setMode('history')
      setSelectedJob(preview)
      onNotify?.('文件内容已处理过，已打开原导入批次')
      return
    }
    setJob(preview)
    setSelected(new Set(preview.rows.filter((row) => row.state === 'ready').map((row) => row.id)))
    setStep('preview')
  }

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.csv')) return setError('目前支持 CSV 文件，请先下载模板整理字段')
    if (file.size > 2 * 1024 * 1024) return setError('文件超过 2 MB，请拆分后导入')
    setBusy(true)
    try {
      const inspection = inspectCatalogCsv(await file.text())
      if (inspection.isStandardTemplate) await openPreview(file.name, mapCatalogCsvInspection(inspection, inspection.suggestedMapping))
      else {
        setMappingContext({ sourceName: file.name, inspection, mapping: { ...inspection.suggestedMapping } })
        setStep('mapping')
      }
    } catch (reason) {
      setError(reason.message || '文件解析失败')
    } finally {
      setBusy(false)
    }
  }

  const updateMapping = (field, index) => {
    setMappingContext((current) => ({ ...current, mapping: { ...current.mapping, [field]: Number(index) } }))
    setError('')
  }

  const confirmMapping = async () => {
    if (!mappingContext) return
    setBusy(true)
    setError('')
    try {
      await openPreview(mappingContext.sourceName, mapCatalogCsvInspection(mappingContext.inspection, mappingContext.mapping))
    } catch (reason) {
      setError(reason.message || '字段映射无法进入预检查')
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

  const mappingFields = catalogImportFieldDefinitions.map((field) => ({ ...field, ...(templateSpec?.fields?.find((item) => item.key === field.key) || {}) }))
  const mapping = mappingContext?.mapping || {}
  const mappedIndexes = Object.values(mapping).map(Number).filter((index) => index >= 0)
  const mappingReady = (Number(mapping.nameZh) >= 0 || Number(mapping.nameEn) >= 0) && Number(mapping.primaryOe) >= 0 && new Set(mappedIndexes).size === mappedIndexes.length
  const unmappedColumns = (mappingContext?.inspection.columns || []).filter((column) => !mappedIndexes.includes(column.index))

  return (
    <div className="sku-modal-backdrop" onMouseDown={onClose}>
      <section className="sku-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入 SKU" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sku-import-head">
          <div><span className="sku-import-icon"><FileCsv size={23} weight="duotone" /></span><div><h2>SKU 导入中心</h2><p>预检查、写入结果和每次重试都可追溯。</p></div></div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button>
        </header>

        <div className="sku-import-modebar">
          <div><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setSelectedJob(null); setStep('upload'); setMappingContext(null); setError('') }}><UploadSimple size={17} />新建导入</button><button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => { setMode('history'); setSelectedJob(null); setError('') }}><ClockCounterClockwise size={17} />导入记录</button></div>
          {mode === 'new' ? <nav className="sku-import-steps" aria-label="导入步骤">{['选择文件', '字段映射', '预检查', '写入结果'].map((label, index) => { const current = { upload: 0, mapping: 1, preview: 2, result: 3 }[step]; return <span className={index === current ? 'active' : index < current ? 'done' : ''} key={label}><i>{index < current ? <Check size={13} weight="bold" /> : index + 1}</i>{label}</span> })}</nav> : <label className="sku-import-history-filter"><select aria-label="导入状态筛选" value={historyState} onChange={(event) => { setHistoryState(event.target.value); setSelectedJob(null) }}><option value="">全部状态</option><option value="completed">已完成</option><option value="partial">部分失败</option><option value="preview">待确认</option></select></label>}
        </div>

        <div className="sku-import-body">
          {mode === 'new' && step === 'upload' ? <>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => handleFile(event.target.files?.[0])} />
            <div className="sku-import-onboarding">
              <button className={`sku-import-dropzone ${dragging ? 'dragging' : ''}`} type="button" onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files?.[0]) }}>
                <span><UploadSimple size={28} weight="bold" /></span><strong>{busy ? '正在预检查…' : '选择或拖入 CSV 文件'}</strong><small>最多 {templateSpec?.maxRows || 500} 行、2 MB；不会直接写入资料库</small>
              </button>
              <aside className="sku-import-readiness">
                <div className="sku-import-readiness-title"><span><ClipboardText size={20} weight="duotone" /></span><div><strong>先用标准模板整理</strong><small>{templateSpec?.schemaVersion || '正在读取字段规范…'}</small></div></div>
                <ol><li><b>1</b><span><strong>保留原始编号</strong><small>OE 分隔格式与来源记录不要改写</small></span></li><li><b>2</b><span><strong>补齐适配边界</strong><small>车型、年款与排除条件尽量一起填写</small></span></li><li><b>3</b><span><strong>先预检查再写入</strong><small>重复和阻断项都会由人确认</small></span></li></ol>
                <div><button className="primary-template" type="button" disabled={templateBusy} onClick={downloadTemplate}><DownloadSimple size={17} />{templateBusy ? '正在下载…' : '下载标准模板'}</button><button type="button" aria-expanded={fieldGuideOpen} onClick={() => setFieldGuideOpen((value) => !value)}>查看字段说明 <CaretDown className={fieldGuideOpen ? 'open' : ''} size={15} /></button></div>
              </aside>
            </div>
            {fieldGuideOpen ? <section className="sku-import-field-guide"><header><div><strong>字段说明</strong><span>模板与导入校验使用同一版规范</span></div><em>{templateSpec?.fields?.length || 0} 个字段</em></header><div>{(templateSpec?.fields || []).map((field) => <article key={field.key}><span><strong>{field.label}</strong>{field.required === 'one_of_name' ? <i>二选一</i> : field.required ? <i className="required">必需</i> : field.recommended ? <i>建议</i> : <i className="optional">可选</i>}</span><p>{field.description}</p><small>示例：{field.example || '—'}</small></article>)}</div></section> : null}
          </> : null}

          {mode === 'new' && step === 'mapping' && mappingContext ? <section className="sku-import-mapping">
            <header><div><span><ArrowsLeftRight size={22} weight="duotone" /></span><div><h3>确认供应商字段映射</h3><p>{mappingContext.sourceName} · {mappingContext.inspection.columns.length} 列 · {mappingContext.inspection.dataRows.length} 行数据</p></div></div><strong>{mappedIndexes.length} / {mappingFields.length} 字段已映射</strong></header>
            <div className="sku-mapping-list">{mappingFields.map((field) => { const selectedIndex = Number(mapping[field.key]); const column = mappingContext.inspection.columns.find((item) => item.index === selectedIndex); return <article key={field.key}><div className="sku-mapping-target"><span><strong>{field.label}</strong>{field.required === 'one_of_name' ? <i>二选一</i> : field.required ? <i className="required">必需</i> : field.recommended ? <i>建议</i> : <i className="optional">可选</i>}</span><small>{field.description || '映射到 SKU 标准字段'}</small></div><ArrowRight size={17} /><label><select aria-label={`映射 ${field.label}`} value={selectedIndex >= 0 ? selectedIndex : -1} onChange={(event) => updateMapping(field.key, event.target.value)}><option value={-1}>不导入此字段</option>{mappingContext.inspection.columns.map((item) => <option key={item.index} value={item.index} disabled={mappedIndexes.includes(item.index) && item.index !== selectedIndex}>{item.label}</option>)}</select><span>{column ? `样例：${column.sample}` : '尚未选择原始列'}</span></label></article> })}</div>
            <footer><div><strong>未映射原始列</strong><span>不写入 SKU 字段，但仍会保留在来源证据中</span></div><p>{unmappedColumns.length ? unmappedColumns.map((column) => <span key={column.index}>{column.label}</span>) : <em>全部原始列已映射</em>}</p></footer>
          </section> : null}

          {mode === 'new' && step === 'preview' ? <>
            {job.duplicateUpload ? <section className="sku-import-duplicate-upload"><FingerprintSimple size={22} weight="duotone" /><div><strong>已找到相同内容的待确认批次</strong><span>系统没有新建重复批次；你可继续处理下方原批次。</span></div><code>{job.contentFingerprint}</code></section> : null}
            {job.preflight ? (() => { const decision = preflightDecision[job.preflight.decision] || preflightDecision.review_required; return <section className={`sku-preflight-decision ${decision.className}`}><span>{job.preflight.decision === 'blocked' ? <WarningCircle size={23} weight="fill" /> : <ShieldCheck size={23} weight="duotone" />}</span><div><h3>{decision.title}</h3><p>{decision.note}</p></div><dl><div><dt>默认选中</dt><dd>{job.preflight.defaultSelectedRows} 条</dd></div><div><dt>警告</dt><dd>{job.preflight.warningCount} 项</dd></div><div><dt>重复匹配</dt><dd>{job.preflight.duplicateMatches} 条</dd></div></dl></section> })() : null}
            <div className="sku-import-summary"><div><span>总行数</span><strong>{job.totalRows}</strong></div><div className="ready"><span>可导入</span><strong>{job.readyRows}</strong></div><div className="duplicate"><span>疑似重复</span><strong>{job.duplicateRows}</strong></div><div className="invalid"><span>不可导入</span><strong>{job.invalidRows}</strong></div></div>
            {job.preflight ? <div className="sku-preflight-grid"><section><header><strong>资料覆盖率</strong><span>不阻断导入，但会影响后续核验</span></header><div className="sku-preflight-coverage">{job.preflight.coverage.map((item) => <div key={item.field}><span><b>{item.label}</b><em>{item.present}/{item.total} · {item.percent}%</em></span><i><b style={{ width: `${item.percent}%` }} /></i></div>)}</div></section><section><header><strong>问题汇总</strong><span>按严重程度与影响行数排序</span></header><div className="sku-preflight-issues">{job.preflight.issueSummary.slice(0, 5).map((issue) => <div className={issue.severity} key={issue.code}><span>{issue.severity === 'error' ? <WarningCircle size={16} weight="fill" /> : <WarningCircle size={16} />}</span><p><strong>{issue.message}</strong><small>{issue.count} 行受影响</small></p></div>)}{!job.preflight.issueSummary.length ? <div className="clear"><span><CheckCircle size={17} weight="fill" /></span><p><strong>未发现字段问题</strong><small>可继续检查逐行结果</small></p></div> : null}</div></section></div> : null}
            <div className="sku-import-table-wrap"><table className="sku-import-table"><thead><tr><th>选择</th><th>行</th><th>名称 / 主 OE</th><th>品牌 / 分类</th><th>车型</th><th>检查结果</th></tr></thead><tbody>{job.rows.map((row) => { const state = rowState[row.state]; const identity = row.payload.identity; const primary = row.payload.identifiers?.find((item) => item.isPrimary); return <tr key={row.id}><td><input aria-label={`选择第 ${row.rowNumber} 行`} type="checkbox" disabled={row.state === 'invalid'} checked={selected.has(row.id)} onChange={() => toggleRow(row)} /></td><td>{row.rowNumber}</td><td><strong>{identity.nameZh || identity.nameEn || '—'}</strong><small>{primary?.rawValue || '缺少主 OE'}</small></td><td><span>{identity.brandLabel || '待补充'}</span><small>{identity.categoryLabel || '待补充'}</small></td><td>{row.payload.fitments?.[0]?.vehicleLabel || '待补充'}</td><td><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.state === 'duplicate' ? duplicateMessage(row) : row.issues.map((issue) => issue.message).join('、') || '字段检查通过'}</small></td></tr> })}</tbody></table></div>
            <div className="sku-import-warning"><WarningCircle size={18} weight="fill" /><span>疑似重复项默认不选中。勾选表示你已确认它应作为独立 SKU 写入，系统不会自动覆盖已有资料。</span></div>
          </> : null}

          {mode === 'new' && step === 'result' ? <div className="sku-import-result"><span><CheckCircle size={36} weight="fill" /></span><h3>导入批次已完成</h3><p>成功写入 {job.importedRows} 条，失败 {job.failedRows} 条；未选择或不可导入的行未写入。</p><div><strong>{job.sourceName}</strong><span>批次 {job.id.slice(0, 8)} · 版本 {job.version}</span></div><button type="button" onClick={() => { setMode('history'); setSelectedJob(job) }}>查看本次导入记录 <ArrowRight size={16} /></button></div> : null}

          {mode === 'history' && !selectedJob ? <div className="sku-import-history">
            <div className="sku-import-history-summary"><div><span>批次总数</span><strong>{historyTotal}</strong></div><div><span>部分失败</span><strong>{history.filter((item) => item.state === 'partial').length}</strong></div><div><span>本页写入</span><strong>{history.reduce((sum, item) => sum + item.importedRows, 0)}</strong></div></div>
            <div className="sku-import-history-list"><div className="history-list-head"><span>文件 / 批次</span><span>写入结果</span><span>执行记录</span><span>状态</span><span /></div>{history.map((item) => { const state = jobState[item.state] || { label: item.state, className: 'skipped' }; return <button type="button" key={item.id} onClick={() => openHistoryJob(item.id)}><span><strong>{item.sourceName}</strong><small>{displayTime(item.createdAt)} · {item.id.slice(0, 8)}</small></span><span><strong>{item.importedRows} / {item.totalRows}</strong><small>{item.failedRows ? `${item.failedRows} 条失败` : '无失败记录'}</small></span><span><strong>{item.attemptCount || 0} 次</strong><small>{displayTime(item.lastAttemptAt || item.committedAt)}</small></span><span className={`import-state ${state.className}`}>{state.label}</span><ArrowRight size={17} /></button> })}{!history.length && !historyLoading ? <div className="sku-import-history-empty"><ClockCounterClockwise size={34} /><strong>暂无导入记录</strong><span>完成第一次导入后会在这里留下完整记录</span></div> : null}</div>
          </div> : null}

          {mode === 'history' && selectedJob ? <div className="sku-import-history-detail">
            <button className="history-back" type="button" onClick={() => { setSelectedJob(null); loadHistory() }}><ArrowLeft size={16} />返回批次列表</button>
            {selectedJob.duplicateUpload ? <section className="sku-import-duplicate-upload history"><FingerprintSimple size={22} weight="duotone" /><div><strong>该文件内容已导入过</strong><span>为防止重复写入，系统直接打开了原批次与执行记录。</span></div><code>{selectedJob.contentFingerprint}</code></section> : null}
            <div className="history-detail-title"><div><h3>{selectedJob.sourceName}</h3><p>批次 {selectedJob.id.slice(0, 8)} · 指纹 {selectedJob.contentFingerprint || '—'} · 创建于 {displayTime(selectedJob.createdAt)}</p></div><span className={`import-state ${(jobState[selectedJob.state] || {}).className || 'skipped'}`}>{(jobState[selectedJob.state] || {}).label || selectedJob.state}</span></div>
            <div className="sku-import-summary"><div><span>总行数</span><strong>{selectedJob.totalRows}</strong></div><div className="ready"><span>成功写入</span><strong>{selectedJob.importedRows}</strong></div><div className="duplicate"><span>跳过 / 无效</span><strong>{selectedJob.rows.filter((row) => ['skipped', 'invalid'].includes(row.state)).length}</strong></div><div className="invalid"><span>写入失败</span><strong>{selectedJob.failedRows}</strong></div></div>
            <div className="history-detail-grid"><section><h4>逐行结果</h4><div className="history-row-list">{selectedJob.rows.map((row) => { const state = rowState[row.state] || { label: row.state, className: 'skipped' }; const identity = row.payload?.identity || {}; const primary = row.payload?.identifiers?.find((item) => item.isPrimary); return <div key={row.id}><span>{row.rowNumber}</span><span><strong>{identity.nameZh || identity.nameEn || '未命名'}</strong><small>{primary?.rawValue || '无主 OE'}</small></span><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.errorMessage || row.issues?.map((item) => item.message).join('、') || '—'}</small></div> })}</div></section><section><h4>执行记录</h4><div className="history-attempts">{selectedJob.attempts.map((attempt) => <div key={attempt.id}><span><ArrowsClockwise size={18} weight="bold" /></span><div><strong>{attempt.attemptType === 'retry' ? `第 ${attempt.attemptNumber} 次 · 失败重试` : '首次写入'}</strong><small>{attempt.startedBy} · {displayTime(attempt.startedAt)}</small><p>选中 {attempt.selectedRows} · 成功 {attempt.importedRows} · 失败 {attempt.failedRows}</p></div></div>)}{!selectedJob.attempts.length ? <p className="history-no-attempt">尚未执行写入</p> : null}</div></section></div>
          </div> : null}

          {error ? <div className="sku-import-error"><WarningCircle size={18} weight="fill" />{error}</div> : null}
        </div>

        <footer className="sku-import-actions">
          {mode === 'new' && ['mapping', 'preview'].includes(step) ? <button type="button" onClick={() => { setStep('upload'); setJob(null); setMappingContext(null); setError('') }}><ArrowLeft size={17} />重新选择</button> : <span />}
          {mode === 'new' && step === 'upload' ? <button className="secondary" type="button" onClick={onClose}>取消</button> : null}
          {mode === 'new' && step === 'mapping' ? <button className="primary" type="button" disabled={busy || !mappingReady} onClick={confirmMapping}>{busy ? '正在预检查…' : '确认映射并预检查'}</button> : null}
          {mode === 'new' && step === 'preview' ? <button className="primary" type="button" disabled={busy || !selected.size} onClick={commit}>{busy ? '正在写入…' : `写入 ${selected.size} 条草稿`}</button> : null}
          {mode === 'new' && step === 'result' ? <button className="primary" type="button" onClick={onClose}>完成并返回资料库</button> : null}
          {mode === 'history' ? <button className="secondary" type="button" onClick={onClose}>关闭</button> : null}
          {mode === 'history' && selectedJob?.state === 'partial' ? <button className="primary" type="button" disabled={busy} onClick={retryFailed}><ArrowsClockwise size={17} />{busy ? '正在重试…' : `重试 ${selectedJob.failedRows} 条失败记录`}</button> : null}
        </footer>
      </section>
    </div>
  )
}
