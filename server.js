import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import 'dotenv/config'
import { db, ensureSchema } from './db.js'
import { defaultContent, normalizeContent } from './src/contentDefaults.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5173)
const adminEmail = process.env.ADMIN_EMAIL || 'admin@local.dev'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin-dev-password'
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret'
const contentCacheTtlMs = Number(process.env.CONTENT_CACHE_TTL_SECONDS || 300) * 1000
let contentCache = null

const app = express()
app.use(express.json({ limit: '1mb' }))

await ensureSchema()

async function getLandingContent() {
  if (contentCache && contentCache.expiresAt > Date.now()) {
    return contentCache.value
  }

  const result = await db.execute({
    sql: 'SELECT value FROM site_content WHERE key = ?',
    args: ['landing'],
  })

  if (!result.rows.length) {
    await saveLandingContent(defaultContent)
    contentCache = { value: defaultContent, expiresAt: Date.now() + contentCacheTtlMs }
    return defaultContent
  }

  const storedContent = JSON.parse(String(result.rows[0].value))
  const content = normalizeContent(storedContent)
  if (content.version !== storedContent.version) await saveLandingContent(content)
  contentCache = { value: content, expiresAt: Date.now() + contentCacheTtlMs }
  return content
}

async function saveLandingContent(content) {
  await db.execute({
    sql: `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ('landing', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [JSON.stringify(content)],
  })
  contentCache = null
}

function requireAdmin(req, res, next) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || !verifyJwt(token)) {
    res.status(401).json({ error: 'Sesión inválida.' })
    return
  }

  next()
}

app.get('/api/content', async (_req, res) => {
  try {
    res.set('Cache-Control', `public, max-age=${Math.floor(contentCacheTtlMs / 1000)}`)
    res.json(await getLandingContent())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo cargar el contenido.' })
  }
})

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body

  if (email !== adminEmail || password !== adminPassword) {
    res.status(401).json({ error: 'Credenciales inválidas.' })
    return
  }

  res.json({ token: signJwt({ sub: email, role: 'admin' }) })
})

app.put('/api/admin/content', requireAdmin, async (req, res) => {
  try {
    await saveLandingContent(normalizeContent(req.body))
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo guardar el contenido.' })
  }
})

function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const claims = { ...payload, iat: now, exp: now + 60 * 60 * 8 }
  const data = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  return `${data}.${hmac(data)}`
}

function verifyJwt(token) {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return false
  const expected = hmac(`${header}.${payload}`)
  if (signature !== expected) return false
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8'))
  return claims.role === 'admin' && claims.exp >= Math.floor(Date.now() / 1000)
}

function hmac(data) {
  return crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.use((_req, res) => {
    res.sendFile(path.join(__dirname, 'dist/index.html'))
  })
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor listo en http://localhost:${port}`)
  console.log(`Admin: http://localhost:${port}/admin`)
})
