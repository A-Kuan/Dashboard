import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { appConfig } from '../../config/app'
import { TopNavigation } from '../navigation/TopNavigation'
import './layout.css'

export function AppLayout() {
  const { pathname } = useLocation()

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
      )[pathname] ??
      (pathname.startsWith('/vehicles/')
        ? '车型代际详情'
        : pathname.startsWith('/customers/') && pathname.endsWith('/garage')
          ? '客户车辆工作台'
          : '页面未找到')
    document.title = `${pageTitle} · ${appConfig.name}`
  }, [pathname])

  return (
    <div className="app-layout">
      <TopNavigation />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
