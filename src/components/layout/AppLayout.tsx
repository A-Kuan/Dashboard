import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { appConfig } from '../../config/app'
import { navigation } from '../../config/navigation'
import { Sidebar } from '../navigation/Sidebar'
import type { NavigationItem } from '../navigation/types'
import './layout.css'
import { AccountFooter } from '../../features/auth/Auth'
import { useAuth } from '../../features/auth/context'

function visibleItem(item: NavigationItem, isAdmin: boolean): NavigationItem | null {
  if (item.type === 'link') return item.id === 'accounts' && !isAdmin ? null : item
  const children = item.children
    .map((child) => visibleItem(child, isAdmin))
    .filter((child): child is NavigationItem => child !== null)
  return children.length ? { ...item, children } : null
}

export function AppLayout() {
  const { pathname } = useLocation()
  const { user } = useAuth()

  useEffect(() => {
    const pageTitle =
      (
        {
          '/': '首页',
          '/quotes/templates': '报价模板',
          '/skus': '汽配 SKU',
          '/customers': '客户项目',
          '/settings/accounts': '账号管理',
          '/sku-foundation': '商品基础字典',
        } as Record<string, string>
      )[pathname] ?? '页面未找到'
    document.title = `${pageTitle} · ${appConfig.name}`
  }, [pathname])

  return (
    <div className="app-layout">
      <Sidebar
        sections={navigation.map((section) => ({
          ...section,
          items: section.items
            .map((item) => visibleItem(item, user.role === 'admin'))
            .filter((item): item is NavigationItem => item !== null),
        }))}
        footer={<AccountFooter />}
      />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
