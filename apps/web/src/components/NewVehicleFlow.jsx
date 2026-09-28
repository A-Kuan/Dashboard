import { useMemo, useState } from 'react'
import {
  ArrowLeft, CheckCircle, ClipboardText, Copy, Database, FileArrowUp,
  IdentificationCard, ImageSquare, Info, MagnifyingGlass, Warning,
} from '@phosphor-icons/react'
import { createVehicle, getVehicle, listVehicles } from '../services/vehicleService'

const blankVehicle = {
  vehicleCode: '', brand: '', series: '', platform: '', displayName: '', displacement: '', engineCode: '',
  transmissionCode: '', yearStart: '', yearEnd: '', market: '', bodyType: 'SUV', sampleVin: '', productionDate: '',
  dataSource: '人工录入', verificationStatus: '待验证', imageUrl: '', sourceEvidence: null,
  requirements: [], packages: [], lifecycleStatus: '草稿', version: 0,
}

const identityFields = [
  ['vehicleCode', '车型版本编码', true], ['displayName', '车型名称', true], ['displacement', '排量', false],
  ['yearStart', '起始年款', false], ['yearEnd', '结束年款', false], ['platform', '平台', true],
  ['engineCode', '发动机', false], ['transmissionCode', '变速箱', false], ['market', '市场', false],
]

const primaryIdentityFields = [
  ['displayName', '车型名称'], ['displacement', '排量'], ['yearStart', '起始年款'], ['yearEnd', '结束年款'],
  ['platform', '平台'], ['engineCode', '发动机'], ['transmissionCode', '变速箱'], ['market', '市场'],
]

const secondaryIdentityFields = [
  ['vehicleCode', '车型版本编码 *'], ['brand', '品牌 *'], ['series', '车系 *'], ['sampleVin', 'VIN 样本'],
]

const sourceModes = [
  ['vin', 'VIN 识别', IdentificationCard],
  ['epc', 'EPC 导入', FileArrowUp],
  ['copy', '复制已有车型', Copy],
]

function requirementKey(row, index) {
  return row?.id || `index:${index}`
}

function cloneTemplate(template, sampleVin = '') {
  const requirements = (template.requirements || []).map((row) => ({ ...row, id: '', candidates: (row.candidates || []).map(({ id, sku, ...candidate }) => ({ ...candidate, id: '' })) }))
  const sourceIndexById = new Map((template.requirements || []).map((row, index) => [row.id || `index:${index}`, index]))
  const packages = (template.packages || []).map(({ id, ...pack }) => ({
    ...pack,
    id: '',
    items: (pack.items || []).map((item) => ({ ...item, sourceIndex: sourceIndexById.get(item.requirementId) })),
  }))
  return {
    ...blankVehicle,
    ...template,
    id: undefined,
    vehicleCode: '',
    sampleVin: sampleVin || template.sampleVin || '',
    lifecycleStatus: '草稿',
    verificationStatus: '待验证',
    version: 0,
    requirements,
    packages,
    sourceEvidence: {
      ...(template.sourceEvidence || {}),
      copiedFrom: template.vehicleCode || template.displayName,
    },
  }
}

function years(vehicle) {
  if (!vehicle?.yearStart && !vehicle?.yearEnd) return '年款待补充'
  return `${vehicle.yearStart || '—'}–${vehicle.yearEnd || '至今'}`
}

