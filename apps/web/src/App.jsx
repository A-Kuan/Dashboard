import { useEffect, useMemo, useState } from 'react'
import { CaretDown, DotsThree, Funnel, GearSix, Package, Plus, Warning } from '@phosphor-icons/react'
import { AppHeader } from './components/AppHeader'
import { CommandCenter } from './components/CommandCenter'
import { DictionarySelect } from './components/Common'
import { DictionaryManagement } from './components/DictionarySettings'
import { DetailPanels } from './components/DetailPanels'
import { SkuTable } from './components/SkuTable'
import { SkuEditor } from './components/SkuEditor'
import { useDictionaries } from './hooks/useDictionaries'
import { ALL_DICTIONARY_VALUE } from './services/dictionaryService'
import { listSkus } from './services/skuService'
import { assetPath } from './utils/assetPath'

export function App() {
  const { dictionaries, loading: dictionariesLoading, saveDictionaries, resetDictionaries } = useDictionaries()
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [summaryTab, setSummaryTab] = useState('全部零件')
  const [brand, setBrand] = useState(ALL_DICTIONARY_VALUE)
  const [category, setCategory] = useState(ALL_DICTIONARY_VALUE)
  const [status, setStatus] = useState(ALL_DICTIONARY_VALUE)
  const [detailTab, setDetailTab] = useState('基本信息')
  const initialCommand = useMemo(() => {
    const requested = new URLSearchParams(window.location.search).get('state')
    const presets = { expanded: '', oe: '95B 867 288', vin: 'WP1AA2A25PLB12345', empty: '95B 867 228 OM8', loading: '95B 867 288', error: '95B 867 288' }
    return requested in presets ? { state: requested, value: presets[requested] } : { state: 'closed', value: '' }
  }, [])
  const [commandState, setCommandState] = useState(initialCommand.state)
  const [searchValue, setSearchValue] = useState(initialCommand.value)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const isDictionaryModule = window.location.pathname.replace(/\/+$/, '').endsWith('/dictionaries')
  const editorMatch = window.location.pathname.match(/\/skus\/(new|[^/]+\/edit)\/?$/)
  const isSkuEditor = Boolean(editorMatch)

  useEffect(() => {
    if (isDictionaryModule || isSkuEditor) return
    const controller = new AbortController()
    setRecordsLoading(true)
    listSkus({ signal: controller.signal }).then((items) => {
      setRecords(items)
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || null)
      setRecordsError('')
    }).catch((error) => { if (error.name !== 'AbortError') setRecordsError(error.message) }).finally(() => setRecordsLoading(false))
    return () => controller.abort()
  }, [isDictionaryModule, isSkuEditor])

  useEffect(() => {
    const openCommandPanel = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandState('expanded')
      }
      if (event.key === 'Escape') {
        setCommandState('closed')
        setSearchValue('')
        setActionMenuOpen(false)
      }
    }
    window.addEventListener('keydown', openCommandPanel)
    return () => window.removeEventListener('keydown', openCommandPanel)
  }, [])

  const skuRows = useMemo(() => records.map((item) => ({
    id: item.id,
    image: item.imageUrl || assetPath('assets/parts/selected-part.png'),
    sku: item.skuCode,
    oe: item.primaryOe,
    name: item.chineseName,
    category: item.category,
    brand: item.brand,
    vehicle: item.fitmentCount ? `${item.fitmentCount} 个适配车型` : '未配置',
    stock: '—',
    purchasePrice: '—',
    salePrice: '—',
    source: item.dataSource || '人工录入',
    status: item.lifecycleStatus,
  })), [records])
  const summaryTabs = useMemo(() => [['全部零件', String(skuRows.length)], ['待补全', String(skuRows.filter((row) => !row.vehicle || row.vehicle === '未配置').length)], ['低库存', '0'], ['适配冲突', '0']], [skuRows])
  const filteredRows = useMemo(() => skuRows.filter((row) => {
    const matchesSummary = summaryTab === '全部零件'
      || (summaryTab === '低库存' && row.status === '低库存')
      || (summaryTab === '待补全' && row.vehicle === '未配置')
      || summaryTab === '适配冲突' && false
    return matchesSummary && (brand === ALL_DICTIONARY_VALUE || row.brand === brand)
      && (category === ALL_DICTIONARY_VALUE || row.category === category)
      && (status === ALL_DICTIONARY_VALUE || row.status === status)
  }), [brand, category, skuRows, status, summaryTab])

  const selectedItem = skuRows.find((row) => row.id === selectedId) ?? null
  const commandCenter = commandState !== 'closed' ? <CommandCenter rows={skuRows} state={commandState} value={searchValue} onChange={setSearchValue} onClose={() => { setCommandState('closed'); setSearchValue('') }} onSubmit={(event) => { event.preventDefault(); const query = searchValue.trim(); setCommandState('loading'); window.setTimeout(() => { if (/^WP1/i.test(query)) setCommandState('vin'); else if (/error/i.test(query)) setCommandState('error'); else setCommandState(skuRows.length ? 'oe' : 'empty') }, 650) }} onStateChange={(nextState, nextValue = searchValue) => { setSearchValue(nextValue); setCommandState(nextState); if (nextState === 'loading') window.setTimeout(() => setCommandState(skuRows.length ? 'oe' : 'empty'), 650) }} onSelect={(id) => { setSelectedId(id); setCommandState('closed'); setSearchValue('') }} /> : null

  if (isDictionaryModule) {
    return <div className="app-shell"><AppHeader activeNav="" currentSpace="字典管理" onSearchFocus={() => setCommandState('expanded')} searchValue={commandState === 'closed' ? '' : searchValue} /><DictionaryManagement dictionaries={dictionaries} onReset={resetDictionaries} onSave={saveDictionaries} />{commandCenter}</div>
  }

  if (isSkuEditor) {
    const mode = editorMatch[1] === 'new' ? 'new' : 'edit'
    const skuId = mode === 'edit' ? decodeURIComponent(editorMatch[1].replace(/\/edit$/, '')) : null
    return <div className="app-shell"><AppHeader onSearchFocus={() => setCommandState('expanded')} searchValue={commandState === 'closed' ? '' : searchValue} /><SkuEditor dictionaries={dictionaries} dictionariesLoading={dictionariesLoading} mode={mode} skuId={skuId} onBack={() => window.location.assign(assetPath(''))} onSaved={(id) => window.location.assign(assetPath(`skus/${id}/edit`))} />{commandCenter}</div>
  }

  return (
    <div className="app-shell">
      <AppHeader onSearchFocus={() => setCommandState('expanded')} searchValue={commandState === 'closed' ? '' : searchValue} />
      <main className="workspace">
        <section className="workspace-heading">
          <div><h1>SKU 管理</h1><p>管理汽车零部件SKU，打通 OE、EPC 与库存销售数据</p></div>
          <div className="page-actions"><button className="primary-button" onClick={() => window.location.assign(assetPath('skus/new'))} type="button"><Plus size={18} /> 新建 SKU</button><button className="more-button" aria-label="更多操作" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen((current) => !current)} type="button"><DotsThree size={21} weight="bold" /></button>{actionMenuOpen ? <><button className="page-action-scrim" aria-label="关闭更多操作" onClick={() => setActionMenuOpen(false)} type="button" /><div className="page-action-menu" role="menu"><button disabled={dictionariesLoading} onClick={() => window.location.assign(assetPath('dictionaries'))} role="menuitem" type="button"><GearSix size={17} /><span><b>字典管理</b><small>独立维护品牌、分类与状态</small></span></button></div></> : null}</div>
        </section>

        <div className="summary-tabs" role="tablist">
          {summaryTabs.map(([label, count]) => <button className={summaryTab === label ? 'active' : ''} key={label} onClick={() => setSummaryTab(label)} role="tab" type="button">{label} <strong>{count}</strong></button>)}
        </div>

        <div className="filters-row">
          <div className="filters-left">
            <DictionarySelect dictionaryCode="sku_brand" dictionaries={dictionaries} fallbackLabel="品牌" value={brand} onChange={setBrand} disabled={dictionariesLoading} />
            <DictionarySelect dictionaryCode="part_category" dictionaries={dictionaries} fallbackLabel="零件大类" value={category} onChange={setCategory} disabled={dictionariesLoading} />
            <DictionarySelect dictionaryCode="sku_status" dictionaries={dictionaries} fallbackLabel="状态" value={status} onChange={setStatus} disabled={dictionariesLoading} />
          </div>
          <div className="filters-right"><button className="secondary-button" type="button"><Funnel size={17} /> 更多筛选</button><button className="secondary-button sort-button" type="button">默认排序 <CaretDown size={13} weight="bold" /></button></div>
        </div>

        {recordsLoading ? <div className="sku-data-state"><span className="data-spinner" />正在读取 SKU 数据…</div> : null}
        {!recordsLoading && recordsError ? <div className="sku-data-state error"><Warning size={23} weight="fill" /><b>无法读取 SKU 数据</b><span>{recordsError}</span><button className="secondary-button" onClick={() => window.location.reload()} type="button">重新加载</button></div> : null}
        {!recordsLoading && !recordsError && filteredRows.length ? <><SkuTable rows={filteredRows} selectedId={selectedId} onSelect={setSelectedId} onOpen={(id) => window.location.assign(assetPath(`skus/${id}/edit`))} />{selectedItem ? <DetailPanels item={selectedItem} activeTab={detailTab} onTabChange={setDetailTab} /> : null}</> : null}
        {!recordsLoading && !recordsError && !filteredRows.length ? <div className="sku-data-state empty"><Package size={38} /><h2>{records.length ? '当前筛选没有结果' : '还没有 SKU'}</h2><p>{records.length ? '调整筛选条件后再试。' : '数据库已准备好，从第一条真实 SKU 开始建立零件主数据。'}</p>{records.length ? null : <button className="primary-button" onClick={() => window.location.assign(assetPath('skus/new'))} type="button"><Plus size={17} />新建第一个 SKU</button>}</div> : null}
      </main>

      {commandCenter}

    </div>
  )
}
