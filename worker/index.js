import { createClient } from '@libsql/client/web'
import { defaultContent, normalizeContent } from '../src/contentDefaults.js'

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
}

const contentCachePath = '/api/content-cache/landing'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) })
    }

    try {
      if (url.pathname === '/api/content' && request.method === 'GET') {
        return getCachedLandingContent(request, env)
      }

      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.JWT_SECRET) {
          throw new Error('Faltan ADMIN_EMAIL, ADMIN_PASSWORD o JWT_SECRET.')
        }

        const { email, password } = await request.json()

        if (email !== env.ADMIN_EMAIL || password !== env.ADMIN_PASSWORD) {
          return json({ error: 'Credenciales inválidas.' }, request, 401)
        }

        return json({ token: await signJwt(env, { sub: email, role: 'admin' }) }, request)
      }

      if (url.pathname === '/api/admin/content' && request.method === 'PUT') {
        await requireJwt(request, env)

        await ensureSchema(env)
        const body = normalizeContent(await request.json())
        await saveLandingContent(env, body)
        await invalidateLandingContentCache(request, env)
        return json({ ok: true }, request)
      }

      return env.ASSETS.fetch(request)
    } catch (error) {
      console.error(error)
      return json({ error: error.message || 'Error interno.' }, request, error.status || 500)
    }
  },
}

async function getCachedLandingContent(request, env) {
  const cache = caches.default
  const cacheRequest = getContentCacheRequest(request)
  const cachedResponse = await cache.match(cacheRequest)

  if (cachedResponse) {
    return withCors(cachedResponse, request, 'HIT')
  }

  await ensureSchema(env)
  const content = await getLandingContent(env)
  const response = json(content, request, 200, {
    'cache-control': `public, max-age=${getContentCacheTtl(env)}`,
    'x-content-cache': 'MISS',
  })

  await cache.put(cacheRequest, response.clone())
  return response
}

async function invalidateLandingContentCache(request) {
  await caches.default.delete(getContentCacheRequest(request))
}

function getContentCacheRequest(request) {
  const url = new URL(request.url)
  url.pathname = contentCachePath
  url.search = ''
  return new Request(url.toString(), { method: 'GET' })
}

function getContentCacheTtl(env) {
  const ttl = Number(env.CONTENT_CACHE_TTL_SECONDS || 300)
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 300
}

function getClient(env) {
  const url = env.TURSO_URL || env.TURSO_DATABASE_URL
  const authToken = env.TURSO_AUTH_TOKEN

  if (!url || !authToken) {
    throw new Error('Faltan TURSO_URL/TURSO_DATABASE_URL o TURSO_AUTH_TOKEN.')
  }

  return createClient({ url, authToken })
}

async function ensureSchema(env) {
  await getClient(env).execute(`
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getLandingContent(env) {
  const result = await getClient(env).execute({
    sql: 'SELECT value FROM site_content WHERE key = ?',
    args: ['landing'],
  })

  if (!result.rows.length) {
    await saveLandingContent(env, defaultContent)
    return defaultContent
  }

  const storedContent = JSON.parse(String(result.rows[0].value))
  const content = normalizeContent(storedContent)
  if (content.version !== storedContent.version) {
    await saveLandingContent(env, content)
  }
  return content
}

async function saveLandingContent(env, content) {
  await getClient(env).execute({
    sql: `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ('landing', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [JSON.stringify(content)],
  })
}

async function signJwt(env, payload) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const claims = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 8,
  }
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`
  const signature = await hmac(env, data)
  return `${data}.${signature}`
}

async function requireJwt(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError('Sesión requerida.', 401)

  const [encodedHeader, encodedPayload, signature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !signature) throw new HttpError('Sesión inválida.', 401)

  const data = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = await hmac(env, data)
  if (signature !== expectedSignature) throw new HttpError('Sesión inválida.', 401)

  const payload = JSON.parse(base64UrlDecode(encodedPayload))
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new HttpError('Sesión vencida.', 401)
  if (payload.role !== 'admin') throw new HttpError('Sesión sin permisos.', 403)

  return payload
}

async function hmac(env, data) {
  if (!env.JWT_SECRET) throw new Error('Falta JWT_SECRET.')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value))
}

function base64UrlEncodeBytes(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(base64)
}

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function json(payload, request, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...jsonHeaders,
      ...corsHeaders(request),
      ...extraHeaders,
    },
  })
}

function withCors(response, request, cacheStatus) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders(request)).forEach(([key, value]) => headers.set(key, value))
  headers.set('x-content-cache', cacheStatus)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders(request) {
  const origin = request.headers.get('origin')

  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  }
}
