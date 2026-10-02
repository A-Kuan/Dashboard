import { useEffect, useRef, useState } from 'react'
import { CaretDown, Check, ShieldCheck } from '@phosphor-icons/react'
import { getCatalogSession, setStoredCatalogRole } from '../services/catalogApi'

export function CatalogOperatorMenu({ onSession }) {
  const [session, setSession] = useState(null)
  const [open, setOpen] = useState(false)
  const root = useRef(null)

  const load = async () => {
    const next = await getCatalogSession()
    setSession(next)
    onSession?.(next)
  }

  useEffect(() => {
    load().catch(() => {
      const unavailable = { name: '虎山行', roleLabel: '权限读取失败', capabilities: [], availableRoles: [], development: false }
      setSession(unavailable)
      onSession?.(unavailable)
    })
  }, [])
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const choose = async (role) => {
    setStoredCatalogRole(role)
    setOpen(false)
    await load()
  }

  const displayName = session?.name === 'hushanxing-workbench' ? '虎山行' : session?.name || '虎山行'

  return <div className="catalog-operator-menu" ref={root}>
    <button type="button" aria-label="当前资料权限" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span><strong>{displayName}</strong><small>{session?.roleLabel || '正在确认权限'}</small></span><CaretDown size={14} weight="bold" /></button>
    {open ? <div className="catalog-role-popover"><header><ShieldCheck size={18} weight="duotone" /><div><strong>当前资料权限</strong><span>{session?.development ? '开发环境可切换角色进行验收' : session?.authenticated ? `身份来自 ${session.identityProvider || '企业登录'}` : '尚未连接可信身份，系统保持只读'}</span></div></header>{session?.availableRoles?.length ? <div>{session.availableRoles.map((role) => <button type="button" key={role.id} onClick={() => choose(role.id)}><span><strong>{role.label}</strong><small>{role.capabilities.length} 项能力</small></span>{session.role === role.id ? <Check size={17} weight="bold" /> : null}</button>)}</div> : null}</div> : null}
  </div>
}
