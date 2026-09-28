import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, CarProfile, CheckCircle, ClipboardText, Database, FloppyDisk, MagnifyingGlass,
  Package, PencilSimple, Plus, SealCheck, Sparkle, Trash, Warning, X,
} from '@phosphor-icons/react'
import { AppHeader } from './AppHeader'
import { assetPath } from '../utils/assetPath'
import { autoMatchVehicle, createVehicle, getVehicle, listVehicles, publishVehicle, updateVehicle } from '../services/vehicleService'

const emptyVehicle = {
  vehicleCode: '', brand: '', series: '', platform: '', displayName: '', displacement: '', engineCode: '',
  transmissionCode: '', yearStart: '', yearEnd: '', market: '', bodyType: 'SUV', sampleVin: '', productionDate: '',
  dataSource: '人工录入', verificationStatus: '待验证', imageUrl: '', sourceEvidence: null,
  requirements: [], packages: [], version: 0,
}

function years(vehicle) {
  if (!vehicle?.yearStart && !vehicle?.yearEnd) return '年款待补充'
  return `${vehicle.yearStart || '—'}–${vehicle.yearEnd || '至今'}`
}

function Status({ value }) {
  const warning = /待|冲突|部分/.test(value || '')
  return <span className={`vehicle-status ${warning ? 'warning' : ''}`}><i />{value || '待验证'}</span>
}

