import {
  createClientPaymentPreference,
  createClientBricksPaymentIntent,
  processClientBricksPayment,
  recoverClientBricksPayment,
} from './publicRequests.js'

const encoder = new TextEncoder()
const SESSION_SECONDS = 60 * 60 * 24 * 14
const GENERIC_MESSAGE = 'Si encontramos solicitudes asociadas a ese correo, enviaremos un código de acceso.'
const requestReferencePattern = /^CRA-[A-Z0-9-]{8,40}$/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function handleClientPortal(request, env) {
  const url = new URL(request.url)
  const requestMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)$/)
  const attachmentMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)\/attachments\/([^/]+)$/)
  const paymentMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)\/payment-preference$/)
  const bricksIntentMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)\/payment-bricks-intent$/)
  const bricksProcessMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)\/payment-bricks-process$/)
  const bricksRecoverMatch = url.pathname.match(/^\/api\/client\/requests\/([^/]+)\/payment-bricks-recover$/)
  const routes = {
    '/api/client/access-code': request.method === 'POST',
    '/api/client/session': request.method === 'POST' || request.method === 'GET',
    '/api/client/requests': request.method === 'GET',
    '/api/client/logout': request.method === 'POST',
  }
  const isRequestList = url.pathname === '/api/client/requests' && request.method === 'GET'
  const isRequestDetail = Boolean(requestMatch) && request.method === 'GET'
  const isAttachment = Boolean(attachmentMatch) && request.method === 'GET'
  const isPaymentPreference = Boolean(paymentMatch) && request.method === 'POST'
  const isBricksIntent = Boolean(bricksIntentMatch) && request.method === 'POST'
  const isBricksProcess = Boolean(bricksProcessMatch) && request.method === 'POST'
  const isBricksRecover = Boolean(bricksRecoverMatch) && request.method === 'POST'
  if (!routes[url.pathname] && !isRequestList && !isRequestDetail && !isAttachment && !isPaymentPreference && !isBricksIntent && !isBricksProcess && !isBricksRecover) return null
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

  if (isRequestDetail) return requestDetail(sql, email, decodeSegment(requestMatch[1]))
  if (isAttachment) return clientAttachment(sql, email, decodeSegment(attachmentMatch[1]), attachmentMatch[2], env)
  if (isPaymentPreference) {
    const reference = decodeSegment(paymentMatch[1])
    if (!requestReferencePattern.test(reference)) return response({ error: 'Solicitud no encontrada.' }, 404)
    if (Number(request.headers.get('content-length') || 0) > 16_384) return response({ error: 'Los datos del pago superan el tamaño permitido.' }, 413)
    const input = await request.json().catch(() => ({}))
    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : ''
    if (!uuidPattern.test(idempotencyKey)) return response({ error: 'La clave del intento de pago no es válida.' }, 400)
    const paymentRequest = new Request(request.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference, idempotencyKey }),
    })
    return createClientPaymentPreference(paymentRequest, env, email)
  }
  if (isBricksIntent || isBricksProcess || isBricksRecover) {
    const match = bricksIntentMatch || bricksProcessMatch || bricksRecoverMatch
    const reference = decodeSegment(match[1])
    if (!requestReferencePattern.test(reference)) return response({ error: 'Solicitud no encontrada.' }, 404)
    if (Number(request.headers.get('content-length') || 0) > 16_384) return response({ error: 'Los datos del pago superan el tamaño permitido.' }, 413)
    const input = await request.json().catch(() => ({}))
    if (isBricksIntent) {
      const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : ''
      if (!uuidPattern.test(idempotencyKey)) return response({ error: 'La clave del intento de pago no es válida.' }, 400)
      const paymentRequest = new Request(request.url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference, idempotencyKey }),
      })
      return createClientBricksPaymentIntent(paymentRequest, env, email)
    }
    if (isBricksRecover) {
      const paymentRequest = new Request(request.url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference }),
      })
      const result = await recoverClientBricksPayment(paymentRequest, env, email)
      return result || response({ checkoutMode: 'pro' }, 200, { 'cache-control': 'no-store' })
    }
    const attemptId = typeof input.attemptId === 'string' ? input.attemptId : ''
    if (!uuidPattern.test(attemptId)) return response({ error: 'El intento de pago no es válido.' }, 400)
    const ownedAttempt = await sql`
      SELECT 1 FROM operations.request_payments payment
      JOIN operations.requests request ON request.id = payment.request_id
      WHERE payment.id = ${attemptId}::uuid AND payment.checkout_mode = 'bricks'
        AND request.reference = ${reference} AND lower(trim(request.email)) = ${email}
      LIMIT 1
    `
    if (!ownedAttempt.length) return response({ error: 'El intento de pago no pertenece a esta solicitud.' }, 404)
    return processClientBricksPayment(new Request(request.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }), env, email)
  }

  const page = Math.max(1, Math.min(100000, Number(url.searchParams.get('page')) || 1))
  const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get('pageSize')) || 10))
  const offset = (page - 1) * pageSize
  const [items, counts] = await Promise.all([
    sql`SELECT r.reference, r.service_type, r.consultation_type_name, r.specialty_name, r.status, r.created_at,
        r.service_amount_cents, r.service_currency, r.payment_required,
        COALESCE((SELECT p.status FROM operations.request_payments p WHERE p.request_id = r.id ORDER BY p.created_at DESC LIMIT 1),
          CASE WHEN r.payment_required THEN 'not_started' ELSE 'not_required' END) AS payment_status,
        EXISTS (SELECT 1 FROM operations.request_payments p WHERE p.request_id = r.id AND p.status = 'approved') AS payment_approved
      FROM operations.requests r
      WHERE lower(trim(r.email)) = ${email}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE lower(trim(email)) = ${email}`,
  ])
  const totalItems = Number(counts[0]?.total || 0)
  return response({
    items: items.map((row) => ({
      reference: String(row.reference), service: row.service_type ? String(row.service_type) : '',
      consultation: row.consultation_type_name ? String(row.consultation_type_name) : row.specialty_name ? String(row.specialty_name) : '',
      status: String(row.status), paymentStatus: String(row.payment_status), paymentApproved: Boolean(row.payment_approved),
      paymentRequired: Boolean(row.payment_required), amountCents: Number(row.service_amount_cents || 0),
      currency: String(row.service_currency || 'USD'), createdAt: String(row.created_at),
    })),
    pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  })
}

