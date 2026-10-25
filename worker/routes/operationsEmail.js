import { requireOperationsAuth } from './operationsAuth.js'
import { createEmailAppNotifications, createEmailFailureAlerts, publishRequestStateUpdate } from './appNotifications.js'

export async function handleOperationsEmail(request, env) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/app\/requests\/([^/]+)\/notifications$/)
  if (!match || request.method !== 'POST') return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims?.permissions?.includes('requests.update')) return response({ error: 'No tienes permisos para enviar notificaciones.' }, 403)
  if (!env.NEON_DATABASE_URL || !(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) return response({ error: 'Falta configurar Neon, RESEND_OPERATIONS_API_KEY o RESEND_FROM_EMAIL.' }, 500)

  const body = await request.json().catch(() => ({}))
  const eventCode = typeof body.eventCode === 'string' ? body.eventCode.trim() : 'request_created'
  if (!['payment_approved', 'payment_rejected', 'request_created', 'status_changed', 'expert_assigned', 'assignment_failed', 'similar_question_review'].includes(eventCode)) return response({ error: 'Evento inválido.' }, 400)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  try {
    const idempotencyKey = request.headers.get('Idempotency-Key') || `manual/${match[1]}/${eventCode}/${crypto.randomUUID()}`
    const result = await enqueueNotification(sql, match[1], eventCode, { idempotencyKey, actorId: claims.sub })
    if (!result.queued) return response({ ok: true, queued: false, reason: result.reason }, 200)
    return response({ ok: true, queued: true, eventId: result.eventId, status: result.status }, 202)
  } catch (error) {
    return response({ error: error.message || 'No se pudo enviar la notificación.' }, 502)
  }
}