export function NewVehicleFlow({ templates = [], onCancel, onSaved }) {
  const [mode, setMode] = useState('vin')
  const [vin, setVin] = useState('')
  const [epcText, setEpcText] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id || '')
  const [sourceVehicle, setSourceVehicle] = useState(null)
  const [draft, setDraft] = useState(blankVehicle)
  const [selectedRequirements, setSelectedRequirements] = useState(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const applySource = (vehicle, sourceLabel, sampleVin = '') => {
    const next = cloneTemplate(vehicle, sampleVin)
    if (sourceLabel) next.dataSource = sourceLabel
    setSourceVehicle(vehicle)
    setDraft(next)
    setSelectedRequirements(new Set(next.requirements.map(requirementKey)))
    setMessage('')
  }

  const recognizeVin = async () => {
    const normalized = vin.trim().toUpperCase()
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) return setMessage('请输入 17 位有效 VIN')
    setBusy(true)
    setMessage('正在查询车型库…')
    try {
      const matches = await listVehicles({ query: normalized })
      const exact = matches.find((item) => item.sampleVin?.toUpperCase() === normalized) || matches[0]
      if (!exact) {
        setDraft((current) => ({ ...current, sampleVin: normalized, dataSource: 'VIN 识别' }))
        setSourceVehicle(null)
        setSelectedRequirements(new Set())
        return setMessage('没有找到可复用的车型资料，请切换“复制已有车型”或继续手工补充')
      }
      const detail = await getVehicle(exact.id)
      applySource(detail, detail.dataSource || 'VIN 识别', normalized)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const importEpc = () => {
    try {
      const parsed = JSON.parse(epcText)
      applySource({ ...blankVehicle, ...parsed, requirements: parsed.requirements || [], packages: parsed.packages || [] }, parsed.dataSource || 'EPC 导入', parsed.sampleVin || '')
    } catch {
      setMessage('EPC 数据格式无法识别，请粘贴车型 JSON 数据')
    }
  }

  const copyExisting = async () => {
    if (!templateId) return setMessage('请先选择一个已有车型')
    setBusy(true)
    setMessage('正在载入车型模板…')
    try {
      const detail = await getVehicle(templateId)
      applySource(detail, detail.dataSource || '复制已有车型')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const toggleRequirement = (key) => setSelectedRequirements((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const selectedRows = useMemo(() => draft.requirements.map((row, index) => ({ row, index, key: requirementKey(row, index) })).filter((item) => selectedRequirements.has(item.key)), [draft.requirements, selectedRequirements])
  const includedPackageCount = useMemo(() => draft.packages.filter((pack) => (pack.items || []).some((item) => selectedRequirements.has(requirementKey(draft.requirements[item.sourceIndex], item.sourceIndex)))).length, [draft.packages, draft.requirements, selectedRequirements])
  const differences = useMemo(() => sourceVehicle ? identityFields.map(([key, label]) => ({ key, label, before: sourceVehicle[key] ?? '', after: draft[key] ?? '' })).filter((item) => String(item.before) !== String(item.after)).slice(0, 4) : [], [draft, sourceVehicle])
  const missingRequired = ['vehicleCode', 'brand', 'series', 'platform', 'displayName'].filter((key) => !String(draft[key] || '').trim())

  const payload = (includeTemplate) => {
    if (!includeTemplate) return { ...draft, requirements: [], packages: [] }
    const newIndexBySourceIndex = new Map(selectedRows.map((item, newIndex) => [item.index, newIndex]))
    const requirements = selectedRows.map(({ row }) => {
      const { id, ...rest } = row
      return { ...rest, candidates: (rest.candidates || []).map(({ id: candidateId, sku, ...candidate }) => candidate) }
    })
    const packages = draft.packages.map(({ id, items, ...pack }) => ({
      ...pack,
      items: (items || []).filter((item) => newIndexBySourceIndex.has(item.sourceIndex)).map((item) => ({ requirementId: `index:${newIndexBySourceIndex.get(item.sourceIndex)}`, quantity: item.quantity || 1 })),
    })).filter((pack) => pack.items.length)
    return { ...draft, requirements, packages }
  }

  const save = async (includeTemplate) => {
    if (missingRequired.length) return setMessage('请先补齐车型版本编码、车型名称、品牌、车系和平台')
    setBusy(true)
    setMessage('正在创建车型…')
    try { onSaved(await createVehicle(payload(includeTemplate))) }
    catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }

  return <main className="vehicle-create-page">
    <header className="vehicle-create-heading">
      <button onClick={onCancel} type="button"><ArrowLeft size={16} />返回车型库</button>
      <div><h1>新建车型</h1><p>从 VIN、EPC 或相近车型模板开始</p></div>
    </header>

    <div className="vehicle-create-layout">
      <aside className="vehicle-create-source">
        <div className="vehicle-source-modes" role="tablist">
          {sourceModes.map(([value, label, Icon]) => <button aria-selected={mode === value} className={mode === value ? 'active' : ''} key={value} onClick={() => { setMode(value); setMessage('') }} role="tab" type="button"><Icon size={18} />{label}</button>)}
        </div>

        {mode === 'vin' ? <section className="vehicle-source-input"><label><span>请输入 VIN 码</span><div><input aria-label="VIN 码" maxLength="17" placeholder="17 位 VIN" value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} /><button disabled={busy} onClick={recognizeVin} type="button"><MagnifyingGlass size={16} />识别车型</button></div><small>从已有真实车型资料中识别并复用建档模板</small></label></section> : null}
        {mode === 'epc' ? <section className="vehicle-source-input"><label><span>粘贴 EPC 车型数据</span><textarea aria-label="EPC 车型数据" placeholder={'粘贴包含车型、配件与套餐的 JSON 数据'} value={epcText} onChange={(event) => setEpcText(event.target.value)} /></label><button disabled={busy || !epcText.trim()} onClick={importEpc} type="button"><FileArrowUp size={16} />解析 EPC 数据</button></section> : null}
        {mode === 'copy' ? <section className="vehicle-source-input"><label><span>选择已有车型</span><select aria-label="已有车型模板" value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">请选择车型</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.platform} · {years(item)}</option>)}</select></label><button disabled={busy || !templateId} onClick={copyExisting} type="button"><Copy size={16} />载入车型模板</button></section> : null}

        {message ? <div className={`vehicle-create-message ${sourceVehicle ? 'success' : ''}`}>{sourceVehicle ? <CheckCircle size={17} /> : <Warning size={17} />}{message}</div> : null}

        {sourceVehicle ? <section className="vehicle-recognition-result">
          <header><h2>识别结果</h2><span><CheckCircle size={16} weight="fill" />资料可追溯</span><small>{sourceVehicle.dataSource || '已有车型库'}</small></header>
          <div>
            {sourceVehicle.imageUrl ? (
              <img alt={`${sourceVehicle.displayName} 车型图`} src={sourceVehicle.imageUrl} />
            ) : (
              <div className="vehicle-recognition-image-empty"><ImageSquare size={24} />暂无车型图片</div>
            )}
            <div><h3>{sourceVehicle.displayName} · {sourceVehicle.displacement || '排量待补充'} · {years(sourceVehicle)}</h3><dl><div><dt>VIN</dt><dd>{draft.sampleVin || '—'}</dd></div><div><dt>平台</dt><dd>{sourceVehicle.platform || '—'}</dd></div><div><dt>发动机</dt><dd>{sourceVehicle.engineCode || '—'}</dd></div><div><dt>变速箱</dt><dd>{sourceVehicle.transmissionCode || '—'}</dd></div><div><dt>市场</dt><dd>{sourceVehicle.market || '—'}</dd></div></dl></div>
          </div>
        </section> : <div className="vehicle-source-empty"><Database size={33} /><h2>先选择建档来源</h2><p>识别结果会显示在这里，不会自动写入数据库。</p></div>}
      </aside>

      <section className="vehicle-create-review">
        <header><div><h2>建议建档内容</h2><p>基于识别或模板结果，只需确认差异后创建。</p></div>{sourceVehicle ? <span><Info size={15} />复制自 {sourceVehicle.vehicleCode}</span> : null}</header>

        <section className="vehicle-create-identity">
          <h3>车型基本信息</h3>
          <div>{primaryIdentityFields.map(([key, label]) => <label key={key}><span>{label}{key === 'displayName' || key === 'platform' ? ' *' : ''}</span><input aria-label={label} value={draft[key] ?? ''} onChange={(event) => update(key, event.target.value)} /></label>)}</div>
          <div className="vehicle-create-secondary-fields">{secondaryIdentityFields.map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label.replace(' *', '')} value={draft[key] ?? ''} onChange={(event) => update(key, key === 'sampleVin' ? event.target.value.toUpperCase() : event.target.value)} /></label>)}</div>
        </section>

        <section className="vehicle-template-differences">
          <header><div><h3>与模板的差异（{differences.length} 项）</h3><p>{sourceVehicle ? `复制自：${sourceVehicle.displayName} · ${sourceVehicle.vehicleCode}` : '载入来源后显示需要确认的差异'}</p></div></header>
          {differences.length ? <table><thead><tr><th>字段</th><th>模板值</th><th>新车型值</th><th>说明</th></tr></thead><tbody>{differences.map((item) => <tr key={item.key}><td>{item.label}</td><td>{item.before || '—'}</td><td><b>{item.after || '待填写'}</b></td><td>{item.after ? '已调整' : '需要补充'}</td></tr>)}</tbody></table> : <div className="vehicle-difference-empty">{sourceVehicle ? '当前基础资料与模板一致；请填写唯一车型版本编码。' : '尚未载入模板'}</div>}
        </section>

        <section className="vehicle-template-import">
          <header><div><h3>将导入 {selectedRows.length} 个常用配件、{includedPackageCount} 个保养套餐</h3><p>取消不适用于新车型的项目，创建后仍可继续维护。</p></div><label><input checked={selectedRows.length === draft.requirements.length && draft.requirements.length > 0} onChange={(event) => setSelectedRequirements(new Set(event.target.checked ? draft.requirements.map(requirementKey) : []))} type="checkbox" />全选</label></header>
          <div className="vehicle-template-table"><table><thead><tr><th>#</th><th /><th>配件项目</th><th>位置</th><th>零件号</th><th>来源</th><th>验证状态</th></tr></thead><tbody>{draft.requirements.slice(0, 6).map((row, index) => { const key = requirementKey(row, index); return <tr key={key}><td>{index + 1}</td><td><input aria-label={`选择配件 ${index + 1}`} checked={selectedRequirements.has(key)} onChange={() => toggleRequirement(key)} type="checkbox" /></td><td><b>{row.itemName}</b></td><td>{row.position || '—'}</td><td>{row.partNumber || '待补充'}</td><td><span className="vehicle-source-badge"><ClipboardText size={15} />{row.source || draft.dataSource || '人工录入'}</span></td><td>{row.verificationStatus || '待验证'}</td></tr>})}</tbody></table>{draft.requirements.length > 6 ? <div>还有 {draft.requirements.length - 6} 个配件项目，将按当前选择一并导入</div> : null}{draft.requirements.length ? null : <div className="vehicle-template-empty">载入模板后可选择需要导入的常用配件</div>}</div>
        </section>
      </section>
    </div>

    <footer className="vehicle-create-footer"><button onClick={onCancel} type="button"><ArrowLeft size={16} />返回车型库</button><div><span>{message}</span><button disabled={busy || missingRequired.length > 0} onClick={() => save(false)} type="button">仅保存基本信息</button><button className="primary-button" disabled={busy || missingRequired.length > 0} onClick={() => save(true)} type="button"><ClipboardText size={16} />创建并导入模板</button></div></footer>
  </main>
}
