import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import 'dotenv/config'

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('Falta NEON_DATABASE_URL.')
}

const sql = neon(process.env.NEON_DATABASE_URL)
const migration = await fs.readFile(new URL('../worker/db/migrations/001_operations.sql', import.meta.url), 'utf8')

for (const statement of migration.split(';').map((item) => item.trim()).filter(Boolean)) {
  await sql.query(statement)
}

console.log('Migración operativa aplicada en Neon.')
