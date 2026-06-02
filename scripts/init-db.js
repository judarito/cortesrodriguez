import { db, ensureSchema } from '../db.js'
import { defaultContent, normalizeContent } from '../src/contentDefaults.js'

const force = process.argv.includes('--force')

await ensureSchema()

const existing = await db.execute({
  sql: 'SELECT id FROM site_content_versions WHERE content_key = ? ORDER BY id DESC LIMIT 1',
  args: ['landing'],
})

if (existing.rows.length && !force) {
  console.error('Ya existe contenido en site_content.key="landing". Usa --force si realmente deseas sobrescribirlo.')
  process.exit(1)
}

await db.execute({
  sql: `
    INSERT INTO site_content_versions (
      content_key,
      value,
      created_at,
      created_by,
      source,
      base_revision,
      request_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  args: [
    'landing',
    JSON.stringify(normalizeContent(defaultContent)),
    new Date().toISOString(),
    'script:init-db',
    'script:init-db',
    null,
    `init-${Date.now()}`,
  ],
})

console.log('Contenido inicial guardado en Turso/libSQL.')