async function requestDetail(sql, email, reference) {
  if (!requestReferencePattern.test(reference)) return response({ error: 'Solicitud no encontrada.' }, 404)
  const requests = await sql`
    SELECT id, reference, question, service_type, general_service_name, consultation_type_name, specialty_name,
      status, created_at, payment_required, service_amount_cents, service_currency
    FROM operations.requests
    WHERE reference = ${reference} AND lower(trim(email)) = ${email}
    LIMIT 1
  `
  const request = requests[0]
  if (!request) return response({ error: 'Solicitud no encontrada.' }, 404)
  const [attempts, attachments, responses] = await Promise.all([
    sql`SELECT id, status, checkout_mode, provider_submission_started_at, init_point, usd_amount_cents, cop_amount_cents, trm_cop_per_usd, trm_effective_date, created_at
      FROM operations.request_payments WHERE request_id = ${request.id} ORDER BY created_at DESC LIMIT 20`,
    sql`SELECT id, original_name, mime_type, created_at FROM operations.request_attachments
      WHERE request_id = ${request.id} AND status = 'available' AND storage_key LIKE ${`requests/${request.id}/%`}
      ORDER BY created_at DESC`,
    sql`SELECT body, admin_note, updated_at FROM operations.expert_responses
      WHERE request_id = ${request.id} AND status IN ('approved', 'sent') ORDER BY updated_at DESC LIMIT 1`,
  ])
  const paymentApproved = attempts.some((attempt) => String(attempt.status) === 'approved')
  const latest = attempts[0] || null
  const requestClosed = ['closed', 'cancelled'].includes(String(request.status))
  let paymentAction = 'none'
  if (Boolean(request.payment_required) && !paymentApproved && !requestClosed) {
    if (!latest || ['rejected', 'cancelled', 'creation_failed'].includes(String(latest.status))) paymentAction = latest ? 'retry' : 'pay'
    else if (['pending', 'in_process'].includes(String(latest.status)) && latest.init_point) paymentAction = 'resume'
    else if (String(latest?.checkout_mode || 'pro') === 'bricks' && ['pending', 'in_process'].includes(String(latest.status))) paymentAction = latest.provider_submission_started_at ? 'checking' : 'resume'
    else if (['creating', 'creation_uncertain'].includes(String(latest.status))) paymentAction = 'checking'
  }
  return response({
    item: {
      reference: String(request.reference),
      question: String(request.question || ''),
      service: String(request.general_service_name || request.service_type || ''),
      consultation: String(request.consultation_type_name || request.specialty_name || ''),
      status: String(request.status), createdAt: String(request.created_at),
      paymentRequired: Boolean(request.payment_required), paymentApproved,
      amountCents: Number(request.service_amount_cents || 0), currency: String(request.service_currency || 'USD'),
      paymentStatus: latest ? String(latest.status) : (request.payment_required ? 'not_started' : 'not_required'),
      paymentAction,
      checkoutMode: String(latest?.checkout_mode || 'pro'),
      paymentAttemptId: latest?.id ? String(latest.id) : null,
      paymentSubmitted: Boolean(latest?.provider_submission_started_at),
      paymentAttempts: attempts.map((attempt) => ({
        id: String(attempt.id), checkoutMode: String(attempt.checkout_mode || 'pro'),
        paymentSubmitted: Boolean(attempt.provider_submission_started_at),
        status: String(attempt.status), usdAmountCents: Number(attempt.usd_amount_cents),
        copAmountCents: Number(attempt.cop_amount_cents), trm: Number(attempt.trm_cop_per_usd),
        trmDate: String(attempt.trm_effective_date), createdAt: String(attempt.created_at),
      })),
      attachments: attachments.map((attachment) => ({
        id: String(attachment.id), name: String(attachment.original_name), mimeType: String(attachment.mime_type),
        url: `/api/client/requests/${encodeURIComponent(String(request.reference))}/attachments/${encodeURIComponent(String(attachment.id))}`,
      })),
      response: responses[0] ? { body: String(responses[0].body), note: String(responses[0].admin_note || ''), updatedAt: String(responses[0].updated_at) } : null,
    },
  })
}

