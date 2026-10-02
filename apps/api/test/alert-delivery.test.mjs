import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deliverOperationalAlert } from '../src/alert-delivery.mjs'

test('deduplicates repeated operational alerts during the configured cooldown', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'dashboard-alert-'))
  try {
    const calls = []
    const environment = { ALERT_WEBHOOK_URL: 'https://alerts.test/hook', ALERT_COOLDOWN_SECONDS: '1800' }
    const send = async ({ source }) => { calls.push(source); return { status: 'sent', source } }
    const first = await deliverOperationalAlert({ source: 'operations/check', environment, stateDirectory, now: () => new Date('2026-10-02T10:00:00.000Z'), send })
    const repeated = await deliverOperationalAlert({ source: 'operations/check', environment, stateDirectory, now: () => new Date('2026-10-02T10:05:00.000Z'), send })
    const later = await deliverOperationalAlert({ source: 'operations/check', environment, stateDirectory, now: () => new Date('2026-10-02T10:31:00.000Z'), send })
    assert.equal(first.status, 'sent')
    assert.equal(repeated.status, 'suppressed')
    assert.equal(repeated.nextEligibleAt, '2026-10-02T10:30:00.000Z')
    assert.equal(later.status, 'sent')
    assert.deepEqual(calls, ['operations_check', 'operations_check'])
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('does not write alert state while notifications are disabled', async () => {
  assert.deepEqual(await deliverOperationalAlert({ source: 'backup', environment: {}, send: async () => assert.fail('must not send') }), { status: 'disabled' })
})
