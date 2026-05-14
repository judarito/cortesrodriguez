import { db, ensureSchema } from '../db.js'
import { defaultContent, normalizeContent } from '../src/contentDefaults.js'

const content = normalizeContent(defaultContent)

await ensureSchema()

await db.execute({
  sql: `
    INSERT INTO site_content (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `,
  args: ['landing', JSON.stringify(content)],
})

console.log('Fila site_content.key="landing" actualizada con contenido bilingüe.')
console.log(`Idiomas guardados: ${Object.keys(content.locales).join(', ')}`)
