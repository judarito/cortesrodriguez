import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsEmail(request, env) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/app\/requests\/([^/]+)\/notifications$/)
  if (!match || request.method !== 'POST') return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims?.permissions?.includes('requests.update')) return response({ error: 'No tienes permisos para enviar notificaciones.' }, 403)
  if (!env.NEON_DATABASE_URL || !(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) return response({ error: 'Falta configurar Neon, RESEND_OPERATIONS_API_KEY o RESEND_FROM_EMAIL.' }, 500)

  const body = await request.json().catch(() => ({}))
  const eventCode = typeof body.eventCode === 'string' ? body.eventCode.trim() : 'request_created'
  if (!['payment_approved', 'payment_rejected', 'request_created', 'status_changed'].includes(eventCode)) return response({ error: 'Evento inválido.' }, 400)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  try {
    const result = await sendRequestNotification(sql, env, match[1], eventCode, claims.sub)
    if (!result.sent) return response({ ok: true, sent: false, reason: result.reason }, 200)
    return response({ ok: true, sent: true, emailId: result.emailId, status: 'accepted' }, 201)
  } catch (error) {
    return response({ error: error.message || 'No se pudo enviar la notificación.' }, 502)
  }
}

export async function sendRequestNotification(sql, env, requestId, eventCode, actorId = null) {
  const requests = await sql`
    SELECT r.id, r.reference, r.email, r.service_type, r.product_type, r.status, c.full_name AS client_name
    FROM operations.requests r
    JOIN operations.clients c ON c.id = r.client_id
    WHERE r.id = ${requestId}
    LIMIT 1
  `
  const request = requests[0]
  if (!request) throw new Error('Solicitud no encontrada.')

  const rules = await sql`
    SELECT id, name
    FROM operations.notification_rules
    WHERE event_code = ${eventCode}
      AND service_type IN ('all', ${request.service_type})
      AND active = TRUE
    ORDER BY CASE WHEN service_type = ${request.service_type} THEN 0 ELSE 1 END
    LIMIT 1
  `
  if (!rules.length) return { sent: false, reason: 'no_active_rule' }

  const recipients = await sql`
    SELECT nr.email, nr.recipient_type
    FROM operations.notification_rule_recipients rnr
    JOIN operations.notification_recipients nr ON nr.id = rnr.recipient_id
    WHERE rnr.rule_id = ${rules[0].id} AND nr.active = TRUE
    ORDER BY nr.name
  `
  const to = recipients.filter((item) => item.recipient_type === 'to').map((item) => String(item.email))
  const cc = recipients.filter((item) => item.recipient_type === 'cc').map((item) => String(item.email))
  const bcc = recipients.filter((item) => item.recipient_type === 'bcc').map((item) => String(item.email))
  if (!to.length) throw new Error('La regla no tiene un destinatario principal tipo Para.')

  const eventLabel = { payment_approved: 'Pago aprobado', payment_rejected: 'Pago rechazado', request_created: 'Nueva solicitud', status_changed: 'Solicitud actualizada' }[eventCode]
  const subject = `${eventLabel} · ${request.reference}`
  const text = [
    `${eventLabel}: ${request.reference}`,
    `Cliente: ${request.client_name}`,
    `Servicio: ${request.service_type}`,
    `Producto: ${request.product_type}`,
    `Estado: ${request.status}`,
  ].join('\n')
  const html = `<h2>${escapeHtml(eventLabel)}</h2><p><strong>Solicitud:</strong> ${escapeHtml(request.reference)}</p><p><strong>Cliente:</strong> ${escapeHtml(request.client_name)}</p><p><strong>Servicio:</strong> ${escapeHtml(request.service_type)}</p><p><strong>Producto:</strong> ${escapeHtml(request.product_type)}</p><p><strong>Estado:</strong> ${escapeHtml(request.status)}</p>`
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), ...(request.email ? { reply_to: request.email } : {}), subject, text, html }),
  })
  const resendBody = await resendResponse.json().catch(() => ({}))
  if (!resendResponse.ok || !resendBody.id) throw new Error(resendBody.message || 'Resend no aceptó el envío.')

  await sql`
    INSERT INTO operations.notification_messages (request_id, event_code, resend_email_id, subject, to_emails, cc_emails, bcc_emails, status, last_event_at)
    VALUES (${request.id}, ${eventCode}, ${resendBody.id}, ${subject}, ${JSON.stringify(to)}::jsonb, ${JSON.stringify(cc)}::jsonb, ${JSON.stringify(bcc)}::jsonb, 'accepted', NOW())
  `
  await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW() WHERE id = ${request.id}`
  if (actorId) await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'send', 'notification', ${request.id}, ${JSON.stringify({ eventCode, resendEmailId: resendBody.id })}::jsonb)`
  return { sent: true, emailId: String(resendBody.id) }
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
