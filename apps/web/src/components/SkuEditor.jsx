import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Camera, CheckCircle, Circle, FloppyDisk,
  ImageSquare, MagnifyingGlassPlus, Plus, SealCheck, Warning, X,
} from '@phosphor-icons/react'
import { DictionarySelect } from './Common'
import { assetPath } from '../utils/assetPath'

const editorTabs = ['基本信息', 'OE 与替代', '适配车型', '技术规格', '采购与库存', '媒体资料', '变更记录']

const initialOeRows = [
  { type: '主 OE', oe: '95B 867 288 OM8', brand: 'Porsche', relation: '—', source: 'Porsche EPC', confidence: '高' },
  { type: '旧号', oe: '95B 867 288 L', brand: 'Porsche', relation: '被当前号替代', source: 'Porsche EPC', confidence: '中' },
]

const initialFitments = [
  { vehicle: 'Porsche Cayenne (9YA)', years: '2018–2023', engine: '全部', body: 'SUV', condition: '—', source: 'Porsche EPC' },
  { vehicle: 'Porsche Cayenne E-Hybrid', years: '2019–2023', engine: '3.0T Hybrid', body: 'SUV', condition: '不适用于 PR: 3U5', source: 'Porsche EPC' },
]

function EditorField({ label, required = false, children, hint, className = '' }) {
  return <label className={`editor-field ${className}`.trim()}><span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}

function TextField({ label, value, onChange, required, readOnly = false, valid = false }) {
  return <EditorField label={label} required={required}><div className={valid ? 'editor-input valid' : 'editor-input'}><input value={value} onChange={(event) => onChange?.(event.target.value)} readOnly={readOnly} />{valid ? <CheckCircle size={16} weight="fill" /> : null}</div></EditorField>
}

function StaticSelect({ label, value, required, status = false }) {
  return <EditorField label={label} required={required}><button className="editor-static-select" type="button"><span className={status ? 'select-status' : ''}>{status ? <i /> : null}{value}</span><span aria-hidden="true">⌄</span></button></EditorField>
}

function SectionHeading({ title, description, action }) {
  return <header className="editor-section-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>
}

function RowActions({ onRemove }) {
  return <div className="editor-row-actions"><button type="button">编辑</button><button onClick={onRemove} type="button">删除</button></div>
}

function OeRelations({ rows, setRows }) {
  const addOe = () => setRows((current) => [...current, { type: '替代号', oe: '958 867 288 00', brand: 'Porsche', relation: '可互换', source: '供应商数据', confidence: '待核验' }])
  return <section className="editor-section" id="oe-relations">
    <SectionHeading title="OE 与替代关系" description="维护该零件的 OE 号及替代关系，便于零件互换查询" action={<div className="section-actions"><button onClick={addOe} type="button"><Plus size={16} />添加 OE 号</button><button onClick={addOe} type="button"><Plus size={16} />建立替代关系</button></div>} />
    <div className="editor-table-wrap"><table className="editor-table oe-editor-table"><thead><tr><th>类型</th><th>OE / 替代号</th><th>品牌</th><th>关系</th><th>来源</th><th>可信度</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.oe}-${index}`}><td><span className={`relation-type relation-${index}`}>{row.type}</span></td><td>{row.oe}</td><td>{row.brand}</td><td>{row.relation}</td><td>{row.source}</td><td>{row.confidence}</td><td><RowActions onRemove={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} /></td></tr>)}</tbody></table></div>
  </section>
}

function FitmentTable({ rows, setRows }) {
  const addFitment = () => setRows((current) => [...current, { vehicle: 'Porsche Cayenne Coupe (9YB)', years: '2019–2023', engine: '全部', body: 'Coupe', condition: '待确认', source: '人工添加' }])
  return <section className="editor-section" id="fitments">
    <SectionHeading title="适配车型" description="指定适用的车型范围，支持按车型、年款、发动机等条件精准匹配" action={<div className="section-actions"><button onClick={addFitment} type="button"><Plus size={16} />添加适配车型</button></div>} />
    <div className="editor-table-wrap"><table className="editor-table fitment-editor-table"><thead><tr><th>#</th><th>品牌 / 车型</th><th>年份</th><th>发动机</th><th>车身形式</th><th>适配条件</th><th>来源</th><th>验证状态</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.vehicle}-${index}`}><td>{index + 1}</td><td>{row.vehicle}</td><td>{row.years}</td><td>{row.engine}</td><td>{row.body}</td><td>{row.condition}</td><td>{row.source}</td><td><span className={row.source === '人工添加' ? 'verification pending' : 'verification'}><i />{row.source === '人工添加' ? '待验证' : '已验证'}</span></td><td><RowActions onRemove={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} /></td></tr>)}</tbody></table></div>
  </section>
}

