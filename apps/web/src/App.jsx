import { useEffect, useState } from 'react'
import { SkuLibrary } from './components/SkuLibrary'
import { WorkbenchHome } from './components/WorkbenchHome'

export function App() {
  const [view, setView] = useState(() => window.location.hash === '#/sku' ? 'sku' : 'home')

  useEffect(() => {
    const handleHashChange = () => setView(window.location.hash === '#/sku' ? 'sku' : 'home')
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (nextView) => {
    window.location.hash = nextView === 'sku' ? '/sku' : '/'
    setView(nextView)
  }

  return view === 'sku' ? <SkuLibrary onNavigate={navigate} /> : <WorkbenchHome onNavigate={navigate} />
}
