import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  ClipboardText,
  Cube,
  FloppyDisk,
  Info,
  LinkSimple,
  Plus,
  SealCheck,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import '../sku-editor.css'
import { findDuplicateIdentifiers, saveCatalogDraft, submitCatalogReview } from '../services/catalogApi'

const sourceLabels = {
  epc: 'EPC / VIN',
  oe: 'OE 查询',
  import: '批量导入',
  manual: '手工创建',
}

const steps = [
  { id: 'identity', label: '来源与身份' },
  { id: 'numbers', label: '编号关系' },
  { id: 'fitment', label: '适配车型' },
  { id: 'review', label: '发布检查' },
]

const sourceDefaults = {
  epc: { sourceSystem: 'Porsche PET', catalog: 'Cayenne 9YA / 615-05', position: '位置 3', originalName: 'Brake disc, internally vented', vin: 'WP1ZZZ9Y••••0931' },
  oe: { sourceSystem: 'OE 查询', catalog: 'OE 交叉查询结果', position: '—', originalName: 'Brake disc, front axle', vin: '—' },
  import: { sourceSystem: '供应商资料表', catalog: '待导入文件 / 第 1 行', position: '—', originalName: '前制动盘', vin: '—' },
  manual: { sourceSystem: '手工录入', catalog: '—', position: '—', originalName: '—', vin: '—' },
}

function makeInitialDraft(source, record) {
  if (record) {
    return {
      code: record.code,
      name: record.name,
      englishName: record.englishName,
      brand: record.brand,
      category: record.category,
      unit: record.unit || '件',
      primaryOe: record.primaryOe,
      identifiers: record.identifiers.filter((item) => !item.isPrimary && item.type !== '主 OE').map((item, index) => ({ id: item.id || `existing-${index}`, type: item.type, value: item.value, relation: item.relation })),
      fitments: record.fitments.map((item, index) => ({
        id: `fitment-${index}`, persistedId: item.id, vehicle: item.vehicle, platformId: item.platformId, years: item.years,
        yearFrom: item.yearFrom, yearTo: item.yearTo, engineCodes: item.engineCodes?.join(', ') || '', prCodes: item.prCodes?.join(', ') || '',
        position: item.position, condition: item.condition, exclusion: item.exclusion, verificationStatus: item.verificationStatus,
      })),
      evidence: { ...record.evidence, sourceSystem: record.evidence.system, position: record.evidence.figure, vin: record.evidence.catalog.includes('VIN:') ? record.evidence.catalog.replace('VIN: ', '') : '—' },
    }
  }

  const isManual = source === 'manual'
  return {
    code: '保存后自动生成',
    name: isManual ? '' : '前制动盘',
    englishName: isManual ? '' : 'Brake disc, front axle',
    brand: isManual ? '' : 'Porsche OE',
    category: isManual ? '' : '制动系统 / 制动盘',
    unit: '件',
    primaryOe: isManual ? '' : '9Y0 615 301 M',
    identifiers: isManual ? [] : [{ id: 'relation-1', type: '历史 OE', value: '9Y0 615 301 K', relation: '被替代' }],
    fitments: isManual ? [] : [{ id: 'fitment-1', vehicle: 'Cayenne (9YA)', platformId: '9YA', years: '2018–2023', yearFrom: 2018, yearTo: 2023, engineCodes: '', prCodes: '', position: '前轴', condition: '350mm 制动盘', exclusion: '排除 PSCB' }],
    evidence: sourceDefaults[source] || sourceDefaults.manual,
  }
}

function Field({ label, required, hint, children }) {
  return <label className="editor-field"><span>{label}{required ? <em>*</em> : null}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}

function dictionaryItems(dictionaries, code, fallback, currentValue = '') {
  const configured = (dictionaries?.[code]?.items || []).filter((item) => item.enabled !== false && item.value !== '__all__')
  const items = [...configured]
  fallback.forEach((value) => { if (!items.some((item) => item.value === value)) items.push({ value, label: value }) })
  if (currentValue && !items.some((item) => item.value === currentValue)) return [{ value: currentValue, label: currentValue }, ...items]
  return items
}

