import { ArrowsDownUp } from '@phosphor-icons/react'
import { StatusBadge } from './Common'

export function SkuTable({ rows, selectedId, onSelect, onOpen }) {
  return <div className="sku-table-shell"><table className="sku-table"><thead><tr>
    <th className="check-col"><input aria-label="选择全部" type="checkbox" /></th><th className="image-col">图片</th><th className="sku-col">SKU编码 <ArrowsDownUp size={12} /></th><th className="oe-col">OE号</th><th className="name-col">中文名称</th><th className="category-col">零件大类</th><th className="brand-col">品牌</th><th className="vehicle-col">适配车型</th><th className="stock-col">库存</th><th className="price-col">采购价 (¥)</th><th className="price-col">销售价 (¥)</th><th className="source-col">数据来源</th><th className="status-col">状态</th><th className="action-col">操作</th>
  </tr></thead><tbody>{rows.map((row) => {
    const selected = row.id === selectedId
    return <tr className={selected ? 'selected' : ''} key={row.id} onClick={() => onSelect(row.id)}>
      <td className="check-col"><input aria-label={`选择 ${row.sku}`} checked={selected} onChange={() => onSelect(row.id)} onClick={(event) => event.stopPropagation()} type="checkbox" /></td>
      <td className="image-col"><img src={row.image} alt="" /></td><td className="sku-col"><button className="row-link" onClick={(event) => { event.stopPropagation(); onOpen(row.id) }} type="button">{row.sku}</button></td><td className="oe-col">{row.oe}</td><td className="name-col">{row.name}</td><td className="category-col">{row.category}</td><td className="brand-col">{row.brand}</td><td className="vehicle-col">{row.vehicle}</td><td className="stock-col">{row.stock}</td><td className="price-col">{row.purchasePrice}</td><td className="price-col">{row.salePrice}</td><td className="source-col">{row.source}</td><td className="status-col"><StatusBadge status={row.status} /></td><td className="action-col"><button className="text-link" onClick={(event) => { event.stopPropagation(); onOpen(row.id) }} type="button">查看</button></td>
    </tr>
  })}</tbody></table></div>
}
