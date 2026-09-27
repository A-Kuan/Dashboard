import { useEffect, useMemo, useState } from 'react'
import { CaretDown, DotsThree, Funnel, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { AppHeader } from './components/AppHeader'
import { FilterSelect } from './components/Common'
import { DetailPanels } from './components/DetailPanels'
import { SkuTable } from './components/SkuTable'
import { skuRows } from './data/mockData'

const summaryTabs = [['全部零件', '12,348'], ['待补全', '256'], ['低库存', '318'], ['适配冲突', '72']]

export function App() {
  const [selectedId, setSelectedId] = useState('95B-867-288-OM8')
  const [summaryTab, setSummaryTab] = useState('全部零件')
  const [brand, setBrand] = useState('全部')
  const [category, setCategory] = useState('全部')
  const [status, setStatus] = useState('全部')
  const [detailTab, setDetailTab] = useState('基本信息')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [newSkuOpen, setNewSkuOpen] = useState(false)

  useEffect(() => {
    const openCommandPanel = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setSearchValue('')
        setNewSkuOpen(false)
      }
    }
    window.addEventListener('keydown', openCommandPanel)
    return () => window.removeEventListener('keydown', openCommandPanel)
  }, [])

  const filteredRows = useMemo(() => skuRows.filter((row) => {
    const query = searchValue.trim().toLowerCase()
    const matchesSummary = summaryTab === '全部零件'
      || (summaryTab === '低库存' && row.status === '低库存')
      || (summaryTab === '待补全' && ['958-807-421', 'A-205-320-01-13'].includes(row.id))
      || (summaryTab === '适配冲突' && row.id === 'A-247-880-12-04')
    return matchesSummary && (brand === '全部' || row.brand === brand)
      && (category === '全部' || row.category === category)
      && (status === '全部' || row.status === status)
      && (!query || [row.sku, row.oe, row.name, row.brand, row.category, row.vehicle, row.source].join(' ').toLowerCase().includes(query))
  }), [brand, category, status, searchValue, summaryTab])

  const selectedItem = skuRows.find((row) => row.id === selectedId) ?? skuRows[3]

  return (
    <div className="app-shell">
      <AppHeader onSearchFocus={() => setSearchOpen(true)} />
      <main className="workspace">
        <section className="workspace-heading">
          <div><h1>SKU 管理</h1><p>管理汽车零部件SKU，打通 OE、EPC 与库存销售数据</p></div>
          <div className="page-actions"><button className="primary-button" onClick={() => setNewSkuOpen(true)} type="button"><Plus size={18} /> 新建 SKU</button><button className="more-button" aria-label="更多操作" type="button"><DotsThree size={21} weight="bold" /></button></div>
        </section>

        <div className="summary-tabs" role="tablist">
          {summaryTabs.map(([label, count]) => <button className={summaryTab === label ? 'active' : ''} key={label} onClick={() => setSummaryTab(label)} role="tab" type="button">{label} <strong>{count}</strong></button>)}
        </div>

        <div className="filters-row">
          <div className="filters-left">
            <FilterSelect label="品牌" value={brand} onChange={setBrand} options={['全部', 'Porsche', 'BMW', 'Mercedes']} />
            <FilterSelect label="零件大类" value={category} onChange={setCategory} options={['全部', '车身及内饰', '制动系统', '底盘系统', '转向系统', '发动机系统']} />
            <FilterSelect label="状态" value={status} onChange={setStatus} options={['全部', '在售', '低库存']} />
          </div>
          <div className="filters-right"><button className="secondary-button" type="button"><Funnel size={17} /> 更多筛选</button><button className="secondary-button sort-button" type="button">默认排序 <CaretDown size={13} weight="bold" /></button></div>
        </div>

        <SkuTable rows={filteredRows} selectedId={selectedId} onSelect={setSelectedId} />
        <DetailPanels item={selectedItem} activeTab={detailTab} onTabChange={setDetailTab} />
      </main>

      {searchOpen ? <div className="search-backdrop" onMouseDown={() => { setSearchOpen(false); setSearchValue('') }}><section className="command-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-input"><MagnifyingGlass size={20} /><input autoFocus value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索 VIN、OE号、SKU、车型，或输入命令…" /><button onClick={() => { setSearchOpen(false); setSearchValue('') }} type="button"><X size={17} /></button></div>
        <div className="command-results"><strong>快速搜索</strong>{filteredRows.slice(0, 4).map((row) => <button key={row.id} onClick={() => { setSelectedId(row.id); setSearchOpen(false); setSearchValue('') }} type="button"><img src={row.image} alt="" /><span><b>{row.sku}</b><small>{row.name}</small></span></button>)}</div>
      </section></div> : null}

      {newSkuOpen ? <div className="modal-backdrop" onMouseDown={() => setNewSkuOpen(false)}><section className="new-sku-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>新建 SKU</h2><button onClick={() => setNewSkuOpen(false)} type="button"><X size={18} /></button></header><label>SKU 编码<input defaultValue="95B-" /></label><label>中文名称<input placeholder="输入零件名称" /></label><footer><button className="secondary-button" onClick={() => setNewSkuOpen(false)} type="button">取消</button><button className="primary-button" onClick={() => setNewSkuOpen(false)} type="button">创建 SKU</button></footer>
      </section></div> : null}
    </div>
  )
}