export async function sendRequestNotification(sql, env, requestId, eventCode, actorId = null, options = {}) {
  const requests = await sql`
    SELECT r.id, r.reference, r.email, r.service_name, r.service_type, r.product_type, r.status, r.source, r.payment_required,
      r.agent_id, r.assigned_expert_id, r.consultation_type_id, r.source_channel, c.full_name AS client_name,
      agent.email AS agent_email, expert.email AS expert_email
    FROM operations.requests r
    JOIN operations.clients c ON c.id = r.client_id
    LEFT JOIN operations.users agent ON agent.id = r.agent_id
    LEFT JOIN operations.users expert ON expert.id = r.assigned_expert_id
    WHERE r.id = ${requestId}
    LIMIT 1
  `
  const request = requests[0]
  if (!request) throw new Error('Solicitud no encontrada.')
  let paid = false
  if (request.payment_required) {
    const payments = await sql`SELECT EXISTS (SELECT 1 FROM operations.request_payments WHERE request_id = ${request.id} AND status = 'approved') AS paid`
    paid = Boolean(payments[0]?.paid)
  }
  const paymentPolicy = notificationPolicyForPayment(eventCode, Boolean(request.payment_required), paid, options.forceAdminOnly)
  if (!paymentPolicy.send) return { sent: false, reason: paymentPolicy.reason }
  const sourceChannel = request.source_channel || (request.source === 'agent' ? 'agent_link' : 'direct_web')

  const rules = await sql`
    SELECT id, audiences
    FROM operations.notification_rules
    WHERE event_code = ${eventCode}
      AND service_type IN ('all', ${request.service_type})
      AND (consultation_type_id IS NULL OR consultation_type_id = ${request.consultation_type_id})
      AND (source_channel IS NULL OR source_channel = ${sourceChannel})
      AND active = TRUE
    ORDER BY (consultation_type_id IS NOT NULL) DESC,
      (source_channel IS NOT NULL) DESC,
      (service_type <> 'all') DESC
  `
  const defaultAudiences = {
    request_created: ['admin', 'expert', 'agent', 'client'],
    payment_approved: ['admin', 'expert', 'agent', 'client'],
    payment_rejected: ['admin'],
    expert_assigned: ['admin', 'expert', 'agent'],
    assignment_failed: ['admin'],
    similar_question_review: ['admin'],
    status_changed: ['admin'],
    expert_response_submitted: ['admin'],
    feedback_received: ['admin'],
    feedback_low: ['admin'],
  }
  if (!rules.length && !defaultAudiences[eventCode]) return { sent: false, reason: 'no_active_rule' }

  const ruleIds = rules.map((rule) => rule.id)
  const recipients = ruleIds.length ? await sql`
    SELECT nr.email, nr.recipient_type
    FROM operations.notification_rule_recipients rnr
    JOIN operations.notification_recipients nr ON nr.id = rnr.recipient_id
    WHERE rnr.rule_id = ANY(${ruleIds}) AND nr.active = TRUE
    ORDER BY nr.name
  ` : []
  // Each event has core recipients derived from the request and its user
  // accounts. Matching rules can add audiences or extra addresses, but cannot
  // accidentally suppress the client or the assigned expert.
  const ruleAudiences = rules.flatMap((rule) => Array.isArray(rule.audiences) ? rule.audiences : [])
  const audiences = paymentPolicy.adminOnly
    ? ['admin']
    : [...new Set([...(defaultAudiences[eventCode] || ['configured']), ...ruleAudiences, ...(['assignment_failed', 'similar_question_review'].includes(eventCode) ? ['admin'] : [])])]
  const dynamic = []
  if (!paymentPolicy.adminOnly && shouldNotifyClient(eventCode, audiences)) dynamic.push(request.email)
  if (!paymentPolicy.adminOnly && (audiences.includes('agent') || audiences.includes('all_involved')) && sourceChannel === 'agent_link') dynamic.push(request.agent_email)
  if (!paymentPolicy.adminOnly && (audiences.includes('expert') || audiences.includes('all_involved'))) {
    const assignedExpertEmail = assignedExpertRecipient(request)
    if (assignedExpertEmail) dynamic.push(assignedExpertEmail)
  }
  if (paymentPolicy.adminOnly || audiences.includes('admin') || audiences.includes('all_involved')) {
    const admins = await sql`
      SELECT DISTINCT u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'admin'
      WHERE u.active = TRUE
    `
    dynamic.push(...admins.map((row) => row.email))
  }
  const configured = !paymentPolicy.adminOnly && (audiences.includes('configured') || audiences.includes('admin') || audiences.includes('all_involved')) ? recipients : []
  const unique = (values) => [...new Set(values.filter((value) => value && /^\S+@\S+\.\S+$/.test(String(value))).map(String))]
  const to = unique([...configured.filter((item) => item.recipient_type === 'to').map((item) => item.email), ...dynamic])
  const cc = unique(configured.filter((item) => item.recipient_type === 'cc').map((item) => item.email)).filter((email) => !to.includes(email))
  const bcc = unique(configured.filter((item) => item.recipient_type === 'bcc').map((item) => item.email)).filter((email) => !to.includes(email) && !cc.includes(email))
  if (!to.length) throw new Error('La regla no tiene un destinatario principal tipo Para.')

  const eventLabel = { payment_approved: 'Pago recibido', payment_rejected: 'Pago rechazado', request_created: 'Nueva solicitud recibida', expert_assigned: 'Solicitud asignada a experto', assignment_failed: 'Solicitud sin experto asignado', similar_question_review: 'Pregunta similar pendiente de validación', status_changed: 'Solicitud actualizada', expert_response_submitted: 'Respuesta de experto pendiente de revisión', feedback_received: 'Feedback recibido', feedback_low: 'Feedback con baja calificación' }[eventCode]
  const subject = `${eventLabel} · ${request.reference}`
  // Notification rules may include the assigned expert. Keep shared mail
  // content free of client identity and operation details; authorized users
  // can consult their role-scoped inbox for the information they need.
  const description = notificationDescription(eventCode)
  const text = [
    'CORTÉS RODRÍGUEZ ASESORES',
    '',
    eventLabel,
    description,
    `Solicitud: ${request.reference}`,
    '',
    'Ingresa al panel operativo para consultar las novedades de forma segura.',
    '',
    'Este mensaje fue enviado automáticamente. Por favor, no compartas este correo.',
  ].join('\n')
  const html = notificationTemplate(eventLabel, request.reference, description)
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), ...(request.email ? { reply_to: request.email } : {}), subject, text, html }),
  })
  const resendBody = await resendResponse.json().catch(() => ({}))
  if (!resendResponse.ok || !resendBody.id) throw new Error(resendBody.message || 'Resend no aceptó el envío.')

  await sql`
    INSERT INTO operations.notification_messages (request_id, event_code, resend_email_id, subject, to_emails, cc_emails, bcc_emails, status, last_event_at)
    VALUES (${request.id}, ${eventCode}, ${resendBody.id}, ${subject}, ${JSON.stringify(to)}::jsonb, ${JSON.stringify(cc)}::jsonb, ${JSON.stringify(bcc)}::jsonb, 'accepted', NOW())
    ON CONFLICT (resend_email_id) DO NOTHING
  `
  await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW() WHERE id = ${request.id}`
  if (actorId) await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'send', 'notification', ${request.id}, ${JSON.stringify({ eventCode, resendEmailId: resendBody.id })}::jsonb)`
  return { sent: true, emailId: String(resendBody.id) }
}

