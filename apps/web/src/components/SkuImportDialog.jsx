import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowsClockwise, ArrowsLeftRight, CaretDown, Check, CheckCircle, ClipboardText, ClockCounterClockwise, Copy, DownloadSimple, FileCsv, FingerprintSimple, MagnifyingGlass, PencilSimple, Plus, Power, ShieldCheck, SlidersHorizontal, Trash, UploadSimple, WarningCircle, X } from '@phosphor-icons/react'
import { applyCatalogImportRules, catalogImportFieldDefinitions, cloneCatalogImportMapping, commitCatalogImport, downloadCatalogImportTemplate, getCatalogImport, getCatalogImportMapping, getCatalogImportTemplate, inspectCatalogCsv, listCatalogImportMappings, listCatalogImports, mapCatalogCsvInspection, matchCatalogImportMapping, previewCatalogImport, resolveCatalogImportValues, retryCatalogImport, saveCatalogImportMapping, updateCatalogImportMapping, updateCatalogImportMappingRules, updateCatalogImportValueMappings } from '../services/catalogApi'
import '../sku-import.css'

const rowState = {
  ready: { label: '可导入', className: 'ready' },
  duplicate: { label: '疑似重复', className: 'duplicate' },
  review: { label: '值待映射', className: 'review' },
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

const profileChangeLabel = { create: '创建方案', update_mapping: '更新字段映射', update_rules: '更新导入规则', update_value_mappings: '更新值映射', resolve_value_mapping: '批次异常学习', rename: '重命名', deactivate: '停用方案', reactivate: '恢复方案', clone: '复制方案' }
const transformRuleLabel = { normalizeFullWidth: '全角转半角', trimText: '清理首尾空白', collapseWhitespace: '合并连续空白', uppercaseOe: 'OE 编号转大写' }
const valueMappingFieldLabel = { brand: '品牌', category: '分类', unit: '单位' }

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function duplicateMessage(row) {
  const fileRows = (row.duplicateMatches || []).filter((match) => match.scope === 'file').map((match) => match.rowNumber)
  if (fileRows.length) return `与文件第 ${fileRows.join('、')} 行使用相同主 OE`
  return `匹配 ${(row.duplicateMatches || []).length} 条已有资料`
}

function defaultProfileName(sourceName) {
  return `${String(sourceName || '').replace(/\.[^.]+$/, '').trim() || '供应商'} 映射方案`
}

function mergeMappings(primary = {}, fallback = {}) {
  const merged = {}
  const used = new Set()
  for (const source of [primary, fallback]) for (const field of catalogImportFieldDefinitions) {
    if (Number(merged[field.key]) >= 0) continue
    const index = Number(source[field.key])
    if (Number.isInteger(index) && index >= 0 && !used.has(index)) { merged[field.key] = index; used.add(index) }
    else if (!(field.key in merged)) merged[field.key] = -1
  }
  return merged
}

function snapshotFieldMapping(mapping, columns) {
  return Object.fromEntries(Object.entries(mapping).flatMap(([field, rawIndex]) => {
    const column = columns[Number(rawIndex)]
    return column ? [[field, column.sourceKey]] : []
  }))
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
  const [profiles, setProfiles] = useState([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [profileQuery, setProfileQuery] = useState('')
  const [profileState, setProfileState] = useState('all')
  const [profileAction, setProfileAction] = useState('')
  const [profileActionName, setProfileActionName] = useState('')
  const [profileRulesDraft, setProfileRulesDraft] = useState(null)
  const [profileValueMappingsDraft, setProfileValueMappingsDraft] = useState(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [valueResolutionDraft, setValueResolutionDraft] = useState({})

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

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true)
    setError('')
    try {
      const result = await listCatalogImportMappings()
      setProfiles(result.items || [])
    } catch (reason) {
      setError(reason.message || '映射方案加载失败')
    } finally {
      setProfilesLoading(false)
    }
  }, [])

  useEffect(() => { if (mode === 'profiles') loadProfiles() }, [loadProfiles, mode])

  useEffect(() => {
    if (mode === 'profiles' && profiles.length && !selectedProfile) getCatalogImportMapping(profiles[0].id).then(setSelectedProfile).catch((reason) => setError(reason.message || '映射方案详情加载失败'))
  }, [mode, profiles, selectedProfile])

  const openProfile = async (id) => {
    setProfilesLoading(true)
    setProfileAction('')
    setError('')
    try { setSelectedProfile(await getCatalogImportMapping(id)) } catch (reason) { setError(reason.message || '映射方案详情加载失败') } finally { setProfilesLoading(false) }
  }

  const startProfileAction = (action) => {
    setProfileAction(action)
    setProfileActionName(action === 'clone' ? `${selectedProfile.name} 副本` : selectedProfile.name)
    if (action === 'rules') setProfileRulesDraft({
      defaultValues: { brand: '', category: '', unit: '', sourceSystem: '', ...(selectedProfile.defaultValues || {}) },
      transformRules: { trimText: true, collapseWhitespace: true, uppercaseOe: true, normalizeFullWidth: true, ...(selectedProfile.transformRules || {}) },
    })
    if (action === 'values') setProfileValueMappingsDraft(Object.fromEntries(Object.keys(valueMappingFieldLabel).map((field) => [field, [...(selectedProfile.valueMappings?.[field] || [])]])))
    setError('')
  }

  const addProfileValueMapping = (field) => setProfileValueMappingsDraft((current) => ({ ...current, [field]: [...(current?.[field] || []), { source: '', target: '' }] }))
  const updateProfileValueMapping = (field, index, key, value) => setProfileValueMappingsDraft((current) => ({ ...current, [field]: current[field].map((entry, entryIndex) => entryIndex === index ? { ...entry, [key]: value } : entry) }))
  const removeProfileValueMapping = (field, index) => setProfileValueMappingsDraft((current) => ({ ...current, [field]: current[field].filter((_, entryIndex) => entryIndex !== index) }))

  const submitProfileAction = async () => {
    if (!selectedProfile) return
    setProfileBusy(true)
    setError('')
    try {
      let result
      if (profileAction === 'rules') result = await updateCatalogImportMappingRules(selectedProfile, profileRulesDraft)
      else if (profileAction === 'values') result = await updateCatalogImportValueMappings(selectedProfile, profileValueMappingsDraft)
      else if (profileAction === 'rename') result = await updateCatalogImportMapping(selectedProfile, { name: profileActionName })
      else if (profileAction === 'clone') result = await cloneCatalogImportMapping(selectedProfile.id, profileActionName)
      else if (profileAction === 'toggle') result = await updateCatalogImportMapping(selectedProfile, { active: !selectedProfile.active })
      if (!result) return
      await loadProfiles()
      setSelectedProfile(await getCatalogImportMapping(result.id))
      setProfileAction('')
      onNotify?.(profileAction === 'rules' ? '供应商导入规则已更新' : profileAction === 'values' ? '供应商值映射已更新' : profileAction === 'clone' ? '映射方案已复制' : profileAction === 'rename' ? '映射方案已重命名' : result.active ? '映射方案已恢复' : '映射方案已停用')
    } catch (reason) {
      if (reason.code === 'IMPORT_MAPPING_VERSION_CONFLICT') setSelectedProfile(await getCatalogImportMapping(selectedProfile.id).catch(() => selectedProfile))
      setError(reason.message || '映射方案操作失败')
    } finally {
      setProfileBusy(false)
    }
  }

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

  const openPreview = async (sourceName, rows, mappingProfile = null) => {
    const preview = await previewCatalogImport(sourceName, rows, mappingProfile)
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
        const match = await matchCatalogImportMapping(file.name, inspection.columns)
        const exact = match.status === 'exact'
        setMappingContext({
          sourceName: file.name,
          inspection,
          match,
          mapping: exact ? mergeMappings(match.suggestedMapping, inspection.suggestedMapping) : { ...inspection.suggestedMapping },
          profileApplied: exact,
          profileDirty: false,
          userEdited: false,
          saveProfile: match.status === 'none',
          profileName: match.profile?.name || defaultProfileName(file.name),
        })
        setStep('mapping')
      }
    } catch (reason) {
      setError(reason.message || '文件解析失败')
    } finally {
      setBusy(false)
    }
  }

  const updateMapping = (field, index) => {
    setMappingContext((current) => ({ ...current, profileDirty: true, userEdited: true, mapping: { ...current.mapping, [field]: Number(index) } }))
    setError('')
  }

  const applyMatchedProfile = () => {
    setMappingContext((current) => ({
      ...current,
      profileApplied: true,
      profileDirty: current.match?.status === 'drift',
      mapping: mergeMappings(current.match?.suggestedMapping, current.mapping),
    }))
    setError('')
  }

  const confirmMapping = async () => {
    if (!mappingContext) return
    setBusy(true)
    setError('')
    try {
      let profile = mappingContext.profileApplied ? mappingContext.match?.profile : null
      let matchStatus = mappingContext.userEdited ? 'manual_override' : mappingContext.match?.status || 'manual_override'
      if (mappingContext.saveProfile) {
        profile = await saveCatalogImportMapping({
          profile: mappingContext.match?.profile || null,
          name: mappingContext.profileName,
          sourceName: mappingContext.sourceName,
          columns: mappingContext.inspection.columns,
          mapping: mappingContext.mapping,
        })
        matchStatus = mappingContext.match?.profile ? 'updated' : 'created'
      }
      const mappingProfile = profile ? {
        id: profile.id,
        name: profile.name,
        version: profile.version,
        matchStatus,
        headerSignature: profile.headerSignature,
        fieldMapping: snapshotFieldMapping(mappingContext.mapping, mappingContext.inspection.columns),
      } : null
      const mappedRows = mapCatalogCsvInspection(mappingContext.inspection, mappingContext.mapping)
      await openPreview(mappingContext.sourceName, profile ? applyCatalogImportRules(mappedRows, profile) : mappedRows, mappingProfile)
    } catch (reason) {
      setError(reason.message || '字段映射无法进入预检查')
    } finally {
      setBusy(false)
    }
  }

  const toggleRow = (row) => {
    if (!['ready', 'duplicate', 'review'].includes(row.state)) return
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

  const resolveValueExceptions = async () => {
    const resolutions = valueReviewQueue.flatMap((item) => {
      const target = String(valueResolutionDraft[`${item.field}:${item.value}`] || '').trim()
      return target ? [{ field: item.field, source: item.value, target }] : []
    })
    if (!resolutions.length) return setError('请至少填写一个标准值')
    setBusy(true)
    setError('')
    try {
      const result = await resolveCatalogImportValues(job, resolutions)
      setJob(result)
      setSelected(new Set(result.rows.filter((row) => row.state === 'ready').map((row) => row.id)))
      setValueResolutionDraft({})
      onNotify?.(`已学习 ${resolutions.length} 条供应商值，并重新检查当前批次`)
    } catch (reason) {
      if (['IMPORT_VERSION_CONFLICT', 'IMPORT_MAPPING_VERSION_CONFLICT'].includes(reason.code)) setJob(await getCatalogImport(job.id).catch(() => job))
      setError(reason.message || '异常值处理失败')
    } finally {
      setBusy(false)
    }
  }

  const mappingFields = catalogImportFieldDefinitions.map((field) => ({ ...field, ...(templateSpec?.fields?.find((item) => item.key === field.key) || {}) }))
  const mapping = mappingContext?.mapping || {}
  const mappedIndexes = Object.values(mapping).map(Number).filter((index) => index >= 0)
  const mappingReady = (Number(mapping.nameZh) >= 0 || Number(mapping.nameEn) >= 0) && Number(mapping.primaryOe) >= 0 && new Set(mappedIndexes).size === mappedIndexes.length && (!mappingContext?.saveProfile || Boolean(mappingContext.profileName.trim()))
  const unmappedColumns = (mappingContext?.inspection.columns || []).filter((column) => !mappedIndexes.includes(column.index))
  const mappingMatch = mappingContext?.match
  const appliedRuleProfile = mappingContext?.profileApplied ? mappingMatch?.profile : null
  let mappingRulePreview = []
  let mappingValueIssues = []
  if (mappingReady && appliedRuleProfile) {
    try {
      const mappedRows = mapCatalogCsvInspection(mappingContext.inspection, mapping)
      const transformedRows = applyCatalogImportRules(mappedRows, appliedRuleProfile)
      const before = mappedRows[0]
      const after = transformedRows[0]
      mappingRulePreview = catalogImportFieldDefinitions.flatMap((field) => {
        const original = String(before?.[field.key] || '')
        const standardized = String(after?.[field.key] || '')
        return original === standardized ? [] : [{ key: field.key, label: field.label, before: original || '空', after: standardized || '空' }]
      })
      const grouped = new Map()
      for (const row of transformedRows) for (const issue of row._valueMappingIssues || []) {
        const key = `${issue.field}:${issue.value}`
        grouped.set(key, { ...issue, count: (grouped.get(key)?.count || 0) + 1 })
      }
      mappingValueIssues = [...grouped.values()]
    } catch { mappingRulePreview = [] }
  }
  const visibleProfiles = profiles.filter((profile) => {
    const stateMatches = profileState === 'all' || (profileState === 'active' ? profile.active : !profile.active)
    const query = profileQuery.trim().toLowerCase()
    return stateMatches && (!query || `${profile.name} ${profile.sourceNamePattern}`.toLowerCase().includes(query))
  })
  const valueReviewQueue = job?.rows ? [...job.rows.reduce((grouped, row) => {
    for (const issue of row.issues || []) if (issue.severity === 'review') {
      const key = `${issue.field}:${issue.value}`
      const current = grouped.get(key) || { field: issue.field, value: issue.value, rows: [] }
      current.rows.push(row.rowNumber)
      grouped.set(key, current)
    }
    return grouped
  }, new Map()).values()] : []

  return (
    <div className="sku-modal-backdrop" onMouseDown={onClose}>
      <section className="sku-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入 SKU" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sku-import-head">
          <div><span className="sku-import-icon"><FileCsv size={23} weight="duotone" /></span><div><h2>SKU 导入中心</h2><p>预检查、写入结果和每次重试都可追溯。</p></div></div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={20} weight="bold" /></button>
        </header>

        <div className="sku-import-modebar">
          <div><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setSelectedJob(null); setStep('upload'); setMappingContext(null); setError('') }}><UploadSimple size={17} />新建导入</button><button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => { setMode('history'); setSelectedJob(null); setError('') }}><ClockCounterClockwise size={17} />导入记录</button><button type="button" className={mode === 'profiles' ? 'active' : ''} onClick={() => { setMode('profiles'); setSelectedProfile(null); setProfileAction(''); setError('') }}><ArrowsLeftRight size={17} />映射方案</button></div>
          {mode === 'new' ? <nav className="sku-import-steps" aria-label="导入步骤">{['选择文件', '字段映射', '预检查', '写入结果'].map((label, index) => { const current = { upload: 0, mapping: 1, preview: 2, result: 3 }[step]; return <span className={index === current ? 'active' : index < current ? 'done' : ''} key={label}><i>{index < current ? <Check size={13} weight="bold" /> : index + 1}</i>{label}</span> })}</nav> : mode === 'history' ? <label className="sku-import-history-filter"><select aria-label="导入状态筛选" value={historyState} onChange={(event) => { setHistoryState(event.target.value); setSelectedJob(null) }}><option value="">全部状态</option><option value="completed">已完成</option><option value="partial">部分失败</option><option value="preview">待确认</option></select></label> : <span className="sku-profile-policy">版本化管理 · 历史记录不会删除</span>}
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
            {mappingMatch?.status === 'exact' ? <div className="sku-mapping-profile-status exact"><ShieldCheck size={21} weight="fill" /><div><strong>已自动套用“{mappingMatch.profile.name}”</strong><span>表头完全一致 · 历史使用 {mappingMatch.profile.usageCount} 次；仍可在下方人工调整。</span></div></div> : null}
            {mappingMatch?.status === 'drift' ? <div className="sku-mapping-profile-status drift"><WarningCircle size={21} weight="fill" /><div><strong>检测到“{mappingMatch.profile.name}”的表头发生变化</strong><span>{mappingMatch.changes.added.length ? `新增：${mappingMatch.changes.added.join('、')}` : '无新增列'}；{mappingMatch.changes.removed.length ? `缺少：${mappingMatch.changes.removed.join('、')}` : '无缺少列'}。</span></div><button type="button" disabled={mappingContext.profileApplied} onClick={applyMatchedProfile}>{mappingContext.profileApplied ? '已应用可匹配字段' : '应用已有方案'}</button></div> : null}
            {appliedRuleProfile ? <div className="sku-mapping-rule-preview"><span><SlidersHorizontal size={20} weight="duotone" /></span><div><strong>导入规则预览 · 第 1 行</strong><small>只调整标准字段，供应商原始行会完整保留。</small><div>{mappingRulePreview.length ? mappingRulePreview.slice(0, 5).map((item) => <p key={item.key}><b>{item.label}</b><span>{item.before}</span><ArrowRight size={14} /><em>{item.after}</em></p>) : <p className="unchanged"><CheckCircle size={15} weight="fill" />首行已符合当前标准，无需调整</p>}</div></div></div> : null}
            {mappingValueIssues.length ? <div className="sku-mapping-value-alert"><WarningCircle size={20} weight="fill" /><div><strong>{mappingValueIssues.reduce((sum, item) => sum + item.count, 0)} 行值需要人工确认</strong><span>这些值不在当前供应商映射表中，预检查后默认不会选中。</span><p>{mappingValueIssues.slice(0, 6).map((issue) => <em key={`${issue.field}:${issue.value}`}>{valueMappingFieldLabel[issue.field]} · {issue.value} × {issue.count}</em>)}</p></div></div> : null}
            <div className="sku-mapping-list">{mappingFields.map((field) => { const selectedIndex = Number(mapping[field.key]); const column = mappingContext.inspection.columns.find((item) => item.index === selectedIndex); return <article key={field.key}><div className="sku-mapping-target"><span><strong>{field.label}</strong>{field.required === 'one_of_name' ? <i>二选一</i> : field.required ? <i className="required">必需</i> : field.recommended ? <i>建议</i> : <i className="optional">可选</i>}</span><small>{field.description || '映射到 SKU 标准字段'}</small></div><ArrowRight size={17} /><label><select aria-label={`映射 ${field.label}`} value={selectedIndex >= 0 ? selectedIndex : -1} onChange={(event) => updateMapping(field.key, event.target.value)}><option value={-1}>不导入此字段</option>{mappingContext.inspection.columns.map((item) => <option key={item.index} value={item.index} disabled={mappedIndexes.includes(item.index) && item.index !== selectedIndex}>{item.label}</option>)}</select><span>{column ? `样例：${column.sample}` : '尚未选择原始列'}</span></label></article> })}</div>
            <footer><div><strong>未映射原始列</strong><span>不写入 SKU 字段，但仍会保留在来源证据中</span></div><p>{unmappedColumns.length ? unmappedColumns.map((column) => <span key={column.index}>{column.label}</span>) : <em>全部原始列已映射</em>}</p></footer>
            {mappingMatch?.status === 'none' || mappingContext.profileDirty ? <div className="sku-mapping-profile-save"><label><input type="checkbox" checked={mappingContext.saveProfile} onChange={(event) => setMappingContext((current) => ({ ...current, saveProfile: event.target.checked }))} /><span><strong>{mappingMatch?.profile ? '同步更新供应商方案' : '保存为供应商方案'}</strong><small>{mappingMatch?.profile ? '本次确认后更新方案版本，后续同类文件自动复用。' : '下次遇到相同表头将自动套用，减少重复配置。'}</small></span></label>{mappingContext.saveProfile ? <input aria-label="映射方案名称" value={mappingContext.profileName} onChange={(event) => setMappingContext((current) => ({ ...current, profileName: event.target.value }))} placeholder="例如：华东供应商标准表" /> : null}</div> : null}
          </section> : null}

          {mode === 'new' && step === 'preview' ? <>
            {job.duplicateUpload ? <section className="sku-import-duplicate-upload"><FingerprintSimple size={22} weight="duotone" /><div><strong>已找到相同内容的待确认批次</strong><span>系统没有新建重复批次；你可继续处理下方原批次。</span></div><code>{job.contentFingerprint}</code></section> : null}
            {job.preflight ? (() => { const decision = job.preflight.reviewRows && !job.preflight.duplicateMatches ? { title: '需要确认未识别的供应商值', note: '异常行默认不选中，请核对映射或明确按原值写入。', className: 'warning' } : preflightDecision[job.preflight.decision] || preflightDecision.review_required; return <section className={`sku-preflight-decision ${decision.className}`}><span>{job.preflight.decision === 'blocked' ? <WarningCircle size={23} weight="fill" /> : <ShieldCheck size={23} weight="duotone" />}</span><div><h3>{decision.title}</h3><p>{decision.note}</p></div><dl><div><dt>默认选中</dt><dd>{job.preflight.defaultSelectedRows} 条</dd></div><div><dt>值待映射</dt><dd>{job.preflight.reviewRows || 0} 条</dd></div><div><dt>重复匹配</dt><dd>{job.preflight.duplicateMatches} 条</dd></div></dl></section> })() : null}
            <div className="sku-import-summary has-review"><div><span>总行数</span><strong>{job.totalRows}</strong></div><div className="ready"><span>可导入</span><strong>{job.readyRows}</strong></div><div className="review"><span>值待映射</span><strong>{job.reviewRows || 0}</strong></div><div className="duplicate"><span>疑似重复</span><strong>{job.duplicateRows}</strong></div><div className="invalid"><span>不可导入</span><strong>{job.invalidRows}</strong></div></div>
            {job.preflight ? <div className="sku-preflight-grid"><section><header><strong>资料覆盖率</strong><span>不阻断导入，但会影响后续核验</span></header><div className="sku-preflight-coverage">{job.preflight.coverage.map((item) => <div key={item.field}><span><b>{item.label}</b><em>{item.present}/{item.total} · {item.percent}%</em></span><i><b style={{ width: `${item.percent}%` }} /></i></div>)}</div></section><section><header><strong>问题汇总</strong><span>按严重程度与影响行数排序</span></header><div className="sku-preflight-issues">{job.preflight.issueSummary.slice(0, 5).map((issue) => <div className={issue.severity} key={issue.code}><span>{issue.severity === 'error' ? <WarningCircle size={16} weight="fill" /> : <WarningCircle size={16} />}</span><p><strong>{issue.message}</strong><small>{issue.count} 行受影响</small></p></div>)}{!job.preflight.issueSummary.length ? <div className="clear"><span><CheckCircle size={17} weight="fill" /></span><p><strong>未发现字段问题</strong><small>可继续检查逐行结果</small></p></div> : null}</div></section></div> : null}
            {valueReviewQueue.length ? <section className="sku-value-review-queue"><header><div><span><WarningCircle size={19} weight="fill" /></span><div><strong>供应商值异常队列</strong><small>填写标准值后会保存到“{job.mappingSnapshot?.name || '当前供应商方案'}”，并立即重新检查当前批次。</small></div></div><div className="sku-value-review-actions"><b>{valueReviewQueue.length} 个未识别值</b><button type="button" disabled={busy || !Object.values(valueResolutionDraft).some((value) => String(value).trim())} onClick={resolveValueExceptions}>{busy ? '正在重新检查…' : '保存并重新检查'}</button></div></header><div>{valueReviewQueue.map((item) => { const key = `${item.field}:${item.value}`; return <article key={key}><div><span>{valueMappingFieldLabel[item.field] || item.field}</span><strong>{item.value}</strong><small>文件第 {item.rows.join('、')} 行</small></div><ArrowRight size={15} /><label><span>标准值</span><input aria-label={`${valueMappingFieldLabel[item.field] || item.field} ${item.value} 的标准值`} value={valueResolutionDraft[key] || ''} onChange={(event) => setValueResolutionDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder="输入资料库标准值" /></label></article> })}</div><footer><CheckCircle size={16} weight="fill" /><span>本次保存会生成方案 v{Number(job.mappingSnapshot?.version || 0) + 1}，原始供应商值仍保留在来源证据中。</span></footer></section> : null}
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
            <div className="history-detail-title"><div><h3>{selectedJob.sourceName}</h3><p>批次 {selectedJob.id.slice(0, 8)} · 指纹 {selectedJob.contentFingerprint || '—'} · 创建于 {displayTime(selectedJob.createdAt)}{selectedJob.mappingSnapshot?.name ? ` · 映射方案 ${selectedJob.mappingSnapshot.name}` : ''}</p></div><span className={`import-state ${(jobState[selectedJob.state] || {}).className || 'skipped'}`}>{(jobState[selectedJob.state] || {}).label || selectedJob.state}</span></div>
            <div className="sku-import-summary"><div><span>总行数</span><strong>{selectedJob.totalRows}</strong></div><div className="ready"><span>成功写入</span><strong>{selectedJob.importedRows}</strong></div><div className="duplicate"><span>跳过 / 无效</span><strong>{selectedJob.rows.filter((row) => ['skipped', 'invalid'].includes(row.state)).length}</strong></div><div className="invalid"><span>写入失败</span><strong>{selectedJob.failedRows}</strong></div></div>
            <div className="history-detail-grid"><section><h4>逐行结果</h4><div className="history-row-list">{selectedJob.rows.map((row) => { const state = rowState[row.state] || { label: row.state, className: 'skipped' }; const identity = row.payload?.identity || {}; const primary = row.payload?.identifiers?.find((item) => item.isPrimary); return <div key={row.id}><span>{row.rowNumber}</span><span><strong>{identity.nameZh || identity.nameEn || '未命名'}</strong><small>{primary?.rawValue || '无主 OE'}</small></span><span className={`import-state ${state.className}`}>{state.label}</span><small>{row.errorMessage || row.issues?.map((item) => item.message).join('、') || '—'}</small></div> })}</div></section><section><h4>执行记录</h4><div className="history-attempts">{selectedJob.attempts.map((attempt) => <div key={attempt.id}><span><ArrowsClockwise size={18} weight="bold" /></span><div><strong>{attempt.attemptType === 'retry' ? `第 ${attempt.attemptNumber} 次 · 失败重试` : '首次写入'}</strong><small>{attempt.startedBy} · {displayTime(attempt.startedAt)}</small><p>选中 {attempt.selectedRows} · 成功 {attempt.importedRows} · 失败 {attempt.failedRows}</p></div></div>)}{!selectedJob.attempts.length ? <p className="history-no-attempt">尚未执行写入</p> : null}</div></section></div>
          </div> : null}

          {mode === 'profiles' ? <div className="sku-profile-manager">
            <header><div><h3>供应商映射方案</h3><p>管理自动套用规则、表头结构和历史使用记录。</p></div><dl><div><dt>方案</dt><dd>{profiles.length}</dd></div><div><dt>启用</dt><dd>{profiles.filter((profile) => profile.active).length}</dd></div><div><dt>累计使用</dt><dd>{profiles.reduce((sum, profile) => sum + profile.usageCount, 0)}</dd></div></dl></header>
            <div className="sku-profile-toolbar"><label><MagnifyingGlass size={17} /><input aria-label="搜索映射方案" value={profileQuery} onChange={(event) => setProfileQuery(event.target.value)} placeholder="搜索方案或文件名特征" /></label><select aria-label="映射方案状态" value={profileState} onChange={(event) => setProfileState(event.target.value)}><option value="all">全部状态</option><option value="active">仅启用</option><option value="inactive">已停用</option></select></div>
            <div className="sku-profile-workspace">
              <aside><div className="sku-profile-list">{visibleProfiles.map((profile) => <button type="button" className={selectedProfile?.id === profile.id ? 'active' : ''} key={profile.id} onClick={() => openProfile(profile.id)}><span><strong>{profile.name}</strong><small>{profile.sourceNamePattern || '未设置文件名特征'} · v{profile.version}</small></span><span><em className={profile.active ? 'enabled' : 'disabled'}>{profile.active ? '启用' : '停用'}</em><small>{profile.usageCount} 次使用</small></span><ArrowRight size={17} /></button>)}{!visibleProfiles.length && !profilesLoading ? <div className="sku-profile-empty"><ArrowsLeftRight size={30} /><strong>没有匹配的方案</strong><span>首次导入供应商文件时可保存方案</span></div> : null}</div></aside>
              <section className="sku-profile-inspector">{selectedProfile ? <>
                <header><div><span className={selectedProfile.active ? 'enabled' : 'disabled'}>{selectedProfile.active ? '启用中' : '已停用'}</span><h3>{selectedProfile.name}</h3><p>文件名特征 {selectedProfile.sourceNamePattern || '—'} · v{selectedProfile.version} · {selectedProfile.usageCount} 次使用</p></div><div><button type="button" aria-label="编辑值映射" onClick={() => startProfileAction('values')}><ArrowsLeftRight size={17} />值映射</button><button type="button" aria-label="编辑导入规则" onClick={() => startProfileAction('rules')}><SlidersHorizontal size={17} />导入规则</button><button type="button" aria-label="重命名方案" onClick={() => startProfileAction('rename')}><PencilSimple size={17} />重命名</button><button type="button" aria-label="复制方案" onClick={() => startProfileAction('clone')}><Copy size={17} />复制</button><button type="button" className={selectedProfile.active ? 'danger' : 'restore'} aria-label={selectedProfile.active ? '停用方案' : '恢复方案'} onClick={() => startProfileAction('toggle')}><Power size={17} />{selectedProfile.active ? '停用' : '恢复'}</button></div></header>
                {profileAction && !['rules', 'values'].includes(profileAction) ? <div className={`sku-profile-action ${profileAction === 'toggle' ? 'warning' : ''}`}><div><strong>{profileAction === 'rename' ? '重命名方案' : profileAction === 'clone' ? '复制为新方案' : selectedProfile.active ? '确认停用方案' : '确认恢复方案'}</strong><span>{profileAction === 'toggle' ? selectedProfile.active ? '停用后不再参与自动匹配，历史导入仍然保留。' : '恢复后将重新参与供应商文件自动匹配。' : '名称应能识别供应商或文件用途。'}</span></div>{profileAction !== 'toggle' ? <input aria-label={profileAction === 'rename' ? '新的方案名称' : '复制方案名称'} value={profileActionName} onChange={(event) => setProfileActionName(event.target.value)} /> : null}<div><button type="button" onClick={() => setProfileAction('')}>取消</button><button className="confirm" type="button" disabled={profileBusy || (profileAction !== 'toggle' && !profileActionName.trim())} onClick={submitProfileAction}>{profileBusy ? '正在保存…' : '确认'}</button></div></div> : null}
                {profileAction === 'rules' && profileRulesDraft ? <section className="sku-profile-rule-editor"><header><div><strong>编辑导入规则</strong><span>空值才会使用默认值；清理规则不会覆盖原始供应商行。</span></div><div><button type="button" onClick={() => { setProfileAction(''); setProfileRulesDraft(null) }}>取消</button><button className="confirm" type="button" disabled={profileBusy} onClick={submitProfileAction}>{profileBusy ? '正在保存…' : '保存规则'}</button></div></header><div className="sku-profile-default-grid">{[['brand', '默认品牌'], ['category', '默认分类'], ['unit', '默认单位'], ['sourceSystem', '来源系统']].map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label} value={profileRulesDraft.defaultValues[key] || ''} onChange={(event) => setProfileRulesDraft((current) => ({ ...current, defaultValues: { ...current.defaultValues, [key]: event.target.value } }))} placeholder="留空则不补充" /></label>)}</div><div className="sku-profile-transform-grid">{Object.entries(transformRuleLabel).map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(profileRulesDraft.transformRules[key])} onChange={(event) => setProfileRulesDraft((current) => ({ ...current, transformRules: { ...current.transformRules, [key]: event.target.checked } }))} /><span><strong>{label}</strong><small>{key === 'uppercaseOe' ? '仅处理主 OE 标准字段' : '应用到已映射的文本字段'}</small></span></label>)}</div></section> : null}
                {profileAction === 'values' && profileValueMappingsDraft ? <section className="sku-profile-value-editor"><header><div><strong>编辑供应商值映射</strong><span>将供应商写法转换为资料库标准值；未识别值会进入异常队列。</span></div><div><button type="button" onClick={() => { setProfileAction(''); setProfileValueMappingsDraft(null) }}>取消</button><button className="confirm" type="button" disabled={profileBusy} onClick={submitProfileAction}>{profileBusy ? '正在保存…' : '保存映射'}</button></div></header><div className="sku-profile-value-columns">{Object.entries(valueMappingFieldLabel).map(([field, label]) => <section key={field}><header><div><strong>{label}</strong><span>{profileValueMappingsDraft[field].length} 条</span></div><button type="button" aria-label={`添加${label}映射`} onClick={() => addProfileValueMapping(field)}><Plus size={15} />添加</button></header><div>{profileValueMappingsDraft[field].map((entry, index) => <div key={`${field}-${index}`}><input aria-label={`${label}供应商值 ${index + 1}`} value={entry.source} onChange={(event) => updateProfileValueMapping(field, index, 'source', event.target.value)} placeholder="供应商写法" /><ArrowRight size={14} /><input aria-label={`${label}标准值 ${index + 1}`} value={entry.target} onChange={(event) => updateProfileValueMapping(field, index, 'target', event.target.value)} placeholder="标准值" /><button type="button" aria-label={`删除${label}映射 ${index + 1}`} onClick={() => removeProfileValueMapping(field, index)}><Trash size={15} /></button></div>)}{!profileValueMappingsDraft[field].length ? <p>尚未配置，只有添加映射后才会检查未知值。</p> : null}</div></section>)}</div></section> : null}
                <div className="sku-profile-facts"><div><span>原始字段</span><strong>{selectedProfile.sourceHeaders.length}</strong></div><div><span>已映射</span><strong>{Object.keys(selectedProfile.fieldMapping).length}</strong></div><div><span>最后使用</span><strong>{displayTime(selectedProfile.lastUsedAt)}</strong></div><div><span>最后修改人</span><strong>{selectedProfile.updatedBy}</strong></div></div>
                <section className="sku-profile-rule-summary"><header><span><SlidersHorizontal size={18} /></span><div><strong>导入标准化</strong><small>每次预检查前执行，可在字段映射页查看首行前后对比。</small></div></header><div><p><span>默认值</span><strong>{Object.entries(selectedProfile.defaultValues || {}).filter(([, value]) => value).map(([key, value]) => `${({ brand: '品牌', category: '分类', unit: '单位', sourceSystem: '来源' })[key]} ${value}`).join(' · ') || '未配置'}</strong></p><p><span>清理规则</span><strong>{Object.entries(selectedProfile.transformRules || {}).filter(([, enabled]) => enabled).map(([key]) => transformRuleLabel[key]).filter(Boolean).join(' · ') || '未启用'}</strong></p></div></section>
                <section className="sku-profile-value-summary"><header><span><ArrowsLeftRight size={18} /></span><div><strong>供应商值映射</strong><small>有映射表的字段才会检查未知值。</small></div></header><div>{Object.entries(valueMappingFieldLabel).map(([field, label]) => <p key={field}><span>{label}</span><strong>{selectedProfile.valueMappings?.[field]?.length || 0} 条</strong><small>{(selectedProfile.valueMappings?.[field] || []).slice(0, 2).map((entry) => `${entry.source} → ${entry.target}`).join(' · ') || '未配置'}</small></p>)}</div></section>
                <section className="sku-profile-mapping-detail"><header><strong>字段对应关系</strong><span>标准字段 ← 供应商原始列</span></header><div>{catalogImportFieldDefinitions.map((field) => <div key={field.key}><span>{field.label}</span><ArrowLeft size={14} /><strong>{selectedProfile.fieldMapping[field.key] || '未映射'}</strong></div>)}</div></section>
                <div className="sku-profile-detail-grid"><section><header><strong>最近使用</strong><span>{selectedProfile.recentUses?.length || 0} 个批次</span></header><div>{selectedProfile.recentUses?.map((use) => <div key={use.id}><span><strong>{use.sourceName}</strong><small>{displayTime(use.createdAt)} · {use.matchStatus || '人工映射'}</small></span><span><b>{use.importedRows}/{use.totalRows}</b><small>{(jobState[use.state] || {}).label || use.state}</small></span></div>)}{!selectedProfile.recentUses?.length ? <p>尚未用于导入批次</p> : null}</div></section><section><header><strong>变更记录</strong><span>最近 {selectedProfile.changes?.length || 0} 条</span></header><div>{selectedProfile.changes?.map((change) => <div key={change.id}><span className="change-dot" /><span><strong>{profileChangeLabel[change.action] || change.action}</strong><small>{change.actor} · {displayTime(change.createdAt)} · v{change.version}</small></span></div>)}{!selectedProfile.changes?.length ? <p>暂无变更记录</p> : null}</div></section></div>
              </> : <div className="sku-profile-empty detail"><ArrowsLeftRight size={36} /><strong>选择一个映射方案</strong><span>查看字段关系、最近使用和版本记录</span></div>}</section>
            </div>
          </div> : null}

          {error ? <div className="sku-import-error"><WarningCircle size={18} weight="fill" />{error}</div> : null}
        </div>

        <footer className="sku-import-actions">
          {mode === 'new' && ['mapping', 'preview'].includes(step) ? <button type="button" onClick={() => { setStep('upload'); setJob(null); setMappingContext(null); setError('') }}><ArrowLeft size={17} />重新选择</button> : <span />}
          {mode === 'new' && step === 'upload' ? <button className="secondary" type="button" onClick={onClose}>取消</button> : null}
          {mode === 'new' && step === 'mapping' ? <button className="primary" type="button" disabled={busy || !mappingReady} onClick={confirmMapping}>{busy ? '正在预检查…' : '确认映射并预检查'}</button> : null}
          {mode === 'new' && step === 'preview' ? <button className="primary" type="button" disabled={busy || !selected.size} onClick={commit}>{busy ? '正在写入…' : `写入 ${selected.size} 条草稿`}</button> : null}
          {mode === 'new' && step === 'result' ? <button className="primary" type="button" onClick={onClose}>完成并返回资料库</button> : null}
          {['history', 'profiles'].includes(mode) ? <button className="secondary" type="button" onClick={onClose}>关闭</button> : null}
          {mode === 'history' && selectedJob?.state === 'partial' ? <button className="primary" type="button" disabled={busy} onClick={retryFailed}><ArrowsClockwise size={17} />{busy ? '正在重试…' : `重试 ${selectedJob.failedRows} 条失败记录`}</button> : null}
        </footer>
      </section>
    </div>
  )
}
