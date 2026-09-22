import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { IconLayoutDashboard, IconLock } from '@tabler/icons-react'
import { api, errorMessage } from '../../lib/api'
import type { User } from '../catalog/types'
import '../../components/business/business.css'

import { AuthContext, useAuth } from './context'

export function Auth({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [setup, setSetup] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function check() {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ user: User | null; setupRequired: boolean }>('/auth/session')
      setUser(result.user)
      setSetup(result.setupRequired)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void api<{ user: User | null; setupRequired: boolean }>('/auth/session')
      .then((result) => {
        setUser(result.user)
        setSetup(result.setupRequired)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
    const expired = () => {
      setUser(null)
      setError('登录已失效，请重新登录')
    }
    window.addEventListener('session-expired', expired)
    return () => window.removeEventListener('session-expired', expired)
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    try {
      setUser(
        await api<User>(setup ? '/auth/setup' : '/auth/login', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      )
      setSetup(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST', body: '{}' })
    setUser(null)
  }
  if (loading)
    return (
      <div className="business auth-screen">
        <p role="status">正在验证身份…</p>
      </div>
    )
  if (!user)
    return (
      <div className="business auth-screen">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-brand">
            <IconLayoutDashboard size={32} />
            <strong>Dashboard</strong>
          </div>
          <span className="auth-lock">
            <IconLock size={25} />
          </span>
          <h1>{setup ? '创建管理员' : '登录工作台'}</h1>
          <p>
            {setup
              ? '使用首次启动生成的初始化码，设置你的管理员账号。'
              : '登录后访问客户、SKU、分类售价和供应商报价。'}
          </p>
          {setup && (
            <label>
              初始化码
              <input name="setupToken" required autoComplete="off" />
              <small>初始化码位于服务器数据目录的 setup-token.txt 文件中。</small>
            </label>
          )}
          <label>
            账号
            <input name="username" required autoComplete="username" placeholder="请输入账号" />
          </label>
          <label>
            密码
            <input
              name="password"
              required
              type="password"
              maxLength={128}
              autoComplete={setup ? 'new-password' : 'current-password'}
              placeholder="请输入密码"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? '正在处理…' : setup ? '创建并登录' : '登录'}
          </button>
          <button type="button" className="text-button" onClick={() => void check()}>
            重新连接
          </button>
        </form>
      </div>
    )
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>
}

export function AccountFooter() {
  const { user, logout } = useAuth()
  const [error, setError] = useState('')
  return (
    <div className="account-footer">
      <span>
        {user.username}
        <small>{{ admin: '管理员', editor: '编辑员', viewer: '只读账号' }[user.role]}</small>
      </span>
      <button
        type="button"
        onClick={() => {
          void logout().catch((e) => setError(errorMessage(e)))
        }}
      >
        退出
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
