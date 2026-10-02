import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeReleaseRevision, resolveReleaseRevision } from '../src/release-info.mjs'

test('resolves release revision from environment before the immutable release file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-release-info-'))
  const revisionFile = join(directory, 'REVISION')
  await writeFile(revisionFile, 'file-revision\n')

  assert.equal(await resolveReleaseRevision({ environment: { RELEASE_REVISION: 'env-revision' }, revisionFile }), 'env-revision')
  assert.equal(await resolveReleaseRevision({ environment: {}, revisionFile }), 'file-revision')
})

test('uses a clear development marker when no release metadata exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-release-info-missing-'))
  assert.equal(await resolveReleaseRevision({ environment: {}, revisionFile: join(directory, 'REVISION') }), 'development')
})

test('rejects unsafe or ambiguous release identifiers', () => {
  assert.equal(normalizeReleaseRevision(' 1c69b5b '), '1c69b5b')
  assert.throws(() => normalizeReleaseRevision('bad revision'), { code: 'INVALID_RELEASE_REVISION' })
  assert.throws(() => normalizeReleaseRevision('../main'), { code: 'INVALID_RELEASE_REVISION' })
})