const notificationEventCodes = new Set([
  'payment_approved', 'payment_rejected', 'request_created', 'status_changed', 'expert_assigned',
  'assignment_failed', 'similar_question_review', 'expert_response_submitted', 'expert_response_approved',
  'feedback_received', 'feedback_low',
])

export async function enqueueNotification(sql, requestId, eventCode, {
  idempotencyKey = `${eventCode}/${requestId}`,
  adminOnly = false,
  actorId = null,
  payload = {},
  retryFailed = false,
} = {}) {
  if (!notificationEventCodes.has(eventCode)) throw new Error('notification_event_invalid')
  if (!idempotencyKey || idempotencyKey.length > 250) throw new Error('notification_idempotency_key_invalid')
  let rows = await sql`
    INSERT INTO operations.notification_outbox (request_id, event_code, idempotency_key, admin_only, actor_id, event_payload)
    VALUES (${requestId}, ${eventCode}, ${idempotencyKey}, ${adminOnly}, ${actorId}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, status
  `
  if (!rows[0]) rows = await sql`SELECT id, status FROM operations.notification_outbox WHERE idempotency_key = ${idempotencyKey} LIMIT 1`
  if (retryFailed && rows[0]?.status === 'failed') {
    rows = await sql`
      UPDATE operations.notification_outbox
      SET status = 'pending', attempts = 0, next_attempt_at = NOW(), last_error_code = NULL,
          lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${rows[0].id} AND status = 'failed'
      RETURNING id, status
    `
  }
  if (!rows[0]) return { queued: false, reason: 'duplicate_event' }
  const outbox = rows[0]
  if (outbox.status === 'pending') await sql`UPDATE operations.requests SET notification_status = 'pending_retry', updated_at = NOW() WHERE id = ${requestId}`
  return { queued: true, eventId: String(outbox.id), status: String(outbox.status) }
}

export async function dispatchPendingNotifications(env, limit = 20) {
  if (!env.NEON_DATABASE_URL || !env.NOTIFICATION_EVENTS_QUEUE) return { dispatched: 0 }
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const claimed = await sql`
    WITH due AS (
      SELECT id
      FROM operations.notification_outbox
      WHERE (status = 'pending' AND next_attempt_at <= NOW())
         OR (status = 'processing' AND lease_expires_at < NOW())
         OR (status = 'dispatching' AND dispatch_lease_expires_at < NOW())
      ORDER BY next_attempt_at, created_at
      LIMIT ${Math.max(1, Math.min(Number(limit) || 20, 100))}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE operations.notification_outbox AS event
    SET status = 'dispatching', dispatch_lease_expires_at = NOW() + INTERVAL '2 minutes', updated_at = NOW()
    FROM due
    WHERE event.id = due.id
    RETURNING event.id
  `
  let dispatched = 0
  for (const item of claimed) {
    try {
      await env.NOTIFICATION_EVENTS_QUEUE.send({ eventId: String(item.id) })
      await sql`
        UPDATE operations.notification_outbox
        SET status = 'queued', dispatch_lease_expires_at = NULL, updated_at = NOW()
        WHERE id = ${item.id} AND status = 'dispatching'
      `
      dispatched += 1
    } catch (error) {
      await sql`
        UPDATE operations.notification_outbox
        SET status = 'pending', dispatch_lease_expires_at = NULL, next_attempt_at = NOW() + INTERVAL '1 minute',
            last_error_code = 'queue_dispatch_failed', updated_at = NOW()
        WHERE id = ${item.id} AND status = 'dispatching'
      `
      console.warn(JSON.stringify({ event: 'notification_queue_dispatch_failed', severity: 'warning', outboxId: String(item.id), errorCode: 'queue_dispatch_failed' }))
    }
  }
  return { dispatched }
}

