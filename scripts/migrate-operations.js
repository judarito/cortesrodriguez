import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

const environmentFile = '.env.dev'
const loaded = dotenv.config({ path: environmentFile, override: true })
if (loaded.error) throw new Error(`No se pudo cargar ${environmentFile}; las migraciones operativas están limitadas a dev.`)
if (process.env.DOTENV_CONFIG_PATH && process.env.DOTENV_CONFIG_PATH !== environmentFile) {
  throw new Error('Las migraciones operativas de este checkout solo se permiten con .env.dev.')
}

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('Falta NEON_DATABASE_URL.')
}

const sql = neon(process.env.NEON_DATABASE_URL)
const availableMigrations = (await fs.readdir(new URL('../worker/db/migrations/', import.meta.url)))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const requestedMigration = process.argv[2]
const migrationFiles = requestedMigration
  ? availableMigrations.filter((file) => file === requestedMigration || file.startsWith(requestedMigration))
  : availableMigrations
if (requestedMigration && !migrationFiles.length) throw new Error(`No se encontró la migración: ${requestedMigration}`)

for (const file of migrationFiles) {
  const migration = await fs.readFile(new URL(`../worker/db/migrations/${file}`, import.meta.url), 'utf8')
  for (const statement of splitSqlStatements(migration)) {
    await sql.query(statement)
  }
  console.log(`Migración operativa aplicada: ${file}`)
}

function splitSqlStatements(source) {
  const statements = []
  let statement = ''
  let quote = ''
  let dollarTag = ''
  let lineComment = false
  let blockCommentDepth = 0

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (lineComment) {
      statement += char
      if (char === '\n') lineComment = false
      continue
    }
    if (blockCommentDepth > 0) {
      statement += char
      if (char === '/' && next === '*') { statement += next; index += 1; blockCommentDepth += 1 }
      else if (char === '*' && next === '/') { statement += next; index += 1; blockCommentDepth -= 1 }
      continue
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        statement += dollarTag
        index += dollarTag.length - 1
        dollarTag = ''
      } else statement += char
      continue
    }
    if (quote) {
      statement += char
      if (char === quote && next === quote) { statement += next; index += 1 }
      else if (char === quote) quote = ''
      continue
    }
    if (char === '-' && next === '-') { statement += char + next; index += 1; lineComment = true; continue }
    if (char === '/' && next === '*') { statement += char + next; index += 1; blockCommentDepth = 1; continue }
    if (char === "'" || char === '"') { statement += char; quote = char; continue }
    if (char === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
      if (match) { dollarTag = match[0]; statement += dollarTag; index += dollarTag.length - 1; continue }
    }
    if (char === ';') {
      if (statement.trim()) statements.push(statement.trim())
      statement = ''
      continue
    }
    statement += char
  }
  if (statement.trim()) statements.push(statement.trim())
  return statements
}
