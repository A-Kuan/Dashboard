import { createHmac } from 'node:crypto'
import { hostname } from 'node:os'

function dingTalkUrl(url, secret, timestamp) {
  if (!secret) return url
  const signature = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
  const signed = new URL(url)
  signed.searchParams.set('timestamp', String(timestamp))
  signed.searchParams.set('sign', signature)
  return signed.toString()
}

function payload(type, content) {
  if (type === 'dingtalk' || type === 'wecom') return { msgtype: 'text', text: { content } }
  if (type === 'generic') return { text: content }
  throw new Error('ALERT_WEBHOOK_TYPE must be dingtalk, wecom or generic')
}

export async function sendOperationalAlert({
  source,
  message = '服务检查失败，请查看服务器日志。',
  environment = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
  host = hostname(),
} = {}) {
  const url = String(environment.ALERT_WEBHOOK_URL || '').trim()
  if (!url) return { status: 'disabled' }
  const type = String(environment.ALERT_WEBHOOK_TYPE || 'dingtalk').trim().toLowerCase()
  const timestamp = now().getTime()
  const content = [
    '【虎山行 SKU 系统告警】',
    `来源：${String(source || 'unknown')}`,
    `主机：${host}`,
    `时间：${new Date(timestamp).toISOString()}`,
    `说明：${String(message).slice(0, 500)}`,
  ].join('\n')
  const target = type === 'dingtalk' ? dingTalkUrl(url, String(environment.ALERT_WEBHOOK_SECRET || '').trim(), timestamp) : url
  const response = await fetchImpl(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(type, content)),
    signal: AbortSignal.timeout(Number(environment.ALERT_TIMEOUT_MS || 10000)),
  })
  if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`)
  let responseBody = null
  try { responseBody = await response.json() } catch {}
  if ((type === 'dingtalk' || type === 'wecom') && Number(responseBody?.errcode) !== 0) {
    throw new Error(`Alert webhook rejected the notification with code ${responseBody?.errcode ?? 'unknown'}`)
  }
  return { status: 'sent', type, source: String(source || 'unknown') }
}
