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
  const attemptKeys = await getLoginAttemptKeys(request, email, env.OPERATIONS_JWT_SECRET)
  await cleanupExpiredLoginAttempts(sql)
  const limits = await sql`
    WITH requested(scope, identifier_hash) AS (VALUES
      ('account', ${attemptKeys.account}), ('ip', ${attemptKeys.ip})
    )
    SELECT COALESCE(bool_or(a.locked_until > NOW()), FALSE) AS locked
    FROM requested r
    LEFT JOIN operations.login_attempt_limits a USING (scope, identifier_hash)
  `
  if (limits[0]?.locked) return invalidCredentials()

  const users = await sql`
    SELECT u.id, u.email, u.full_name, u.active, c.password_hash, c.password_salt, c.locked_until
    FROM operations.users u
    JOIN operations.user_credentials c ON c.user_id = u.id
    WHERE lower(u.email) = ${email}
    LIMIT 1
  `
  const user = users[0]
  if (!user || !user.active || (user.locked_until && new Date(user.locked_until) > new Date())) {
    await recordFailedLogin(sql, attemptKeys)
    return invalidCredentials()
  }

  const hash = await derivePassword(password, user.password_salt)
  if (!timingSafeEqual(hash, user.password_hash)) {
    await recordFailedLogin(sql, attemptKeys)
    return invalidCredentials()
  }

  await sql`
    DELETE FROM operations.login_attempt_limits
    WHERE (scope = 'account' AND identifier_hash = ${attemptKeys.account})
       OR (scope = 'ip' AND identifier_hash = ${attemptKeys.ip})
  `

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

function invalidCredentials() { return response({ error: 'Credenciales inválidas.' }, 401) }

async function getLoginAttemptKeys(request, email, secret) {
  const address = request.headers.get('cf-connecting-ip') || ''
  return {
    account: await hmac(secret, `operations-login-account:${email}`),
    ip: await hmac(secret, `operations-login-ip:${address}`),
  }
}

async function recordFailedLogin(sql, keys) {
  await sql`
    INSERT INTO operations.login_attempt_limits
      (scope, identifier_hash, failed_attempts, window_started_at, locked_until, expires_at)
    VALUES
      ('account', ${keys.account}, 1, NOW(), NULL, NOW() + INTERVAL '1 day'),
      ('ip', ${keys.ip}, 1, NOW(), NULL, NOW() + INTERVAL '1 day')
    ON CONFLICT (scope, identifier_hash) DO UPDATE SET
      failed_attempts = CASE
        WHEN operations.login_attempt_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
        ELSE operations.login_attempt_limits.failed_attempts + 1
      END,
      window_started_at = CASE
        WHEN operations.login_attempt_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW()
        ELSE operations.login_attempt_limits.window_started_at
      END,
      locked_until = CASE
        WHEN (CASE WHEN operations.login_attempt_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE operations.login_attempt_limits.failed_attempts + 1 END) >= 15 THEN NOW() + INTERVAL '30 minutes'
        WHEN (CASE WHEN operations.login_attempt_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE operations.login_attempt_limits.failed_attempts + 1 END) >= 10 THEN NOW() + INTERVAL '5 minutes'
        WHEN (CASE WHEN operations.login_attempt_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE operations.login_attempt_limits.failed_attempts + 1 END) >= 5 THEN NOW() + INTERVAL '1 minute'
        ELSE NULL
      END,
      expires_at = NOW() + INTERVAL '1 day'
  `
}

async function cleanupExpiredLoginAttempts(sql) {
  await sql`
    WITH expired AS (
      SELECT scope, identifier_hash FROM operations.login_attempt_limits
      WHERE expires_at <= NOW()
      ORDER BY expires_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM operations.login_attempt_limits a
    USING expired e
    WHERE a.scope = e.scope AND a.identifier_hash = e.identifier_hash
  `
}

async function session(request, env) {
  const claims = await requireActiveOperationsAuth(request, env)
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
  return requireActiveOperationsAuth(request, env)
}

export async function requireActiveOperationsAuth(request, env) {
  const claims = await verifyToken(request, env)
  const token = getToken(request)
  if (!claims || !token || !env.NEON_DATABASE_URL) return null
  const sql = await getNeonClient(env)
  const sessions = await sql`
    SELECT u.id, u.email, u.full_name
    FROM operations.sessions s
    JOIN operations.users u ON u.id = s.user_id
    WHERE s.user_id = ${claims.sub} AND s.token_hash = ${await sha256(token)}
      AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.active = TRUE
    LIMIT 1
  `
  if (!sessions.length) return null
  const [roles, permissions] = await Promise.all([
    sql`SELECT r.name FROM operations.user_roles ur JOIN operations.roles r ON r.id = ur.role_id WHERE ur.user_id = ${claims.sub}`,
    sql`SELECT DISTINCT p.code FROM operations.user_roles ur
      JOIN operations.role_permissions rp ON rp.role_id = ur.role_id
      JOIN operations.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ${claims.sub}`,
  ])
  return {
    ...claims,
    email: String(sessions[0].email),
    name: String(sessions[0].full_name),
    roles: roles.map((row) => String(row.name)),
    permissions: permissions.map((row) => String(row.code)),
  }
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
