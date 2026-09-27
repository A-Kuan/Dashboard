import {
  ArrowBendDownLeft, ArrowRight, Barcode, BookmarkSimple, CaretRight, Command,
  Copy, FileText, Info, MagnifyingGlass, Package, Plus, Question, ShoppingCart,
  Storefront, Warning, Warehouse, X,
} from '@phosphor-icons/react'
import { skuRows } from '../data/mockData'
import { assetPath } from '../utils/assetPath'

const recentItems = [
  ['95B-807-288-OM8', '行李厢内饰板', '12 分钟前', '95B-867-288-OM8'],
  ['A 247 880 12 04', '前保险杠下格栅', '2 小时前', 'A-247-880-12-04'],
  ['5111 8087 375', '前制动盘', '1 天前', '5111-8087-375'],
  ['95B-631-681-02', '尾灯总成 右', '28 分钟前', '95B-631-681-02'],
]
const savedViews = [['我的常用零件', '1'], ['保时捷热销件', '2'], ['BMW 低库存', '3'], ['奔驰 适配冲突', '4']]
const commands = [['打开零件库', '⌘ 1'], ['打开采购', '⌘ 2'], ['打开库存', '⌘ 3'], ['打开销售', '⌘ 4'], ['帮助中心', '⌘ /']]
const vinMatches = [
  ['95B-867-288-OM8', '行李厢内饰板（黑色）', '100%', 'EPC', '95B-867-288-OM8'],
  ['958-631-681-02', '尾灯总成 右', '100%', 'EPC', '95B-631-681-02'],
  ['A-247-880-12-04', '前保险杠下格栅', '99%', 'EPC', 'A-247-880-12-04'],
  ['5111-8087-375', '前制动盘', '98%', 'EPC', '5111-8087-375'],
  ['A-205-320-01-13', '前空气滤清器', '96%', '人工复核', 'A-205-320-01-13'],
]

function PartImage({ id }) {
  const row = skuRows.find((item) => item.id === id) ?? skuRows[3]
  return <img src={row.image} alt="" />
}

function CommandInput({ value, onChange, onClose, onSubmit }) {
  return <form className="command-input" onSubmit={onSubmit}>
    <MagnifyingGlass size={19} />
    <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder="搜索 VIN、OE号、SKU、车型，或输入命令…" aria-label="命令搜索" />
    {value ? <button className="command-clear" onClick={() => onChange('')} aria-label="清空搜索" type="button"><X size={15} /></button> : null}
    <span className="command-shortcut"><Command size={14} /> K</span>
    {onClose ? <button className="command-close" onClick={onClose} aria-label="关闭搜索" type="button"><X size={18} /></button> : null}
  </form>
}

function DefaultState({ onSelect }) {
  return <div className="command-default-grid">
    <div className="command-column">
      <h3>最近访问</h3>
      <div className="recent-list">{recentItems.map(([sku, name, time, id]) => <button key={sku} onClick={() => onSelect(id)} type="button"><PartImage id={id} /><span><b>{sku}</b><small>{name}</small></span><em>{time}</em></button>)}</div>
      <div className="command-section quick-actions"><h3>快速操作</h3>{[['新建 SKU', '⌘ N', Plus], ['查询库存', '⌘ I', MagnifyingGlass], ['新建采购单', '⌘ P', ShoppingCart], ['新建销售单', '⌘ S', Storefront]].map(([label, key, Icon]) => <button key={label} type="button"><Icon size={17} /><span>{label}</span><kbd>{key}</kbd></button>)}</div>
    </div>
    <div className="command-column command-column-right">
      <h3>已保存视图</h3>
      <div className="saved-list">{savedViews.map(([label, key]) => <button key={label} type="button"><BookmarkSimple size={16} /><span>{label}</span><em>{key}</em></button>)}</div>
      <div className="command-section more-commands"><h3>更多命令</h3>{commands.map(([label, key], index) => { const Icon = index === 0 ? Package : index === 1 ? ShoppingCart : index === 2 ? Warehouse : index === 3 ? Storefront : Question; return <button key={label} type="button"><Icon size={17} /><span>{label}</span><kbd>{key}</kbd></button> })}</div>
    </div>
  </div>
}

function ResultRow({ id, sku, name, meta, replacement, onSelect }) {
  return <button className="result-row" onClick={() => onSelect(id)} type="button"><PartImage id={id} /><span className="result-code"><b>{sku}</b><small>{replacement}</small></span><span className="result-name"><b>{name}</b><small>{meta}</small></span><span className="result-stock"><i />在售</span></button>
}