function VehicleForm({ initial, onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => structuredClone(initial || emptyVehicle))
  const [tab, setTab] = useState('基本信息')
  const [message, setMessage] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const saving = message === '正在保存…'
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const updateRequirement = (index, key, value) => setDraft((current) => ({
    ...current, requirements: current.requirements.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row),
  }))
  const addRequirement = () => setDraft((current) => ({
    ...current,
    requirements: [...current.requirements, { category: '', itemCode: '', itemName: '', position: '', side: '', quantity: 1, partNumber: '', partNumberType: 'OE号', fitmentCondition: '', source: current.dataSource || '人工录入', verificationStatus: '待验证', candidates: [] }],
  }))
  const importRequirements = () => {
    const rows = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [itemName = '', partNumber = '', position = '', category = ''] = line.split(/\t|\s{2,}/).map((item) => item.trim())
      return { category, itemCode: '', itemName, position, side: '', quantity: 1, partNumber, partNumberType: partNumber ? '待确认号码类型' : '', fitmentCondition: '', source: draft.dataSource || '人工录入', verificationStatus: '待验证', candidates: [] }
    }).filter((row) => row.itemName)
    if (!rows.length) return setMessage('没有识别到可导入的配件行')
    setDraft((current) => ({ ...current, requirements: [...current.requirements, ...rows] }))
    setBulkText('')
    setBulkOpen(false)
    setMessage(`已导入 ${rows.length} 条配件，请检查后保存`)
  }
  const updatePackage = (index, key, value) => setDraft((current) => ({
    ...current, packages: current.packages.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row),
  }))
  const addPackage = () => setDraft((current) => ({
    ...current, packages: [...current.packages, { packageCode: `PACKAGE-${current.packages.length + 1}`, name: '新套餐', intervalText: '', description: '', lifecycleStatus: '启用', items: [] }],
  }))
  const togglePackageItem = (packageIndex, requirementId) => setDraft((current) => ({
    ...current,
    packages: current.packages.map((pack, index) => {
      if (index !== packageIndex) return pack
      const included = pack.items.some((item) => item.requirementId === requirementId)
      return { ...pack, items: included ? pack.items.filter((item) => item.requirementId !== requirementId) : [...pack.items, { requirementId, quantity: 1 }] }
    }),
  }))
  const save = async () => {
    setMessage('正在保存…')
    try {
      const saved = draft.id ? await updateVehicle(draft.id, draft) : await createVehicle(draft)
      setMessage('已保存')
      onSaved(saved)
    } catch (error) { setMessage(error.message) }
  }
  return <main className="vehicle-editor-page">
    <div className="vehicle-editor-heading"><button onClick={onCancel} type="button"><ArrowLeft size={17} />返回车型库</button><div><h1>{draft.id ? '编辑车型资料' : '新建车型版本'}</h1><p>车型、常用配件和保养套餐使用同一数据版本</p></div><div className="vehicle-editor-actions"><span>{message}</span><button className="secondary-button" onClick={onCancel} type="button">取消</button><button className="primary-button" disabled={saving} onClick={save} type="button"><FloppyDisk size={17} />保存资料</button></div></div>
    <div className="vehicle-editor-tabs">{['基本信息', '常用配件', '保养套餐'].map((item) => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)} type="button">{item}</button>)}</div>
    {tab === '基本信息' ? <section className="vehicle-form-section"><h2>车型版本档案</h2><div className="vehicle-field-grid">
      {[["vehicleCode","车型版本编码 *"],["brand","品牌 *"],["series","车系 *"],["platform","平台代码 *"],["displayName","显示名称 *"],["displacement","排量"],["engineCode","发动机代码"],["transmissionCode","变速箱代码"],["yearStart","起始年款"],["yearEnd","结束年款"],["market","市场"],["bodyType","车身形式"],["sampleVin","VIN 样本"],["productionDate","生产日期"],["dataSource","数据来源"],["verificationStatus","验证状态"]].map(([key,label]) => <label key={key}><span>{label}</span><input aria-label={label} value={draft[key] ?? ''} onChange={(event) => update(key, event.target.value)} /></label>)}
    </div></section> : null}
    {tab === '常用配件' ? <section className="vehicle-form-section"><header><div><h2>常用配件矩阵</h2><p>缺少零件号的项目也应保留，用于后续待补充提醒。</p></div><div className="vehicle-section-actions"><button className="secondary-button" onClick={() => setBulkOpen((current) => !current)} type="button"><ClipboardText size={16} />批量粘贴</button><button className="secondary-button" onClick={addRequirement} type="button"><Plus size={16} />添加配件</button></div></header>{bulkOpen ? <div className="vehicle-bulk-import"><div><b>从 Excel 粘贴配件</b><span>每行依次为：配件项目、零件号、位置、分类；列之间使用 Tab。</span></div><textarea aria-label="批量配件数据" placeholder={'机油格\t95811556201\t发动机\t保养滤芯\n机油格密封圈\t\t发动机\t保养滤芯'} value={bulkText} onChange={(event) => setBulkText(event.target.value)} /><footer><button onClick={() => { setBulkOpen(false); setBulkText('') }} type="button">取消</button><button disabled={!bulkText.trim()} onClick={importRequirements} type="button">导入到配件表</button></footer></div> : null}<div className="vehicle-edit-table"><table><thead><tr><th>分类</th><th>配件项目</th><th>位置</th><th>用量</th><th>号码类型</th><th>零件号</th><th>来源</th><th>验证状态</th><th /></tr></thead><tbody>{draft.requirements.map((row, index) => <tr key={row.id || index}>{[['category','分类'],['itemName','配件项目'],['position','位置'],['quantity','用量'],['partNumberType','号码类型'],['partNumber','零件号'],['source','来源'],['verificationStatus','验证状态']].map(([key,label]) => <td key={key}><input aria-label={`${label} ${index + 1}`} value={row[key] ?? ''} onChange={(event) => updateRequirement(index, key, event.target.value)} /></td>)}<td><button aria-label={`删除配件 ${index + 1}`} onClick={() => update('requirements', draft.requirements.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash size={15} /></button></td></tr>)}</tbody></table>{draft.requirements.length ? null : <div className="vehicle-editor-empty">尚未添加常用配件</div>}</div></section> : null}
    {tab === '保养套餐' ? <section className="vehicle-form-section"><header><div><h2>保养与维修套餐</h2><p>套餐只组织配件需求，不在车型库保存销售价格。</p></div><button className="secondary-button" onClick={addPackage} type="button"><Plus size={16} />添加套餐</button></header><div className="package-editor-list">{draft.packages.map((pack, packageIndex) => <article key={pack.id || packageIndex}><div className="package-fields"><input aria-label={`套餐名称 ${packageIndex + 1}`} value={pack.name} onChange={(event) => updatePackage(packageIndex, 'name', event.target.value)} /><input aria-label={`套餐编码 ${packageIndex + 1}`} value={pack.packageCode} onChange={(event) => updatePackage(packageIndex, 'packageCode', event.target.value)} /><input aria-label={`更换周期 ${packageIndex + 1}`} placeholder="10,000 km / 12个月" value={pack.intervalText} onChange={(event) => updatePackage(packageIndex, 'intervalText', event.target.value)} /><button aria-label={`删除套餐 ${packageIndex + 1}`} onClick={() => update('packages', draft.packages.filter((_, index) => index !== packageIndex))} type="button"><Trash size={15} /></button></div><div className="package-item-picker">{draft.requirements.map((requirement, requirementIndex) => { const id = requirement.id || `index:${requirementIndex}`; const checked = pack.items.some((item) => item.requirementId === id); return <label key={id}><input checked={checked} onChange={() => togglePackageItem(packageIndex, id)} type="checkbox" />{requirement.itemName || `未命名配件 ${requirementIndex + 1}`}</label> })}</div></article>)}</div>{draft.packages.length ? null : <div className="vehicle-editor-empty">尚未配置套餐</div>}</section> : null}
  </main>
}

function PartsTable({ vehicle }) {
  let currentCategory = null
  return <div className="vehicle-parts-table"><table><thead><tr><th>#</th><th>配件项目</th><th>位置</th><th>用量</th><th>零件号</th><th>已关联 SKU</th><th>来源</th><th>验证状态</th></tr></thead><tbody>{vehicle.requirements.map((row, index) => {
    const group = row.category && row.category !== currentCategory ? row.category : null
    currentCategory = row.category || currentCategory
    const preferred = row.candidates?.find((item) => item.role === '首选') || row.candidates?.[0]
    return [group ? <tr className="part-group" key={`${row.id}-group`}><td colSpan="8">{group}</td></tr> : null,<tr className={!row.partNumber ? 'missing-row' : ''} key={row.id || index}><td>{index + 1}</td><td><b>{row.itemName}</b><small>{row.fitmentCondition}</small></td><td>{[row.position,row.side].filter(Boolean).join(' ') || '—'}</td><td>{row.quantity}</td><td>{row.partNumber || '待补充'}</td><td>{preferred?.sku ? <span className="linked-sku"><Package size={18} /><span><b>{preferred.sku.skuCode}</b><small>{preferred.sku.chineseName}</small></span></span> : <span className="unlinked-sku">未关联</span>}</td><td>{row.source || '—'}</td><td><Status value={row.partNumber ? row.verificationStatus : '待补充'} /></td></tr>]
  })}</tbody></table>{vehicle.requirements.length ? null : <div className="vehicle-table-empty">尚未维护常用配件</div>}</div>
}