async function clientAttachment(sql, email, reference, attachmentId, env) {
  if (!requestReferencePattern.test(reference) || !uuidPattern.test(attachmentId)) return response({ error: 'Adjunto no encontrado.' }, 404)
  if (!env.GALLERY_IMAGES) return response({ error: 'El archivo no está disponible temporalmente.' }, 503)
  const rows = await sql`
    SELECT attachment.storage_key, attachment.mime_type
    FROM operations.request_attachments attachment
    JOIN operations.requests request ON request.id = attachment.request_id
    WHERE request.reference = ${reference} AND lower(trim(request.email)) = ${email}
      AND attachment.id = ${attachmentId}::uuid AND attachment.status = 'available'
      AND attachment.storage_key LIKE ('requests/' || request.id::text || '/%')
    LIMIT 1
  `
  if (!rows[0] || !/^image\/(jpeg|png|webp)$/.test(String(rows[0].mime_type))) return response({ error: 'Adjunto no encontrado.' }, 404)
  const object = await env.GALLERY_IMAGES.get(String(rows[0].storage_key))
  if (!object) return response({ error: 'Adjunto no encontrado.' }, 404)
  return new Response(object.body, { headers: {
    'content-type': String(rows[0].mime_type), 'cache-control': 'private, no-store, max-age=0',
    'x-content-type-options': 'nosniff', 'content-disposition': 'inline',
  } })
}

function decodeSegment(value) {
  try { return decodeURIComponent(value) } catch { return '' }
}

