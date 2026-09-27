import { useCallback, useEffect, useState } from 'react'
import { fetchDictionaries, normalizeDictionaries } from '../services/dictionaryService'

const STORAGE_KEY = 'dashboard.dictionary-overrides.v1'

export function useDictionaries() {
  const [state, setState] = useState({ dictionaries: {}, loading: true, error: null })
  const [defaults, setDefaults] = useState({})

  useEffect(() => {
    const controller = new AbortController()

    fetchDictionaries({ signal: controller.signal })
      .then((dictionaries) => {
        setDefaults(dictionaries)
        const saved = window.localStorage.getItem(STORAGE_KEY)
        if (!saved) {
          setState({ dictionaries, loading: false, error: null })
          return
        }

        try {
          const overridden = normalizeDictionaries(JSON.parse(saved))
          setState({ dictionaries: overridden, loading: false, error: null })
        } catch {
          window.localStorage.removeItem(STORAGE_KEY)
          setState({ dictionaries, loading: false, error: null })
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ dictionaries: {}, loading: false, error })
      })

    return () => controller.abort()
  }, [])

  const saveDictionaries = useCallback((nextDictionaries) => {
    const normalized = normalizeDictionaries({ dictionaries: nextDictionaries })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, dictionaries: normalized }))
    setState({ dictionaries: normalized, loading: false, error: null })
  }, [])

  const resetDictionaries = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    setState({ dictionaries: defaults, loading: false, error: null })
  }, [defaults])

  return { ...state, saveDictionaries, resetDictionaries }
}
