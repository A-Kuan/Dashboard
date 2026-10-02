import { readFile } from 'node:fs/promises'

export function normalizeReleaseRevision(value) {
  const revision = String(value ?? '').trim()
  if (!revision) return 'development'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(revision)) {
    const error = new Error('Release revision must use 1-80 safe identifier characters')
    error.code = 'INVALID_RELEASE_REVISION'
    throw error
  }
  return revision
}

export async function resolveReleaseRevision({ environment = process.env, revisionFile = new URL('../REVISION', import.meta.url) } = {}) {
  if (String(environment.RELEASE_REVISION || '').trim()) return normalizeReleaseRevision(environment.RELEASE_REVISION)
  try {
    return normalizeReleaseRevision(await readFile(revisionFile, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return 'development'
    throw error
  }
}