function OeResults({ onSelect }) {
  return <div className="oe-layout">
    <div className="oe-results-list">
      <section><h3>精确匹配 <span>1</span></h3><ResultRow id="95B-867-288-OM8" sku="95B-867-288-OM8" name="行李厢内饰板（黑色）" meta="Porsche Cayenne (9YA)" replacement="OE: 95B 867 288 OM8" onSelect={onSelect} /></section>
      <section><h3>替代 / 历史 OE <span>2</span></h3><ResultRow id="95B-867-288-OM8" sku="95B 867 287 OM8" name="行李厢内饰板（黑色）" meta="Porsche Cayenne (9YA)" replacement="替代 → 95B 867 288 OM8" onSelect={onSelect} /><ResultRow id="95B-867-288-OM8" sku="95B 867 288 1E0" name="行李厢内饰板（米色）" meta="Porsche Cayenne (9YA)" replacement="替代 → 95B 867 288 OM8" onSelect={onSelect} /></section>
      <section><h3>相关零件 <span>2</span></h3><ResultRow id="A-205-320-01-13" sku="95B-867-289-OM8" name="行李厢内饰板 支架" meta="Porsche Cayenne (9YA)" replacement="OE: 95B 867 289 OM8" onSelect={onSelect} /><ResultRow id="958-121-251" sku="N 910 189 01" name="内饰板固定螺栓" meta="Porsche 通用" replacement="OE: N 910 189 01" onSelect={onSelect} /></section>
      <footer><MagnifyingGlass size={17} /> 查看全部与 “<b>95B 867 288</b>” 相关的结果 <span>按 ↵ 打开，↑ ↓ 选择</span></footer>
    </div>
    <aside className="result-preview"><img src={assetPath('assets/parts/selected-part.png')} alt="行李厢内饰板" /><h2>95B-867-288-OM8</h2><h4>行李厢内饰板（黑色）</h4><dl><div><dt>OE 号</dt><dd>95B 867 288 OM8</dd></div><div><dt>品牌</dt><dd>Porsche</dd></div><div><dt>适配车型</dt><dd>Cayenne (9YA) <CaretRight size={14} /></dd></div><div><dt>可用库存</dt><dd className="inventory-number">12</dd></div><div><dt>数据来源</dt><dd>Porsche EPC</dd></div><div><dt>状态</dt><dd className="preview-status"><i />在售</dd></div></dl><button className="primary-button preview-open" onClick={() => onSelect('95B-867-288-OM8')} type="button"><ArrowBendDownLeft size={17} />打开 SKU</button><button className="secondary-button preview-detail" type="button"><MagnifyingGlass size={16} />查看详情</button></aside>
  </div>
}

function VinResults({ onSelect }) {
  return <div className="vin-results">
    <section className="vehicle-summary"><div><h3>识别到的车辆信息</h3><h2>Porsche Cayenne (9YA)</h2><dl><div><dt>年份</dt><dd>2023</dd></div><div><dt>配置</dt><dd>Cayenne S</dd></div><div><dt>发动机</dt><dd>3.0T (DCB)</dd></div><div><dt>市场</dt><dd>中国</dd></div></dl></div><img src={assetPath('assets/cayenne.png')} alt="Porsche Cayenne" /><aside><small>VIN</small><b>WP1AA2A25PLB12345</b><strong>126 个适配零件<br />3 个需确认</strong><a>查看车辆详情 ›</a></aside></section>
    <div className="vin-heading"><h3>高匹配 SKU</h3><button type="button">查看更多 (126) <CaretRight size={14} /></button></div>
    <div className="vin-list">{vinMatches.map(([sku, name, match, source, id], index) => <button className={index === 0 ? 'selected' : ''} key={sku} onClick={() => onSelect(id)} type="button"><PartImage id={id} /><span><b>{sku}</b><small>{name}</small></span><em>匹配度 <strong>{match}</strong></em><span className="vin-stock"><i />在售</span><mark className={source === 'EPC' ? '' : 'manual'}>{source}</mark></button>)}</div>
    <h3 className="confirm-heading">需确认条件（1）</h3><button className="confirm-row" type="button"><PartImage id="958-807-421" /><span><b>95B-807-421</b><small>前保险杠总成</small></span><Warning size={19} weight="fill" /><em>需确认：车身形式存在差异（普通版 / Coupe），<br />请核对选装代码（M655 运动组件 等）。</em><span>匹配度 <b>85%</b></span><mark>人工复核</mark></button>
    <footer className="vin-footer"><button className="secondary-button" type="button">查看车型零件清单</button><button className="primary-button" type="button">进入适配校验 <ArrowRight size={16} /></button></footer>
  </div>
}

