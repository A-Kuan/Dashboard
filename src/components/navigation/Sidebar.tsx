import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconChevronDown, IconLayoutDashboard, IconMenu2, IconX } from '@tabler/icons-react'
import { Link, matchPath, NavLink, useLocation } from 'react-router'
import { appConfig } from '../../config/app'
import type { NavigationGroup, NavigationItem, NavigationSection } from './types'
import './sidebar.css'

function containsCurrentPage(item: NavigationItem, pathname: string): boolean {
  if (item.type === 'group') {
    return item.children.some((child) => containsCurrentPage(child, pathname))
  }
  return matchPath({ path: item.to, end: item.end ?? true }, pathname) !== null
}

function ItemLabel({ item }: { item: NavigationItem }) {
  const Icon = item.icon
  return (
    <>
      {Icon && <Icon className="sidebar-icon" size={22} stroke={1.8} aria-hidden="true" />}
      <span className="sidebar-label">{item.label}</span>
      {item.badge !== undefined && <span className="sidebar-badge">{item.badge}</span>}
    </>
  )
}

function Group({ item, onNavigate }: { item: NavigationGroup; onNavigate: () => void }) {
  const { pathname } = useLocation()
  const isCurrent = containsCurrentPage(item, pathname)
  const [isOpen, setIsOpen] = useState(item.defaultOpen ?? isCurrent)
  const childrenId = useId()
  const trigger = useRef<HTMLButtonElement>(null)

  function handleEscape(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation()
      setIsOpen(false)
      trigger.current?.focus()
    }
  }

  return (
    <li className="sidebar-item sidebar-group" onKeyDown={handleEscape}>
      <button
        ref={trigger}
        type="button"
        className={`sidebar-row sidebar-group-trigger${isCurrent ? ' is-current' : ''}`}
        aria-expanded={isOpen}
        aria-controls={childrenId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <ItemLabel item={item} />
        <IconChevronDown
          className={`sidebar-chevron${isOpen ? ' is-open' : ''}`}
          size={16}
          stroke={2}
          aria-hidden="true"
        />
      </button>
      <ul id={childrenId} className="sidebar-children" hidden={!isOpen}>
        {item.children.map((child) => (
          <Item key={child.id} item={child} onNavigate={onNavigate} />
        ))}
      </ul>
    </li>
  )
}

function Item({ item, onNavigate }: { item: NavigationItem; onNavigate: () => void }) {
  const { pathname } = useLocation()
  if (item.type === 'group') return <Group key={pathname} item={item} onNavigate={onNavigate} />

  return (
    <li className="sidebar-item">
      <NavLink
        to={item.to}
        end={item.end ?? true}
        className={({ isActive }) => `sidebar-row sidebar-link${isActive ? ' is-current' : ''}`}
        onClick={onNavigate}
      >
        <ItemLabel item={item} />
      </NavLink>
    </li>
  )
}

export function Sidebar({
  sections,
  footer,
}: {
  sections: readonly NavigationSection[]
  footer?: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuId = useId()
  const menuButton = useRef<HTMLButtonElement>(null)

  function closeAfterNavigation() {
    setMobileOpen(false)
    if (window.matchMedia('(max-width: 720px)').matches) {
      menuButton.current?.focus()
    }
  }

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && mobileOpen) {
      setMobileOpen(false)
      menuButton.current?.focus()
    }
  }

  return (
    <aside className="sidebar" aria-label="侧边导航" onKeyDown={closeOnEscape}>
      <div className="sidebar-heading">
        <Link
          to="/"
          className="sidebar-brand"
          onClick={closeAfterNavigation}
          aria-label={`${appConfig.name} 首页`}
        >
          <IconLayoutDashboard size={36} stroke={1.8} aria-hidden="true" />
          <span>{appConfig.name}</span>
        </Link>
        <button
          ref={menuButton}
          className="sidebar-mobile-toggle"
          type="button"
          aria-label={mobileOpen ? '收起导航' : '展开导航'}
          aria-expanded={mobileOpen}
          aria-controls={menuId}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? (
            <IconX size={22} aria-hidden="true" />
          ) : (
            <IconMenu2 size={22} aria-hidden="true" />
          )}
        </button>
      </div>
      <nav
        id={menuId}
        className={`sidebar-menu${mobileOpen ? ' is-mobile-open' : ''}`}
        aria-label="主导航"
      >
        {sections.map((section) => (
          <section className="sidebar-section" key={section.id} aria-label={section.label}>
            {section.label && <h2 className="sidebar-section-label">{section.label}</h2>}
            <ul className="sidebar-list">
              {section.items.map((item) => (
                <Item key={item.id} item={item} onNavigate={closeAfterNavigation} />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      {footer}
    </aside>
  )
}
