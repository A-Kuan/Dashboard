import { useEffect, useMemo, useState } from 'react'
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
import { findDuplicateIdentifiers, listCatalogVehiclePlatforms, listCatalogVehicleVariants, saveCatalogDraft, submitCatalogReview } from '../services/catalogApi'

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

const ruleFields = [
  ['engineCode', '发动机代码'], ['transmissionCode', '变速箱代码'], ['marketCode', '市场代码'],
  ['bodyStyle', '车身形式'], ['driveType', '驱动形式'], ['prCode', 'PR 代码'], ['position', '安装位置'],
]

function editableRules(rules = []) {
  return rules.map((rule, index) => ({ ...rule, id: rule.id || `rule-${index}-${rule.field}`, values: Array.isArray(rule.values) ? rule.values : [] }))
}

function RuleBuilder({ title, tone, rules, onChange }) {
  const add = () => onChange([...rules, { id: `rule-${Date.now()}`, field: 'engineCode', operator: tone === 'exclude' ? 'not_in' : 'in', values: [] }])
  const update = (id, field, value) => onChange(rules.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule))
  return <section className={`fitment-rule-builder ${tone}`}><header><div><strong>{title}</strong><small>字段化规则会参与发布前冲突检测</small></div><button type="button" onClick={add}><Plus size={15} weight="bold" />添加规则</button></header>{rules.map((rule) => <div className="fitment-rule-row" key={rule.id}><select aria-label={`${title}字段`} value={rule.field} onChange={(event) => update(rule.id, 'field', event.target.value)}>{ruleFields.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select aria-label={`${title}关系`} value={rule.operator} onChange={(event) => update(rule.id, 'operator', event.target.value)}><option value="in">包含任一</option><option value="equals">必须等于</option><option value="not_in">不得包含</option></select><input aria-label={`${title}值`} value={(rule.values || []).join(', ')} onChange={(event) => update(rule.id, 'values', event.target.value.split(/[,，、]/).map((value) => value.trim()).filter(Boolean))} placeholder="多个值用逗号分隔" /><button aria-label={`删除${title}`} type="button" onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}><Trash size={16} /></button></div>)}{!rules.length ? <p>暂无结构化规则，可保留下面的旧备注作为补充说明。</p> : null}</section>
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
        variantMasterId: item.variantMasterId || '', yearFrom: item.yearFrom, yearTo: item.yearTo, engineCodes: item.engineCodes?.join(', ') || '',
        transmissionCodes: item.transmissionCodes?.join(', ') || '', marketCodes: item.marketCodes?.join(', ') || '', prCodes: item.prCodes?.join(', ') || '',
        bodyStyles: item.bodyStyles?.join(', ') || '', driveTypes: item.driveTypes?.join(', ') || '', position: item.position,
        condition: item.condition, exclusion: item.exclusion, includeRules: editableRules(item.includeRules), excludeRules: editableRules(item.excludeRules), verificationStatus: item.verificationStatus,
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
    fitments: isManual ? [] : [{ id: 'fitment-1', vehicle: 'Cayenne (9YA)', platformId: '9YA', variantMasterId: '', years: '2018–2023', yearFrom: 2018, yearTo: 2023, engineCodes: '', transmissionCodes: '', marketCodes: '', prCodes: '', bodyStyles: '', driveTypes: '', position: '前轴', condition: '350mm 制动盘', exclusion: '排除 PSCB', includeRules: [], excludeRules: [] }],
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
  const [vehiclePlatforms, setVehiclePlatforms] = useState([])
  const [vehicleVariants, setVehicleVariants] = useState([])

  useEffect(() => {
    let active = true
    Promise.all([listCatalogVehiclePlatforms({ status: 'active' }), listCatalogVehicleVariants({ status: 'active' })])
      .then(([platforms, variants]) => { if (active) { setVehiclePlatforms(platforms.items || []); setVehicleVariants(variants.items || []) } })
      .catch(() => { if (active) { setVehiclePlatforms([]); setVehicleVariants([]) } })
    return () => { active = false }
  }, [])

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

  const addFitment = () => { setSubmitted(false); setDraft((current) => ({ ...current, fitments: [...current.fitments, { id: `fitment-${Date.now()}`, vehicle: '', platformId: '', variantMasterId: '', years: '', engineCodes: '', transmissionCodes: '', marketCodes: '', prCodes: '', bodyStyles: '', driveTypes: '', position: '', condition: '', exclusion: '', includeRules: [], excludeRules: [] }] })) }
  const updateFitment = (id, field, value) => { setSubmitted(false); setDraft((current) => ({ ...current, fitments: current.fitments.map((item) => item.id === id ? { ...item, [field]: value } : item) })) }
  const selectPlatform = (id, platformId) => {
    setSubmitted(false)
    setDraft((current) => ({ ...current, fitments: current.fitments.map((item) => item.id === id ? { ...item, platformId, variantMasterId: vehicleVariants.some((variant) => variant.id === item.variantMasterId && variant.platformCode === platformId) ? item.variantMasterId : '' } : item) }))
  }
  const selectVariant = (id, variantId) => {
    const variant = vehicleVariants.find((item) => item.id === variantId)
    setSubmitted(false)
    setDraft((current) => ({ ...current, fitments: current.fitments.map((item) => item.id === id ? {
      ...item, variantMasterId: variantId,
      ...(variant ? {
        platformId: variant.platformCode, vehicle: item.vehicle || `${variant.variantLabel} (${variant.platformCode})`,
        years: item.years || `${variant.yearFrom}–${variant.yearTo}`, yearFrom: item.yearFrom || variant.yearFrom, yearTo: item.yearTo || variant.yearTo,
        engineCodes: item.engineCodes || variant.engineCodes.join(', '), transmissionCodes: item.transmissionCodes || variant.transmissionCodes.join(', '),
        marketCodes: item.marketCodes || variant.marketCodes.join(', '), prCodes: item.prCodes || variant.prCodes.join(', '),
        bodyStyles: item.bodyStyles || variant.bodyStyles.join(', '), driveTypes: item.driveTypes || variant.driveTypes.join(', '),
      } : {}),
    } : item) }))
  }
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
              <div className="sku-form-heading"><div><h2>适配车型与版本规则</h2><p>先选标准平台和车型版本，再补充零件特有条件。</p></div><button className="outline-add" type="button" onClick={addFitment}><Plus size={17} weight="bold" />添加车型</button></div>
              <div className="fitment-editor-list">{draft.fitments.map((item, index) => {
                const variants = vehicleVariants.filter((variant) => variant.platformCode === item.platformId)
                return <article className="fitment-editor-card" key={item.id}><header><span>适配 {index + 1}</span><em>{item.verificationStatus === 'verified' ? '已审核，修改后需重审' : '待专项审核'}</em><button aria-label="删除适配" type="button" onClick={() => removeFitment(item.id)}><Trash size={17} /></button></header><div className="sku-form-grid">
                  <Field label="车型名称" required><input value={item.vehicle} onChange={(event) => updateFitment(item.id, 'vehicle', event.target.value)} placeholder="例如：Cayenne (9YA)" /></Field>
                  <Field label="标准平台" required hint={vehiclePlatforms.length ? '只显示已启用平台' : '暂无已启用平台，请先建立平台'}><select value={item.platformId || ''} onChange={(event) => selectPlatform(item.id, event.target.value)}><option value="">请选择平台</option>{item.platformId && !vehiclePlatforms.some((platform) => platform.platformCode === item.platformId) ? <option value={item.platformId}>{item.platformId} · 未纳入主数据</option> : null}{vehiclePlatforms.map((platform) => <option value={platform.platformCode} key={platform.id}>{platform.platformCode} · {platform.brandLabel} {platform.seriesLabel} · {platform.yearFrom}–{platform.yearTo}</option>)}</select></Field>
                  <Field label="车型版本" hint={item.platformId ? variants.length ? '选择后可带入标准边界' : '该平台暂无已启用版本，可按平台级适配' : '请先选择平台'}><select value={item.variantMasterId || ''} disabled={!item.platformId} onChange={(event) => selectVariant(item.id, event.target.value)}><option value="">平台级适配</option>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.variantCode} · {variant.variantLabel}</option>)}</select></Field>
                  <Field label="年款范围" required><input value={item.years} onChange={(event) => updateFitment(item.id, 'years', event.target.value)} placeholder="例如：2018–2023" /></Field>
                  <Field label="安装位置"><input value={item.position || ''} onChange={(event) => updateFitment(item.id, 'position', event.target.value)} placeholder="例如：前轴 / 左侧" /></Field>
                  <Field label="发动机代码"><input value={item.engineCodes || ''} onChange={(event) => updateFitment(item.id, 'engineCodes', event.target.value)} placeholder="例如：DCBE, DCBD" /></Field>
                  <Field label="变速箱代码"><input value={item.transmissionCodes || ''} onChange={(event) => updateFitment(item.id, 'transmissionCodes', event.target.value)} placeholder="例如：A48.00" /></Field>
                  <Field label="市场代码"><input value={item.marketCodes || ''} onChange={(event) => updateFitment(item.id, 'marketCodes', event.target.value)} placeholder="CN, EU" /></Field>
                  <Field label="车身形式"><input value={item.bodyStyles || ''} onChange={(event) => updateFitment(item.id, 'bodyStyles', event.target.value)} placeholder="SUV, Coupe" /></Field>
                  <Field label="驱动形式"><input value={item.driveTypes || ''} onChange={(event) => updateFitment(item.id, 'driveTypes', event.target.value)} placeholder="AWD" /></Field>
                  <Field label="PR 代码"><input value={item.prCodes || ''} onChange={(event) => updateFitment(item.id, 'prCodes', event.target.value)} placeholder="例如：1ZT, 1ZK" /></Field>
                </div><div className="fitment-rule-grid"><RuleBuilder title="包含规则" tone="include" rules={item.includeRules || []} onChange={(rules) => updateFitment(item.id, 'includeRules', rules)} /><RuleBuilder title="排除规则" tone="exclude" rules={item.excludeRules || []} onChange={(rules) => updateFitment(item.id, 'excludeRules', rules)} /></div><div className="sku-form-grid fitment-legacy-notes"><Field label="包含备注"><input value={item.condition || ''} onChange={(event) => updateFitment(item.id, 'condition', event.target.value)} placeholder="补充无法结构化的说明" /></Field><Field label="排除备注"><input value={item.exclusion || ''} onChange={(event) => updateFitment(item.id, 'exclusion', event.target.value)} placeholder="保留旧资料说明" /></Field><Field label="数据来源"><input disabled value={draft.evidence.sourceSystem} /></Field></div></article>
              })}{!draft.fitments.length ? <div className="fitment-empty"><Cube size={31} weight="duotone" /><strong>尚未添加适配车型</strong><span>只有完成适配核验的 SKU 才能进入发布状态。</span><button type="button" onClick={addFitment}><Plus size={17} weight="bold" />添加第一条适配</button></div> : null}</div>
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
