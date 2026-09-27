import { CaretDown, X } from '@phosphor-icons/react'
import { ALL_DICTIONARY_VALUE } from '../services/dictionaryService'

export function StatusBadge({ status }) {
  const low = status === '低库存'
  return <span className={low ? 'status-badge low' : 'status-badge'}><span className="status-dot" />{status}</span>
}

export function DictionarySelect({ dictionaryCode, dictionaries, fallbackLabel, value, onChange, disabled = false }) {
  const dictionary = dictionaries[dictionaryCode]
  const options = dictionary?.items?.length ? dictionary.items : [{ value, label: value === ALL_DICTIONARY_VALUE ? '全部' : value }]
  const label = dictionary?.label || fallbackLabel || dictionaryCode

  return <label className="filter-select" data-dictionary={dictionaryCode}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><CaretDown size={13} weight="bold" aria-hidden="true" /></label>
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
