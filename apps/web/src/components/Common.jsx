import { CaretDown, X } from '@phosphor-icons/react'

export function StatusBadge({ status }) {
  const low = status === '低库存'
  return <span className={low ? 'status-badge low' : 'status-badge'}><span className="status-dot" />{status}</span>
}

export function FilterSelect({ label, value, onChange, options }) {
  return <label className="filter-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><CaretDown size={13} weight="bold" aria-hidden="true" /></label>
}

export function PanelCard({ title, subtitle, action, children, className = '' }) {
  return <section className={`panel-card ${className}`}><header className="panel-header"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</header>{children}</section>
}

export function CloseButton({ onClick }) {
  return <button className="icon-button" aria-label="关闭" onClick={onClick} type="button"><X size={17} /></button>
}

export function MiniTable({ columns, rows, actionLabel }) {
  return <table className="mini-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => <td key={`${cell}-${index}`}>{cell}</td>)}{actionLabel ? <td><button className="text-link" type="button">{actionLabel}</button></td> : null}</tr>)}</tbody></table>
}