function EmptyState({ onUseSuggestion, onSelect }) {
  return <div className="empty-results">
    <MagnifyingGlass className="empty-search-icon" size={55} /><h2>未找到完全匹配的结果</h2><p>请检查 OE 号、SKU 或 VIN 是否输入正确</p>
    <div className="correction"><FileText size={25} /><span>你是到要搜索： <b>95B 867 228 OM8</b>？</span><button className="primary-button" onClick={onUseSuggestion} type="button">使用建议</button></div>
    <h3>其他搜索建议</h3><div className="suggestion-grid"><button type="button"><MagnifyingGlass /><span><b>去掉空格搜索</b><small>95B867228OM8</small></span><CaretRight /></button><button type="button"><FileText /><span><b>搜索部分 OE 号</b><small>95B 867 288</small></span><CaretRight /></button><button type="button"><Barcode /><span><b>扫描条形码</b><small>使用扫码枪或摄像头</small></span><CaretRight /></button><button type="button"><Plus /><span><b>新建 SKU</b><small>创建此零件</small></span><CaretRight /></button></div>
    <h3>可能相关</h3><div className="possible-list"><button onClick={() => onSelect('95B-867-288-OM8')} type="button"><PartImage id="95B-867-288-OM8" /><span><b>95B-867-288-OM8</b><small>行李厢内饰板（黑色） · Porsche</small></span><em><mark>低匹配</mark><small>可能存在数字差异</small></em><CaretRight /></button><button onClick={() => onSelect('95B-631-681-02')} type="button"><PartImage id="95B-631-681-02" /><span><b>95B-631-681-02</b><small>尾灯总成 右 · Porsche</small></span><em><mark>低匹配</mark><small>可能存在相似编号</small></em><CaretRight /></button></div>
    <footer><kbd>Esc</kbd> 关闭　 <kbd>Enter</kbd> 使用建议</footer>
  </div>
}

function LoadingState({ onCancel }) {
  return <div className="loading-state"><div className="loading-bar"><span /></div><header><div><h2>正在搜索零件数据...</h2><p>正在查询 SKU、OE、EPC 与库存索引</p></div><button className="secondary-button" onClick={onCancel} type="button">取消搜索　Esc</button></header><div className="loading-grid"><section><h3>最近访问</h3>{[0,1,2,3].map((item) => <div className="skeleton-row" key={item}><i /><span /><em /></div>)}<div className="skeleton-block"><h3>快速操作</h3>{[0,1,2].map((item) => <div className="skeleton-action" key={item}><i /><span /><em /></div>)}</div></section><section><h3>已保存视图</h3>{[0,1,2].map((item) => <div className="skeleton-action" key={item}><i /><span /><em /></div>)}<div className="skeleton-block"><h3>更多命令</h3>{[0,1,2,3].map((item) => <div className="skeleton-action" key={item}><i /><span /><em /></div>)}</div></section></div></div>
}

function ErrorState({ onRetry, onClose }) {
  return <div className="error-state"><Warning size={49} /><h2>暂时无法完成搜索</h2><p>SKU 与 OE 索引连接超时，页面中的现有数据不受影响</p><small>错误时间　2026-09-27 14:32　·　请求编号　SRCH–8F21</small><div><button className="primary-button" onClick={onRetry} type="button">重新搜索</button><button className="secondary-button" onClick={onClose} type="button">关闭</button></div><nav><button type="button"><MagnifyingGlass />仅搜索当前列表</button><button type="button"><Copy />复制错误信息</button></nav><footer><Info size={17} />如果问题持续，请联系系统管理员</footer></div>
}

export function CommandCenter({ state, value, onChange, onClose, onSubmit, onStateChange, onSelect }) {
  const resultState = state === 'oe' || state === 'vin'
  return <div className="search-backdrop" onMouseDown={onClose} data-state={state}><section className={`command-panel command-panel-${state}`} onMouseDown={(event) => event.stopPropagation()} aria-label="命令中枢搜索">
    <CommandInput value={value} onChange={onChange} onClose={resultState ? onClose : null} onSubmit={onSubmit} />
    {state === 'expanded' ? <DefaultState onSelect={onSelect} /> : null}
    {state === 'oe' ? <OeResults onSelect={onSelect} /> : null}
    {state === 'vin' ? <VinResults onSelect={onSelect} /> : null}
    {state === 'empty' ? <EmptyState onUseSuggestion={() => onStateChange('oe', '95B 867 288')} onSelect={onSelect} /> : null}
    {state === 'loading' ? <LoadingState onCancel={() => onStateChange('expanded', '')} /> : null}
    {state === 'error' ? <ErrorState onRetry={() => onStateChange('loading', value)} onClose={onClose} /> : null}
  </section></div>
}
