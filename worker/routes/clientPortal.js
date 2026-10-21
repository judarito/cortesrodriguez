const encoder = new TextEncoder()
const SESSION_SECONDS = 60 * 60 * 24 * 14
const GENERIC_MESSAGE = 'Si encontramos solicitudes asociadas a ese correo, enviaremos un código de acceso.'

export async function handleClientPortal(request, env) {
  const url = new URL(request.url)
  const routes = {
    '/api/client/access-code': request.method === 'POST',
    '/api/client/session': request.method === 'POST' || request.method === 'GET',
    '/api/client/requests': request.method === 'GET',
    '/api/client/logout': request.method === 'POST',
  }
  if (!routes[url.pathname]) return null
  if (!env.NEON_DATABASE_URL) return response({ error: 'El portal no está disponible temporalmente.' }, 503)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  if (url.pathname === '/api/client/access-code') return requestAccessCode(request, env, sql)
  if (url.pathname === '/api/client/session' && request.method === 'POST') return verifyAccessCode(request, env, sql)
  if (url.pathname === '/api/client/logout') {
    const token = readCookie(request, 'client_session')
    if (token) {
      const revoked = await sql`UPDATE operations.client_sessions SET revoked_at = NOW() WHERE token_hash = ${await sha256(token)} AND revoked_at IS NULL RETURNING email`
      if (revoked[0]?.email) await sql`INSERT INTO operations.client_auth_events (email, event_type) VALUES (${String(revoked[0].email)}, 'logout')`
    }
    return response({ ok: true }, 200, { 'set-cookie': expiredCookie() })
  }

  const email = await getSessionEmail(request, sql)
  if (!email) return response({ error: 'Inicia sesión para continuar.' }, 401)
  if (url.pathname === '/api/client/session') return response({ user: { email, role: 'client' } })

  const page = Math.max(1, Math.min(100000, Number(url.searchParams.get('page')) || 1))
  const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get('pageSize')) || 10))
  const offset = (page - 1) * pageSize
  const [items, counts] = await Promise.all([
    sql`SELECT reference, service_type, consultation_type_name, specialty_name, status, created_at
      FROM operations.requests
      WHERE lower(trim(email)) = ${email}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE lower(trim(email)) = ${email}`,
  ])
  const totalItems = Number(counts[0]?.total || 0)
  return response({
    items: items.map((row) => ({ reference: String(row.reference), service: row.service_type ? String(row.service_type) : '', consultation: row.consultation_type_name ? String(row.consultation_type_name) : row.specialty_name ? String(row.specialty_name) : '', status: String(row.status), createdAt: String(row.created_at) })),
    pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  })
}

