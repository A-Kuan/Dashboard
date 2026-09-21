import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { appConfig } from '../../config/app'

export function AppLayout() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = `${pathname === '/' ? '首页' : '页面未找到'} · ${appConfig.name}`
  }, [pathname])

  return (
    <>
      <header>
        <nav aria-label="主导航">
          <Link to="/">{appConfig.name}</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
