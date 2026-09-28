import { useCallback, useEffect, useState } from 'react'
import { fetchDictionaries, resetDictionariesOnServer, saveDictionariesToServer } from '../services/dictionaryService'

export function useDictionaries() {
  const [state, setState] = useState({ dictionaries: {}, loading: true, error: null })
  useEffect(() => {
    const controller = new AbortController()

    fetchDictionaries({ signal: controller.signal })
      .then((dictionaries) => {
        window.localStorage.removeItem('dashboard.dictionary-overrides.v1')
        setState({ dictionaries, loading: false, error: null })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ dictionaries: {}, loading: false, error })
      })

    return () => controller.abort()
  }, [])

  const saveDictionaries = useCallback(async (nextDictionaries) => {
    const dictionaries = await saveDictionariesToServer(nextDictionaries)
    setState({ dictionaries, loading: false, error: null })
    return dictionaries
  }, [])

  const resetDictionaries = useCallback(async () => {
    const dictionaries = await resetDictionariesOnServer()
    setState({ dictionaries, loading: false, error: null })
    return dictionaries
  }, [])

  return { ...state, saveDictionaries, resetDictionaries }
}
