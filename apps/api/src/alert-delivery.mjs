import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sendOperationalAlert } from './webhook-alert.mjs'

function safeSource(value) {
  const source = String(value || 'unknown').replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 160)
  return source || 'unknown'
}

export async function deliverOperationalAlert({
  source,
  environment = process.env,
  stateDirectory = environment.ALERT_STATE_DIR || '/var/lib/dashboard-sku-alert',
  now = () => new Date(),
  send = sendOperationalAlert,
  message,
  dedupeKey = '',
  cooldownSeconds: cooldownOverride,
} = {}) {
  const normalizedSource = safeSource(source)
  if (!String(environment.ALERT_WEBHOOK_URL || '').trim()) return { status: 'disabled' }
  const cooldownSeconds = Number(cooldownOverride ?? environment.ALERT_COOLDOWN_SECONDS ?? 1800)
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400) {
    throw new Error('ALERT_COOLDOWN_SECONDS must be an integer between 0 and 86400')
  }
  const timestamp = now()
  const normalizedDedupeKey = String(dedupeKey || '').slice(0, 256)
  const statePath = resolve(stateDirectory, `${normalizedSource}.json`)
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    const elapsed = timestamp.getTime() - Date.parse(state.sentAt)
    if (String(state.dedupeKey || '') === normalizedDedupeKey && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < cooldownSeconds * 1000) {
      return { status: 'suppressed', source: normalizedSource, nextEligibleAt: new Date(Date.parse(state.sentAt) + cooldownSeconds * 1000).toISOString() }
    }
  } catch {}

  const result = await send({ source: normalizedSource, message, environment, now: () => timestamp })
  if (result.status !== 'sent') return result
  await mkdir(stateDirectory, { recursive: true, mode: 0o750 })
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ source: normalizedSource, dedupeKey: normalizedDedupeKey, sentAt: timestamp.toISOString() })}\n`, { mode: 0o600 })
  await chmod(temporaryPath, 0o600)
  await rename(temporaryPath, statePath)
  return result
}

export async function clearOperationalAlertState({ source, environment = process.env, stateDirectory = environment.ALERT_STATE_DIR || '/var/lib/dashboard-sku-alert' } = {}) {
  const normalizedSource = safeSource(source)
  const statePath = resolve(stateDirectory, `${normalizedSource}.json`)
  await rm(statePath, { force: true })
  return { status: 'clear', source: normalizedSource }
}
