import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPool } from './db.mjs'

const pool = createPool()
const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))
try {
  const migrations = (await readdir(migrationDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
  for (const migration of migrations) {
    const sql = await readFile(`${migrationDirectory}/${migration}`, 'utf8')
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const statement of statements) {
        await client.query(statement)
      }
      await client.query('COMMIT')
      console.log(`Applied migration ${migration}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} finally {
  await pool.end()
}
