import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { sendOperationalAlert } from '../src/webhook-alert.mjs'

test('stays disabled without a webhook and signs DingTalk notifications without exposing the secret in the body', async () => {
  assert.deepEqual(await sendOperationalAlert({ source: 'backup', environment: {} }), { status: 'disabled' })
  const requests = []
  const now = new Date('2026-10-02T10:00:00.000Z')
  const result = await sendOperationalAlert({
    source: 'backup.service', message: 'backup failed', now: () => now, host: 'sku-server',
    environment: {
      ALERT_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=token',
      ALERT_WEBHOOK_TYPE: 'dingtalk', ALERT_WEBHOOK_SECRET: 'secret-value',
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, status: 200, json: async () => ({ errcode: 0 }) }
    },
  })
  assert.equal(result.status, 'sent')
  assert.equal(requests.length, 1)
  const requestUrl = new URL(requests[0].url)
  const expectedSignature = createHmac('sha256', 'secret-value').update(`${now.getTime()}\nsecret-value`).digest('base64')
  assert.equal(requestUrl.searchParams.get('sign'), expectedSignature)
  const body = JSON.parse(requests[0].options.body)
  assert.match(body.text.content, /虎山行工作台告警/)
  assert.match(body.text.content, /backup failed/)
  assert.doesNotMatch(requests[0].options.body, /secret-value/)
})

test('fails when the webhook rejects a notification', async () => {
  await assert.rejects(sendOperationalAlert({
    source: 'operations-check',
    environment: { ALERT_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/webhook/send?key=test', ALERT_WEBHOOK_TYPE: 'wecom' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errcode: 93000 }) }),
  }), /code 93000/)
})
