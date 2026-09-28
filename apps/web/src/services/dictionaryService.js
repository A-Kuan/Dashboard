import { assetPath } from '../utils/assetPath'

export const ALL_DICTIONARY_VALUE = '__all__'

export function generateDictionaryValue(dictionaryCode, existingValues = []) {
  const prefix = dictionaryCode.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'DICTIONARY'
  const existing = new Set(existingValues)
  let value

  do {
    const identifier = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().replaceAll('-', '').toUpperCase()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.toUpperCase()
    value = `${prefix}_${identifier}`
  } while (existing.has(value))

  return value
}

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

async function writeDictionaries(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    method: options.method || 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `字典保存失败 (${response.status})`)
  return normalizeDictionaries(payload)
}

export async function fetchDictionaries({ signal } = {}) {
  const configuredEndpoint = dictionaryEndpoint()
  const localEndpoint = assetPath('config/dictionaries.json')

  try {
    return await requestDictionaries(configuredEndpoint, signal)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    console.warn(`字典接口不可用，改用本地配置：${error.message}`)
  }

  return requestDictionaries(localEndpoint, signal)
}

export function saveDictionariesToServer(dictionaries) {
  return writeDictionaries(dictionaryEndpoint(), { body: { version: 1, dictionaries } })
}

export function resetDictionariesOnServer() {
  return writeDictionaries(`${dictionaryEndpoint().replace(/\/$/, '')}/reset`, { method: 'POST' })
}

function dictionaryEndpoint() {
  return import.meta.env.VITE_DICTIONARY_ENDPOINT || assetPath('api/v1/dictionaries')
}
