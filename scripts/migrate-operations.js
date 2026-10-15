import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import 'dotenv/config'

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('Falta NEON_DATABASE_URL.')
}

const sql = neon(process.env.NEON_DATABASE_URL)
const migrationFiles = (await fs.readdir(new URL('../worker/db/migrations/', import.meta.url)))
  .filter((file) => file.endsWith('.sql'))
  .sort()

for (const file of migrationFiles) {
  const migration = await fs.readFile(new URL(`../worker/db/migrations/${file}`, import.meta.url), 'utf8')
  for (const statement of migration.split(';').map((item) => item.trim()).filter(Boolean)) {
    await sql.query(statement)
  }
  console.log(`Migración operativa aplicada: ${file}`)
}
