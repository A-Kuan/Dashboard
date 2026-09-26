import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  IconBook2,
  IconBox,
  IconCalendar,
  IconCar,
  IconFileInvoice,
  IconLayoutGrid,
  IconMenu2,
  IconSearch,
  IconSettings,
  IconUser,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { appConfig } from '../../config/app'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../features/auth/context'
import './top-navigation.css'

const navigationItems = [
  { id: 'garage', label: '车辆工作台', to: '/customers', icon: IconCar },
  { id: 'customers', label: '客户', to: '/customers', icon: IconUsers },
  { id: 'skus', label: 'SKU 商品', to: '/skus', icon: IconBox },
  { id: 'quotes', label: '报价模板', to: '/quotes/templates', icon: IconFileInvoice },
  { id: 'vehicles', label: '车辆资料', to: '/vehicles', icon: IconCar },
  { id: 'dictionaries', label: '字典资料', to: '/sku-foundation', icon: IconBook2 },
] as const

function currentNavigation(pathname: string) {
  if (pathname.endsWith('/garage')) return 'garage'
  if (pathname.startsWith('/quotes')) return 'quotes'
  if (pathname.startsWith('/vehicles')) return 'vehicles'
  if (pathname.startsWith('/sku-foundation') || pathname.startsWith('/settings'))
    return 'dictionaries'
  if (pathname.startsWith('/skus')) return 'skus'
  if (pathname.startsWith('/customers')) return 'customers'
  return ''
}

export function TopNavigation() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountError, setAccountError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const ledgerMode = pathname === '/skus'
  const activeItem = currentNavigation(pathname)
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      })
        .format(new Date())
        .replaceAll('/', '-'),
    [],
  )
  const results = query.trim()
    ? navigationItems.filter((item) =>
        item.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : []

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value) return
    if (ledgerMode) {
      navigate(`/skus?search=${encodeURIComponent(value)}`)
    } else if (results[0]) {
      navigate(results[0].to)
      setQuery('')
    }
    setSearchOpen(false)
  }

  function closeMenus() {
    setMobileOpen(false)
    setAccountOpen(false)
  }

  return (
    <header className={`top-navigation${ledgerMode ? ' ledger-mode' : ''}`}>
      <div className="top-navigation-brand-block">
        <Link to={ledgerMode ? '/skus' : '/'} className="top-navigation-brand" onClick={closeMenus}>
          <span className="top-navigation-brand-mark">
            <IconLayoutGrid size={ledgerMode ? 21 : 19} stroke={2.1} />
          </span>
          <span className="top-navigation-wordmark">
            <strong>
              {ledgerMode
                ? 'Parts Ledger'
                : appConfig.name === 'Dashboard'
                  ? '上海驰骋汽配'
                  : appConfig.name}
            </strong>
            <small>{ledgerMode ? 'Porsche & Audi Parts' : 'Visual Garage Workbench'}</small>
          </span>
        </Link>
      </div>

      <nav className={`top-navigation-links${mobileOpen ? ' is-open' : ''}`} aria-label="主导航">
        {navigationItems.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              to={item.to}
              className={item.id === activeItem ? 'active' : ''}
              onClick={closeMenus}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <form className="top-navigation-search" onSubmit={submitSearch}>
        <IconSearch size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          aria-label={ledgerMode ? '全局搜索 SKU、品牌或供应商' : '搜索客户、车牌、VIN 或 SKU'}
          placeholder={ledgerMode ? '全局搜索 SKU、品牌、供应商…' : '搜索客户、车牌、VIN 或 SKU…'}
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
        <kbd>Ctrl K</kbd>
        {!ledgerMode && searchOpen && query.trim() && (
          <div className="top-navigation-search-results">
            {results.length ? (
              results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    navigate(item.to)
                    setQuery('')
                    setSearchOpen(false)
                  }}
                >
                  <span>{item.label}</span>
                  <small>前往</small>
                </button>
              ))
            ) : (
              <p>没有匹配的功能</p>
            )}
          </div>
        )}
      </form>

      <div className="top-navigation-utilities">
        <span className="top-navigation-date">
          <IconCalendar size={18} />
          {dateLabel}
        </span>
        <Link to="/sku-foundation" aria-label="设置" className="top-navigation-icon-button">
          <IconSettings size={20} />
        </Link>
        <div className="top-navigation-account">
          <button
            type="button"
            className="top-navigation-icon-button"
            aria-label="账号菜单"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((value) => !value)}
          >
            <IconUser size={20} />
          </button>
          {accountOpen && (
            <div className="top-navigation-account-menu">
              <strong>{user.username}</strong>
              <small>{{ admin: '管理员', editor: '编辑员', viewer: '只读账号' }[user.role]}</small>
              {user.role === 'admin' && <Link to="/settings/accounts">账号管理</Link>}
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
    </header>
  )
}