async function requestAccessCode(request, env, sql) {
  const input = await request.json().catch(() => ({}))
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'Ingresa un correo electrónico válido.' }, 400)
  const recent = await sql`SELECT COUNT(*)::int AS total FROM operations.client_login_challenges WHERE lower(email) = ${email} AND created_at > NOW() - INTERVAL '15 minutes'`
  if (Number(recent[0]?.total || 0) >= 4) return response({ message: GENERIC_MESSAGE })
  const matching = await sql`SELECT 1 FROM operations.requests WHERE lower(trim(email)) = ${email} LIMIT 1`
  if (!matching.length) return response({ message: GENERIC_MESSAGE })

  await sql`INSERT INTO operations.client_auth_events (email, event_type) VALUES (${email}, 'code_requested')`
  await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW() WHERE lower(email) = ${email} AND consumed_at IS NULL`
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  await sql`INSERT INTO operations.client_login_challenges (email, code_hash, expires_at) VALUES (${email}, ${await hashAccessCode(env, email, code)}, NOW() + INTERVAL '10 minutes')`
  if (!env.RESEND_FROM_EMAIL || !(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY)) {
    console.error('Portal de clientes: faltan variables de envío de correo.')
    return response({ message: GENERIC_MESSAGE })
  }
  const html = `<p>Hola,</p><p>Usa este código para acceder a tus solicitudes en Cortés Rodríguez Asesores:</p><p style="font-size:30px;font-weight:800;letter-spacing:8px;color:#0e4567">${code}</p><p>El código vence en 10 minutos y solo puede usarse una vez. Si no solicitaste el acceso, puedes ignorar este mensaje.</p>`
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [email], subject: 'Tu código de acceso · Portal de clientes', html, text: `Tu código de acceso al portal de clientes es: ${code}\n\nVence en 10 minutos y solo puede usarse una vez. Si no solicitaste el acceso, ignora este correo.` }),
  })
  if (!result.ok) console.error('No se pudo enviar el acceso al portal de clientes:', (await result.text()).slice(0, 300))
  return response({ message: GENERIC_MESSAGE })
}

async function verifyAccessCode(request, env, sql) {
  const input = await request.json().catch(() => ({}))
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return response({ error: 'El correo o el código no son válidos.' }, 400)
  const challenges = await sql`SELECT id, code_hash FROM operations.client_login_challenges
    WHERE lower(email) = ${email} AND consumed_at IS NULL AND expires_at > NOW() AND attempts_count < 5
    ORDER BY created_at DESC LIMIT 1`
  const challenge = challenges[0]
  if (!challenge) return response({ error: 'El código no es válido, venció o superó el límite de intentos.' }, 400)
  const codeHash = await hashAccessCode(env, email, code)
  if (!timingSafeEqual(String(challenge.code_hash), codeHash)) {
    await sql`UPDATE operations.client_login_challenges
      SET attempts_count = attempts_count + 1,
          consumed_at = CASE WHEN attempts_count + 1 >= 5 THEN NOW() ELSE consumed_at END
      WHERE id = ${challenge.id} AND consumed_at IS NULL AND expires_at > NOW() AND attempts_count < 5`
    return response({ error: 'El correo o el código no son válidos.' }, 400)
  }
  const rows = await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW()
    WHERE id = ${challenge.id} AND code_hash = ${codeHash} AND consumed_at IS NULL AND expires_at > NOW() AND attempts_count < 5
    RETURNING email`
  if (!rows[0]) return response({ error: 'El código no es válido o venció.' }, 400)
  const verifiedEmail = String(rows[0].email).toLowerCase()
  const matching = await sql`SELECT 1 FROM operations.requests WHERE lower(trim(email)) = ${verifiedEmail} LIMIT 1`
  if (!matching.length) return response({ error: 'El código no es válido o venció.' }, 400)
  const tokenValue = randomToken()
  await sql`INSERT INTO operations.client_sessions (email, token_hash, expires_at) VALUES (${verifiedEmail}, ${await sha256(tokenValue)}, NOW() + INTERVAL '14 days')`
  await sql`INSERT INTO operations.client_auth_events (email, event_type) VALUES (${verifiedEmail}, 'login')`
  return response({ user: { email: verifiedEmail, role: 'client' } }, 200, { 'set-cookie': sessionCookie(tokenValue) })
}

async function getSessionEmail(request, sql) {
  const token = readCookie(request, 'client_session')
  if (!token) return ''
  const rows = await sql`SELECT email FROM operations.client_sessions WHERE token_hash = ${await sha256(token)} AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`
  return rows[0]?.email ? String(rows[0].email).toLowerCase() : ''
}

function sessionCookie(token) { return `client_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/client; Max-Age=${SESSION_SECONDS}` }
function expiredCookie() { return 'client_session=; HttpOnly; Secure; SameSite=Lax; Path=/api/client; Max-Age=0' }
function readCookie(request, name) { return (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '' }
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return base64UrlBytes(bytes) }
async function sha256(value) { return base64UrlBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))) }
async function hashAccessCode(env, email, code) {
  if (!env.OPERATIONS_JWT_SECRET) throw new Error('Falta configurar el secreto para validar códigos de cliente.')
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.OPERATIONS_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${email}:${code}`)))
  return base64UrlBytes(signature)
}
function timingSafeEqual(left, right) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0 }
function base64UrlBytes(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function response(payload, status = 200, headers = {}) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }) }
