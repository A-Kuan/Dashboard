const roleDefinitions = {
  catalog_viewer: {
    label: '只读查看',
    capabilities: ['catalog.read'],
  },
  catalog_editor: {
    label: '资料录入',
    capabilities: ['catalog.read', 'catalog.edit', 'catalog.import', 'catalog.submit', 'catalog.bulk'],
  },
  catalog_reviewer: {
    label: '资料审核',
    capabilities: ['catalog.read', 'catalog.review', 'catalog.assign', 'catalog.resolve_conflict', 'catalog.bulk'],
  },
  catalog_admin: {
    label: '资料管理员',
    capabilities: ['catalog.read', 'catalog.edit', 'catalog.import', 'catalog.submit', 'catalog.review', 'catalog.assign', 'catalog.resolve_conflict', 'catalog.merge', 'catalog.export', 'catalog.restore', 'catalog.lifecycle', 'catalog.bulk'],
  },
}

export const catalogRoles = Object.fromEntries(Object.entries(roleDefinitions).map(([key, value]) => [key, { id: key, ...value }]))

function header(request, name) {
  return String(request.headers[name] || '').trim()
}

export function resolveCatalogActor(request, environment = process.env) {
  const development = environment.NODE_ENV !== 'production'
  const trustsIdentity = development || environment.TRUST_PROXY_IDENTITY === '1'
  const requestedRole = trustsIdentity ? header(request, 'x-operator-role') : ''
  const role = catalogRoles[requestedRole] ? requestedRole : development ? 'catalog_admin' : 'catalog_viewer'
  const requestedName = trustsIdentity ? header(request, 'x-operator-name') : ''
  return {
    name: requestedName || (development ? 'hushanxing-workbench' : '只读访客'),
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
    details: { capability, role: actor.role },
  })
  return null
}
