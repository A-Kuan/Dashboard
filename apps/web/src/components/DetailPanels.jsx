import { CaretLeft, CaretRight, CheckCircle, Database, PencilSimple } from '@phosphor-icons/react'
import { CloseButton, MiniTable, PartThumbnail, StatusBadge } from './Common'
import { dictionaryItemLabel } from '../services/dictionaryService'

const detailTabs = ['基本信息', '适配信息', '库存分布', '采购与价格', 'OEM 参考', '变更记录']

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function TabContent({ activeTab, item }) {
  if (activeTab === '适配信息') {
    const rows = (item.fitments || []).map((row) => [row.vehicle, row.years || '—', row.engine || '—', row.body || '—', row.condition || '—', row.verificationStatus || '—'])
    return <section className="detail-tab-panel" role="tabpanel"><h3>适配车型</h3><MiniTable columns={['车型', '年款', '发动机', '车身形式', '其他条件', '验证状态']} rows={rows} />{rows.length ? null : <div className="detail-data-empty compact"><span>暂无适配记录，请先在编辑页维护。</span></div>}</section>
  }
  if (activeTab === '库存分布') return <section className="detail-tab-panel" role="tabpanel"><h3>库存分布</h3><div className="detail-data-empty"><Database size={27} /><span>库存模块尚未接入，当前不展示虚拟库存。</span></div></section>
  if (activeTab === '采购与价格') return <section className="detail-tab-panel" role="tabpanel"><h3>采购与价格</h3><div className="detail-data-empty"><Database size={27} /><span>采购价、销售价和价格历史尚未接入。</span></div></section>
  if (activeTab === 'OEM 参考') {
    const evidence = item.sourceEvidence
    return <section className="detail-tab-panel" role="tabpanel"><h3>OEM 参考</h3>{evidence ? <dl className="detail-facts"><div><dt>来源</dt><dd>{evidence.title || item.dataSource}</dd></div><div><dt>参考价</dt><dd>{evidence.referencePrice || '—'}</dd></div><div><dt>原始名称</dt><dd>{evidence.originalName || '—'}</dd></div><div><dt>最后同步</dt><dd>{evidence.syncedAt || '—'}</dd></div></dl> : <div className="detail-data-empty"><Database size={27} /><span>尚未关联 OEM/EPC 来源证据。</span></div>}</section>
  }
  if (activeTab === '变更记录') {
    const rows = (item.changeHistory || []).map((entry) => [`v${entry.version}`, entry.action, entry.changedBy || '—', formatDate(entry.changedAt), `${entry.details?.oeRelationCount ?? 0} OE / ${entry.details?.fitmentCount ?? 0} 适配`])
    return <section className="detail-tab-panel" role="tabpanel"><h3>变更记录</h3><MiniTable columns={['版本', '操作', '操作人', '时间', '关系数据']} rows={rows} />{rows.length ? null : <div className="detail-data-empty compact"><span>暂无变更记录。</span></div>}</section>
  }
  return null
}

function ReadinessRow({ label, ready, value }) {
  return <div className={ready ? 'ready' : ''}><dt>{label}</dt><dd>{ready ? <CheckCircle size={18} weight="fill" /> : <span className="readiness-dot" />}{value}</dd></div>
}

