import { Database, Info } from '@phosphor-icons/react'
import { CloseButton, MiniTable, PanelCard, StatusBadge } from './Common'

const detailTabs = ['基本信息', '适配信息', '库存分布', '采购与价格', 'OEM 参考', '变更记录']

export function DetailPanels({ item, activeTab, onTabChange }) {
  return (
    <div className="detail-grid">
      <section className="part-summary-card">
        <div className="part-summary-top">
          <img className="part-preview" src={item.image} alt={item.name} />
          <div className="part-title">
            <div className="part-title-line"><h2>{item.sku}</h2><StatusBadge status={item.status} /></div>
            <p>{item.name}</p>
            <div className="chips"><span>{item.brand}</span><span>{item.category}</span><span>{item.source}</span></div>
          </div>
          <button className="secondary-button compact" type="button">编辑</button>
          <CloseButton />
        </div>
        <div className="detail-tabs" role="tablist">
          {detailTabs.map((tab) => <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => onTabChange(tab)} role="tab" type="button">{tab}</button>)}
        </div>
        <dl className="detail-facts">
          <div><dt>SKU编码</dt><dd>{item.sku}</dd></div><div><dt>品牌</dt><dd>{item.brand}</dd></div>
          <div><dt>OE号</dt><dd>{item.oe}</dd></div><div><dt>状态</dt><dd><StatusBadge status={item.status} /></dd></div>
          <div><dt>中文名称</dt><dd>{item.name}</dd></div><div><dt>数据来源</dt><dd>{item.source}</dd></div>
          <div><dt>零件大类</dt><dd>{item.category}</dd></div><div><dt>适配概况</dt><dd>{item.vehicle}</dd></div>
        </dl>
      </section>

      <PanelCard className="epc-card" title="EPC 零件位置" subtitle={<><Info size={14} /> 来源证据需在编辑页关联</>}>
        <div className="detail-data-empty"><Database size={27} /><span>暂无 EPC 图组数据</span></div>
      </PanelCard>

      <PanelCard className="fitment-card" title="适配条件" subtitle={<><Info size={14} /> 仅展示数据库中的真实记录</>}>
        <MiniTable columns={['车型', '年款', '发动机', '车身形式', '其他条件']} rows={[]} />
        <div className="detail-data-empty compact"><span>在编辑页维护适配车型</span></div>
      </PanelCard>

      <div className="side-stack">
        <PanelCard className="oem-card" title="OEM 参考价格（只读）" subtitle="未关联 OEM 来源" action={<CloseButton />}>
          <div className="oem-price"><span>建议零售价 (¥)</span><strong>—</strong></div>
        </PanelCard>
        <PanelCard className="inventory-card" title="库存分布"><MiniTable columns={['仓库', '可用库存', '锁定', '在途', '操作']} rows={[]} actionLabel="查看" /><div className="detail-data-empty compact"><span>暂无库存记录</span></div></PanelCard>
      </div>
    </div>
  )
}
