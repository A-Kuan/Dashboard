import { useRef, useState, type FormEvent } from 'react'
import {
  IconBell,
  IconChevronDown,
  IconHelpCircle,
  IconMenu2,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { Link, matchPath, NavLink, useLocation, useNavigate } from 'react-router'
import { appConfig } from '../../config/app'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../features/auth/context'
import type { NavigationGroup, NavigationItem, NavigationSection } from './types'
import './top-navigation.css'

function isCurrent(item: NavigationItem, pathname: string): boolean {
  if (item.type === 'group') return item.children.some((child) => isCurrent(child, pathname))
  return matchPath({ path: item.to, end: item.end ?? true }, pathname) !== null
}

function firstLink(item: NavigationItem): string {
  if (item.type === 'link') return item.to
  return firstLink(item.children[0])
}

function linksOf(item: NavigationItem): { label: string; to: string; group: string }[] {
  if (item.type === 'link') return [{ label: item.label, to: item.to, group: '' }]
  return item.children.flatMap((child) =>
    linksOf(child).map((link) => ({ ...link, group: item.label })),
  )
}

export function TopNavigation({ sections }: { sections: readonly NavigationSection[] }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountError, setAccountError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const groups = sections
    .flatMap((section) => section.items)
    .filter((item): item is NavigationGroup => item.type === 'group')
  const currentGroup =
    (pathname === '/' ? groups.find((group) => group.id === 'sales') : undefined) ??
    groups.find((group) => isCurrent(group, pathname)) ??
    groups[0]
  const searchable = groups.flatMap(linksOf)
  const results = query.trim()
    ? searchable.filter((item) =>
        `${item.group} ${item.label}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : []

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    if (!results[0]) return
    navigate(results[0].to)
    setQuery('')
    setSearchOpen(false)
  }

  function closeMenus() {
    setMobileOpen(false)
    setAccountOpen(false)
  }

  return (
    <header className="top-navigation">
      <div className="top-navigation-main">
        <Link to="/" className="top-navigation-brand" onClick={closeMenus}>
          <span>{appConfig.name}</span>
        </Link>
        <nav className={`top-navigation-groups${mobileOpen ? ' is-open' : ''}`} aria-label="主导航">
          {groups.map((group) => {
            return (
              <Link
                key={group.id}
                to={firstLink(group)}
                className={group.id === currentGroup.id ? 'active' : ''}
                onClick={closeMenus}
              >
                {group.label}
              </Link>
            )
          })}
        </nav>
        <form className="top-navigation-search" onSubmit={submitSearch}>
          <IconSearch size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="搜索页面"
            placeholder="搜索客户、SKU、报价或功能…"
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchOpen(false)
                searchRef.current?.blur()
              }
            }}
          />
          <kbd>⌘ K</kbd>
          {searchOpen && query.trim() && (
            <div className="top-navigation-search-results">
              {results.length ? (
                results.map((item) => (
                  <button
                    key={item.to}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      navigate(item.to)
                      setQuery('')
                      setSearchOpen(false)
                    }}
                  >
                    <span>{item.label}</span>
                    <small>{item.group}</small>
                  </button>
                ))
              ) : (
                <p>没有匹配的功能</p>
              )}
            </div>
          )}
        </form>
        <div className="top-navigation-utilities">
          <button type="button" aria-label="帮助">
            <IconHelpCircle size={20} />
            <span>帮助</span>
          </button>
          <button type="button" className="top-navigation-notifications" aria-label="通知">
            <IconBell size={21} />
            <i />
          </button>
        </div>
        <div className="top-navigation-account">
          <button
            type="button"
            className="top-navigation-account-trigger"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((value) => !value)}
          >
            <span className="top-navigation-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
            <span>{user.username}</span>
            <IconChevronDown size={15} aria-hidden="true" />
          </button>
          {accountOpen && (
            <div className="top-navigation-account-menu">
              <strong>{user.username}</strong>
              <small>{{ admin: '管理员', editor: '编辑员', viewer: '只读账号' }[user.role]}</small>
              <button
                type="button"
                onClick={() => {
                  setAccountError('')
                  void logout().catch((cause) => setAccountError(errorMessage(cause)))
                }}
              >
                退出登录
              </button>
              {accountError && <p role="alert">{accountError}</p>}
            </div>
          )}
        </div>
        <button
          type="button"
          className="top-navigation-mobile-toggle"
          aria-label={mobileOpen ? '收起导航' : '展开导航'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <IconX size={22} /> : <IconMenu2 size={22} />}
        </button>
      </div>
      <nav className="top-navigation-secondary" aria-label={`${currentGroup.label}模块导航`}>
        {currentGroup.children.map((item) =>
          item.type === 'link' ? (
            <NavLink key={item.id} to={item.to} end={item.end ?? true} onClick={closeMenus}>
              {item.label}
            </NavLink>
          ) : null,
        )}
      </nav>
    </header>
  )
}
