import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = resolve(webRoot, '../api')
const playwrightCli = resolve(webRoot, 'node_modules/@playwright/test/cli.js')
const inheritedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || '').trim()

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal || code})`))
    })
  })
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolvePromise(address.port))
    })
  })
}

async function waitForReady(url, processHandle, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`E2E API exited before readiness (${processHandle.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok && (await response.json()).status === 'ready') return
    } catch {
      // The API may still be opening its listening socket.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function main() {
  if (inheritedBaseUrl) {
    throw new Error('Refusing to run stateful E2E tests against PLAYWRIGHT_BASE_URL. Use npm run test:production-smoke for a deployed environment.')
  }

  const database = `dashboard_sku_e2e_${process.pid}_${Date.now().toString(36)}`
  if (!/^dashboard_sku_e2e_[a-z0-9_]+$/.test(database)) throw new Error('Generated unsafe E2E database name')
  const databaseEnv = {
    ...process.env,
    PGHOST: process.env.E2E_PGHOST || process.env.PGHOST || '/tmp',
    PGPORT: process.env.E2E_PGPORT || process.env.PGPORT || '5432',
    PGUSER: process.env.E2E_PGUSER || process.env.PGUSER || userInfo().username,
    PGPASSWORD: process.env.E2E_PGPASSWORD || process.env.PGPASSWORD || '',
    PGDATABASE: database,
  }
  const databaseHost = databaseEnv.PGHOST
  const localDatabaseHost = databaseHost.startsWith('/') || ['localhost', '127.0.0.1', '::1'].includes(databaseHost)
  if (!localDatabaseHost && process.env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(`Refusing remote E2E PostgreSQL host ${databaseHost}. Set E2E_ALLOW_REMOTE=1 only for a dedicated disposable test cluster.`)
  }
  const databaseArgs = ['-h', databaseEnv.PGHOST, '-p', databaseEnv.PGPORT, '-U', databaseEnv.PGUSER]
  const apiPort = await freePort()
  const webPort = await freePort()
  let apiProcess
  let databaseCreated = false
  let cleanupPromise

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      await stop(apiProcess)
      if (databaseCreated) {
        await run('dropdb', [...databaseArgs, '--if-exists', database], { env: databaseEnv })
        databaseCreated = false
      }
    })()
    return cleanupPromise
  }

  const stopForSignal = (exitCode) => {
    cleanup()
      .catch((error) => console.error(`E2E cleanup failed: ${error.message}`))
      .finally(() => process.exit(exitCode))
  }
  const onInterrupt = () => stopForSignal(130)
  const onTerminate = () => stopForSignal(143)
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)

  try {
    await run('createdb', [...databaseArgs, database], { env: databaseEnv })
    databaseCreated = true
    await run(process.execPath, ['src/migrate.mjs'], { cwd: apiRoot, env: databaseEnv })
    apiProcess = spawn(process.execPath, ['src/server.mjs'], {
      cwd: apiRoot,
      env: { ...databaseEnv, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(apiPort) },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    await waitForReady(`http://127.0.0.1:${apiPort}/api/ready`, apiProcess)
    await run(process.execPath, [playwrightCli, 'test'], {
      cwd: webRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_WEB_PORT: String(webPort),
        VITE_API_PROXY: `http://127.0.0.1:${apiPort}`,
      },
    })
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    await cleanup()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
