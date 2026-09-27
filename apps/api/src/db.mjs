import pg from 'pg'

const { Pool } = pg

export function createPool(config = {}) {
  return new Pool({
    host: process.env.PGHOST || '/var/run/postgresql',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'dashboard_sku',
    user: process.env.PGUSER || 'dashboard_sku',
    password: process.env.PGPASSWORD || undefined,
    max: Number(process.env.PGPOOL_MAX || 10),
    ...config,
  })
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