export async function dispatchPendingAppNotifications(env, limit = 50) {
  if (!env.NEON_DATABASE_URL) return { generated: 0 }
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const pending = await sql`
    SELECT id, request_id, event_code, resend_email_id
    FROM operations.notification_outbox
    WHERE status = 'sent' AND app_notifications_generated_at IS NULL AND resend_email_id IS NOT NULL
    ORDER BY sent_at, created_at
    LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 200))}
  `
  let generated = 0
  for (const item of pending) {
    try {
      await createEmailAppNotifications(sql, env, item, String(item.resend_email_id))
      await sql`UPDATE operations.notification_outbox SET app_notifications_generated_at = NOW(), updated_at = NOW() WHERE id = ${item.id} AND app_notifications_generated_at IS NULL`
      generated += 1
    } catch {
      console.warn(JSON.stringify({ event: 'app_notification_materialization_failed', severity: 'warning', outboxId: String(item.id) }))
    }
  }
  return { generated }
}

export async function consumeQueuedNotification(env, eventId) {
  if (!env.NEON_DATABASE_URL || !eventId) throw new Error('notification_queue_configuration_missing')
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  await deliverNotification(sql, env, String(eventId))
}

export async function deliverNotification(sql, env, outboxId) {
  const claimed = await sql`
    UPDATE operations.notification_outbox
    SET status = 'processing', attempts = attempts + 1,
        lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
    WHERE id = ${outboxId}
      AND (status IN ('queued', 'dispatching')
        OR (status = 'processing' AND lease_expires_at < NOW()))
    RETURNING id, request_id, event_code, idempotency_key, admin_only, actor_id, event_payload, attempts
  `
  if (!claimed[0]) return
  const item = claimed[0]
  try { await publishRequestStateUpdate(sql, env, item) }
  catch { console.warn(JSON.stringify({ event: 'request_realtime_publish_failed', severity: 'warning', errorCode: 'realtime_publish_failed' })) }
  try {
    if (!(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) throw new Error('mail_configuration_missing')
    const result = item.event_code === 'expert_response_approved'
      ? await sendApprovedResponseNotification(sql, env, item)
      : await sendRequestNotification(sql, env, item.request_id, item.event_code, item.actor_id, { idempotencyKey: `cra-${item.id}`, forceAdminOnly: Boolean(item.admin_only) })
    if (!result.sent) throw new Error(result.reason || 'notification_not_sent')
    await sql`
      UPDATE operations.notification_outbox
      SET status = 'sent', resend_email_id = ${result.emailId}, last_error_code = NULL,
          lease_expires_at = NULL, sent_at = NOW(), updated_at = NOW()
      WHERE id = ${item.id}
    `
    try { await dispatchPendingAppNotifications(env, 1) }
    catch { console.warn(JSON.stringify({ event: 'app_notification_materialization_failed', severity: 'warning', outboxId: String(item.id) })) }
  } catch (error) {
    const retry = Number(item.attempts) < 8
    const safeCode = error.message === 'mail_configuration_missing' ? error.message : 'resend_delivery_failed'
    await sql`
      UPDATE operations.notification_outbox
      SET status = ${retry ? 'pending' : 'failed'},
          next_attempt_at = NOW() + (LEAST(3600, 60 * POWER(2, GREATEST(0, ${Number(item.attempts)} - 1))) * INTERVAL '1 second'),
          lease_expires_at = NULL, last_error_code = ${safeCode}, updated_at = NOW()
      WHERE id = ${item.id}
    `
    await sql`
      UPDATE operations.requests
      SET notification_status = ${retry ? 'pending_retry' : 'failed'},
          notification_last_error = ${safeCode}, notification_last_event_at = NOW(), updated_at = NOW()
      WHERE id = ${item.request_id}
    `
    console.warn(JSON.stringify({ event: 'notification_retry_scheduled', eventCode: item.event_code, severity: retry ? 'warning' : 'error', outboxId: String(item.id), attempt: Number(item.attempts), errorCode: safeCode }))
    try { await createEmailFailureAlerts(sql, env, item, safeCode, retry) }
    catch { console.warn(JSON.stringify({ event: 'app_notification_persist_failed', severity: 'warning', outboxId: String(item.id) })) }
  }
}

async function sendApprovedResponseNotification(sql, env, item) {
  const payload = typeof item.event_payload === 'string' ? JSON.parse(item.event_payload) : item.event_payload
  const responseId = String(payload?.responseId || '')
  if (!responseId || !env.JWT_SECRET) throw new Error('notification_payload_invalid')
  const rows = await sql`
    SELECT er.id, er.request_id, er.body, er.admin_note, r.reference, r.email, c.full_name AS client_name
    FROM operations.expert_responses er
    JOIN operations.requests r ON r.id = er.request_id
    JOIN operations.clients c ON c.id = r.client_id
    WHERE er.id = ${responseId} AND er.status IN ('approved', 'sent')
    LIMIT 1
  `
  if (!rows[0]?.email) throw new Error('client_email_missing')
  const row = rows[0]
  const token = await feedbackTokenForResponse(env.JWT_SECRET, responseId)
  const tokenHash = await sha256(token)
  await sql`
    INSERT INTO operations.client_feedback (request_id, response_id, token_hash)
    VALUES (${row.request_id}, ${row.id}, ${tokenHash})
    ON CONFLICT (response_id) DO NOTHING
  `
  const baseUrl = env.PUBLIC_APP_URL || 'https://cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev'
  const feedbackUrl = `${baseUrl}/feedback?token=${encodeURIComponent(token)}`
  const portalUrl = `${baseUrl}/portal-cliente`
  const subject = `Respuesta a tu solicitud · ${row.reference}`
  const textBody = [`Hola ${row.client_name},`, '', row.body, row.admin_note ? `\nNota de administración:\n${row.admin_note}` : '', '', `¿Quieres continuar el proceso con nosotros? Accede al portal de clientes: ${portalUrl}`, '', `Evalúa esta respuesta: ${feedbackUrl}`, '', 'Gracias por confiar en Cortés Rodríguez Asesores.'].join('\n')
  const html = `<p>Hola ${escapeHtml(row.client_name)},</p><div>${escapeHtml(row.body).replaceAll('\n', '<br />')}</div>${row.admin_note ? `<p><strong>Nota de administración:</strong><br />${escapeHtml(row.admin_note).replaceAll('\n', '<br />')}</p>` : ''}<p>¿Cómo fue tu experiencia? <a href="${escapeHtml(feedbackUrl)}">Déjanos tu feedback</a>.</p><p>¿Quieres continuar el proceso con nosotros? <a href="${escapeHtml(portalUrl)}">Accede al portal de clientes</a> para consultar tus solicitudes.</p><p>Gracias por confiar en Cortés Rodríguez Asesores.</p>`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `cra-${item.id}` },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [row.email], subject, text: textBody, html }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.id) throw new Error('resend_delivery_failed')
  await sql`
    INSERT INTO operations.notification_messages (request_id, event_code, resend_email_id, subject, to_emails, status, last_event_at)
    VALUES (${row.request_id}, ${item.event_code}, ${result.id}, ${subject}, ${JSON.stringify([row.email])}::jsonb, 'accepted', NOW())
    ON CONFLICT (resend_email_id) DO NOTHING
  `
  await sql`UPDATE operations.expert_responses SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = ${row.id} AND status <> 'sent'`
  await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW() WHERE id = ${row.request_id}`
  return { sent: true, emailId: String(result.id) }
}

async function feedbackTokenForResponse(secret, responseId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`client-feedback:${responseId}`)))
  let binary = ''; signature.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function shouldNotifyClient(eventCode, audiences = []) {
  return eventCode === 'payment_approved' || audiences.includes('client') || audiences.includes('all_involved')
}

export function assignedExpertRecipient(request) {
  // `expert_email` is joined through requests.assigned_expert_id; do not expand
  // this to all users linked to the consultation type.
  return request.assigned_expert_id ? request.expert_email || null : null
}

export function notificationPolicyForPayment(eventCode, paymentRequired, paid, forceAdminOnly = false) {
  if (eventCode === 'payment_approved' && (!paymentRequired || !paid)) {
    return { send: false, adminOnly: false, reason: 'payment_required' }
  }
  if (eventCode === 'payment_rejected' || forceAdminOnly || (paymentRequired && !paid)) return { send: true, adminOnly: true, reason: null }
  return { send: true, adminOnly: false, reason: null }
}

export function notificationDescription(eventCode) {
  const descriptions = {
    payment_approved: 'Recibimos y confirmamos el pago de tu solicitud. Nuestro equipo está revisando tu caso y pronto te contactaremos con la respuesta correspondiente.',
    payment_rejected: 'El pago asociado a esta solicitud no fue aprobado. Revisa el caso en el panel.',
    request_created: 'Se recibió una nueva solicitud y quedó registrada en la plataforma.',
    expert_assigned: 'La solicitud fue asignada o reasignada a un experto.',
    assignment_failed: 'No hay expertos activos asociados a este tipo de consulta. La solicitud quedó en la cola administrativa y requiere asignación manual.',
    similar_question_review: 'La solicitud tiene coincidencias con respuestas aprobadas anteriores y requiere validación administrativa antes de asignarse.',
    status_changed: 'El estado de esta solicitud fue actualizado.',
    expert_response_submitted: 'Un experto envió su respuesta y está pendiente de revisión administrativa.',
    expert_response_approved: 'La respuesta revisada por nuestro equipo está lista para ti.',
    feedback_received: 'El cliente compartió su opinión sobre la respuesta recibida.',
    feedback_low: 'Se recibió una calificación baja que requiere seguimiento administrativo.',
  }
  return descriptions[eventCode] || 'Hay una novedad relacionada con esta solicitud.'
}

function notificationTemplate(title, reference, description) {
  const safeTitle = escapeHtml(title)
  const safeReference = escapeHtml(reference)
  const safeDescription = escapeHtml(description)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#243b53">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${safeTitle} · Solicitud ${safeReference}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f9;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e1e8ef;border-radius:12px;overflow:hidden">
      <tr><td style="padding:22px 28px;background:#0b3553;color:#fff;font-size:14px;font-weight:700;letter-spacing:.04em">CORTÉS RODRÍGUEZ <span style="color:#9dd6d7">ASESORES</span></td></tr>
      <tr><td style="padding:32px 28px 12px"><p style="margin:0 0 10px;color:#54829a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Aviso de operación</p><h1 style="margin:0;color:#173b58;font-size:24px;line-height:1.3">${safeTitle}</h1></td></tr>
      <tr><td style="padding:12px 28px 28px"><p style="margin:0 0 22px;color:#63788b;font-size:14px;line-height:1.6">${safeDescription}</p><p style="margin:0 0 8px;color:#63788b;font-size:12px">Referencia de solicitud</p><div style="padding:15px 17px;border:1px solid #dce7ef;border-radius:8px;background:#f7fafc;color:#174b6b;font-size:16px;font-weight:700">${safeReference}</div><p style="margin:20px 0 0;color:#63788b;font-size:14px;line-height:1.6">Ingresa al panel operativo para consultar las novedades de forma segura.</p></td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e8edf2;color:#8796a5;font-size:11px;line-height:1.6">Mensaje automático de Cortés Rodríguez Asesores. Por seguridad, no compartas este correo.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
