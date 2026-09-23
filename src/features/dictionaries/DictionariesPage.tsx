import { useEffect, useState, type FormEvent } from 'react'
import {
  IconChevronLeft,
  IconChevronRight,
  IconCornerDownRight,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import './dictionaries.css'

type Scope = 'configuration' | 'sku_foundation'
type Group = {
  scope: Scope
  code: string
  name: string
  description: string
  editable: number
  status: string
  maintenanceMode: string
  sortOrder: number
  itemCount: number
}
type Item = {
  code: string
  label: string
  description: string
  sortOrder: number
  status: string
  parentCode: string | null
  parentLabel?: string | null
  logoId: string | null
  version: number
}
const empty: Item = {
  code: '',
  label: '',
  description: '',
  sortOrder: 0,
  status: 'active',
  parentCode: null,
  logoId: null,
  version: 1,
}

export function DictionariesPage({ scope }: { scope: Scope }) {
  const { user } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState('')
  const [rows, setRows] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [parents, setParents] = useState<{ code: string; label: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const group = groups.find((entry) => entry.code === selected)

  useEffect(() => {
    let alive = true
    void api<Group[]>(`/dictionaries/groups?scope=${scope}`)
      .then((result) => {
        if (!alive) return
        setGroups(result)
        setSelected((current) =>
          result.some((g) => g.code === current) ? current : (result[0]?.code ?? ''),
        )
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [scope, reload])

  useEffect(() => {
    if (!selected) return
    let alive = true
    const params = new URLSearchParams({
      scope,
      code: selected,
      page: String(page),
      search,
      status,
    })
    void api<{ rows: Item[]; total: number }>(`/dictionaries/items?${params}`)
      .then((result) => {
        if (alive) {
          setRows(result.rows)
          setTotal(result.total)
          setError('')
        }
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [scope, selected, page, search, status, reload])

  useEffect(() => {
    if (selected !== 'supply_type' || scope !== 'sku_foundation') return
    void api<{ code: string; label: string; parentCode: string | null }[]>(
      '/dictionaries/options?scope=sku_foundation&code=supply_type',
    )
      .then((result) => setParents(result.filter((item) => !item.parentCode)))
      .catch(() => {})
  }, [scope, selected, reload])

  function selectGroup(code: string) {
    setSelected(code)
    setPage(1)
    setSearch('')
    setStatus('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editing || !group) return
    setBusy(true)
    setError('')
    try {
      await api(`/dictionaries/items?scope=${scope}&code=${encodeURIComponent(group.code)}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(editing),
      })
      setEditing(null)
      setReload((value) => value + 1)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="business business-page dictionary-page">
      <header className="page-heading">
        <div>
          <h1>{scope === 'configuration' ? '配置中心字典' : '商品基础字典'}</h1>
          <p>来源数据已保存到本地数据库。新增选项自动生成编码，停用选项保留历史关联。</p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dictionary-layout">
        <aside className="dictionary-groups" aria-label="字典分组">
          {groups.map((entry) => (
            <button
              key={entry.code}
              className={selected === entry.code ? 'active' : ''}
              onClick={() => selectGroup(entry.code)}
            >
              <span>{entry.name}</span>
              <small>{entry.itemCount}</small>
            </button>
          ))}
        </aside>
        <section className="dictionary-content">
          {group && (
            <>
              <div className="dictionary-heading">
                <div>
                  <h2>{group.name}</h2>
                  <p>{group.description || group.code}</p>
                </div>
                {user.role === 'admin' && Boolean(group.editable) && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditing({ ...empty })
                      setIsNew(true)
                    }}
                  >
                    <IconPlus size={17} />
                    新增选项
                  </button>
                )}
              </div>
              <div className="dictionary-toolbar">
                <label className="search-field">
                  <IconSearch size={18} />
                  <input
                    aria-label="搜索字典选项"
                    value={search}
                    placeholder="搜索名称或编码"
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                  />
                </label>
                <Select
                  label="状态筛选"
                  value={status}
                  onChange={(value) => {
                    setStatus(value)
                    setPage(1)
                  }}
                  options={[
                    { value: '', label: '全部状态' },
                    { value: 'active', label: '启用' },
                    { value: 'disabled', label: '停用' },
                  ]}
                />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>编码</th>
                      <th>名称</th>
                      <th>说明</th>
                      <th>排序</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr
                        key={item.code}
                        className={
                          item.parentCode
                            ? 'dictionary-child-row'
                            : rows.some((row) => row.parentCode === item.code)
                              ? 'dictionary-parent-row'
                              : undefined
                        }
                      >
                        <td>
                          <code>{item.code}</code>
                        </td>
                        <td className="dictionary-name">
                          <div className="dictionary-name-content">
                            {item.parentCode && (
                              <IconCornerDownRight size={17} aria-hidden="true" />
                            )}
                            {item.logoId && (
                              <img src={`/api/dictionaries/logo/${item.logoId}`} alt="" />
                            )}
                            <span>
                              <span className="dictionary-item-label">{item.label}</span>
                              {item.parentCode &&
                                !rows.some((row) => row.code === item.parentCode) && (
                                  <small>上级：{item.parentLabel || item.parentCode}</small>
                                )}
                            </span>
                          </div>
                        </td>
                        <td className="cell-note">{item.description || '—'}</td>
                        <td>{item.sortOrder}</td>
                        <td>{item.status === 'active' ? '启用' : '停用'}</td>
                        <td>
                          {user.role === 'admin' && Boolean(group.editable) && (
                            <button
                              onClick={() => {
                                setEditing({ ...item })
                                setIsNew(false)
                              }}
                            >
                              编辑
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && <div className="empty-state">暂无匹配的字典项</div>}
              <div className="pagination">
                <span>
                  共 {total} 项 · 第 {page} / {Math.max(1, Math.ceil(total / 50))} 页
                </span>
                <div>
                  <button
                    aria-label="上一页"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <IconChevronLeft size={18} />
                  </button>
                  <button
                    aria-label="下一页"
                    disabled={page * 50 >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    <IconChevronRight size={18} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {editing && group && (
        <Modal
          title={isNew ? `新增${group.name}选项` : `编辑${group.name}选项`}
          onClose={() => {
            if (!busy) setEditing(null)
          }}
        >
          <form onSubmit={(event) => void save(event)}>
            <label>
              编码（系统自动生成）
              <input
                maxLength={200}
                disabled
                value={isNew ? '保存后自动生成' : editing.code}
                spellCheck={false}
              />
            </label>
            <label>
              名称
              <input
                required
                maxLength={200}
                value={editing.label}
                onChange={(event) => setEditing({ ...editing, label: event.target.value })}
              />
            </label>
            <label>
              说明
              <textarea
                maxLength={600}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                排序
                <input
                  type="number"
                  min="0"
                  max="999999"
                  value={editing.sortOrder}
                  onChange={(event) =>
                    setEditing({ ...editing, sortOrder: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                状态
                <Select
                  label="状态"
                  value={editing.status}
                  onChange={(value) => setEditing({ ...editing, status: value })}
                  options={[
                    { value: 'active', label: '启用' },
                    { value: 'disabled', label: '停用' },
                  ]}
                />
              </label>
            </div>
            {scope === 'sku_foundation' && group.code === 'supply_type' && (
              <label>
                上级分类
                <Select
                  label="上级分类"
                  value={editing.parentCode ?? ''}
                  onChange={(value) => setEditing({ ...editing, parentCode: value || null })}
                  options={[
                    { value: '', label: '一级选项' },
                    ...parents
                      .filter((item) => item.code !== editing.code)
                      .map((item) => ({ value: item.code, label: item.label })),
                  ]}
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="form-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
