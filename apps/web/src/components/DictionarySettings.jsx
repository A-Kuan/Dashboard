import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react'
import { ALL_DICTIONARY_VALUE, generateDictionaryValue } from '../services/dictionaryService'
import { assetPath } from '../utils/assetPath'

function cloneDictionaries(dictionaries) {
  return JSON.parse(JSON.stringify(dictionaries))
}

export function DictionaryManagement({ dictionaries, onReset, onSave }) {
  const codes = Object.keys(dictionaries)
  const [activeCode, setActiveCode] = useState(codes[0])
  const [draft, setDraft] = useState(() => cloneDictionaries(dictionaries))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const currentCode = activeCode ?? codes[0]
  const activeDictionary = draft[currentCode] ?? dictionaries[currentCode]
  const activeItems = useMemo(() => activeDictionary?.items ?? [], [activeDictionary])

  useEffect(() => {
    setDraft(cloneDictionaries(dictionaries))
    setActiveCode((current) => current && dictionaries[current] ? current : Object.keys(dictionaries)[0])
  }, [dictionaries])

  const updateItems = (items) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [currentCode]: { ...(current[currentCode] ?? dictionaries[currentCode]), items: items.map((item, index) => ({ ...item, sort: index * 10 })) } }))
  }
  const updateItem = (index, changes) => updateItems(activeItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item))
  const moveItem = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= activeItems.length) return
    const items = [...activeItems]
    ;[items[index], items[target]] = [items[target], items[index]]
    updateItems(items)
  }
  const addItem = () => updateItems([...activeItems, {
    value: generateDictionaryValue(currentCode, activeItems.map((item) => item.value)),
    label: '新选项',
    enabled: true,
    sort: activeItems.length * 10,
  }])
  const removeItem = (index) => updateItems(activeItems.filter((_, itemIndex) => itemIndex !== index))
  const submit = async () => {
    const invalid = Object.values(draft).some((dictionary) => {
      const values = dictionary.items.map((item) => item.value.trim())
      return dictionary.items.some((item) => !item.label.trim() || !item.value.trim()) || new Set(values).size !== values.length
    })
    if (invalid) {
      setError('显示名称不能为空，系统编码必须保持唯一。')
      return
    }
    setSaving(true)
    try {
      const persisted = await onSave(draft)
      setDraft(cloneDictionaries(persisted))
      setError('')
      setSaved(true)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setSaving(false)
    }
  }
  const reset = async () => {
    setSaving(true)
    try {
      const persisted = await onReset()
      setDraft(cloneDictionaries(persisted))
      setError('')
      setSaved(false)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  return <main className="dictionary-module">
    <header className="dictionary-module-heading"><div><a href={assetPath('')}><ArrowLeft size={16} />返回 SKU 管理</a><h1>字典管理</h1><p>集中维护业务系统中的公共选项，保存后同步到服务端</p></div><div className="dictionary-module-actions">{saved ? <span><CheckCircle size={16} weight="fill" />配置已保存到数据库</span> : null}<button className="secondary-button" disabled={saving} onClick={reset} type="button">恢复系统默认</button><button className="primary-button" disabled={saving} onClick={submit} type="button">{saving ? '正在保存…' : '保存配置'}</button></div></header>
    <div className="dictionary-module-layout">
      <aside className="dictionary-catalog"><div className="catalog-title"><SlidersHorizontal size={18} /><span><b>业务字典</b><small>{codes.length} 个字典</small></span></div><nav aria-label="字典类型">{codes.map((code) => { const dictionary = draft[code] ?? dictionaries[code]; return <button className={code === currentCode ? 'active' : ''} key={code} onClick={() => { setActiveCode(code); setError(''); setSaved(false) }} type="button"><span>{dictionary.label}<small>{code}</small></span><em>{dictionary.items.filter((item) => item.enabled).length} 项</em></button> })}</nav><div className="catalog-note"><b>配置说明</b><p>停用选项不会影响已有数据，但将从新建与筛选入口中隐藏。</p></div></aside>
      <section className="dictionary-page-editor"><div className="dictionary-page-toolbar"><div><span>当前字典</span><h2>{activeDictionary?.label}</h2><p>调整显示顺序、名称和启用状态；系统编码自动生成且不可修改</p></div><button className="secondary-button" onClick={addItem} type="button"><Plus size={16} />新增选项</button></div>
        <div className="dictionary-table"><div className="dictionary-table-head"><span>排序</span><span>显示名称</span><span>系统编码</span><span>状态</span><span>操作</span></div><div className="dictionary-table-body">{activeItems.map((item, index) => <div className={item.enabled ? 'dictionary-table-row' : 'dictionary-table-row disabled'} key={index}>
          <div className="row-order"><button aria-label="上移" disabled={index === 0 || item.value === ALL_DICTIONARY_VALUE} onClick={() => moveItem(index, -1)} type="button"><ArrowUp size={15} /></button><button aria-label="下移" disabled={index === activeItems.length - 1 || item.value === ALL_DICTIONARY_VALUE} onClick={() => moveItem(index, 1)} type="button"><ArrowDown size={15} /></button></div>
          <input aria-label={`${item.label} 显示名称`} value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} />
          <input className="dictionary-system-code" aria-label={`${item.label} 系统编码`} aria-readonly="true" value={item.value} readOnly title="系统自动生成，创建后不可修改" />
          <label className="dictionary-switch"><input checked={item.enabled} disabled={item.value === ALL_DICTIONARY_VALUE} onChange={(event) => updateItem(index, { enabled: event.target.checked })} type="checkbox" /><span aria-hidden="true" /><em>{item.enabled ? '启用' : '停用'}</em></label>
          <button className="delete-dictionary-item" aria-label={`删除 ${item.label}`} disabled={item.value === ALL_DICTIONARY_VALUE} onClick={() => removeItem(index)} type="button"><Trash size={17} /></button>
        </div>)}</div></div>
        {error ? <p className="settings-error">{error}</p> : null}
      </section>
    </div>
  </main>
}