export function DetailPanels({ item, dictionaries, activeTab, onTabChange, onClose, onEdit, onPrevious, onNext, hasPrevious, hasNext }) {
  const showOverview = activeTab === '基本信息'
  const brandLabel = dictionaryItemLabel(dictionaries, 'sku_brand', item.brand)
  const categoryLabel = dictionaryItemLabel(dictionaries, 'part_category', item.category)
  const unitLabel = dictionaryItemLabel(dictionaries, 'unit', item.unit)
  const oeRows = (item.oeRelations || []).map((row) => [row.type || '—', row.oeNumber || '—', row.relation || '—', row.source || '—', row.confidence || '—'])
  const fitmentRows = (item.fitments || []).map((row) => [row.vehicle, row.years || '—', row.engine || '—', row.body || '—'])
  const sourceImage = item.sourceEvidence?.diagramUrl || item.imageUrl
  return <section className="sku-detail-workspace" aria-label="当前 SKU 详情">
    <header className="sku-detail-identity part-summary-card">
      <PartThumbnail className="part-preview" src={item.imageUrl} alt={item.chineseName} showLabel />
      <div className="part-title"><div className="part-title-line"><h2>{item.skuCode}</h2><StatusBadge status={item.lifecycleStatus} /></div><p>{item.chineseName}</p><div className="chips"><span>{brandLabel}</span><span>{categoryLabel}</span><span>{item.dataSource || '—'}</span></div><small>最后更新：{formatDate(item.updatedAt)}　更新者：{item.updatedBy || '—'}</small></div>
      <div className="sku-detail-actions"><div className="sku-detail-step"><button aria-label="上一个 SKU" disabled={!hasPrevious} onClick={onPrevious} type="button"><CaretLeft size={19} />上一个</button><button aria-label="下一个 SKU" disabled={!hasNext} onClick={onNext} type="button">下一个<CaretRight size={19} /></button></div><button className="primary-button" onClick={onEdit} type="button"><PencilSimple size={19} />编辑</button><CloseButton onClick={onClose} /></div>
    </header>
    <div className="detail-tabs" role="tablist">{detailTabs.map((tab) => <button aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => onTabChange(tab)} role="tab" type="button">{tab}</button>)}</div>
    <div className="sku-detail-scroll">{showOverview ? <div className="sku-detail-overview" role="tabpanel">
      <div className="sku-detail-main-column">
        <section className="sku-detail-section"><header><h3>主数据</h3><button onClick={onEdit} type="button"><PencilSimple size={17} />编辑</button></header><dl className="detail-facts"><div><dt>SKU 编码</dt><dd>{item.skuCode}</dd></div><div><dt>中文名称</dt><dd>{item.chineseName}</dd></div><div><dt>品牌</dt><dd>{brandLabel}</dd></div><div><dt>零件大类</dt><dd>{categoryLabel}</dd></div><div><dt>主 OE 号</dt><dd>{item.primaryOe || '—'}</dd></div><div><dt>制造商零件号</dt><dd>{item.manufacturerPartNumber || '—'}</dd></div><div><dt>计量单位</dt><dd>{unitLabel}</dd></div><div><dt>数据来源</dt><dd>{item.dataSource || '—'}</dd></div><div><dt>创建时间</dt><dd>{formatDate(item.createdAt)}</dd></div><div><dt>生命周期</dt><dd><StatusBadge status={item.lifecycleStatus} /></dd></div></dl></section>
        <section className="sku-detail-section"><header><h3>OE 与适配</h3><button onClick={onEdit} type="button"><PencilSimple size={17} />维护</button></header><h4>OE 关系</h4><MiniTable columns={['类型', 'OE / 替代号', '关系', '来源', '可信度']} rows={oeRows} />{oeRows.length ? null : <div className="detail-data-empty compact"><span>尚未维护 OE 或替代关系</span></div>}<h4>适配车型</h4><MiniTable columns={['车型', '年款', '发动机', '车身形式']} rows={fitmentRows} />{fitmentRows.length ? null : <div className="detail-data-empty compact"><span>尚未维护适配车型</span></div>}</section>
      </div>
      <aside className="sku-detail-side-column">
        <section className="sku-detail-section sku-source-section"><header><h3>产品图片 / EPC 来源</h3>{item.sourceEvidence ? <span className="source-linked"><CheckCircle size={18} weight="fill" />已关联</span> : null}</header>{sourceImage ? <img src={sourceImage} alt={item.sourceEvidence ? `${item.chineseName} EPC 来源图` : item.chineseName} /> : <div className="source-image-empty"><Database size={35} /><span>尚未关联 EPC 图组</span></div>}<dl><div><dt>图片来源</dt><dd>{item.sourceEvidence ? 'EPC 图' : item.imageUrl ? 'SKU 图片' : '—'}</dd></div><div><dt>EPC 图号</dt><dd>{item.sourceEvidence?.group || '—'}</dd></div><div><dt>EPC 位置</dt><dd>{item.sourceEvidence?.position || '—'}</dd></div><div><dt>参考价格</dt><dd>{item.sourceEvidence?.referencePrice || '—'}</dd></div></dl></section>
        <section className="sku-detail-section"><header><h3>配置与使用情况</h3></header><dl className="sku-readiness"><ReadinessRow label="适配数据" ready={Boolean(item.fitments?.length)} value={item.fitments?.length ? `${item.fitments.length} 个适配车型` : '待维护'} /><ReadinessRow label="商品图片" ready={Boolean(item.imageUrl)} value={item.imageUrl ? '已上传' : '待上传'} /><ReadinessRow label="数据来源" ready={Boolean(item.dataSource)} value={item.dataSource || '待维护'} /><ReadinessRow label="OEM 参考" ready={Boolean(item.sourceEvidence)} value={item.sourceEvidence ? '已关联' : '未关联'} /></dl></section>
      </aside>
    </div> : <TabContent activeTab={activeTab} item={item} />}</div>
  </section>
}
