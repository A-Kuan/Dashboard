import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Trash, X } from '@phosphor-icons/react'
import { ALL_DICTIONARY_VALUE } from '../services/dictionaryService'

function cloneDictionaries(dictionaries) {
  return JSON.parse(JSON.stringify(dictionaries))
}

export function DictionarySettings({ dictionaries, onClose, onReset, onSave }) {
  const codes = Object.keys(dictionaries)
  const [activeCode, setActiveCode] = useState(codes[0])
  const [draft, setDraft] = useState(() => cloneDictionaries(dictionaries))
  const [error, setError] = useState('')
  const activeDictionary = draft[activeCode]
  const activeItems = useMemo(() => activeDictionary?.items ?? [], [activeDictionary])

  const updateItems = (items) => setDraft((current) => ({ ...current, [activeCode]: { ...current[activeCode], items: items.map((item, index) => ({ ...item, sort: index * 10 })) } }))
  const updateItem = (index, changes) => updateItems(activeItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item))
  const moveItem = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= activeItems.length) return
    const items = [...activeItems]
    ;[items[index], items[target]] = [items[target], items[index]]
    updateItems(items)
  }
  const addItem = () => updateItems([...activeItems, { value: `CUSTOM_${Date.now()}`, label: '新选项', enabled: true, sort: activeItems.length * 10 }])
  const removeItem = (index) => updateItems(activeItems.filter((_, itemIndex) => itemIndex !== index))
  const submit = () => {
    const invalid = Object.values(draft).some((dictionary) => {
      const values = dictionary.items.map((item) => item.value.trim())
      return dictionary.items.some((item) => !item.label.trim() || !item.value.trim()) || new Set(values).size !== values.length
    })
    if (invalid) {
      setError('显示名称和内部值不能为空，同一字典中的内部值不能重复。')
      return
    }
    onSave(draft)
  }

  return <div className="settings-backdrop" onMouseDown={onClose}><aside className="dictionary-settings" onMouseDown={(event) => event.stopPropagation()} aria-label="字典配置">
    <header><div className="settings-title-icon"><SlidersHorizontal size={20} /></div><div><h2>字典配置</h2><p>维护 SKU 页面中的公共选择项</p></div><button className="icon-button" aria-label="关闭字典配置" onClick={onClose} type="button"><X size={19} /></button></header>
    <nav aria-label="字典类型">{codes.map((code) => <button className={code === activeCode ? 'active' : ''} key={code} onClick={() => { setActiveCode(code); setError('') }} type="button"><span>{draft[code].label}</span><small>{draft[code].items.filter((item) => item.enabled).length} 项</small></button>)}</nav>
    <section className="settings-editor"><div className="settings-editor-heading"><div><h3>{activeDictionary?.label}</h3><p>调整顺序、显示名称和启用状态</p></div><button className="secondary-button" onClick={addItem} type="button"><Plus size={15} />新增选项</button></div>
      <div className="dictionary-edit-list">{activeItems.map((item, index) => <div className={item.enabled ? 'dictionary-edit-row' : 'dictionary-edit-row disabled'} key={index}>
        <div className="row-order"><button aria-label="上移" disabled={index === 0 || item.value === ALL_DICTIONARY_VALUE} onClick={() => moveItem(index, -1)} type="button"><ArrowUp size={14} /></button><button aria-label="下移" disabled={index === activeItems.length - 1 || item.value === ALL_DICTIONARY_VALUE} onClick={() => moveItem(index, 1)} type="button"><ArrowDown size={14} /></button></div>
        <label><span>显示名称</span><input value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} /></label>
        <label><span>内部值</span><input value={item.value} disabled={item.value === ALL_DICTIONARY_VALUE} onChange={(event) => updateItem(index, { value: event.target.value })} /></label>
        <label className="dictionary-switch"><input checked={item.enabled} disabled={item.value === ALL_DICTIONARY_VALUE} onChange={(event) => updateItem(index, { enabled: event.target.checked })} type="checkbox" /><span aria-hidden="true" /><em>{item.enabled ? '启用' : '停用'}</em></label>
        <button className="delete-dictionary-item" aria-label={`删除 ${item.label}`} disabled={item.value === ALL_DICTIONARY_VALUE} onClick={() => removeItem(index)} type="button"><Trash size={16} /></button>
      </div>)}</div>
      {error ? <p className="settings-error">{error}</p> : null}
    </section>
    <footer><button className="text-button" onClick={onReset} type="button">恢复系统默认</button><div><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" onClick={submit} type="button">保存配置</button></div></footer>
  </aside></div>
}
