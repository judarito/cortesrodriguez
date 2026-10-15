const encoder = new TextEncoder()

async function getNeonClient(env) {
  const { neon } = await import('@neondatabase/serverless')
  return neon(env.NEON_DATABASE_URL)
}

export async function handleOperationsAuth(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/api/app/login' && request.method === 'POST') return login(request, env)
  if (url.pathname === '/api/app/session' && request.method === 'GET') return session(request, env)
  if (url.pathname === '/api/app/logout' && request.method === 'POST') return logout(request, env)
  return null
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}))
  const email = normalize(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return response({ error: 'Correo y contraseña son obligatorios.' }, 400)
  if (!env.NEON_DATABASE_URL || !env.OPERATIONS_JWT_SECRET) return response({ error: 'Falta configurar la autenticación operativa.' }, 500)

  const sql = await getNeonClient(env)
  const users = await sql`
    SELECT u.id, u.email, u.full_name, u.active, c.password_hash, c.password_salt, c.locked_until
    FROM operations.users u
    JOIN operations.user_credentials c ON c.user_id = u.id
    WHERE lower(u.email) = ${email}
    LIMIT 1
  `
  const user = users[0]
  if (!user || !user.active || (user.locked_until && new Date(user.locked_until) > new Date())) {
    return response({ error: 'Credenciales inválidas.' }, 401)
  }

  const hash = await derivePassword(password, user.password_salt)
  if (!timingSafeEqual(hash, user.password_hash)) return response({ error: 'Credenciales inválidas.' }, 401)

  const roles = await sql`SELECT r.name, r.label FROM operations.user_roles ur JOIN operations.roles r ON r.id = ur.role_id WHERE ur.user_id = ${user.id}`
  const permissions = await sql`
    SELECT DISTINCT p.code, p.label, p.module
    FROM operations.user_roles ur
    JOIN operations.role_permissions rp ON rp.role_id = ur.role_id
    JOIN operations.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${user.id}
    ORDER BY p.module, p.code
  `
  const now = Math.floor(Date.now() / 1000)
  const claims = { sub: user.id, email: user.email, name: user.full_name, scope: 'operations', roles: roles.map((item) => item.name), permissions: permissions.map((item) => item.code), iat: now, exp: now + 60 * 60 * 12 }
  const token = await signToken(env.OPERATIONS_JWT_SECRET, claims)
  const tokenHash = await sha256(token)
  await sql`INSERT INTO operations.sessions (user_id, token_hash, expires_at) VALUES (${user.id}, ${tokenHash}, ${new Date((now + 60 * 60 * 12) * 1000).toISOString()})`
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, metadata) VALUES (${user.id}, 'login', 'session', ${JSON.stringify({ email })}::jsonb)`
  return response({ token, user: { id: user.id, email: user.email, name: user.full_name, roles: roles.map((item) => item.name), permissions: permissions.map((item) => item.code) } })
}

async function session(request, env) {
  const claims = await verifyToken(request, env)
  if (!claims) return response({ error: 'Sesión inválida.' }, 401)
  return response({ user: { id: claims.sub, email: claims.email, name: claims.name, roles: claims.roles || [], permissions: claims.permissions || [] } })
}

async function logout(request, env) {
  const token = getToken(request)
  if (token && env.NEON_DATABASE_URL) {
    const sql = await getNeonClient(env)
    await sql`UPDATE operations.sessions SET revoked_at = NOW() WHERE token_hash = ${await sha256(token)} AND revoked_at IS NULL`
  }
  return response({ ok: true })
}

export async function requireOperationsAuth(request, env) {
  return verifyToken(request, env)
}

async function verifyToken(request, env) {
  const token = getToken(request)
  if (!token || !env.OPERATIONS_JWT_SECRET) return null
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature || signature !== await hmac(env.OPERATIONS_JWT_SECRET, `${header}.${payload}`)) return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64Decode(payload)))
    if (claims.scope !== 'operations' || claims.exp < Math.floor(Date.now() / 1000)) return null
    return claims
  } catch { return null }
}

async function signToken(secret, claims) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify(claims))
  return `${header}.${payload}.${await hmac(secret, `${header}.${payload}`)}`
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64UrlBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256)
  return base64UrlBytes(new Uint8Array(bits))
}

async function sha256(value) {
  return base64UrlBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let result = 0
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return result === 0
}

function getToken(request) { return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '' }
function normalize(value) { return typeof value === 'string' ? value.trim() : '' }
function base64Url(value) { return base64UrlBytes(encoder.encode(value)) }
function base64UrlBytes(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function base64Decode(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (char) => char.charCodeAt(0)) }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
