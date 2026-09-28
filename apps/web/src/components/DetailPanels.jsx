import { Database, Info } from '@phosphor-icons/react'
import { CloseButton, MiniTable, PanelCard, StatusBadge } from './Common'
import { assetPath } from '../utils/assetPath'

const detailTabs = ['基本信息', '适配信息', '库存分布', '采购与价格', 'OEM 参考', '变更记录']

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function TabContent({ activeTab, item }) {
  if (activeTab === '适配信息') {
    const rows = (item.fitments || []).map((row) => [row.vehicle, row.years || '—', row.engine || '—', row.body || '—', row.condition || '—', row.verificationStatus || '待验证'])
    return <section className="detail-tab-panel" role="tabpanel"><h3>适配车型</h3><MiniTable columns={['车型', '年款', '发动机', '车身形式', '其他条件', '验证状态']} rows={rows} />{rows.length ? null : <div className="detail-data-empty compact"><span>暂无适配记录，请先在编辑页维护。</span></div>}</section>
  }
  if (activeTab === '库存分布') return <section className="detail-tab-panel" role="tabpanel"><h3>库存分布</h3><div className="detail-data-empty"><Database size={27} /><span>库存模块尚未接入，当前不展示虚拟库存。</span></div></section>
  if (activeTab === '采购与价格') return <section className="detail-tab-panel" role="tabpanel"><h3>采购与价格</h3><div className="detail-data-empty"><Database size={27} /><span>采购价、销售价和价格历史尚未接入。</span></div></section>
  if (activeTab === 'OEM 参考') {
    const evidence = item.sourceEvidence
    return <section className="detail-tab-panel" role="tabpanel"><h3>OEM 参考</h3>{evidence ? <dl className="detail-facts"><div><dt>来源</dt><dd>{evidence.title || item.dataSource}</dd></div><div><dt>参考价</dt><dd>{evidence.referencePrice || '—'}</dd></div><div><dt>原始名称</dt><dd>{evidence.originalName || '—'}</dd></div><div><dt>最后同步</dt><dd>{evidence.syncedAt || '—'}</dd></div></dl> : <div className="detail-data-empty"><Database size={27} /><span>尚未关联 OEM/EPC 来源证据。</span></div>}</section>
  }
  if (activeTab === '变更记录') return <section className="detail-tab-panel" role="tabpanel"><h3>当前记录</h3><dl className="detail-facts"><div><dt>创建时间</dt><dd>{formatDate(item.createdAt)}</dd></div><div><dt>创建人</dt><dd>{item.createdBy || '—'}</dd></div><div><dt>最后更新</dt><dd>{formatDate(item.updatedAt)}</dd></div><div><dt>更新人</dt><dd>{item.updatedBy || '—'}</dd></div><div><dt>数据版本</dt><dd>v{item.version || 1}</dd></div></dl><p className="detail-panel-note">完整字段级变更日志将在后续版本接入。</p></section>
  return null
}

export function DetailPanels({ item, activeTab, onTabChange, onClose, onEdit }) {
  const showOverview = activeTab === '基本信息'
  const image = item.imageUrl || assetPath('assets/parts/selected-part.png')
  return <div className={showOverview ? 'detail-grid' : 'detail-grid focused'}>
    <section className={showOverview ? 'part-summary-card' : 'part-summary-card focused'}>
      <div className="part-summary-top"><img className="part-preview" src={image} alt={item.chineseName} /><div className="part-title"><div className="part-title-line"><h2>{item.skuCode}</h2><StatusBadge status={item.lifecycleStatus} /></div><p>{item.chineseName}</p><div className="chips"><span>{item.brand}</span><span>{item.category}</span><span>{item.dataSource || '人工录入'}</span></div></div><button className="secondary-button compact" onClick={onEdit} type="button">编辑</button><CloseButton onClick={onClose} /></div>
      <div className="detail-tabs" role="tablist">{detailTabs.map((tab) => <button aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => onTabChange(tab)} role="tab" type="button">{tab}</button>)}</div>
      {showOverview ? <dl className="detail-facts"><div><dt>SKU编码</dt><dd>{item.skuCode}</dd></div><div><dt>品牌</dt><dd>{item.brand}</dd></div><div><dt>OE号</dt><dd>{item.primaryOe}</dd></div><div><dt>状态</dt><dd><StatusBadge status={item.lifecycleStatus} /></dd></div><div><dt>中文名称</dt><dd>{item.chineseName}</dd></div><div><dt>数据来源</dt><dd>{item.dataSource || '人工录入'}</dd></div><div><dt>零件大类</dt><dd>{item.category}</dd></div><div><dt>适配概况</dt><dd>{item.fitments?.length || 0} 个适配车型</dd></div></dl> : <TabContent activeTab={activeTab} item={item} />}
    </section>
    {showOverview ? <><PanelCard className="epc-card" title="EPC 零件位置" subtitle={<><Info size={14} /> {item.sourceEvidence ? '已关联来源证据' : '来源证据需在编辑页关联'}</>}><div className="detail-data-empty"><Database size={27} /><span>{item.sourceEvidence ? item.sourceEvidence.title || '已关联 EPC 来源' : '暂无 EPC 图组数据'}</span></div></PanelCard><PanelCard className="fitment-card" title="适配条件" subtitle={<><Info size={14} /> 仅展示数据库中的真实记录</>}><MiniTable columns={['车型', '年款', '发动机', '车身形式', '其他条件']} rows={(item.fitments || []).map((row) => [row.vehicle, row.years || '—', row.engine || '—', row.body || '—', row.condition || '—'])} />{item.fitments?.length ? null : <div className="detail-data-empty compact"><span>在编辑页维护适配车型</span></div>}</PanelCard><div className="side-stack"><PanelCard className="oem-card" title="OEM 参考价格（只读）" subtitle={item.sourceEvidence ? item.sourceEvidence.title : '未关联 OEM 来源'}><div className="oem-price"><span>建议零售价 (¥)</span><strong>{item.sourceEvidence?.referencePrice || '—'}</strong></div></PanelCard><PanelCard className="inventory-card" title="库存分布"><div className="detail-data-empty compact"><span>库存模块尚未接入</span></div></PanelCard></div></> : null}
  </div>
}