function PackagesPanel({ vehicle, onSelectPackage }) {
  return <section className="vehicle-package-panel"><header><div><h2>保养与维修套餐</h2><p>套餐根据车型配件需求组合，销售价格与库存在选品时读取。</p></div></header><div className="vehicle-package-grid">{vehicle.packages.map((pack) => <article key={pack.id}><span>{pack.lifecycleStatus}</span><h3>{pack.name}</h3><p>{pack.description || '暂无套餐说明'}</p><dl><div><dt>建议周期</dt><dd>{pack.intervalText || '—'}</dd></div><div><dt>配件项目</dt><dd>{pack.items.length} 项</dd></div></dl><button onClick={() => onSelectPackage(pack)} type="button">快速选品</button></article>)}</div>{vehicle.packages.length ? null : <div className="vehicle-table-empty">尚未配置保养或维修套餐</div>}</section>
}

function SelectionDrawer({ vehicle, initialPackage, onClose }) {
  const [packageId, setPackageId] = useState(initialPackage?.id || vehicle.packages[0]?.id || '')
  const [customIds, setCustomIds] = useState([])
  const [candidateChoices, setCandidateChoices] = useState({})
  const pack = vehicle.packages.find((item) => item.id === packageId)
  const ids = pack ? pack.items.map((item) => item.requirementId) : customIds
  const rows = vehicle.requirements.filter((item) => ids.includes(item.id))
  const unresolved = rows.filter((row) => !row.candidates?.length || !row.partNumber).length
  return <div className="selection-backdrop" role="presentation"><aside aria-label="待报价选品" className="selection-drawer"><header><div><span>快速选品</span><h2>{vehicle.displayName}</h2><p>{vehicle.sampleVin || vehicle.vehicleCode}</p></div><button aria-label="关闭快速选品" onClick={onClose} type="button"><X size={20} /></button></header><section><label className="selection-package"><span>保养 / 维修项目</span><select value={packageId} onChange={(event) => { setPackageId(event.target.value); setCustomIds([]) }}><option value="">自选配件</option>{vehicle.packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.intervalText}</option>)}</select></label>{!pack ? <div className="selection-custom-list">{vehicle.requirements.map((row) => <label key={row.id}><input checked={customIds.includes(row.id)} onChange={() => setCustomIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current,row.id])} type="checkbox" />{row.itemName}</label>)}</div> : null}<div className="selection-lines">{rows.map((row) => { const candidate = row.candidates?.find((item) => item.id === candidateChoices[row.id]) || row.candidates?.find((item) => item.role === '首选') || row.candidates?.[0]; return <article key={row.id}><div><b>{row.itemName}</b><small>{row.partNumber || '零件号待补充'}</small></div>{row.candidates?.length > 1 ? <select aria-label={`${row.itemName} 候选 SKU`} value={candidate?.id || ''} onChange={(event) => setCandidateChoices((current) => ({ ...current, [row.id]: event.target.value }))}>{row.candidates.map((item) => <option key={item.id} value={item.id}>{item.sku?.skuCode || item.partNumber} · {item.role}</option>)}</select> : <span>{candidate?.sku ? candidate.sku.skuCode : '暂无可选 SKU'}</span>}<Status value={candidate?.sku ? candidate.role || '已匹配' : '需人工确认'} /></article> })}</div></section><footer><div><b>{rows.length} 项配件</b><span>{unresolved ? `${unresolved} 项需人工确认` : '全部已匹配'}</span></div><button className="primary-button" disabled={!rows.length} onClick={onClose} type="button"><ClipboardText size={17} />完成选品</button><p>本步只整理待报价商品，不生成报价单。</p></footer></aside></div>
}

