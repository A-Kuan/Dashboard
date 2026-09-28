import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Camera, CheckCircle, Circle, FloppyDisk, ImageSquare,
  MagnifyingGlassPlus, Plus, SealCheck, Warning, X,
} from '@phosphor-icons/react'
import { DictionarySelect } from './Common'
import { createSku, discontinueSku, getSku, publishSku, updateSku, validateSkuCode } from '../services/skuService'
import { assetPath } from '../utils/assetPath'

const editorTabs = ['基本信息', 'OE 与替代', '适配车型']
const blankForm = {
  skuCode: '', chineseName: '', brand: 'Porsche', category: '车身及内饰', subcategory: '',
  manufacturerPartNumber: '', primaryOe: '', unit: '件', lifecycleStatus: '草稿', barcode: '',
  imageUrl: '', dataSource: '人工录入', sourceEvidence: null, conflictResolution: null,
  createdAt: '', updatedAt: '', updatedBy: '张伟', version: null,
}

const codeFieldHint = '仅支持英文字母、数字、空格及 - . _ / # ( ) +'
const allowedCodeCharacter = /[A-Za-z0-9 ._/#()+-]/g

function sanitizeCodeValue(value) {
  return value.match(allowedCodeCharacter)?.join('') || ''
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function EditorField({ label, required = false, children }) {
  return <label className="editor-field"><span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>{children}</label>
}

function TextField({ label, value, onChange, required, readOnly = false, valid = false, onBlur, error = '', codeInput = false }) {
  const className = ['editor-input', valid ? 'valid' : '', error ? 'invalid' : ''].filter(Boolean).join(' ')
  return <EditorField label={label} required={required}><div className={className}><input aria-invalid={Boolean(error)} aria-describedby={error ? `${label}-input-error` : undefined} autoCapitalize={codeInput ? 'off' : undefined} lang={codeInput ? 'en' : undefined} spellCheck={codeInput ? false : undefined} value={value} onBlur={onBlur} onChange={(event) => onChange?.(event.target.value)} readOnly={readOnly} />{valid ? <CheckCircle size={16} weight="fill" /> : null}</div>{error ? <small className="editor-field-error" id={`${label}-input-error`} role="alert">{error}</small> : null}</EditorField>
}

function SelectField({ label, value, onChange, options, required, status = false }) {
  return <EditorField label={label} required={required}><div className={status ? 'editor-native-select has-status' : 'editor-native-select'}>{status ? <i /> : null}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div></EditorField>
}

function SectionHeading({ title, description, action }) {
  return <header className="editor-section-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>
}

function EditableCell({ value, onChange, label }) {
  return <input aria-label={label} className="table-cell-input" value={value} onChange={(event) => onChange(event.target.value)} />
}

function OeRelations({ rows, setRows }) {
  const update = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const addOe = () => setRows((current) => [...current, { type: current.length ? '替代号' : '主 OE', oeNumber: '', brand: '', relation: '', source: '人工录入', confidence: '待核验' }])
  return <section className="editor-section" id="oe-relations">
    <SectionHeading title="OE 与替代关系" description="维护该零件的 OE 号及替代关系，保存后同步写入数据库" action={<div className="section-actions"><button onClick={addOe} type="button"><Plus size={16} />添加 OE 号</button></div>} />
    {rows.length ? <div className="editor-table-wrap"><table className="editor-table oe-editor-table"><thead><tr><th>类型</th><th>OE / 替代号</th><th>品牌</th><th>关系</th><th>来源</th><th>可信度</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.id || 'new-oe'}-${index}`}><td><EditableCell label={`OE 类型 ${index + 1}`} value={row.type} onChange={(value) => update(index, 'type', value)} /></td><td><EditableCell label={`OE 编号 ${index + 1}`} value={row.oeNumber} onChange={(value) => update(index, 'oeNumber', value)} /></td><td><EditableCell label={`OE 品牌 ${index + 1}`} value={row.brand} onChange={(value) => update(index, 'brand', value)} /></td><td><EditableCell label={`OE 关系 ${index + 1}`} value={row.relation} onChange={(value) => update(index, 'relation', value)} /></td><td><EditableCell label={`OE 来源 ${index + 1}`} value={row.source} onChange={(value) => update(index, 'source', value)} /></td><td><EditableCell label={`OE 可信度 ${index + 1}`} value={row.confidence} onChange={(value) => update(index, 'confidence', value)} /></td><td><button className="remove-row-button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} type="button">删除</button></td></tr>)}</tbody></table></div> : <div className="editor-inline-empty">尚未添加 OE 或替代关系</div>}
  </section>
}

function FitmentTable({ rows, setRows }) {
  const update = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const addFitment = () => setRows((current) => [...current, { vehicle: '', years: '', engine: '', body: '', condition: '', source: '人工录入', verificationStatus: '待验证' }])
  return <section className="editor-section" id="fitments">
    <SectionHeading title="适配车型" description="指定适用的车型、年款、发动机和限制条件" action={<div className="section-actions"><button onClick={addFitment} type="button"><Plus size={16} />添加适配车型</button></div>} />
    {rows.length ? <div className="editor-table-wrap"><table className="editor-table fitment-editor-table"><thead><tr><th>#</th><th>品牌 / 车型</th><th>年份</th><th>发动机</th><th>车身形式</th><th>适配条件</th><th>来源</th><th>验证状态</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.id || 'new-fitment'}-${index}`}><td>{index + 1}</td><td><EditableCell label={`适配车型 ${index + 1}`} value={row.vehicle} onChange={(value) => update(index, 'vehicle', value)} /></td><td><EditableCell label={`适配年份 ${index + 1}`} value={row.years} onChange={(value) => update(index, 'years', value)} /></td><td><EditableCell label={`适配发动机 ${index + 1}`} value={row.engine} onChange={(value) => update(index, 'engine', value)} /></td><td><EditableCell label={`车身形式 ${index + 1}`} value={row.body} onChange={(value) => update(index, 'body', value)} /></td><td><EditableCell label={`适配条件 ${index + 1}`} value={row.condition} onChange={(value) => update(index, 'condition', value)} /></td><td><EditableCell label={`适配来源 ${index + 1}`} value={row.source} onChange={(value) => update(index, 'source', value)} /></td><td><EditableCell label={`验证状态 ${index + 1}`} value={row.verificationStatus} onChange={(value) => update(index, 'verificationStatus', value)} /></td><td><button className="remove-row-button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} type="button">删除</button></td></tr>)}</tbody></table></div> : <div className="editor-inline-empty">尚未添加适配车型</div>}
  </section>
}

function getRequiredPublishChecks(form, oeRows, fitmentRows) {
  return [
    ['基本信息', Boolean(form.skuCode && form.chineseName && form.brand && form.category && form.subcategory && form.manufacturerPartNumber && form.primaryOe)],
    ['主 OE 关系', oeRows.some((row) => row.oeNumber?.trim().toLowerCase() === form.primaryOe?.trim().toLowerCase())],
    ['适配车型', fitmentRows.some((row) => row.vehicle?.trim())],
    ['数据来源', Boolean(form.dataSource)],
  ]
}

function PublishCheck({ form, oeRows, fitmentRows }) {
  const checks = getRequiredPublishChecks(form, oeRows, fitmentRows)
  const completed = checks.filter(([, value]) => value).length
  const recommendations = [['商品图片', Boolean(form.imageUrl)], ['条形码', Boolean(form.barcode)]]
  return <section className="publish-check"><h3>发布必填 <b>{completed}/{checks.length}</b></h3><div className="publish-progress"><span style={{ width: `${completed / checks.length * 100}%` }} /></div><div className="publish-check-grid">{checks.map(([item, complete]) => <span className={complete ? 'complete' : ''} key={item}>{complete ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}<b>{item}</b><em>{complete ? '已完成' : '待完成'}</em></span>)}</div><h4>建议补充</h4><div className="publish-check-grid">{recommendations.map(([item, complete]) => <span className={complete ? 'complete' : ''} key={item}>{complete ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}<b>{item}</b><em>{complete ? '已完成' : '可后补'}</em></span>)}</div></section>
}

function EvidencePanel({ form, oeRows, fitmentRows, onZoom }) {
  const evidence = form.sourceEvidence
  if (!evidence) return <aside className="evidence-panel evidence-empty"><header className="evidence-title"><div><h2>来源证据</h2></div></header><div className="evidence-empty-state"><ImageSquare size={38} /><h3>尚未关联 EPC 来源</h3><p>人工录入可先建档；接入 EPC 后，原始图组、OE 编号、车型和参考价会在这里显示。</p></div><PublishCheck form={form} oeRows={oeRows} fitmentRows={fitmentRows} /></aside>

  const comparisons = evidence.comparisons || []
  return <aside className="evidence-panel"><header className="evidence-title"><div><h2>EPC 来源证据</h2><span><SealCheck size={15} weight="fill" />可信来源</span></div><small>最后同步：{evidence.syncedAt || '—'}</small></header><section className="source-record"><h3>{evidence.title || 'EPC 原始记录'}</h3><div className="source-record-main"><div className="epc-editor-image"><img src={evidence.diagramUrl || assetPath('assets/parts/epc-diagram.png')} alt="EPC 图组" /><button aria-label="放大 EPC 图" onClick={onZoom} type="button"><MagnifyingGlassPlus size={17} /></button></div><dl><div><dt>OE 号</dt><dd>{evidence.oe || form.primaryOe}</dd></div><div><dt>原始名称</dt><dd>{evidence.originalName || '—'}</dd></div><div><dt>图组</dt><dd>{evidence.group || '—'}</dd></div><div><dt>位置</dt><dd>{evidence.position || '—'}</dd></div><div><dt>适配车型</dt><dd>{evidence.fitment || '—'}</dd></div><div className="reference-price"><dt>OEM 参考价（仅作来源参考）</dt><dd>{evidence.referencePrice || '—'}</dd></div></dl></div></section>{comparisons.length ? <section className="field-comparison"><h3>字段对比结果</h3>{comparisons.map((item) => <div className={item.passed ? 'comparison-row' : 'comparison-row warning-row'} key={item.label}>{item.passed ? <CheckCircle size={17} weight="fill" /> : <Warning size={17} weight="fill" />}<b>{item.label}</b><strong className={item.passed ? '' : 'warning'}>{item.result}</strong><span>{item.note}</span></div>)}</section> : null}<PublishCheck form={form} oeRows={oeRows} fitmentRows={fitmentRows} /></aside>
}

export function SkuEditor({ dictionaries, dictionariesLoading, mode = 'edit', skuId, onBack, onSaved }) {
  const [activeTab, setActiveTab] = useState('基本信息')
  const [form, setForm] = useState(blankForm)
  const [oeRows, setOeRows] = useState([])
  const [fitmentRows, setFitmentRows] = useState([])
  const [saveState, setSaveState] = useState(mode === 'new' ? '尚未保存' : '正在读取…')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(mode === 'edit')
  const [codeAvailable, setCodeAvailable] = useState(null)
  const [codeFieldErrors, setCodeFieldErrors] = useState({})
  const [zoomOpen, setZoomOpen] = useState(false)
  const imageInputRef = useRef(null)
  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setCodeValue = (key, value) => {
    const sanitized = sanitizeCodeValue(value)
    setValue(key, sanitized)
    setCodeFieldErrors((current) => ({ ...current, [key]: sanitized === value ? '' : codeFieldHint }))
  }

  useEffect(() => {
    if (mode !== 'edit' || !skuId) return
    const controller = new AbortController()
    getSku(skuId, { signal: controller.signal }).then((item) => {
      setForm({ ...blankForm, ...item })
      setOeRows(item.oeRelations || [])
      setFitmentRows(item.fitments || [])
      setCodeAvailable(true)
      setSaveState(`更新于 ${formatDate(item.updatedAt)}`)
    }).catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [mode, skuId])

  const completion = useMemo(() => {
    const values = [form.skuCode, form.chineseName, form.brand, form.category, form.subcategory, form.manufacturerPartNumber, form.primaryOe, form.barcode]
    return Math.round(values.filter(Boolean).length / values.length * 100)
  }, [form])
  const canPublish = useMemo(() => getRequiredPublishChecks(form, oeRows, fitmentRows).every(([, complete]) => complete), [fitmentRows, form, oeRows])

  const checkCode = async () => {
    if (!form.skuCode) return setCodeAvailable(null)
    try { setCodeAvailable((await validateSkuCode(form.skuCode, mode === 'edit' ? form.id : null)).available) } catch { setCodeAvailable(null) }
  }
  const save = async (publish = false) => {
    setError('')
    setSaveState('正在保存…')
    const payload = { ...form, oeRelations: oeRows, fitments: fitmentRows }
    try {
      let item
      if (mode === 'new') item = await createSku(payload)
      else item = publish ? await publishSku(form.id || skuId, payload) : await updateSku(form.id || skuId, payload)
      setSaveState(publish ? 'SKU 已保存并发布' : '草稿已保存到数据库')
      if (mode === 'new') onSaved(item.id)
      else setForm((current) => ({ ...current, ...item }))
    } catch (reason) {
      setError(reason.message)
      setSaveState('保存失败')
    }
  }
  const discontinue = async () => {
    if (!window.confirm('确认将这个 SKU 标记为停产吗？停产后仍保留历史数据，可重新发布。')) return
    setError('')
    setSaveState('正在停产…')
    try {
      const item = await discontinueSku(form.id || skuId, { version: form.version })
      setForm((current) => ({ ...current, ...item }))
      setSaveState('SKU 已标记为停产')
    } catch (reason) {
      setError(reason.message)
      setSaveState('停产失败')
    }
  }
  const selectTab = (tab) => {
    setActiveTab(tab)
    const targets = { '基本信息': 'basic-information', 'OE 与替代': 'oe-relations', '适配车型': 'fitments' }
    document.getElementById(targets[tab] || 'basic-information')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <main className="sku-editor-page editor-loading"><span />正在读取 SKU 数据…</main>
  return <main className="sku-editor-page">
    <header className="sku-editor-heading"><div><button className="editor-back" onClick={onBack} type="button"><ArrowLeft size={15} />返回 SKU 管理</button><div className="editor-title-line"><h1>{mode === 'new' ? '新建 SKU' : '编辑 SKU'}</h1><span>{form.lifecycleStatus || '草稿'}</span></div></div><div className="editor-save-actions"><span className={saveState.includes('已保存') || saveState.includes('已标记') ? 'save-message success' : 'save-message'}>{saveState.includes('已保存') || saveState.includes('已标记') ? <CheckCircle size={15} weight="fill" /> : null}{saveState}</span><button className="secondary-button" onClick={onBack} type="button">取消</button>{mode === 'edit' && form.lifecycleStatus === '在售' ? <button className="secondary-button danger-button" onClick={discontinue} type="button">停产 SKU</button> : null}{mode === 'edit' ? <button className="secondary-button" onClick={() => save(false)} type="button"><FloppyDisk size={16} />保存草稿</button> : null}<button className="primary-button" disabled={mode === 'edit' && !canPublish} onClick={() => save(mode === 'edit')} title={mode === 'edit' && !canPublish ? '请先完成发布必填项' : undefined} type="button">{mode === 'new' ? '创建草稿' : form.lifecycleStatus === '停产' ? '重新发布 SKU' : '发布 SKU'}</button></div></header>
    {error ? <div className="editor-error"><Warning size={17} weight="fill" />{error}</div> : null}
    <nav className="editor-tabs" aria-label="SKU 编辑区段">{editorTabs.map((tab) => <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => selectTab(tab)} type="button">{tab}</button>)}</nav>
    <div className="sku-editor-layout"><div className="sku-editor-main"><section className="identity-section" id="basic-information"><div className="identity-image"><div>{form.imageUrl ? <img src={form.imageUrl} alt={form.chineseName || 'SKU 商品图'} /> : <span className="image-placeholder"><ImageSquare size={36} />尚未上传图片</span>}<button aria-label="查看商品图片" disabled={!form.imageUrl} type="button"><MagnifyingGlassPlus size={16} /></button></div><button onClick={() => imageInputRef.current?.click()} type="button"><Camera size={17} />上传图片</button><input ref={imageInputRef} accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return setError('图片不能超过 2MB'); const reader = new FileReader(); reader.onload = () => setValue('imageUrl', reader.result); reader.readAsDataURL(file) }} type="file" /></div><div className="identity-content"><header><div><div className="sku-title"><h2>{form.skuCode || '待填写 SKU 编码'}</h2>{codeAvailable === true ? <span><CheckCircle size={15} weight="fill" />SKU 编码可用</span> : null}</div><h3>{form.chineseName || '请输入零件中文名称'}</h3><p>品牌　<b>{form.brand || '—'}</b><i />零件大类　<b>{form.category || '—'}</b><i />零件小类　<b>{form.subcategory || '—'}</b></p></div><div className="identity-meta"><span>信息完整度 <b>{completion}%</b><i><em style={{ width: `${completion}%` }} /></i></span><dl><div><dt>数据来源</dt><dd>{form.dataSource || '人工录入'}</dd></div><div><dt>状态</dt><dd>{form.lifecycleStatus}</dd></div></dl></div></header><div className="editor-fields">
      <TextField codeInput error={codeFieldErrors.skuCode} label="SKU 编码" value={form.skuCode} onChange={(value) => { setCodeValue('skuCode', value); setCodeAvailable(null) }} onBlur={checkCode} required valid={codeAvailable === true} />
      <TextField label="中文名称" value={form.chineseName} onChange={(value) => setValue('chineseName', value)} required />
      <EditorField label="品牌" required><DictionarySelect allowAll={false} showLabel={false} className="form-dictionary" dictionaryCode="sku_brand" dictionaries={dictionaries} fallbackLabel="品牌" value={form.brand} onChange={(value) => setValue('brand', value)} disabled={dictionariesLoading} /></EditorField>
      <EditorField label="零件大类" required><DictionarySelect allowAll={false} showLabel={false} className="form-dictionary" dictionaryCode="part_category" dictionaries={dictionaries} fallbackLabel="零件大类" value={form.category} onChange={(value) => setValue('category', value)} disabled={dictionariesLoading} /></EditorField>
      <TextField label="零件小类" value={form.subcategory} onChange={(value) => setValue('subcategory', value)} required />
      <TextField codeInput error={codeFieldErrors.manufacturerPartNumber} label="制造商零件号" value={form.manufacturerPartNumber} onChange={(value) => setCodeValue('manufacturerPartNumber', value)} required />
      <TextField codeInput error={codeFieldErrors.primaryOe} label="主 OE 号" value={form.primaryOe} onChange={(value) => setCodeValue('primaryOe', value)} required />
      <SelectField label="计量单位" value={form.unit} onChange={(value) => setValue('unit', value)} options={['件', '套', '盒', '支']} required />
      <TextField label="生命周期状态" value={form.lifecycleStatus} readOnly required />
      <TextField label="条形码 / GTIN" value={form.barcode} onChange={(value) => setValue('barcode', value)} />
      <SelectField label="数据来源" value={form.dataSource} onChange={(value) => setValue('dataSource', value)} options={['人工录入', 'EPC 导入', '供应商资料', '历史系统']} required />
      <TextField label="最后更新" value={formatDate(form.updatedAt)} readOnly />
      <TextField label="更新者" value={form.updatedBy || '张伟'} readOnly />
    </div></div></section><OeRelations rows={oeRows} setRows={setOeRows} /><FitmentTable rows={fitmentRows} setRows={setFitmentRows} /></div><EvidencePanel form={form} oeRows={oeRows} fitmentRows={fitmentRows} onZoom={() => setZoomOpen(true)} /></div>
    {zoomOpen && form.sourceEvidence ? <div className="epc-zoom-backdrop" onMouseDown={() => setZoomOpen(false)}><section onMouseDown={(event) => event.stopPropagation()}><header><div><ImageSquare size={19} /><b>{form.sourceEvidence.title || 'EPC 来源图'}</b></div><button aria-label="关闭 EPC 大图" onClick={() => setZoomOpen(false)} type="button"><X size={19} /></button></header><img src={form.sourceEvidence.diagramUrl || assetPath('assets/parts/epc-diagram.png')} alt="EPC 大图" /></section></div> : null}
  </main>
}
