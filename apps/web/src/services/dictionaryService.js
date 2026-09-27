import { assetPath } from '../utils/assetPath'

export const ALL_DICTIONARY_VALUE = '__all__'

function normalizeDictionary(dictionary, code) {
  if (!dictionary || !Array.isArray(dictionary.items)) {
    throw new Error(`字典 ${code} 缺少 items 数组`)
  }

  const items = dictionary.items
    .filter((item) => item && typeof item.value === 'string' && typeof item.label === 'string')
    .map((item) => ({ ...item, enabled: item.enabled !== false }))
    .sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0))

  return { label: dictionary.label || code, items }
}

export function normalizeDictionaries(payload) {
  if (!payload || typeof payload.dictionaries !== 'object' || payload.dictionaries === null) {
    throw new Error('字典响应缺少 dictionaries 对象')
  }

  return Object.fromEntries(Object.entries(payload.dictionaries).map(([code, dictionary]) => [code, normalizeDictionary(dictionary, code)]))
}

async function requestDictionaries(endpoint, signal) {
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal })

  if (!response.ok) {
    throw new Error(`字典加载失败 (${response.status})`)
  }

  return normalizeDictionaries(await response.json())
}

export async function fetchDictionaries({ signal } = {}) {
  const configuredEndpoint = import.meta.env.VITE_DICTIONARY_ENDPOINT
  const localEndpoint = assetPath('config/dictionaries.json')

  if (configuredEndpoint) {
    try {
      return await requestDictionaries(configuredEndpoint, signal)
    } catch (error) {
      if (error.name === 'AbortError') throw error
      console.warn(`字典接口不可用，改用本地配置：${error.message}`)
    }
  }

  return requestDictionaries(localEndpoint, signal)
}
