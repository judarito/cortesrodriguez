import { readdir, readFile } from 'node:fs/promises'
import { db } from '../db.js'

const migrationsDir = new URL('../migrations/', import.meta.url)
const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort()

for (const file of migrationFiles) {
  const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

  for (const statement of statements) {
    await db.execute(statement)
  }

  console.log(`Migración aplicada: migrations/${file}`)
}
