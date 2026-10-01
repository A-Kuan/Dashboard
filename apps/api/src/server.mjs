import { buildApp } from './app.mjs'
import { createPool } from './db.mjs'
import { createSkuRepository } from './repository.mjs'
import { createVehicleRepository } from './vehicle-repository.mjs'
import { createDictionaryRepository } from './dictionary-repository.mjs'
import { defaultDictionaries } from './default-dictionaries.mjs'
import { createCatalogRepository } from './catalog-repository.mjs'
import { createCatalogImportRepository } from './catalog-import-repository.mjs'

const pool = createPool()
const catalogRepository = createCatalogRepository(pool)
const app = buildApp({
  repository: createSkuRepository(pool),
  vehicleRepository: createVehicleRepository(pool),
  dictionaryRepository: createDictionaryRepository(pool, defaultDictionaries),
  catalogRepository,
  catalogImportRepository: createCatalogImportRepository(pool, catalogRepository),
})
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