function EvidencePanel({ conflictResolved, onResolve, onKeep, onZoom }) {
  const checks = [
    ['OE 号', '一致', '与 EPC 记录一致', true],
    ['名称', '已翻译', '已从英文翻译为中文', true],
    ['车型', '已匹配', '车型信息与 EPC 一致', true],
    ['替代链', conflictResolved ? '已确认' : '1 项待确认', conflictResolved ? '替代关系已完成复核' : '存在前序 OE 号，需要确认是否保留', conflictResolved],
  ]
  return <aside className="evidence-panel">
    <header className="evidence-title"><div><h2>EPC 来源证据</h2><span><SealCheck size={15} weight="fill" />可信来源</span></div><small>最后同步：2026-09-27</small></header>
    <section className="source-record"><h3>Porsche EPC 原始记录</h3><div className="source-record-main"><div className="epc-editor-image"><img src={assetPath('assets/parts/epc-diagram.png')} alt="Porsche EPC 图组 867-05，位置 9" /><button aria-label="放大 EPC 图" onClick={onZoom} type="button"><MagnifyingGlassPlus size={17} /></button></div><dl><div><dt>OE 号</dt><dd>95B 867 288 OM8</dd></div><div><dt>原始名称</dt><dd>Trim panel, luggage<br />compartment, black</dd></div><div><dt>图组</dt><dd>867–05</dd></div><div><dt>位置</dt><dd>9</dd></div><div><dt>适配车型</dt><dd>Cayenne (9YA), 2018–2023</dd></div><div className="reference-price"><dt>OEM 参考价（仅作来源参考）</dt><dd>¥ 1,120.50</dd></div></dl></div></section>
    <section className="field-comparison"><h3>字段对比结果</h3>{checks.map(([label, result, note, passed]) => <div className={passed ? 'comparison-row' : 'comparison-row warning-row'} key={label}>{passed ? <CheckCircle size={17} weight="fill" /> : <Warning size={17} weight="fill" />}<b>{label}</b><strong className={passed ? '' : 'warning'}>{result}</strong><span>{note}</span></div>)}</section>
    {!conflictResolved ? <section className="evidence-conflict"><div><Warning size={19} weight="fill" /><span><b>存在需要确认的差异</b><small>EPC 记录显示前序 OE 号 95B 867 288 L 被当前号替代，请确认追溯链。</small></span></div><footer><button onClick={onResolve} type="button">采用 EPC 数据</button><button onClick={onKeep} type="button">保留当前值</button></footer></section> : <section className="resolved-message"><CheckCircle size={18} weight="fill" />替代链差异已完成确认</section>}
    <section className="publish-check"><h3>发布前检查 <b>{conflictResolved ? '6/6' : '5/6'}</b></h3><div className="publish-progress"><span style={{ width: conflictResolved ? '100%' : '83.33%' }} /></div><div className="publish-check-grid">{['基本信息', '图片', 'OE 与替代关系', '条形码', '适配车型', '替代链确认'].map((item, index) => { const complete = index < 5 || conflictResolved; return <span className={complete ? 'complete' : ''} key={item}>{complete ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}<b>{item}</b><em>{complete ? '已完成' : '待完成'}</em></span> })}</div></section>
  </aside>
}

