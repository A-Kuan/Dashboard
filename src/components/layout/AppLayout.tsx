import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { appConfig } from '../../config/app'
import { navigation } from '../../config/navigation'
import { Sidebar } from '../navigation/Sidebar'
import './layout.css'

export function AppLayout() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = `${pathname === '/' ? '首页' : '页面未找到'} · ${appConfig.name}`
  }, [pathname])

  return (
    <div className="app-layout">
      <Sidebar sections={navigation} />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
