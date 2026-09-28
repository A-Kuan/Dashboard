import { assetPath } from '../utils/assetPath'

const collectionUrl = assetPath('api/v1/skus')

async function request(path = '', options = {}) {
  const response = await fetch(`${collectionUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'SKU 服务暂时不可用')
  return body
}

export async function listSkus({ signal, query = '' } = {}) {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  const result = await request(suffix, { signal })
  return result.items || []
}

export function getSku(id, { signal } = {}) {
  return request(`/${encodeURIComponent(id)}`, { signal })
}

export function createSku(input) {
  return request('', { method: 'POST', body: JSON.stringify(input) })
}

export function updateSku(id, input) {
  return request(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function publishSku(id, input) {
  return request(`/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify(input) })
}

export function validateSkuCode(skuCode, exceptId = null) {
  return request('/validate-code', { method: 'POST', body: JSON.stringify({ skuCode, exceptId }) })
}
