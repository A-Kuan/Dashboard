import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { appConfig } from '../../config/app'
import { navigation } from '../../config/navigation'
import { TopNavigation } from '../navigation/TopNavigation'
import type { NavigationItem } from '../navigation/types'
import './layout.css'
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
          '/vehicles': '保时捷车型库',
          '/customers': '客户项目',
          '/settings/accounts': '账号管理',
          '/settings/dictionaries': '配置中心字典',
          '/sku-foundation': '商品基础字典',
        } as Record<string, string>
      )[pathname] ?? (pathname.startsWith('/vehicles/') ? '车型代际详情' : '页面未找到')
    document.title = `${pageTitle} · ${appConfig.name}`
  }, [pathname])

  return (
    <div className="app-layout">
      <TopNavigation
        sections={navigation.map((section) => ({
          ...section,
          items: section.items
            .map((item) => visibleItem(item, user.role === 'admin'))
            .filter((item): item is NavigationItem => item !== null),
        }))}
      />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
