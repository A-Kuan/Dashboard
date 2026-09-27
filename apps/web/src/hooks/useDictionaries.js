import { useEffect, useState } from 'react'
import { fetchDictionaries } from '../services/dictionaryService'

export function useDictionaries() {
  const [state, setState] = useState({ dictionaries: {}, loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()

    fetchDictionaries({ signal: controller.signal })
      .then((dictionaries) => setState({ dictionaries, loading: false, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ dictionaries: {}, loading: false, error })
      })

    return () => controller.abort()
  }, [])

  return state
}
