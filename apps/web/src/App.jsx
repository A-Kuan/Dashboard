import { useEffect, useMemo, useState } from 'react'
import { CaretDown, DotsThree, Funnel, GearSix, Plus, X } from '@phosphor-icons/react'
import { AppHeader } from './components/AppHeader'
import { CommandCenter } from './components/CommandCenter'
import { DictionarySelect } from './components/Common'
import { DictionaryManagement } from './components/DictionarySettings'
import { DetailPanels } from './components/DetailPanels'
import { SkuTable } from './components/SkuTable'
import { skuRows } from './data/mockData'
import { useDictionaries } from './hooks/useDictionaries'
import { ALL_DICTIONARY_VALUE } from './services/dictionaryService'
import { assetPath } from './utils/assetPath'

const summaryTabs = [['全部零件', '12,348'], ['待补全', '256'], ['低库存', '318'], ['适配冲突', '72']]

export function App() {
  const { dictionaries, loading: dictionariesLoading, saveDictionaries, resetDictionaries } = useDictionaries()
  const [selectedId, setSelectedId] = useState('95B-867-288-OM8')
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
  const [newSkuOpen, setNewSkuOpen] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const isDictionaryModule = window.location.pathname.replace(/\/+$/, '').endsWith('/dictionaries')

  useEffect(() => {
    const openCommandPanel = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandState('expanded')
      }
      if (event.key === 'Escape') {
        setCommandState('closed')
        setSearchValue('')
        setNewSkuOpen(false)
        setActionMenuOpen(false)
      }
    }
    window.addEventListener('keydown', openCommandPanel)
    return () => window.removeEventListener('keydown', openCommandPanel)
  }, [])

  const filteredRows = useMemo(() => skuRows.filter((row) => {
    const matchesSummary = summaryTab === '全部零件'
      || (summaryTab === '低库存' && row.status === '低库存')
      || (summaryTab === '待补全' && ['958-807-421', 'A-205-320-01-13'].includes(row.id))
      || (summaryTab === '适配冲突' && row.id === 'A-247-880-12-04')
    return matchesSummary && (brand === ALL_DICTIONARY_VALUE || row.brand === brand)
      && (category === ALL_DICTIONARY_VALUE || row.category === category)
      && (status === ALL_DICTIONARY_VALUE || row.status === status)
  }), [brand, category, status, summaryTab])

  const selectedItem = skuRows.find((row) => row.id === selectedId) ?? skuRows[3]
  const commandCenter = commandState !== 'closed' ? <CommandCenter state={commandState} value={searchValue} onChange={setSearchValue} onClose={() => { setCommandState('closed'); setSearchValue('') }} onSubmit={(event) => { event.preventDefault(); const query = searchValue.trim(); setCommandState('loading'); window.setTimeout(() => { if (/^WP1/i.test(query)) setCommandState('vin'); else if (/228/.test(query)) setCommandState('empty'); else if (/error/i.test(query)) setCommandState('error'); else setCommandState('oe') }, 650) }} onStateChange={(nextState, nextValue = searchValue) => { setSearchValue(nextValue); setCommandState(nextState); if (nextState === 'loading') window.setTimeout(() => setCommandState('oe'), 650) }} onSelect={(id) => { setSelectedId(id); setCommandState('closed'); setSearchValue('') }} /> : null

  if (isDictionaryModule) {
    return <div className="app-shell"><AppHeader activeNav="" currentSpace="字典管理" onSearchFocus={() => setCommandState('expanded')} searchValue={commandState === 'closed' ? '' : searchValue} /><DictionaryManagement dictionaries={dictionaries} onReset={resetDictionaries} onSave={saveDictionaries} />{commandCenter}</div>
  }

  return (
    <div className="app-shell">
      <AppHeader onSearchFocus={() => setCommandState('expanded')} searchValue={commandState === 'closed' ? '' : searchValue} />
      <main className="workspace">
        <section className="workspace-heading">
          <div><h1>SKU 管理</h1><p>管理汽车零部件SKU，打通 OE、EPC 与库存销售数据</p></div>
          <div className="page-actions"><button className="primary-button" onClick={() => setNewSkuOpen(true)} type="button"><Plus size={18} /> 新建 SKU</button><button className="more-button" aria-label="更多操作" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen((current) => !current)} type="button"><DotsThree size={21} weight="bold" /></button>{actionMenuOpen ? <><button className="page-action-scrim" aria-label="关闭更多操作" onClick={() => setActionMenuOpen(false)} type="button" /><div className="page-action-menu" role="menu"><button disabled={dictionariesLoading} onClick={() => window.location.assign(assetPath('dictionaries'))} role="menuitem" type="button"><GearSix size={17} /><span><b>字典管理</b><small>独立维护品牌、分类与状态</small></span></button></div></> : null}</div>
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

        <SkuTable rows={filteredRows} selectedId={selectedId} onSelect={setSelectedId} />
        <DetailPanels item={selectedItem} activeTab={detailTab} onTabChange={setDetailTab} />
      </main>

      {commandCenter}

      {newSkuOpen ? <div className="modal-backdrop" onMouseDown={() => setNewSkuOpen(false)}><section className="new-sku-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>新建 SKU</h2><button onClick={() => setNewSkuOpen(false)} type="button"><X size={18} /></button></header><label>SKU 编码<input defaultValue="95B-" /></label><label>中文名称<input placeholder="输入零件名称" /></label><footer><button className="secondary-button" onClick={() => setNewSkuOpen(false)} type="button">取消</button><button className="primary-button" onClick={() => setNewSkuOpen(false)} type="button">创建 SKU</button></footer>
      </section></div> : null}

    </div>
  )
}
