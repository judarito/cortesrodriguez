import { readFile } from 'node:fs/promises'
import { db } from '../db.js'

const migration = await readFile(new URL('../migrations/001_create_site_content.sql', import.meta.url), 'utf8')

await db.execute(migration)

console.log('Migración aplicada: migrations/001_create_site_content.sql')
