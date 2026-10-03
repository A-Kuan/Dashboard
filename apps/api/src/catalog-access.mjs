import { createHash, timingSafeEqual } from 'node:crypto'

const roleDefinitions = {
  catalog_viewer: {
    label: '只读查看',
    capabilities: ['catalog.read', 'business.read'],
  },
  catalog_editor: {
    label: '资料录入',
    capabilities: ['catalog.read', 'catalog.edit', 'catalog.import', 'catalog.submit', 'catalog.bulk', 'catalog.migration.plan', 'business.read', 'business.manage', 'business.quote', 'business.order', 'business.inventory', 'business.finance', 'business.after_sales', 'business.purchase_return'],
  },
  catalog_reviewer: {
    label: '资料审核',
    capabilities: ['catalog.read', 'catalog.review', 'catalog.review_fitment', 'catalog.resolve_fitment_conflict', 'catalog.assign', 'catalog.resolve_conflict', 'catalog.bulk', 'catalog.migration.review', 'catalog.migration.accept', 'business.read', 'business.quote.approve', 'business.after_sales.review', 'business.purchase_return.review'],
  },
  catalog_admin: {
    label: '资料管理员',
    capabilities: ['catalog.read', 'catalog.edit', 'catalog.import', 'catalog.submit', 'catalog.review', 'catalog.review_fitment', 'catalog.resolve_fitment_conflict', 'catalog.manage_platform', 'catalog.assign', 'catalog.resolve_conflict', 'catalog.merge', 'catalog.export', 'catalog.restore', 'catalog.lifecycle', 'catalog.bulk', 'catalog.configure', 'catalog.migration.plan', 'catalog.migration.review', 'catalog.migration.execute', 'catalog.migration.accept', 'business.read', 'business.manage', 'business.customer.merge', 'business.customer.vehicle.merge', 'business.quote', 'business.quote.approve', 'business.policy', 'business.order', 'business.inventory', 'business.finance', 'business.after_sales', 'business.after_sales.review', 'business.purchase_return', 'business.purchase_return.review'],
  },
}

export const catalogRoles = Object.fromEntries(Object.entries(roleDefinitions).map(([key, value]) => [key, { id: key, ...value }]))

function header(request, name) {
  return String(request.headers[name] || '').trim()
}

function decodedHeader(request, name) {
  const value = header(request, name)
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false
  const actualHash = createHash('sha256').update(actual).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function validIdentityValue(value, maximum = 128) {
  return Boolean(value) && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
}

export function resolveCatalogActor(request, environment = process.env) {
  const development = environment.NODE_ENV !== 'production'
  const proxyConfigured = !development && environment.TRUST_PROXY_IDENTITY === '1'
  const trustsIdentity = development || (proxyConfigured && secretsMatch(header(request, 'x-catalog-identity-secret'), String(environment.TRUST_PROXY_IDENTITY_SECRET || '')))
  const requestedRole = trustsIdentity ? header(request, 'x-operator-role') : ''
  const requestedName = trustsIdentity ? decodedHeader(request, 'x-operator-name') : ''
  const requestedId = trustsIdentity ? header(request, 'x-operator-id') : ''
  const validTrustedIdentity = trustsIdentity && catalogRoles[requestedRole] && validIdentityValue(requestedId) && validIdentityValue(requestedName, 160)
  const role = development ? (catalogRoles[requestedRole] ? requestedRole : 'catalog_admin') : validTrustedIdentity ? requestedRole : 'catalog_viewer'
  const id = development ? (validIdentityValue(requestedId) ? requestedId : `development:${role}`) : validTrustedIdentity ? requestedId : 'anonymous'
  const name = development ? (requestedName || 'hushanxing-workbench') : validTrustedIdentity ? requestedName : '只读访客'
  return {
    id,
    name,
    email: validTrustedIdentity ? header(request, 'x-operator-email') : '',
    identityProvider: development ? 'development' : validTrustedIdentity ? (header(request, 'x-identity-provider') || 'trusted-proxy') : '',
    authenticated: development || validTrustedIdentity,
    authMode: development ? 'development-bypass' : validTrustedIdentity ? 'trusted-proxy' : 'anonymous-readonly',
    role,
    roleLabel: catalogRoles[role].label,
    capabilities: catalogRoles[role].capabilities,
    development,
  }
}

export function requireCatalogCapability(request, reply, capability, environment = process.env) {
  const actor = resolveCatalogActor(request, environment)
  if (actor.capabilities.includes(capability)) return actor
  reply.code(403).send({
    error: 'CATALOG_PERMISSION_DENIED',
    message: `${actor.roleLabel}无权执行此操作`,
    details: { capability, role: actor.role, authenticated: actor.authenticated },
  })
  return null
}