export function SkuEditor({ source = 'manual', record, dictionaries = {}, onBack, onNotify, onSaved }) {
  const [step, setStep] = useState('identity')
  const [draft, setDraft] = useState(() => makeInitialDraft(source, record))
  const [savedAt, setSavedAt] = useState('')
  const [submitted, setSubmitted] = useState(record?.status === 'review')
  const [saving, setSaving] = useState(false)
  const [persistedRecord, setPersistedRecord] = useState(() => record?.dataOrigin === 'live' ? record : null)
  const [duplicateMatches, setDuplicateMatches] = useState([])

  const setField = (field, value) => {
    setSubmitted(false)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const checks = useMemo(() => [
    { id: 'name', label: '标准中文名称', passed: Boolean(draft.name.trim()), step: 'identity' },
    { id: 'brand', label: '品牌与零件分类', passed: Boolean(draft.brand && draft.category), step: 'identity' },
    { id: 'oe', label: '主 OE 编号', passed: Boolean(draft.primaryOe.trim()), step: 'numbers' },
    { id: 'fitment', label: '至少一条适配车型', passed: draft.fitments.length > 0, step: 'fitment' },
    { id: 'evidence', label: '可追溯的来源证据', passed: draft.evidence.sourceSystem !== '手工录入' && draft.evidence.catalog !== '—', step: 'identity' },
  ], [draft])

  const passedCount = checks.filter((item) => item.passed).length
  const completeness = Math.round((passedCount / checks.length) * 100)
  const currentIndex = steps.findIndex((item) => item.id === step)
  const brandOptions = dictionaryItems(dictionaries, 'sku_brand', ['Porsche OE', 'Audi OE', 'MANN-FILTER', 'LEMFÖRDER'], draft.brand)
  const categoryOptions = dictionaryItems(dictionaries, 'part_category', ['制动系统 / 制动盘', '制动系统 / 制动片', '保养件 / 机油滤芯', '底盘 / 控制臂'], draft.category)
  const unitOptions = dictionaryItems(dictionaries, 'unit', ['件', '套', '盒', '支'], draft.unit)

  const addIdentifier = () => { setSubmitted(false); setDraft((current) => ({ ...current, identifiers: [...current.identifiers, { id: `relation-${Date.now()}`, type: '品牌号', value: '', relation: '制造商号' }] })) }
  const updateIdentifier = (id, field, value) => { setSubmitted(false); setDraft((current) => ({ ...current, identifiers: current.identifiers.map((item) => item.id === id ? { ...item, [field]: value } : item) })) }
  const removeIdentifier = (id) => { setSubmitted(false); setDraft((current) => ({ ...current, identifiers: current.identifiers.filter((item) => item.id !== id) })) }

  const addFitment = () => { setSubmitted(false); setDraft((current) => ({ ...current, fitments: [...current.fitments, { id: `fitment-${Date.now()}`, vehicle: '', platformId: '', years: '', engineCodes: '', prCodes: '', position: '', condition: '', exclusion: '' }] })) }
  const updateFitment = (id, field, value) => { setSubmitted(false); setDraft((current) => ({ ...current, fitments: current.fitments.map((item) => item.id === id ? { ...item, [field]: value } : item) })) }
  const removeFitment = (id) => { setSubmitted(false); setDraft((current) => ({ ...current, fitments: current.fitments.filter((item) => item.id !== id) })) }

  const checkPrimaryDuplicate = async () => {
    if (!draft.primaryOe.trim()) return setDuplicateMatches([])
    try {
      setDuplicateMatches(await findDuplicateIdentifiers(draft.primaryOe, persistedRecord?.id || ''))
    } catch {
      setDuplicateMatches([])
    }
  }

  const persistDraft = async () => {
    setSaving(true)
    try {
      const saved = await saveCatalogDraft(draft, source, persistedRecord)
      const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      setPersistedRecord(saved)
      setSubmitted(saved.status === 'review')
      setDraft((current) => ({ ...current, code: saved.code }))
      setSavedAt(now)
      onSaved?.(saved)
      return saved
    } catch (error) {
      onNotify?.(error.code === 'CATALOG_VERSION_CONFLICT' ? '资料已在别处更新，请返回列表后重新打开' : `保存失败：${error.message}`)
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    const saved = await persistDraft()
    if (saved) onNotify?.('草稿已保存到 SKU 资料库')
  }

  const nextStep = () => {
    if (currentIndex < steps.length - 1) setStep(steps[currentIndex + 1].id)
  }

  const submitForReview = async () => {
    if (passedCount !== checks.length) {
      const firstIssue = checks.find((item) => !item.passed)
      setStep(firstIssue.step)
      onNotify?.(`还有 ${checks.length - passedCount} 项需要补充`)
      return
    }
    const saved = await persistDraft()
    if (!saved) return
    setSaving(true)
    try {
      const reviewRecord = await submitCatalogReview(saved)
      setPersistedRecord(reviewRecord)
      setSubmitted(true)
      onSaved?.(reviewRecord)
      onNotify?.('资料已提交审核并进入质量队列')
    } catch (error) {
      onNotify?.(`提交审核失败：${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="sku-main sku-editor-main">
      <header className="sku-editor-topbar">
        <div className="sku-editor-title">
          <button aria-label="返回 SKU 资料库" type="button" onClick={onBack}><ArrowLeft size={20} weight="bold" /></button>
          <div><span>{record ? '编辑 SKU' : '新建 SKU'}</span><h1>{draft.name || '未命名零件'}</h1></div>
          <em>{sourceLabels[source] || '已有资料'}</em>
        </div>
        <div className="sku-editor-save-state"><span>{saving ? '正在保存…' : savedAt ? `已保存 ${savedAt}` : '尚未保存'}</span><button type="button" disabled={saving} onClick={saveDraft}><FloppyDisk size={19} weight="bold" />{saving ? '保存中' : '保存草稿'}</button></div>
      </header>

      <div className="sku-editor-content">
        <nav className="sku-editor-steps" aria-label="SKU 编辑步骤">
          {steps.map((item, index) => {
            const active = item.id === step
            const completed = index < currentIndex || (item.id === 'review' && submitted)
            return <button className={`${active ? 'active' : ''} ${completed ? 'completed' : ''}`} key={item.id} type="button" onClick={() => setStep(item.id)}><span>{completed ? <Check size={15} weight="bold" /> : index + 1}</span><strong>{item.label}</strong></button>
          })}
        </nav>

        <div className="sku-editor-layout">
          <section className="sku-form-panel">
            {step === 'identity' ? <>
              <div className="sku-form-heading"><div><h2>来源与基本身份</h2><p>先确认原始证据，再整理成标准 SKU 信息。</p></div><span className="prototype-badge">资料库草稿</span></div>
              <article className={`source-evidence-summary ${source === 'manual' ? 'manual' : ''}`}>
                <header><span>{source === 'manual' ? <WarningCircle size={20} weight="fill" /> : <SealCheck size={20} weight="fill" />}</span><div><strong>{draft.evidence.sourceSystem}</strong><small>{source === 'manual' ? '暂无外部证据，发布前需要补充来源' : '来源信息只读，确保后续可以回溯'}</small></div></header>
                <dl><div><dt>目录 / 图组</dt><dd>{draft.evidence.catalog}</dd></div><div><dt>图例位置</dt><dd>{draft.evidence.position || draft.evidence.figure}</dd></div><div><dt>原始名称</dt><dd>{draft.evidence.originalName}</dd></div><div><dt>VIN 上下文</dt><dd>{draft.evidence.vin || '—'}</dd></div></dl>
              </article>
              <div className="sku-form-grid">
                <Field label="SKU 编码" hint="正式保存后生成唯一编码"><input disabled value={draft.code} /></Field>
                <Field label="计量单位" required><select value={draft.unit} onChange={(event) => setField('unit', event.target.value)}>{unitOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
                <Field label="中文标准名称" required><input value={draft.name} onChange={(event) => setField('name', event.target.value)} placeholder="例如：前制动盘" /></Field>
                <Field label="英文名称"><input value={draft.englishName} onChange={(event) => setField('englishName', event.target.value)} placeholder="Original or standard English name" /></Field>
                <Field label="品牌" required><select value={draft.brand} onChange={(event) => setField('brand', event.target.value)}><option value="">请选择品牌</option>{brandOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
                <Field label="零件分类" required><select value={draft.category} onChange={(event) => setField('category', event.target.value)}><option value="">请选择分类</option>{categoryOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
              </div>
            </> : null}

            {step === 'numbers' ? <>
              <div className="sku-form-heading"><div><h2>编号与替代关系</h2><p>保留原始格式，同时明确替代方向。</p></div><button className="outline-add" type="button" onClick={addIdentifier}><Plus size={17} weight="bold" />添加编号</button></div>
              <div className="primary-oe-block"><span><LinkSimple size={20} weight="bold" /></span><Field label="主 OE 编号" required hint="搜索会自动忽略空格和常用分隔符"><input className="oe-input" value={draft.primaryOe} onBlur={checkPrimaryDuplicate} onChange={(event) => { setDuplicateMatches([]); setField('primaryOe', event.target.value) }} placeholder="例如：9Y0 615 301 M" /></Field></div>
              {duplicateMatches.length ? <div className="editor-warning-note"><WarningCircle size={18} weight="fill" /><span><strong>发现 {duplicateMatches.length} 条相同编号资料。</strong> 请先核对是否为同一零件、品牌件或替代关系；系统不会自动合并。</span></div> : null}
              <div className="relation-table"><div className="relation-head"><span>编号类型</span><span>OE / 品牌号</span><span>关系</span><span /></div>{draft.identifiers.map((item) => <div className="relation-edit-row" key={item.id}><select value={item.type} onChange={(event) => updateIdentifier(item.id, 'type', event.target.value)}><option>历史 OE</option><option>品牌号</option><option>条形码</option><option>内部号</option></select><input value={item.value} onChange={(event) => updateIdentifier(item.id, 'value', event.target.value)} placeholder="输入编号" /><select value={item.relation} onChange={(event) => updateIdentifier(item.id, 'relation', event.target.value)}><option>被替代</option><option>替代旧号</option><option>可互换</option><option>制造商号</option><option>仅供参考</option></select><button aria-label="删除编号" type="button" onClick={() => removeIdentifier(item.id)}><Trash size={17} /></button></div>)}{!draft.identifiers.length ? <div className="editor-empty-row">暂无其他编号，主 OE 可以单独保存。</div> : null}</div>
              <div className="editor-info-note"><Info size={18} weight="fill" /><span><strong>替代关系具有方向。</strong>“A 被 B 替代”不会自动被当作双向通用。</span></div>
            </> : null}

            {step === 'fitment' ? <>
              <div className="sku-form-heading"><div><h2>适配车型</h2><p>适配结论必须包含车型和必要条件。</p></div><button className="outline-add" type="button" onClick={addFitment}><Plus size={17} weight="bold" />添加车型</button></div>
              <div className="fitment-editor-list">{draft.fitments.map((item, index) => <article className="fitment-editor-card" key={item.id}><header><span>适配 {index + 1}</span><em>{item.verificationStatus === 'verified' ? '已审核，修改后需重审' : '待专项审核'}</em><button aria-label="删除适配" type="button" onClick={() => removeFitment(item.id)}><Trash size={17} /></button></header><div className="sku-form-grid"><Field label="车型名称" required><input value={item.vehicle} onChange={(event) => updateFitment(item.id, 'vehicle', event.target.value)} placeholder="例如：Cayenne (9YA)" /></Field><Field label="平台编码" required><input value={item.platformId || ''} onChange={(event) => updateFitment(item.id, 'platformId', event.target.value.toUpperCase())} placeholder="例如：9YA" /></Field><Field label="年款范围" required><input value={item.years} onChange={(event) => updateFitment(item.id, 'years', event.target.value)} placeholder="例如：2018–2023" /></Field><Field label="安装位置"><input value={item.position || ''} onChange={(event) => updateFitment(item.id, 'position', event.target.value)} placeholder="例如：前轴 / 左侧" /></Field><Field label="发动机代码"><input value={item.engineCodes || ''} onChange={(event) => updateFitment(item.id, 'engineCodes', event.target.value)} placeholder="多个代码用逗号分隔" /></Field><Field label="PR 代码"><input value={item.prCodes || ''} onChange={(event) => updateFitment(item.id, 'prCodes', event.target.value)} placeholder="例如：1ZT, 1ZK" /></Field><Field label="包含条件"><input value={item.condition || ''} onChange={(event) => updateFitment(item.id, 'condition', event.target.value)} placeholder="例如：350mm 制动盘" /></Field><Field label="排除条件"><input value={item.exclusion || ''} onChange={(event) => updateFitment(item.id, 'exclusion', event.target.value)} placeholder="例如：排除 PSCB" /></Field><Field label="数据来源"><input disabled value={draft.evidence.sourceSystem} /></Field></div></article>)}{!draft.fitments.length ? <div className="fitment-empty"><Cube size={31} weight="duotone" /><strong>尚未添加适配车型</strong><span>只有完成适配核验的 SKU 才能进入发布状态。</span><button type="button" onClick={addFitment}><Plus size={17} weight="bold" />添加第一条适配</button></div> : null}</div>
            </> : null}

            {step === 'review' ? <>
              <div className="sku-form-heading"><div><h2>提交审核</h2><p>核对关键信息并交由审核队列完成最终核验。</p></div></div>
              {submitted ? <div className="verification-success"><span><CheckCircle size={30} weight="fill" /></span><div><h3>资料已进入审核队列</h3><p>审核人将结合来源证据、编号冲突和适配条件做最终确认。</p></div></div> : null}
              <div className="review-summary"><article><span>标准名称</span><strong>{draft.name || '—'}</strong></article><article><span>主 OE</span><strong>{draft.primaryOe || '—'}</strong></article><article><span>品牌 / 分类</span><strong>{draft.brand || '—'}</strong><small>{draft.category || '—'}</small></article><article><span>适配车型</span><strong>{draft.fitments.length} 条</strong></article><article className="wide"><span>来源证据</span><strong>{draft.evidence.sourceSystem}</strong><small>{draft.evidence.catalog}</small></article></div>
              <div className="publish-notice"><WarningCircle size={20} weight="fill" /><span>“提交审核”会锁定当前版本并写入审核队列；只有审核通过后资料状态才会变为“已核验”。</span></div>
            </> : null}
          </section>

          <aside className="sku-validation-panel">
            <div className="validation-score"><div><span>资料完整度</span><strong>{completeness}%</strong></div><div className="score-track"><i style={{ width: `${completeness}%` }} /></div><small>{passedCount} / {checks.length} 项已满足</small></div>
            <div className="validation-list"><h3>发布前检查</h3>{checks.map((item) => <button className={item.passed ? 'passed' : 'issue'} key={item.id} type="button" onClick={() => setStep(item.step)}>{item.passed ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}<span><strong>{item.label}</strong><small>{item.passed ? '已满足' : '点击前往补充'}</small></span><ArrowRight size={15} /></button>)}</div>
            <div className="validation-rule"><SealCheck size={21} weight="fill" /><div><strong>来源优先规则</strong><p>OEM 参考价与 EPC 原始字段只读保存，不会覆盖采购价或销售价。</p></div></div>
          </aside>
        </div>
      </div>

      <footer className="sku-editor-footer"><button type="button" onClick={onBack}>取消并返回</button><div><span>{saving ? '正在同步资料库' : savedAt ? `草稿保存于 ${savedAt}` : '尚未写入资料库'}</span>{step !== 'review' ? <button className="editor-next" type="button" onClick={nextStep}>下一步：{steps[currentIndex + 1]?.label}<ArrowRight size={18} weight="bold" /></button> : <button className="editor-verify" type="button" disabled={saving || submitted} onClick={submitForReview}><SealCheck size={19} weight="fill" />{submitted ? '已提交审核' : saving ? '提交中' : '提交审核'}</button>}</div></footer>
    </main>
  )
}
