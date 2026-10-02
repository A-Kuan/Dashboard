import { randomUUID, timingSafeEqual } from 'node:crypto'
import { LogController } from 'fastify'

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const durationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function escapeLabel(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function labels(values) {
  return `{${Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`
}

function safeTokenMatches(actual, expected) {
  if (!actual || !expected) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createRequestId(rawRequest) {
  const supplied = String(headerValue(rawRequest.headers?.['x-request-id']) || '').trim()
  return requestIdPattern.test(supplied) ? supplied : randomUUID()
}

export function createLoggerOptions(environment = process.env) {
  return {
    level: environment.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-catalog-identity',
        'req.headers.x-catalog-identity-signature',
        'request.headers.authorization',
        'request.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  }
}

export class OperationalLogController extends LogController {
  constructor() {
    super({
      requestIdLogLabel: 'requestId',
      disableRequestLogging: (request) => ['/api/health', '/api/ready', '/api/metrics'].includes(String(request.url || '').split('?')[0]),
    })
  }

  incomingRequest(request) {
    if (this.isLogDisabled(request)) return
    request.log.info({ event: 'http.request.started', method: request.method, path: request.url }, 'request started')
  }

  requestCompleted(error, request, reply) {
    if (this.isLogDisabled(request) && !error && reply.statusCode < 500) return
    const payload = {
      event: 'http.request.completed',
      method: request.method,
      route: request.routeOptions?.url || 'unmatched',
      statusCode: reply.statusCode,
      durationMs: Number(reply.elapsedTime.toFixed(3)),
    }
    if (error || reply.statusCode >= 500) reply.log.error({ ...payload, ...(error ? { err: error } : {}) }, 'request failed')
    else reply.log.info(payload, 'request completed')
  }
}

export function isOperationsRequestAuthorized(request, operationsToken = '') {
  const ip = String(request.ip || '')
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  const authorization = String(request.headers?.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  return safeTokenMatches(token, operationsToken)
}

export function createHttpMetrics({ service = 'dashboard-sku-api', releaseRevision = 'development', getDatabasePoolStats = () => null } = {}) {
  const startedAtSeconds = Date.now() / 1000
  const requestCounts = new Map()
  const requestDurations = new Map()

  function record({ method, route, statusCode, durationMs }) {
    const stableMethod = String(method || 'UNKNOWN').toUpperCase()
    const stableRoute = String(route || 'unmatched')
    const stableStatus = String(Number(statusCode) || 0)
    const countKey = JSON.stringify([stableMethod, stableRoute, stableStatus])
    requestCounts.set(countKey, (requestCounts.get(countKey) || 0) + 1)

    const durationKey = JSON.stringify([stableMethod, stableRoute])
    const duration = Math.max(0, Number(durationMs) || 0) / 1000
    const histogram = requestDurations.get(durationKey) || { count: 0, sum: 0, buckets: durationBuckets.map(() => 0) }
    histogram.count += 1
    histogram.sum += duration
    durationBuckets.forEach((bucket, index) => { if (duration <= bucket) histogram.buckets[index] += 1 })
    requestDurations.set(durationKey, histogram)
  }

  function render() {
    const memory = process.memoryUsage()
    const pool = getDatabasePoolStats() || {}
    const lines = [
      '# HELP dashboard_api_build_info Static API build information.',
      '# TYPE dashboard_api_build_info gauge',
      `dashboard_api_build_info${labels({ service, revision: releaseRevision })} 1`,
      '# HELP dashboard_api_process_start_time_seconds Process start time in Unix seconds.',
      '# TYPE dashboard_api_process_start_time_seconds gauge',
      `dashboard_api_process_start_time_seconds ${startedAtSeconds}`,
      '# HELP dashboard_api_process_uptime_seconds Process uptime in seconds.',
      '# TYPE dashboard_api_process_uptime_seconds gauge',
      `dashboard_api_process_uptime_seconds ${process.uptime()}`,
      '# HELP dashboard_api_process_resident_memory_bytes Resident memory in bytes.',
      '# TYPE dashboard_api_process_resident_memory_bytes gauge',
      `dashboard_api_process_resident_memory_bytes ${memory.rss}`,
      '# HELP dashboard_api_process_heap_used_bytes Used JavaScript heap in bytes.',
      '# TYPE dashboard_api_process_heap_used_bytes gauge',
      `dashboard_api_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP dashboard_api_http_requests_total Completed HTTP requests.',
      '# TYPE dashboard_api_http_requests_total counter',
    ]

    for (const [key, value] of [...requestCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, statusCode] = JSON.parse(key)
      lines.push(`dashboard_api_http_requests_total${labels({ method, route, status_code: statusCode })} ${value}`)
    }

    lines.push('# HELP dashboard_api_http_request_duration_seconds HTTP request duration in seconds.')
    lines.push('# TYPE dashboard_api_http_request_duration_seconds histogram')
    for (const [key, histogram] of [...requestDurations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route] = JSON.parse(key)
      durationBuckets.forEach((bucket, index) => lines.push(`dashboard_api_http_request_duration_seconds_bucket${labels({ method, route, le: bucket })} ${histogram.buckets[index]}`))
      lines.push(`dashboard_api_http_request_duration_seconds_bucket${labels({ method, route, le: '+Inf' })} ${histogram.count}`)
      lines.push(`dashboard_api_http_request_duration_seconds_sum${labels({ method, route })} ${histogram.sum}`)
      lines.push(`dashboard_api_http_request_duration_seconds_count${labels({ method, route })} ${histogram.count}`)
    }

    for (const [name, value] of [
      ['dashboard_api_database_pool_total_connections', pool.totalCount],
      ['dashboard_api_database_pool_idle_connections', pool.idleCount],
      ['dashboard_api_database_pool_waiting_requests', pool.waitingCount],
    ]) {
      if (Number.isFinite(value)) {
        lines.push(`# TYPE ${name} gauge`)
        lines.push(`${name} ${value}`)
      }
    }
    return `${lines.join('\n')}\n`
  }

  return { record, render }
}
