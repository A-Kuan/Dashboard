import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planScheduledBackupRetention, pruneScheduledBackups } from '../src/backup-retention.mjs'

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function backupSet(directory, { index, createdAt, purpose = 'scheduled', withAssets = true }) {
  const compact = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const base = `${compact}-${String(index).padStart(8, '0')}-dashboard_sku`
  const dump = `${base}.dump`
  const asset = `${base}.epc-assets.tar.gz`
  const manifest = `${base}.manifest.json`
  await writeFile(join(directory, dump), `dump-${index}`)
  if (withAssets) await writeFile(join(directory, asset), `assets-${index}`)
  await writeFile(join(directory, manifest), `${JSON.stringify({
    manifestVersion: 'dashboard-postgres-backup-v1', createdAt: createdAt.toISOString(), purpose,
    archive: { filename: dump }, assetArchive: withAssets ? { filename: asset } : null,
  })}\n`)
  return { base, dump: join(directory, dump), asset: join(directory, asset), manifest: join(directory, manifest) }
}

test('retains recent and weekly scheduled sets without touching release or incomplete backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-retention-'))
  try {
    const now = Date.parse('2026-10-02T12:00:00.000Z')
    const scheduled = []
    for (let index = 0; index < 45; index += 1) {
      scheduled.push(await backupSet(directory, { index, createdAt: new Date(now - index * 86400000) }))
    }
    const release = await backupSet(directory, { index: 99, createdAt: new Date(now - 100 * 86400000), purpose: 'release' })
    const incomplete = await backupSet(directory, { index: 98, createdAt: new Date(now - 101 * 86400000), withAssets: false })

    const dryRun = await pruneScheduledBackups({ directory, keepRecent: 14, keepWeekly: 8, minimumAgeHours: 24, now: () => now })
    assert.equal(dryRun.applied, false)
    assert.equal(dryRun.managedSets, 45)
    assert.ok(dryRun.deletable.length > 0)
    assert.ok(await exists(dryRun.deletable[0].files[0]))
    assert.ok(dryRun.kept.some((set) => set.base === scheduled[0].base))
    assert.ok(dryRun.kept.some((set) => scheduled.slice(14).some((candidate) => candidate.base === set.base)))

    const applied = await pruneScheduledBackups({ directory, apply: true, keepRecent: 14, keepWeekly: 8, minimumAgeHours: 24, now: () => now })
    assert.equal(applied.deletedSets, dryRun.deletable.length)
    assert.equal(await exists(applied.deletable[0].files[0]), false)
    assert.equal(await exists(applied.deletable[0].files[2]), false)
    assert.ok(await exists(release.dump))
    assert.ok(await exists(release.manifest))
    assert.ok(await exists(incomplete.dump))
    assert.ok(await exists(incomplete.manifest))
    assert.match(await readFile(release.manifest, 'utf8'), /"purpose":"release"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('refuses an unexpectedly broad deletion plan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-retention-limit-'))
  try {
    const now = Date.parse('2026-10-02T12:00:00.000Z')
    for (let index = 0; index < 12; index += 1) {
      await backupSet(directory, { index, createdAt: new Date(now - index * 8 * 86400000) })
    }
    const plan = await planScheduledBackupRetention({ directory, keepRecent: 1, keepWeekly: 0, minimumAgeHours: 0, now: () => now })
    assert.equal(plan.deletable.length, 11)
    await assert.rejects(pruneScheduledBackups({ directory, apply: true, keepRecent: 1, keepWeekly: 0, minimumAgeHours: 0, maxDeleteSets: 3, now: () => now }), /maximum per run is 3/)
    assert.ok(await exists(plan.deletable[0].files[0]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
