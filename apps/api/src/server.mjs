import { buildApp } from './app.mjs'
import { createPool } from './db.mjs'
import { createSkuRepository } from './repository.mjs'
import { createDictionaryRepository } from './dictionary-repository.mjs'
import { defaultDictionaries } from './default-dictionaries.mjs'

const pool = createPool()
const app = buildApp({ repository: createSkuRepository(pool), dictionaryRepository: createDictionaryRepository(pool, defaultDictionaries) })
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4183)

const shutdown = async () => {
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ host, port })