async function requestAccessCode(request, env, sql) {
  const input = await request.json().catch(() => ({}))
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'Ingresa un correo electrónico válido.' }, 400)
  const matching = await sql`SELECT 1 FROM operations.requests WHERE lower(trim(email)) = ${email} LIMIT 1`
  if (!matching.length) return response({ message: GENERIC_MESSAGE })

  const clientIp = request.headers.get('cf-connecting-ip')?.trim()
  if (clientIp) {
    const ipHash = await hashClientIp(env, clientIp)
    const ipClaims = await sql`INSERT INTO operations.client_login_ip_rate_limits
        (ip_hash, window_started_at, request_count)
      VALUES (${ipHash}, NOW(), 1)
      ON CONFLICT (ip_hash) DO UPDATE SET
        window_started_at = CASE
          WHEN operations.client_login_ip_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE operations.client_login_ip_rate_limits.window_started_at END,
        request_count = CASE
          WHEN operations.client_login_ip_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
          ELSE operations.client_login_ip_rate_limits.request_count + 1 END,
        updated_at = NOW()
      WHERE operations.client_login_ip_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes'
        OR operations.client_login_ip_rate_limits.request_count < 12
      RETURNING request_count`
    if (!ipClaims.length) return response({ message: GENERIC_MESSAGE })
  }

  const leaseToken = crypto.randomUUID()
  const claims = await sql`INSERT INTO operations.client_login_rate_limits
      (email, window_started_at, request_count, request_lease_token, request_lease_expires_at)
    VALUES (${email}, NOW(), 1, ${leaseToken}::uuid, NOW() + INTERVAL '1 minute')
    ON CONFLICT (email) DO UPDATE SET
      window_started_at = CASE
        WHEN operations.client_login_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
        ELSE operations.client_login_rate_limits.window_started_at END,
      request_count = CASE
        WHEN operations.client_login_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
        ELSE operations.client_login_rate_limits.request_count + 1 END,
      request_lease_token = ${leaseToken}::uuid,
      request_lease_expires_at = NOW() + INTERVAL '1 minute',
      updated_at = NOW()
    WHERE (operations.client_login_rate_limits.window_started_at <= NOW() - INTERVAL '15 minutes'
        OR operations.client_login_rate_limits.request_count < 4)
      AND (operations.client_login_rate_limits.request_lease_expires_at IS NULL
        OR operations.client_login_rate_limits.request_lease_expires_at <= NOW())
    RETURNING request_count`
  if (!claims.length) return response({ message: GENERIC_MESSAGE })

  let challengeId = ''
  let emailAccepted = false
  try {
    await sql`INSERT INTO operations.client_auth_events (email, event_type) VALUES (${email}, 'code_requested')`
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
    const challenges = await sql`INSERT INTO operations.client_login_challenges (email, code_hash, expires_at)
      VALUES (${email}, ${await hashAccessCode(env, email, code)}, NOW() + INTERVAL '10 minutes') RETURNING id`
    challengeId = String(challenges[0]?.id || '')
    if (!challengeId) throw new Error('portal_access_challenge_insert_failed')
    if (!env.RESEND_FROM_EMAIL || !(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY)) {
      console.error('Portal de clientes: faltan variables de envío de correo.')
      await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW() WHERE id = ${challengeId}::uuid AND consumed_at IS NULL`
      return response({ message: GENERIC_MESSAGE })
    }
    const html = `<p>Hola,</p><p>Usa este código para acceder a tus solicitudes en Cortés Rodríguez Asesores:</p><p style="font-size:30px;font-weight:800;letter-spacing:8px;color:#0e4567">${code}</p><p>El código vence en 10 minutos y solo puede usarse una vez. Si no solicitaste el acceso, puedes ignorar este mensaje.</p>`
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [email], subject: 'Tu código de acceso · Portal de clientes', html, text: `Tu código de acceso al portal de clientes es: ${code}\n\nVence en 10 minutos y solo puede usarse una vez. Si no solicitaste el acceso, ignora este correo.` }),
      signal: AbortSignal.timeout(15000),
    })
    if (!result.ok) {
      console.error('No se pudo enviar el acceso al portal de clientes:', (await result.text()).slice(0, 300))
      await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW() WHERE id = ${challengeId}::uuid AND consumed_at IS NULL`
      return response({ message: GENERIC_MESSAGE })
    }
    emailAccepted = true
    await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW()
      WHERE lower(email) = ${email} AND id <> ${challengeId}::uuid AND consumed_at IS NULL`
    return response({ message: GENERIC_MESSAGE })
  } catch (error) {
    if (challengeId && !emailAccepted) await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW() WHERE id = ${challengeId}::uuid AND consumed_at IS NULL`.catch(() => {})
    console.error('No se pudo completar el envío del acceso al portal de clientes:', error.message)
    return response({ message: GENERIC_MESSAGE })
  } finally {
    await sql`UPDATE operations.client_login_rate_limits
      SET request_lease_token = NULL, request_lease_expires_at = NULL, updated_at = NOW()
      WHERE email = ${email} AND request_lease_token = ${leaseToken}::uuid`.catch(() => {})
  }
}

async function verifyAccessCode(request, env, sql) {
  const input = await request.json().catch(() => ({}))
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return response({ error: 'El correo o el código no son válidos.' }, 400)
  const challenges = await sql`WITH next_challenge AS MATERIALIZED (
      SELECT id FROM operations.client_login_challenges
      WHERE lower(email) = ${email} AND consumed_at IS NULL AND expires_at > NOW() AND attempts_count < 5
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE
    )
    UPDATE operations.client_login_challenges challenge
    SET attempts_count = challenge.attempts_count + 1
    FROM next_challenge
    WHERE challenge.id = next_challenge.id
    RETURNING challenge.id, challenge.code_hash, challenge.attempts_count`
  const challenge = challenges[0]
  if (!challenge) return response({ error: 'El código no es válido, venció o superó el límite de intentos.' }, 400)
  const codeHash = await hashAccessCode(env, email, code)
  if (!timingSafeEqual(String(challenge.code_hash), codeHash)) {
    if (Number(challenge.attempts_count) >= 5) {
      await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW()
        WHERE id = ${challenge.id} AND consumed_at IS NULL`
    }
    return response({ error: 'El correo o el código no son válidos.' }, 400)
  }
  const rows = await sql`UPDATE operations.client_login_challenges SET consumed_at = NOW()
    WHERE id = ${challenge.id} AND code_hash = ${codeHash} AND consumed_at IS NULL AND expires_at > NOW() AND attempts_count <= 5
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
async function hashClientIp(env, ip) {
  if (!env.OPERATIONS_JWT_SECRET) throw new Error('Falta configurar el secreto para validar códigos de cliente.')
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.OPERATIONS_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`client-portal-ip:${ip}`)))
  return base64UrlBytes(signature)
}
function timingSafeEqual(left, right) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0 }
function base64UrlBytes(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function response(payload, status = 200, headers = {}) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }) }
