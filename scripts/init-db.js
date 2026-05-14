import { db, ensureSchema } from '../db.js'
import { defaultContent, normalizeContent } from '../src/contentDefaults.js'

await ensureSchema()

await db.execute({
  sql: `
    INSERT INTO site_content (key, value, updated_at)
    VALUES ('landing', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `,
  args: [JSON.stringify(normalizeContent(defaultContent))],
})

console.log('Contenido inicial guardado en Turso/libSQL.')
