import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.mjs'
import { createHttpMetrics, createLoggerOptions, createRequestId, isOperationsRequestAuthorized } from '../src/observability.mjs'

test('accepts only bounded safe request IDs and generates a replacement otherwise', () => {
  assert.equal(createRequestId({ headers: { 'x-request-id': 'edge:sku-123.4' } }), 'edge:sku-123.4')
  assert.match(createRequestId({ headers: { 'x-request-id': 'unsafe request id' } }), /^[0-9a-f-]{36}$/)
  assert.match(createRequestId({ headers: {} }), /^[0-9a-f-]{36}$/)
})

test('returns request IDs to callers and includes them in safe errors', async () => {
  const app = buildApp({ logger: false })
  const health = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'client-trace-42' } })
  assert.equal(health.headers['x-request-id'], 'client-trace-42')

  const failure = await app.inject({ method: 'POST', url: '/api/v1/skus', headers: { 'x-request-id': 'invalid id' }, payload: {} })
  assert.equal(failure.statusCode, 400)
  assert.match(failure.headers['x-request-id'], /^[0-9a-f-]{36}$/)
  assert.equal(failure.json().requestId, failure.headers['x-request-id'])
  const explicitFailure = await app.inject({ url: '/api/v2/catalog/import-template?format=xml', headers: { 'x-request-id': 'explicit-error-7' } })
  assert.equal(explicitFailure.statusCode, 400)
  assert.equal(explicitFailure.json().requestId, 'explicit-error-7')
  await app.close()
})

test('exports bounded Prometheus metrics only to local or authenticated operations callers', async () => {
  const app = buildApp({
    releaseRevision: '0123456789abcdef0123456789abcdef01234567',
    operationsToken: 'operations-secret',
    getDatabasePoolStats: () => ({ totalCount: 4, idleCount: 3, waitingCount: 1 }),
    logger: false,
  })
  await app.inject('/api/health')

  const local = await app.inject('/api/metrics')
  assert.equal(local.statusCode, 200)
  assert.match(local.headers['content-type'], /^text\/plain/)
  assert.match(local.body, /dashboard_api_build_info\{service="dashboard-sku-api",revision="0123456789abcdef0123456789abcdef01234567"\} 1/)
  assert.match(local.body, /dashboard_api_http_requests_total\{method="GET",route="\/api\/health",status_code="200"\} 1/)
  assert.match(local.body, /dashboard_api_database_pool_waiting_requests 1/)

  const remote = await app.inject({ url: '/api/metrics', headers: { 'x-forwarded-for': '203.0.113.8' } })
  assert.equal(remote.statusCode, 404)
  const authenticated = await app.inject({ url: '/api/metrics', headers: { 'x-forwarded-for': '203.0.113.8', authorization: 'Bearer operations-secret' } })
  assert.equal(authenticated.statusCode, 200)
  await app.close()
})

test('keeps operational helpers deterministic and redacts credential-bearing headers', () => {
  const metrics = createHttpMetrics({ getDatabasePoolStats: () => null })
  metrics.record({ method: 'GET', route: '/api/v2/catalog/skus/:id', statusCode: 200, durationMs: 125 })
  const output = metrics.render()
  assert.match(output, /dashboard_api_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v2\/catalog\/skus\/:id",le="0.25"\} 1/)
  assert.equal(isOperationsRequestAuthorized({ ip: '::1', headers: {} }), true)
  assert.equal(isOperationsRequestAuthorized({ ip: '203.0.113.9', headers: { authorization: 'Bearer wrong' } }, 'right'), false)
  assert.ok(createLoggerOptions({ LOG_LEVEL: 'warn' }).redact.paths.includes('req.headers.authorization'))
})
