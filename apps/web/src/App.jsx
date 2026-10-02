import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { SkuLibrary } from './components/SkuLibrary'
import { WorkbenchHome } from './components/WorkbenchHome'

export function App() {
  const [view, setView] = useState(() => window.location.hash === '#/sku' ? 'sku' : 'home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('hushanxing.sidebar.collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    const handleHashChange = () => setView(window.location.hash === '#/sku' ? 'sku' : 'home')
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (nextView) => {
    window.location.hash = nextView === 'sku' ? '/sku' : '/'
    setView(nextView)
  }

  const toggleSidebar = (event) => {
    const main = document.querySelector('.workbench-main, .sku-main')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const keyboardTriggered = event?.detail === 0
    const instant = reducedMotion || keyboardTriggered

    if (instant) document.documentElement.classList.add('sidebar-instant')

    if (main) {
      main.getAnimations().forEach((animation) => {
        animation.commitStyles()
        animation.cancel()
      })
    }

    const previousLeft = main?.getBoundingClientRect().left
    if (main) main.style.transform = 'none'

    flushSync(() => setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      try { window.localStorage.setItem('hushanxing.sidebar.collapsed', String(next)) } catch { /* preference storage is optional */ }
      return next
    }))

    if (main && previousLeft !== undefined && !instant) {
      const nextLeft = main.getBoundingClientRect().left
      main.animate(
        [{ transform: `translateX(${previousLeft - nextLeft}px)` }, { transform: 'translateX(0)' }],
        { duration: 220, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
      )
    }

    if (instant) window.requestAnimationFrame(() => document.documentElement.classList.remove('sidebar-instant'))
  }

  const sharedProps = { onNavigate: navigate, sidebarCollapsed, onToggleSidebar: toggleSidebar }
  return view === 'sku' ? <SkuLibrary {...sharedProps} /> : <WorkbenchHome {...sharedProps} />
}
