import { PartThumbnail, StatusBadge } from './Common'

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function SkuMasterList({ rows, selectedId, onSelect }) {
  return <div className="sku-master-list" role="table" aria-label="SKU 结果列表">
    <div className="sku-master-list-body" role="rowgroup">{rows.map((row) => {
      const selected = row.id === selectedId
      return <div aria-selected={selected} className={`sku-master-row${selected ? ' selected' : ''}`} key={row.id} onClick={() => onSelect(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row.id) } }} role="row" tabIndex={0}>
        <span className="sku-master-check" role="cell"><input aria-label={`选择 ${row.sku}`} checked={selected} onChange={() => onSelect(row.id)} onClick={(event) => event.stopPropagation()} type="checkbox" /></span>
        <span className="sku-master-image" role="cell"><PartThumbnail src={row.image} alt={row.name} /></span>
        <span className="sku-master-primary" role="cell"><strong>{row.sku}</strong><b>{row.name}</b><small>{row.brand}　|　{row.category}</small></span>
        <span className="sku-master-meta" role="cell"><StatusBadge status={row.status} /><time dateTime={row.updatedAt || undefined}>{formatDate(row.updatedAt)}</time></span>
      </div>
    })}</div>
  </div>
}