export function VehicleLibrary({ onSearchFocus }) {
  const routeId = useMemo(() => {
    const match = window.location.pathname.match(/\/vehicles\/([^/]+)\/?$/)
    return match ? decodeURIComponent(match[1]) : null
  }, [])
  const [vehicles, setVehicles] = useState([])
  const [selectedId, setSelectedId] = useState(routeId)
  const [vehicle, setVehicle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('常用配件')
  const [editing, setEditing] = useState(null)
  const [selectionPackage, setSelectionPackage] = useState(undefined)
  const load = async (search = query) => {
    setLoading(true)
    try { const items = await listVehicles({ query: search }); setVehicles(items); setSelectedId((current) => routeId || (items.some((item) => item.id === current) ? current : items[0]?.id || null)); setError('') }
    catch (loadError) { setError(loadError.message) } finally { setLoading(false) }
  }
  useEffect(() => { load('') }, [])
  useEffect(() => { if (!selectedId) return setVehicle(null); const controller = new AbortController(); getVehicle(selectedId, { signal: controller.signal }).then(setVehicle).catch((loadError) => { if (loadError.name !== 'AbortError') setError(loadError.message) }); return () => controller.abort() }, [selectedId])
  const completion = useMemo(() => vehicle ? { total: vehicle.requirements.length, linked: vehicle.requirements.filter((item) => item.candidates?.length).length, missing: vehicle.requirements.filter((item) => !item.partNumber).length } : { total: 0, linked: 0, missing: 0 }, [vehicle])
  const handleSaved = (saved) => { window.location.assign(assetPath(`vehicles/${saved.id}`)) }
  const handleAutoMatch = async () => { if (!vehicle) return; try { setVehicle(await autoMatchVehicle(vehicle.id)); setError('') } catch (matchError) { setError(matchError.message) } }
  const handlePublish = async () => { if (!vehicle) return; try { setVehicle(await publishVehicle(vehicle.id, vehicle)); setError('') } catch (publishError) { setError(publishError.message) } }
  if (editing) return <div className="app-shell"><AppHeader activeNav="车型库" currentSpace="车型库" onSearchFocus={onSearchFocus} /><VehicleForm initial={editing === 'new' ? emptyVehicle : editing} onCancel={() => setEditing(null)} onSaved={handleSaved} /></div>
  return <div className="app-shell"><AppHeader activeNav="车型库" currentSpace="车型库" onSearchFocus={onSearchFocus} /><main className={`vehicle-library-page ${routeId ? 'vehicle-detail-page' : ''}`}>{routeId ? <div className="vehicle-detail-breadcrumb"><button onClick={() => window.location.assign(assetPath('vehicles'))} type="button"><ArrowLeft size={16} />返回车型库</button><span>/</span><b>车型详情</b><div><button className="secondary-button" disabled={!vehicle} onClick={handleAutoMatch} type="button"><Sparkle size={17} />自动匹配 SKU</button></div></div> : <><section className="vehicle-page-heading"><div><h1>车型库</h1><p>统一维护车型、常用配件、SKU 关系与保养套餐</p></div><div><button className="secondary-button" disabled={!vehicle} onClick={handleAutoMatch} type="button"><Sparkle size={17} />自动匹配 SKU</button><button className="primary-button" onClick={() => setEditing('new')} type="button"><Plus size={17} />新建车型</button></div></section><form className="vehicle-search" onSubmit={(event) => { event.preventDefault(); load(query) }}><MagnifyingGlass size={17} /><input aria-label="搜索车型库" placeholder="搜索 VIN、品牌、车系、平台、发动机或零件号" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit">搜索</button></form></>}{error ? <div className="vehicle-error"><Warning size={18} />{error}</div> : null}{loading ? <div className="sku-data-state"><span className="data-spinner" />正在读取车型资料…</div> : null}{!loading && !vehicles.length ? <div className="sku-data-state empty"><CarProfile size={42} /><h2>还没有车型资料</h2><p>从第一个真实车型版本开始建立常用配件与 SKU 关系。</p><button className="primary-button" onClick={() => setEditing('new')} type="button"><Plus size={17} />新建第一个车型</button></div> : null}{!loading && vehicles.length ? <>{!routeId ? <div className="vehicle-summary-strip">{vehicles.slice(0, 6).map((item) => <button className={item.id === selectedId ? 'active' : ''} key={item.id} onClick={() => window.location.assign(assetPath(`vehicles/${item.id}`))} type="button"><img alt="" src={item.imageUrl || assetPath('assets/parts/macan-95b.png')} /><span><b>{item.displayName}</b><small>{item.platform} · {item.displacement || '排量待补充'} · {years(item)}</small></span><em>{item.linkedRequirementCount}/{item.requirementCount}</em></button>)}</div> : null}{vehicle ? <><section className="vehicle-identity"><img alt={`${vehicle.displayName} 车型图`} src={vehicle.imageUrl || assetPath('assets/parts/macan-95b.png')} /><div className="vehicle-identity-main"><div><h2>{vehicle.displayName} · {vehicle.displacement} · {years(vehicle)}</h2><Status value={vehicle.verificationStatus} /></div><dl><div><dt>VIN</dt><dd>{vehicle.sampleVin || '—'}</dd></div><div><dt>平台</dt><dd>{vehicle.platform}</dd></div><div><dt>发动机</dt><dd>{vehicle.engineCode || '—'}</dd></div><div><dt>变速箱</dt><dd>{vehicle.transmissionCode || '—'}</dd></div><div><dt>生产日期</dt><dd>{vehicle.productionDate ? String(vehicle.productionDate).slice(0,10) : '—'}</dd></div><div><dt>市场</dt><dd>{vehicle.market || '—'}</dd></div></dl></div><div className="vehicle-identity-actions"><span>更新于 {vehicle.updatedAt ? new Date(vehicle.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span><button className="secondary-button" onClick={() => setEditing(vehicle)} type="button"><PencilSimple size={16} />编辑车型</button><button className="primary-button" onClick={() => setSelectionPackage(null)} type="button"><ClipboardText size={17} />快速选品</button></div></section><div className="vehicle-tabs">{['基本信息','常用配件','保养套餐','VIN / EPC 来源','变更记录'].map((item) => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)} type="button">{item}</button>)}<div><span>已关联 <b>{completion.linked}</b></span><span>待补充 <b>{completion.missing}</b></span></div></div><section className="vehicle-content-grid"><div className="vehicle-content-main">{tab === '常用配件' ? <><header className="vehicle-section-heading"><div><h2>常用配件</h2><p>共 {completion.total} 项，零件号、SKU 与来源均保留独立记录</p></div><button className="secondary-button" onClick={() => setEditing(vehicle)} type="button"><Plus size={16} />维护配件</button></header><PartsTable vehicle={vehicle} /></> : null}{tab === '保养套餐' ? <PackagesPanel vehicle={vehicle} onSelectPackage={setSelectionPackage} /> : null}{tab === '基本信息' ? <div className="vehicle-basic-panel"><h2>车型版本信息</h2><dl>{[['车型版本编码',vehicle.vehicleCode],['品牌',vehicle.brand],['车系',vehicle.series],['平台',vehicle.platform],['排量',vehicle.displacement],['车身形式',vehicle.bodyType],['数据来源',vehicle.dataSource],['发布状态',vehicle.lifecycleStatus]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></div> : null}{tab === 'VIN / EPC 来源' ? <div className="vehicle-source-panel"><Database size={31} /><h2>{vehicle.sourceEvidence?.title || vehicle.dataSource || '尚未关联来源证据'}</h2><p>{vehicle.sourceEvidence?.description || '保留 VIN、EPC 图组、原始零件号和适配条件，方便审计回溯。'}</p></div> : null}{tab === '变更记录' ? <div className="vehicle-history">{(vehicle.changeHistory || []).map((entry) => <article key={entry.id}><SealCheck size={18} /><span><b>{entry.action}</b><small>v{entry.version} · {entry.changedBy} · {new Date(entry.changedAt).toLocaleString('zh-CN', { hour12: false })}</small></span></article>)}</div> : null}</div><aside className="vehicle-evidence"><header><div><h2>EPC / VIN 证据</h2><Status value={vehicle.dataSource ? '可追溯' : '待补充'} /></div><small>{vehicle.dataSource || '未关联数据来源'}</small></header><div className="vehicle-evidence-image">{vehicle.sourceEvidence?.diagramUrl ? <img alt="EPC 图组" src={vehicle.sourceEvidence.diagramUrl} /> : <div><Database size={34} /><span>暂无 EPC 图组</span></div>}</div><dl><div><dt>VIN 样本</dt><dd>{vehicle.sampleVin || '—'}</dd></div><div><dt>发动机</dt><dd>{vehicle.engineCode || '—'}</dd></div><div><dt>变速箱</dt><dd>{vehicle.transmissionCode || '—'}</dd></div><div><dt>适配条件</dt><dd>{vehicle.sourceEvidence?.fitment || '—'}</dd></div></dl><div className="vehicle-completeness"><div><span>配件资料完整度</span><b>{completion.linked} / {completion.total}</b></div><i><em style={{ width: `${completion.total ? Math.round(completion.linked / completion.total * 100) : 0}%` }} /></i><p>{completion.missing ? <><Warning size={15} /> {completion.missing} 个配件项目缺少零件号</> : <><CheckCircle size={15} /> 已补齐所有零件号</>}</p></div><button className="publish-vehicle" disabled={vehicle.lifecycleStatus === '已发布'} onClick={handlePublish} type="button">{vehicle.lifecycleStatus === '已发布' ? '车型资料已发布' : '发布车型资料'}</button></aside></section></> : null}</> : null}</main>{selectionPackage !== undefined ? <SelectionDrawer vehicle={vehicle} initialPackage={selectionPackage} onClose={() => setSelectionPackage(undefined)} /> : null}</div>
}
