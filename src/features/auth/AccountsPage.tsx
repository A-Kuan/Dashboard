import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { api, errorMessage } from '../../lib/api'
import { Modal } from '../../components/business/Modal'
import { Select } from '../../components/business/Select'
import { useAuth } from './context'
import type { User } from '../catalog/types'

const roles = { admin: '管理员', editor: '编辑员', viewer: '只读账号' }
export function AccountsPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newRole, setNewRole] = useState('editor')
  useEffect(() => {
    if (user.role === 'admin')
      void api<User[]>('/users')
        .then(setUsers)
        .catch((e) => setError(errorMessage(e)))
  }, [user.role])
  if (user.role !== 'admin')
    return (
      <div className="business business-page">
        <h1>无权访问</h1>
        <p>仅管理员可以管理账号。</p>
      </div>
    )
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const data = Object.fromEntries(new FormData(e.currentTarget))
    try {
      const u = await api<User>('/users', { method: 'POST', body: JSON.stringify(data) })
      setUsers([...users, u])
      setOpen(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function toggle(u: User) {
    setBusy(true)
    setError('')
    try {
      await api(`/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...u, enabled: !u.enabled }),
      })
      setUsers(users.map((v) => (v.id === u.id ? { ...v, enabled: !v.enabled } : v)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="business business-page">
      <header className="page-heading">
        <div>
          <h1>账号管理</h1>
          <p>管理员可维护全部资料；编辑员可编辑业务；只读账号仅可查看。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setOpen(true)
            setError('')
            setNewRole('editor')
          }}
        >
          <IconPlus size={18} />
          新增账号
        </button>
      </header>
      {error && !open && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.id === user.id && <small>当前账号</small>}
                </td>
                <td>{roles[u.role]}</td>
                <td>{u.enabled ? '启用' : '停用'}</td>
                <td>
                  {u.id !== user.id && (
                    <button disabled={busy} onClick={() => void toggle(u)}>
                      {u.enabled ? '停用账号' : '启用账号'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal
          title="新增账号"
          onClose={() => {
            if (!busy) setOpen(false)
          }}
        >
          <form onSubmit={save}>
            <label>
              账号
              <input
                name="username"
                required
                pattern="[a-zA-Z0-9_.\-]{3,60}"
                autoComplete="off"
                placeholder="3–60 位字母、数字或 _ . -"
              />
            </label>
            <label>
              初始密码
              <input
                name="password"
                type="password"
                required
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              角色
              <Select
                name="role"
                label="角色"
                value={newRole}
                onChange={setNewRole}
                options={Object.entries(roles).map(([value, label]) => ({ value, label }))}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="form-actions">
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                创建账号
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
