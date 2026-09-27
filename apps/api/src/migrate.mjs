import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPool } from './db.mjs'

const pool = createPool()
const migrationUrl = new URL('../migrations/001_init.sql', import.meta.url)
const sql = await readFile(fileURLToPath(migrationUrl), 'utf8')
try {
  await pool.query(sql)
  console.log('Applied migration 001_init.sql')
} finally {
  await pool.end()
}
