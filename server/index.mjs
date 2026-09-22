import { resolve } from 'node:path'
import { createApp } from './app.mjs'

const production = process.env.NODE_ENV === 'production'
if (production && (!process.env.APP_ORIGIN || !process.env.APP_ORIGIN.startsWith('https://')))
  throw new Error('生产环境须配置 HTTPS APP_ORIGIN')
const port = Number(process.env.PORT ?? 4182)
const dataDir = resolve(process.env.DATA_DIR ?? '.data')
const app = createApp({
  dataDir,
  origins: [process.env.APP_ORIGIN ?? 'http://127.0.0.1:4179'],
  secureCookie: production,
})
app.server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Dashboard API listening on port ${port}. Database directory: ${dataDir}`)
  if (!app.db.prepare('SELECT id FROM users LIMIT 1').get())
    console.log('首次登录请使用数据目录内 setup-token.txt 中的一次性初始化码创建管理员。')
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close()
    process.exit(0)
  })