export function SkuEditor({ dictionaries, dictionariesLoading, mode = 'edit', onBack }) {
  const [activeTab, setActiveTab] = useState('基本信息')
  const [brand, setBrand] = useState('Porsche')
  const [category, setCategory] = useState('车身及内饰')
  const [name, setName] = useState(mode === 'new' ? '' : '行李厢内饰板（黑色）')
  const [sku, setSku] = useState(mode === 'new' ? '' : '95B-867-288-OM8')
  const [partImage, setPartImage] = useState(assetPath('assets/parts/selected-part.png'))
  const [oeRows, setOeRows] = useState(initialOeRows)
  const [fitmentRows, setFitmentRows] = useState(initialFitments)
  const [conflictResolved, setConflictResolved] = useState(false)
  const [saveState, setSaveState] = useState('已于 14:32 自动保存')
  const [zoomOpen, setZoomOpen] = useState(false)
  const imageInputRef = useRef(null)
  const completion = useMemo(() => conflictResolved ? 100 : 82, [conflictResolved])

  const save = (published = false) => {
    setSaveState(published ? 'SKU 已保存，发布检查已通过' : '草稿已保存')
    window.setTimeout(() => setSaveState('已于 14:32 自动保存'), 2200)
  }
  const selectTab = (tab) => {
    setActiveTab(tab)
    const targets = { '基本信息': 'basic-information', 'OE 与替代': 'oe-relations', '适配车型': 'fitments' }
    document.getElementById(targets[tab] || 'basic-information')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <main className="sku-editor-page">
    <header className="sku-editor-heading"><div><button className="editor-back" onClick={onBack} type="button"><ArrowLeft size={15} />返回 SKU 管理</button><div className="editor-title-line"><h1>{mode === 'new' ? '新建 SKU' : '编辑 SKU'}</h1><span>草稿</span></div></div><div className="editor-save-actions"><span className={saveState.includes('已保存') ? 'save-message success' : 'save-message'}><CheckCircle size={15} weight="fill" />{saveState}</span><button className="secondary-button" onClick={onBack} type="button">取消</button><button className="secondary-button" onClick={() => save(false)} type="button"><FloppyDisk size={16} />保存草稿</button><button className="primary-button" onClick={() => save(true)} type="button">保存 SKU</button></div></header>
    <nav className="editor-tabs" aria-label="SKU 编辑区段">{editorTabs.map((tab) => <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => selectTab(tab)} type="button">{tab}</button>)}</nav>
    <div className="sku-editor-layout">
      <div className="sku-editor-main">
        <section className="identity-section" id="basic-information"><div className="identity-image"><div><img src={partImage} alt="行李厢内饰板（黑色）" /><button aria-label="查看商品图片" type="button"><MagnifyingGlassPlus size={16} /></button></div><button onClick={() => imageInputRef.current?.click()} type="button"><Camera size={17} />更换图片</button><input ref={imageInputRef} accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) setPartImage(URL.createObjectURL(file)) }} type="file" /></div><div className="identity-content"><header><div><div className="sku-title"><h2>{sku || '待生成 SKU 编码'}</h2>{sku ? <span><CheckCircle size={15} weight="fill" />SKU 编码可用</span> : null}</div><h3>{name || '请输入零件中文名称'}</h3><p>品牌　<b>{brand}</b><i />零件大类　<b>{category}</b><i />零件小类　<b>内饰件</b></p></div><div className="identity-meta"><span>信息完整度 <b>{completion}%</b><i><em style={{ width: `${completion}%` }} /></i></span><dl><div><dt>数据来源</dt><dd>Porsche EPC</dd></div><div><dt>状态</dt><dd>待复核</dd></div></dl></div></header><div className="editor-fields">
          <TextField label="SKU 编码" value={sku} onChange={setSku} required valid={Boolean(sku)} />
          <TextField label="中文名称" value={name} onChange={setName} required />
          <EditorField label="品牌" required><DictionarySelect allowAll={false} showLabel={false} className="form-dictionary" dictionaryCode="sku_brand" dictionaries={dictionaries} fallbackLabel="品牌" value={brand} onChange={setBrand} disabled={dictionariesLoading} /></EditorField>
          <EditorField label="零件大类" required><DictionarySelect allowAll={false} showLabel={false} className="form-dictionary" dictionaryCode="part_category" dictionaries={dictionaries} fallbackLabel="零件大类" value={category} onChange={setCategory} disabled={dictionariesLoading} /></EditorField>
          <StaticSelect label="零件小类" value="内饰件" required />
          <TextField label="制造商零件号" value="95B 867 288 OM8" required />
          <TextField label="主 OE 号" value="95B 867 288 OM8" required />
          <StaticSelect label="计量单位" value="件" required />
          <StaticSelect label="生命周期状态" value="在售" required status />
          <TextField label="创建时间" value="2024-11-15" readOnly />
          <TextField label="最后更新" value="2026-09-27 14:32" readOnly />
          <TextField label="更新者" value="张伟" readOnly />
        </div></div></section>
        <OeRelations rows={oeRows} setRows={setOeRows} />
        <FitmentTable rows={fitmentRows} setRows={setFitmentRows} />
      </div>
      <EvidencePanel conflictResolved={conflictResolved} onResolve={() => { setConflictResolved(true); setSaveState('已采用 EPC 替代关系') }} onKeep={() => { setConflictResolved(true); setSaveState('已保留当前替代关系') }} onZoom={() => setZoomOpen(true)} />
    </div>
    {zoomOpen ? <div className="epc-zoom-backdrop" onMouseDown={() => setZoomOpen(false)}><section onMouseDown={(event) => event.stopPropagation()}><header><div><ImageSquare size={19} /><b>Porsche EPC · 图组 867-05 · 位置 9</b></div><button aria-label="关闭 EPC 大图" onClick={() => setZoomOpen(false)} type="button"><X size={19} /></button></header><img src={assetPath('assets/parts/epc-diagram.png')} alt="Porsche EPC 大图" /></section></div> : null}
  </main>
}
