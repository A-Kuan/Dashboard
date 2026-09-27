import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react'
import { CloseButton, MiniTable, PanelCard, StatusBadge } from './Common'
import { fitmentRows, inventoryRows } from '../data/mockData'
import { assetPath } from '../utils/assetPath'

const detailTabs = ['基本信息', '适配信息', '库存分布', '采购与价格', 'OEM 参考', '变更记录']

export function DetailPanels({ item, activeTab, onTabChange }) {
  return (
    <div className="detail-grid">
      <section className="part-summary-card">
        <div className="part-summary-top">
          <img className="part-preview" src={item.id === '95B-867-288-OM8' ? assetPath('assets/parts/selected-part.png') : item.image} alt={item.name} />
          <div className="part-title">
            <div className="part-title-line"><h2>{item.sku}</h2><StatusBadge status={item.status} /></div>
            <p>{item.name}</p>
            <div className="chips"><span>{item.brand}</span><span>车身及内饰</span><span>内饰件</span></div>
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
          <div><dt>中文名称</dt><dd>{item.name}</dd></div><div><dt>创建时间</dt><dd>2024-11-15</dd></div>
          <div><dt>零件大类</dt><dd>{item.category}</dd></div><div><dt>更新者</dt><dd>张伟</dd></div>
        </dl>
      </section>

      <PanelCard className="epc-card" title="EPC零件位置" subtitle={<><CheckCircle size={14} weight="fill" /> 在下图中高亮显示该零件的位置</>}>
        <div className="epc-image-wrap"><img src={assetPath('assets/parts/epc-diagram.png')} alt="EPC零件位置图" /><button className="zoom-button" aria-label="放大EPC图" type="button"><MagnifyingGlass size={18} /></button></div>
      </PanelCard>

      <PanelCard className="fitment-card" title="适配条件" subtitle={<><CheckCircle size={14} weight="fill" /> 该零件适用于以下车型和条件</>}>
        <MiniTable columns={['车型', '年款', '发动机', '车身形式', '其他条件']} rows={fitmentRows} />
        <div className="fitment-notes"><strong>其他适配信息</strong><p><span /> 适用于带行李厢地板的车型</p><p><span /> 不适用于后排座椅折叠电动版本（PR: 3U5）</p><p><span /> 请在订购前核对车辆 VIN 码，以确保零件兼容性</p></div>
      </PanelCard>

      <div className="side-stack">
        <PanelCard className="oem-card" title="OEM 参考价格（只读）" subtitle="来自 Porsche OEM 数据" action={<CloseButton />}>
          <div className="oem-meta"><span>更新日期</span><strong>2024-11-15</strong></div><div className="oem-price"><span>建议零售价 (¥)</span><strong>1,120.50</strong></div>
        </PanelCard>
        <PanelCard className="inventory-card" title="库存分布"><MiniTable columns={['仓库', '可用库存', '锁定', '在途', '操作']} rows={inventoryRows} actionLabel="查看" /></PanelCard>
      </div>
    </div>
  )
}
