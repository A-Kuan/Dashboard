import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CaretDown, Check, MagnifyingGlass, X } from '@phosphor-icons/react'
import { ALL_DICTIONARY_VALUE } from '../services/dictionaryService'

export function StatusBadge({ status }) {
  const low = status === '低库存'
  const draft = status === '草稿' || status === '待复核'
  return <span className={`status-badge${low ? ' low' : ''}${draft ? ' draft' : ''}`}><span className="status-dot" />{status}</span>
}

export function DictionarySelect({ dictionaryCode, dictionaries, fallbackLabel, value, onChange, disabled = false, allowAll = true, showLabel = true, className = '' }) {
  const dictionary = dictionaries[dictionaryCode]
  const options = dictionary?.items?.filter((item) => item.enabled !== false && (allowAll || item.value !== ALL_DICTIONARY_VALUE)) ?? []
  const availableOptions = options.length ? options : [{ value, label: value === ALL_DICTIONARY_VALUE ? '全部' : value }]
  const label = dictionary?.label || fallbackLabel || dictionaryCode
  const selected = availableOptions.find((option) => option.value === value) ?? (value ? { value, label: value } : { value: '', label: `请选择${label}` })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const searchRef = useRef(null)
  const listId = useId()
  const filteredOptions = useMemo(() => availableOptions.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase())), [availableOptions, query])

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  useEffect(() => {
    if (open) searchRef.current?.focus()
    else setQuery('')
  }, [open])

  return <div className={`${open ? 'filter-select open' : 'filter-select'} ${className}`.trim()} data-dictionary={dictionaryCode} ref={rootRef} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
    <button className="dictionary-trigger" role="combobox" aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}：${selected.label}`} disabled={disabled} onClick={() => setOpen((current) => !current)} type="button">{showLabel ? <span className="dictionary-label">{label}</span> : null}<strong>{selected.label}</strong><CaretDown size={13} weight="bold" aria-hidden="true" /></button>
    {open ? <div className="dictionary-popover"><label className="dictionary-search"><MagnifyingGlass size={15} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} /></label><div className="dictionary-options" id={listId} role="listbox" aria-label={label}>{filteredOptions.map((option) => <button className={option.value === value ? 'selected' : ''} key={option.value} role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false) }} type="button"><span>{option.label}</span>{option.value === value ? <Check size={16} weight="bold" /> : null}</button>)}{filteredOptions.length === 0 ? <p>没有匹配项</p> : null}</div></div> : null}
  </div>
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
