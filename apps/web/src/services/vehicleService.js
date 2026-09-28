import { assetPath } from '../utils/assetPath'

const collectionUrl = assetPath('api/v1/vehicles')

async function request(path = '', options = {}) {
  const response = await fetch(`${collectionUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || '车型库服务暂时不可用')
  return body
}

export async function listVehicles({ signal, query = '' } = {}) {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  const result = await request(suffix, { signal })
  return result.items || []
}

export function getVehicle(id, { signal } = {}) {
  return request(`/${encodeURIComponent(id)}`, { signal })
}

export function createVehicle(input) {
  return request('', { method: 'POST', body: JSON.stringify(input) })
}

export function updateVehicle(id, input) {
  return request(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function publishVehicle(id, input) {
  return request(`/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify(input) })
}

export function autoMatchVehicle(id) {
  return request(`/${encodeURIComponent(id)}/auto-match`, { method: 'POST', body: '{}' })
}
