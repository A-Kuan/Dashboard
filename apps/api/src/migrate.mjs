import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPool } from './db.mjs'

const pool = createPool()
const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))
try {
  const migrations = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    const sql = await readFile(`${migrationDirectory}/${migration}`, 'utf8')
    await pool.query(sql)
    console.log(`Applied migration ${migration}`)
  }
} finally {
  await pool.end()
}
