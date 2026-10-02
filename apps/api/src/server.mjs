import { buildApp } from './app.mjs'
import { createPool } from './db.mjs'
import { createSkuRepository } from './repository.mjs'
import { createVehicleRepository } from './vehicle-repository.mjs'
import { createDictionaryRepository } from './dictionary-repository.mjs'
import { defaultDictionaries } from './default-dictionaries.mjs'
import { createCatalogRepository } from './catalog-repository.mjs'
import { createCatalogImportRepository } from './catalog-import-repository.mjs'
import { createCatalogImportMappingRepository } from './catalog-import-mapping-repository.mjs'
import { createCatalogDictionaryGovernanceRepository } from './catalog-dictionary-governance-repository.mjs'
import { createCatalogPlatformRepository } from './catalog-platform-repository.mjs'
import { createCatalogEpcIntakeRepository } from './catalog-epc-intake-repository.mjs'
import { createCatalogEpcConnectorService } from './catalog-epc-connector-service.mjs'
import { createCatalogEpcConnectorRunRepository } from './catalog-epc-connector-run-repository.mjs'
import { migrationReadiness } from './migration-runner.mjs'

const pool = createPool()
const catalogRepository = createCatalogRepository(pool)
const catalogImportMappingRepository = createCatalogImportMappingRepository(pool)
const catalogDictionaryGovernanceRepository = createCatalogDictionaryGovernanceRepository(pool)
const catalogPlatformRepository = createCatalogPlatformRepository(pool)
const catalogEpcIntakeRepository = createCatalogEpcIntakeRepository(pool)
const app = buildApp({
  repository: createSkuRepository(pool),
  vehicleRepository: createVehicleRepository(pool),
  dictionaryRepository: createDictionaryRepository(pool, defaultDictionaries),
  catalogRepository,
  catalogImportRepository: createCatalogImportRepository(pool, catalogRepository),
  catalogImportMappingRepository,
  catalogDictionaryGovernanceRepository,
  catalogPlatformRepository,
  catalogEpcIntakeRepository,
  catalogEpcConnectorService: createCatalogEpcConnectorService(),
  catalogEpcConnectorRunRepository: createCatalogEpcConnectorRunRepository(pool),
  readinessCheck: async () => {
    const schema = await migrationReadiness(pool)
    const database = (await pool.query('SELECT current_database() AS name')).rows[0].name
    return { ...schema, database: 'ready', databaseName: database }
  },
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
