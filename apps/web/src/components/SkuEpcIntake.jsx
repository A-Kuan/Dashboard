import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle, Database, MagnifyingGlass as FileSearch, Plus, SealCheck, ShieldCheck, Trash, WarningCircle } from '@phosphor-icons/react'
import { commitCatalogEpcPreview, createCatalogEpcPreview } from '../services/catalogApi'
import '../sku-epc-intake.css'

const emptyRow = () => ({ oe: '', originalName: '', sourceRecordId: '', figurePosition: '', platformCode: '', variantCode: '', vehicleLabel: '', yearFrom: '', yearTo: '', engineCodesText: '', transmissionCodesText: '', prCodesText: '', position: '' })
const splitCodes = (value) => String(value || '').split(/[,，/]/).map((item) => item.trim()).filter(Boolean)
const statusMeta = {
  exact: { label: '精确匹配', note: 'OE 唯一命中现有 SKU', className: 'exact' },
  new: { label: '建议新建', note: '未找到相同 OE', className: 'new' },
  ambiguous: { label: '需要判断', note: '同一 OE 命中多条资料', className: 'ambiguous' },
}

function toPayload(row) {
  return { ...row, yearFrom: row.yearFrom || null, yearTo: row.yearTo || null, engineCodes: splitCodes(row.engineCodesText), transmissionCodes: splitCodes(row.transmissionCodesText), prCodes: splitCodes(row.prCodesText) }
}

