import { lstat, readFile, readdir, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const manifestSuffix = '.manifest.json'

function isoWeek(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7)
  return `${value.getUTCFullYear()}-${String(week).padStart(2, '0')}`
}

async function regularFile(path) {
  try {
    const information = await lstat(path)
    return information.isFile() && !information.isSymbolicLink()
  } catch {
    return false
  }
}

async function scheduledSet(directory, manifestName) {
  if (!manifestName.endsWith(manifestSuffix) || basename(manifestName) !== manifestName) return null
  const manifestPath = resolve(directory, manifestName)
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { return null }
  if (manifest.manifestVersion !== 'dashboard-postgres-backup-v1' || manifest.purpose !== 'scheduled' || !manifest.assetArchive) return null
  const createdAt = new Date(manifest.createdAt)
  if (!Number.isFinite(createdAt.getTime())) return null

  const base = manifestName.slice(0, -manifestSuffix.length)
  if (manifest.archive?.filename !== `${base}.dump` || manifest.assetArchive.filename !== `${base}.epc-assets.tar.gz`) return null
  const archivePath = resolve(directory, manifest.archive.filename)
  const assetPath = resolve(directory, manifest.assetArchive.filename)
  if (![manifestPath, archivePath, assetPath].every((path) => resolve(path).startsWith(`${resolve(directory)}/`))) return null
  if (!(await regularFile(manifestPath)) || !(await regularFile(archivePath)) || !(await regularFile(assetPath))) return null
  const receiptPath = resolve(directory, `${base}.offsite.json`)
  return { base, createdAt, manifestPath, archivePath, assetPath, receiptPath: await regularFile(receiptPath) ? receiptPath : null }
}

function integerSetting(value, name, minimum) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  return parsed
}

export async function planScheduledBackupRetention({ directory, keepRecent = 14, keepWeekly = 8, minimumAgeHours = 24, now = () => Date.now() }) {
  const backupDirectory = resolve(directory)
  if (backupDirectory === '/') throw new Error('Refusing to manage backups in the filesystem root')
  const recentCount = integerSetting(keepRecent, 'keepRecent', 1)
  const weeklyCount = integerSetting(keepWeekly, 'keepWeekly', 0)
  const minimumAge = integerSetting(minimumAgeHours, 'minimumAgeHours', 0) * 60 * 60 * 1000
  const entries = await readdir(backupDirectory)
  const inspected = await Promise.all(entries.filter((name) => name.endsWith(manifestSuffix)).map((name) => scheduledSet(backupDirectory, name)))
  const sets = inspected.filter(Boolean).sort((left, right) => right.createdAt - left.createdAt)
  const protectedBases = new Set(sets.slice(0, recentCount).map((set) => set.base))

  const protectedWeeks = new Set()
  for (const set of sets) {
    const week = isoWeek(set.createdAt)
    if (protectedWeeks.has(week) || protectedWeeks.size >= weeklyCount) continue
    protectedWeeks.add(week)
    protectedBases.add(set.base)
  }
  for (const set of sets) {
    if (now() - set.createdAt.getTime() < minimumAge) protectedBases.add(set.base)
  }

  const serialize = (set, reason = '') => ({ base: set.base, createdAt: set.createdAt.toISOString(), ...(reason ? { reason } : {}) })
  return {
    policy: { keepRecent: recentCount, keepWeekly: weeklyCount, minimumAgeHours: minimumAge / 3600000 },
    managedSets: sets.length,
    kept: sets.filter((set) => protectedBases.has(set.base)).map((set) => serialize(set, sets.indexOf(set) < recentCount ? 'recent' : 'weekly_or_minimum_age')),
    deletable: sets.filter((set) => !protectedBases.has(set.base)).map((set) => ({ ...serialize(set), files: [set.archivePath, set.assetPath, set.manifestPath, set.receiptPath].filter(Boolean) })),
  }
}

export async function pruneScheduledBackups({ directory, apply = false, maxDeleteSets = 30, ...policy }) {
  const maximum = integerSetting(maxDeleteSets, 'maxDeleteSets', 1)
  const plan = await planScheduledBackupRetention({ directory, ...policy })
  if (plan.deletable.length > maximum) throw new Error(`Retention plan would delete ${plan.deletable.length} sets; maximum per run is ${maximum}`)
  if (apply) {
    for (const set of plan.deletable) {
      for (const path of set.files) await unlink(path)
    }
  }
  return { ...plan, applied: Boolean(apply), deletedSets: apply ? plan.deletable.length : 0 }
}
