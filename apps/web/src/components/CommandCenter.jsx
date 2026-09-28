import {
  ArrowBendDownLeft, BookmarkSimple, Command, Info, MagnifyingGlass, Package,
  Plus, Question, ShoppingCart, Storefront, Warning, Warehouse, X,
} from '@phosphor-icons/react'
import { assetPath } from '../utils/assetPath'

const savedViews = [['我的常用零件', '1'], ['最近更新', '2'], ['待补全', '3'], ['适配冲突', '4']]
const commands = [['打开零件库', '⌘ 1'], ['打开采购', '⌘ 2'], ['打开库存', '⌘ 3'], ['打开销售', '⌘ 4'], ['帮助中心', '⌘ /']]

function CommandInput({ value, onChange, onClose, onSubmit }) {
  return <form className="command-input" onSubmit={onSubmit}><MagnifyingGlass size={19} /><input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder="搜索 VIN、OE号、SKU、车型，或输入命令…" aria-label="命令搜索" />{value ? <button className="command-clear" onClick={() => onChange('')} aria-label="清空搜索" type="button"><X size={15} /></button> : null}<span className="command-shortcut"><Command size={14} /> K</span>{onClose ? <button className="command-close" onClick={onClose} aria-label="关闭搜索" type="button"><X size={18} /></button> : null}</form>
}

function PartImage({ row }) {
  return <img src={row?.image || assetPath('assets/parts/selected-part.png')} alt="" />
}

function DefaultState({ onNewSku, onSelect, rows }) {
  const quickActions = [['新建 SKU', '⌘ N', Plus, onNewSku], ['查询库存', '尚未开放', MagnifyingGlass], ['新建采购单', '尚未开放', ShoppingCart], ['新建销售单', '尚未开放', Storefront]]
  return <div className="command-default-grid"><div className="command-column"><h3>最近访问</h3><div className="recent-list">{rows.slice(0, 4).map((row) => <button key={row.id} onClick={() => onSelect(row.id)} type="button"><PartImage row={row} /><span><b>{row.sku}</b><small>{row.name}</small></span><em>数据库</em></button>)}{rows.length === 0 ? <p className="command-data-empty">暂无 SKU 记录</p> : null}</div><div className="command-section quick-actions"><h3>快速操作</h3>{quickActions.map(([label, key, Icon, action]) => <button disabled={!action} key={label} onClick={action} title={action ? undefined : `${label}尚未开放`} type="button"><Icon size={17} /><span>{label}</span><kbd>{key}</kbd></button>)}</div></div><div className="command-column command-column-right"><h3>已保存视图</h3><div className="saved-list">{savedViews.map(([label, key]) => <button disabled key={label} title="已保存视图尚未开放" type="button"><BookmarkSimple size={16} /><span>{label}</span><em>{key}</em></button>)}</div><div className="command-section more-commands"><h3>更多命令</h3>{commands.map(([label, key], index) => { const Icon = index === 0 ? Package : index === 1 ? ShoppingCart : index === 2 ? Warehouse : index === 3 ? Storefront : Question; return <button disabled key={label} title={`${label}尚未开放`} type="button"><Icon size={17} /><span>{label}</span><kbd>{key}</kbd></button> })}</div></div></div>
}

function OeResults({ onSelect, rows }) {
  const first = rows[0]
  return <div className="oe-layout"><div className="oe-results-list"><section><h3>数据库结果 <span>{rows.length}</span></h3>{rows.slice(0, 7).map((row) => <button className="result-row" key={row.id} onClick={() => onSelect(row.id)} type="button"><PartImage row={row} /><span className="result-code"><b>{row.sku}</b><small>OE: {row.oe}</small></span><span className="result-name"><b>{row.name}</b><small>{row.brand} · {row.category}</small></span><span className="result-stock"><i />{row.status}</span></button>)}</section><footer><MagnifyingGlass size={17} />结果来自 SKU 数据库<span>选择后打开详情</span></footer></div><aside className="result-preview">{first ? <><img src={first.image} alt={first.name} /><h2>{first.sku}</h2><h4>{first.name}</h4><dl><div><dt>OE 号</dt><dd>{first.oe}</dd></div><div><dt>品牌</dt><dd>{first.brand}</dd></div><div><dt>适配车型</dt><dd>{first.vehicle}</dd></div><div><dt>数据来源</dt><dd>{first.source}</dd></div><div><dt>状态</dt><dd className="preview-status"><i />{first.status}</dd></div></dl><button className="primary-button preview-open" onClick={() => onSelect(first.id)} type="button"><ArrowBendDownLeft size={17} />打开 SKU</button></> : null}</aside></div>
}

function EmptyState({ onClose }) {
  return <div className="empty-results persisted-search-empty"><MagnifyingGlass className="empty-search-icon" size={55} /><h2>数据库中没有匹配记录</h2><p>当前不再使用演示 SKU，请先创建并保存真实数据。</p><div><button className="secondary-button" onClick={onClose} type="button">关闭</button></div><footer><kbd>Esc</kbd> 关闭</footer></div>
}

function VinResults() {
  return <div className="vin-results persisted-search-empty"><Warning size={48} /><h2>VIN 数据服务尚未接入</h2><p>当前不会生成演示车型或虚拟匹配结果。</p></div>
}

function LoadingState({ onCancel }) {
  return <div className="loading-state"><div className="loading-bar"><span /></div><header><div><h2>正在查询数据库...</h2><p>正在查询 SKU、OE 与车型适配记录</p></div><button className="secondary-button" onClick={onCancel} type="button">取消搜索　Esc</button></header><div className="loading-grid"><section><h3>SKU 结果</h3>{[0,1,2,3].map((item) => <div className="skeleton-row" key={item}><i /><span /><em /></div>)}</section><section><h3>来源与适配</h3>{[0,1,2,3].map((item) => <div className="skeleton-action" key={item}><i /><span /><em /></div>)}</section></div></div>
}

function ErrorState({ onRetry, onClose }) {
  return <div className="error-state"><Warning size={49} /><h2>暂时无法查询数据库</h2><p>页面中的现有数据不受影响</p><small>错误时间　2026-09-27　·　服务　SKU API</small><div><button className="primary-button" onClick={onRetry} type="button">重新搜索</button><button className="secondary-button" onClick={onClose} type="button">关闭</button></div><footer><Info size={17} />如果问题持续，请联系系统管理员</footer></div>
}

export function CommandCenter({ state, value, onChange, onClose, onSubmit, onRetry, onNewSku, onSelect, rows = [] }) {
  const resultState = state === 'oe' || state === 'vin'
  return <div className="search-backdrop" onMouseDown={onClose} data-state={state}><section className={`command-panel command-panel-${state}`} onMouseDown={(event) => event.stopPropagation()} aria-label="命令中枢搜索" role="dialog" aria-modal="true"><CommandInput value={value} onChange={onChange} onClose={resultState ? onClose : null} onSubmit={onSubmit} />{state === 'expanded' ? <DefaultState onNewSku={onNewSku} onSelect={onSelect} rows={rows} /> : null}{state === 'oe' ? <OeResults onSelect={onSelect} rows={rows} /> : null}{state === 'vin' ? <VinResults /> : null}{state === 'empty' ? <EmptyState onClose={onClose} /> : null}{state === 'loading' ? <LoadingState onCancel={onClose} /> : null}{state === 'error' ? <ErrorState onRetry={onRetry} onClose={onClose} /> : null}</section></div>
}