export function SkuEpcIntake({ onBack, onComplete, onNotify }) {
  const [form, setForm] = useState({ vin: '', sourceSystem: 'Porsche PET', catalogPath: '', rows: [emptyRow()] })
  const [preview, setPreview] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [decisions, setDecisions] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = preview?.items.find((item) => item.id === selectedId) || preview?.items[0]
  const selectedDecisions = useMemo(() => preview?.items.filter((item) => decisions[item.id]?.selected && item.decisionState === 'pending') || [], [decisions, preview])

  const updateRow = (index, key, value) => setForm((current) => ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }))

  const buildPreview = async () => {
    setBusy(true); setError('')
    try {
      const result = await createCatalogEpcPreview({ vin: form.vin, sourceSystem: form.sourceSystem, catalogPath: form.catalogPath, items: form.rows.map(toPayload) })
      setPreview(result); setSelectedId(result.items[0]?.id || '')
      setDecisions(Object.fromEntries(result.items.map((item) => [item.id, { selected: item.matchState !== 'ambiguous', action: item.matchState === 'exact' ? 'attach_evidence' : item.matchState === 'new' ? 'create_sku' : 'skip', targetSkuId: item.matchedSkuId || '' } ])))
    } catch (nextError) { setError(nextError.message) } finally { setBusy(false) }
  }

  const commit = async () => {
    setBusy(true); setError('')
    try {
      const result = await commitCatalogEpcPreview(preview, selectedDecisions.map((item) => ({ itemId: item.id, action: decisions[item.id].action, targetSkuId: decisions[item.id].targetSkuId })))
      setPreview(result)
      onNotify?.(`已处理 ${selectedDecisions.length} 条 EPC 记录，人工字段保持不变`)
      if (result.state === 'completed') onComplete?.(result)
    } catch (nextError) { setError(nextError.message) } finally { setBusy(false) }
  }

  if (!preview) return (
    <main className="epc-intake epc-intake-form">
      <header className="epc-intake-topbar"><button type="button" onClick={onBack}><ArrowLeft size={20} weight="bold" />返回资料库</button><div><span>来源证据接入</span><h1>从 VIN / EPC 建立资料</h1><p>录入原始目录事实，系统只生成匹配预览，不会直接写入 SKU。</p></div><div className="epc-safety"><ShieldCheck size={22} weight="fill" /><span><strong>写入前人工确认</strong><small>原始证据永久保留</small></span></div></header>
      <div className="epc-form-body">
        <section className="epc-source-card"><div className="epc-section-title"><span>01</span><div><h2>来源上下文</h2><p>VIN 可为空，但来源系统与目录路径应尽量完整。</p></div></div><div className="epc-source-fields"><label><span>VIN</span><input value={form.vin} maxLength={17} onChange={(event) => setForm({ ...form, vin: event.target.value.toUpperCase() })} placeholder="17 位 VIN" /></label><label><span>EPC 来源系统</span><input value={form.sourceSystem} onChange={(event) => setForm({ ...form, sourceSystem: event.target.value })} placeholder="例如 Porsche PET" /></label><label><span>目录 / 图组路径</span><input value={form.catalogPath} onChange={(event) => setForm({ ...form, catalogPath: event.target.value })} placeholder="例如 Macan 95B / 601-05" /></label></div></section>
        <section className="epc-lines-card"><div className="epc-section-title"><span>02</span><div><h2>EPC 零件记录</h2><p>原始名称、图例位置与车型条件会作为只读证据保存。</p></div><button type="button" onClick={() => setForm((current) => ({ ...current, rows: [...current.rows, emptyRow()] }))}><Plus size={17} />添加一行</button></div>
          <div className="epc-lines-head"><span>OE 编号 *</span><span>EPC 原始名称 *</span><span>记录 / 图例位置</span><span>车型与条件</span><span /></div>
          {form.rows.map((row, index) => (
            <div className="epc-line" key={index}>
              <div><input aria-label={`第 ${index + 1} 行 OE 编号`} value={row.oe} onChange={(event) => updateRow(index, 'oe', event.target.value)} placeholder="95B 698 151 H" /><small>将按规范编号精确匹配</small></div>
              <div><input aria-label={`第 ${index + 1} 行原始名称`} value={row.originalName} onChange={(event) => updateRow(index, 'originalName', event.target.value)} placeholder="Brake pad set" /><small>不自动替换中文标准名称</small></div>
              <div><input value={row.sourceRecordId} onChange={(event) => updateRow(index, 'sourceRecordId', event.target.value)} placeholder="601-05-01" /><input value={row.figurePosition} onChange={(event) => updateRow(index, 'figurePosition', event.target.value)} placeholder="位置 6" /></div>
              <div className="epc-condition-grid">
                <input value={row.platformCode} onChange={(event) => updateRow(index, 'platformCode', event.target.value.toUpperCase())} placeholder="平台 95B" />
                <input value={row.variantCode} onChange={(event) => updateRow(index, 'variantCode', event.target.value.toUpperCase())} placeholder="版本代码" />
                <input value={row.vehicleLabel} onChange={(event) => updateRow(index, 'vehicleLabel', event.target.value)} placeholder="Porsche Macan" />
                <input value={row.engineCodesText} onChange={(event) => updateRow(index, 'engineCodesText', event.target.value)} placeholder="发动机代码" />
                <input value={row.yearFrom} onChange={(event) => updateRow(index, 'yearFrom', event.target.value)} placeholder="起始年款" inputMode="numeric" />
                <input value={row.yearTo} onChange={(event) => updateRow(index, 'yearTo', event.target.value)} placeholder="结束年款" inputMode="numeric" />
                <input value={row.transmissionCodesText} onChange={(event) => updateRow(index, 'transmissionCodesText', event.target.value)} placeholder="变速箱代码" />
                <input value={row.prCodesText} onChange={(event) => updateRow(index, 'prCodesText', event.target.value)} placeholder="PR 代码" />
              </div>
              <button aria-label={`删除第 ${index + 1} 行`} type="button" disabled={form.rows.length === 1} onClick={() => setForm((current) => ({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index) }))}><Trash size={18} /></button>
            </div>
          ))}
        </section>
      </div>
      <footer className="epc-actionbar"><div><SealCheck size={19} weight="fill" /><span>下一步只计算 OE、车型平台和版本候选，不写入资料库。</span></div>{error ? <p><WarningCircle size={18} />{error}</p> : null}<button type="button" disabled={busy} onClick={buildPreview}>{busy ? '正在生成…' : '生成匹配预览'}<ArrowRight size={19} weight="bold" /></button></footer>
    </main>
  )

  return (
    <main className="epc-intake epc-review">
      <header className="epc-intake-topbar"><button type="button" onClick={() => setPreview(null)}><ArrowLeft size={20} weight="bold" />返回修改来源</button><div><span>写入前匹配预览</span><h1>{preview.sourceSystem} · {preview.catalogPath || '未填写目录路径'}</h1><p>{preview.vin ? `VIN ${preview.vin}` : '无 VIN 上下文'} · 共 {preview.summary.total} 条</p></div><div className="epc-summary-pills"><span className="exact">{preview.summary.exact} 精确</span><span className="new">{preview.summary.new} 新建</span><span className="ambiguous">{preview.summary.ambiguous} 待判断</span></div></header>
      <div className="epc-review-grid">
        <section className="epc-review-list"><header><div><h2>来源记录</h2><p>逐条选择是否写入</p></div><strong>{selectedDecisions.length} 已选</strong></header>{preview.items.map((item) => { const meta = statusMeta[item.matchState]; const decision = decisions[item.id] || {}; return <button type="button" className={`${selected?.id === item.id ? 'active' : ''} ${item.decisionState !== 'pending' ? 'done' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><input type="checkbox" aria-label={`选择 ${item.oe}`} disabled={item.decisionState !== 'pending' || item.matchState === 'ambiguous'} checked={Boolean(decision.selected)} onClick={(event) => event.stopPropagation()} onChange={(event) => setDecisions((current) => ({ ...current, [item.id]: { ...current[item.id], selected: event.target.checked } }))} /><span><b>{item.oe}</b><strong>{item.originalName}</strong><small>{item.figurePosition || '无图例位置'}</small></span><em className={meta.className}>{item.decisionState === 'pending' ? meta.label : item.decisionState === 'created' ? '已新建' : item.decisionState === 'attached' ? '已附加' : '已跳过'}</em></button> })}</section>
        <section className="epc-match-detail">{selected ? <><header><div><span>规范 OE</span><h2>{selected.oe}</h2><p>{selected.originalName}</p></div><span className={`epc-match-badge ${statusMeta[selected.matchState].className}`}><FileSearch size={20} weight="duotone" />{statusMeta[selected.matchState].label}</span></header><div className="epc-detail-scroll"><section><div className="epc-detail-title"><h3>来源快照</h3><span>只读</span></div><dl><div><dt>来源记录</dt><dd>{selected.sourceRecordId || '—'}</dd></div><div><dt>图例位置</dt><dd>{selected.figurePosition || '—'}</dd></div><div><dt>平台提示</dt><dd>{selected.vehicleContext.platformCode || '—'}</dd></div><div><dt>车型版本</dt><dd>{selected.vehicleContext.variantCode || '—'}</dd></div><div><dt>发动机</dt><dd>{selected.vehicleContext.engineCodes?.join(' / ') || '—'}</dd></div><div><dt>PR 码</dt><dd>{selected.vehicleContext.prCodes?.join(' / ') || '—'}</dd></div></dl></section><section><div className="epc-detail-title"><h3>SKU 匹配解释</h3><span>{selected.matchCandidates.length} 个候选</span></div>{selected.matchCandidates.length ? selected.matchCandidates.map((candidate) => <article className="epc-candidate" key={candidate.id}><CheckCircle size={20} weight="fill" /><span><strong>{candidate.name || '未命名 SKU'}</strong><small>{candidate.skuCode} · v{candidate.version}</small></span><em>OE 完全一致</em></article>) : <div className="epc-no-candidate"><Database size={24} /><span><strong>没有相同 OE</strong><small>可建立草稿，名称仍需人工标准化。</small></span></div>}</section><section><div className="epc-detail-title"><h3>车型匹配解释</h3><span>{selected.platformMatch.id ? '平台已识别' : '未识别平台'}</span></div>{selected.platformMatch.id ? <article className="epc-platform-match"><ShieldCheck size={21} weight="fill" /><span><strong>{selected.platformMatch.label}</strong><small>{selected.platformMatch.code} · {selected.platformMatch.yearFrom || '—'}–{selected.platformMatch.yearTo || '—'}</small></span></article> : <div className="epc-no-candidate warning"><WarningCircle size={24} /><span><strong>平台未进入主数据</strong><small>仍可保存来源证据，但不会自动建立适配关系。</small></span></div>}{selected.variantCandidates.map((candidate) => <article className="epc-variant" key={candidate.id}><div><strong>{candidate.label}</strong><small>{candidate.code}</small></div><b>{candidate.score} 分</b><p>{candidate.reasons.join(' · ')}</p></article>)}</section></div></> : null}</section>
        <aside className="epc-decision-panel">
          <header><span>03</span><h2>写入决定</h2><p>系统不会自动覆盖现有名称、分类或价格。</p></header>
          {selected ? <div className="epc-decision-options">
            <label className={decisions[selected.id]?.action === 'attach_evidence' ? 'active' : ''}>
              <input type="radio" name={`decision-${selected.id}`} disabled={!selected.matchCandidates.length || selected.decisionState !== 'pending' || selected.matchState === 'ambiguous'} checked={decisions[selected.id]?.action === 'attach_evidence'} onChange={() => setDecisions((current) => ({ ...current, [selected.id]: { ...current[selected.id], selected: true, action: 'attach_evidence', targetSkuId: selected.matchedSkuId } }))} />
              <span><strong>附加到现有 SKU</strong><small>只新增来源证据，人工字段保持不变</small></span>
            </label>
            <label className={decisions[selected.id]?.action === 'create_sku' ? 'active' : ''}>
              <input type="radio" name={`decision-${selected.id}`} disabled={selected.decisionState !== 'pending'} checked={decisions[selected.id]?.action === 'create_sku'} onChange={() => setDecisions((current) => ({ ...current, [selected.id]: { ...current[selected.id], selected: true, action: 'create_sku', targetSkuId: '' } }))} />
              <span><strong>建立新 SKU 草稿</strong><small>保留 OE 与证据，标准字段待补充</small></span>
            </label>
            <label className={decisions[selected.id]?.action === 'skip' ? 'active' : ''}>
              <input type="radio" name={`decision-${selected.id}`} disabled={selected.decisionState !== 'pending'} checked={decisions[selected.id]?.action === 'skip'} onChange={() => setDecisions((current) => ({ ...current, [selected.id]: { ...current[selected.id], selected: true, action: 'skip', targetSkuId: '' } }))} />
              <span><strong>跳过本条</strong><small>记录决定，不写入 SKU</small></span>
            </label>
            {selected.matchState === 'ambiguous' ? <div className="epc-manual-warning">
              <WarningCircle size={19} weight="fill" />
              <span><strong>多个 SKU 使用相同 OE</strong><small>必须明确选择目标，系统不会采用第一个候选。</small></span>
              <select aria-label="歧义记录目标 SKU" value={decisions[selected.id]?.action === 'attach_evidence' ? decisions[selected.id]?.targetSkuId : ''} onChange={(event) => setDecisions((current) => ({ ...current, [selected.id]: { ...current[selected.id], selected: Boolean(event.target.value), action: event.target.value ? 'attach_evidence' : 'skip', targetSkuId: event.target.value } }))}>
                <option value="">选择要附加的 SKU</option>
                {selected.matchCandidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.skuCode} · {candidate.name || '未命名 SKU'}</option>)}
              </select>
            </div> : null}
          </div> : null}
          <div className="epc-write-contract"><h3>本次写入边界</h3><ul><li><Check size={15} weight="bold" />原始名称、图组与 VIN 完整保留</li><li><Check size={15} weight="bold" />新适配关系默认为待核验</li><li><Check size={15} weight="bold" />现有人工名称、分类、价格不覆盖</li></ul></div>
        </aside>
      </div>
      <footer className="epc-actionbar"><div><SealCheck size={19} weight="fill" /><span>将处理 {selectedDecisions.length} 条；所有决定都会留下审计记录。</span></div>{error ? <p><WarningCircle size={18} />{error}</p> : null}<button type="button" disabled={busy || !selectedDecisions.length} onClick={commit}>{busy ? '正在写入…' : '确认写入所选记录'}<ArrowRight size={19} weight="bold" /></button></footer>
    </main>
  )
}
