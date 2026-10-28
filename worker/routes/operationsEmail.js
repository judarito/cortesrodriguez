import { requireOperationsAuth } from './operationsAuth.js'
import { createEmailAppNotifications, createEmailFailureAlerts, publishRequestStateUpdate } from './appNotifications.js'

const adminEmailEvents = new Set(['payment_approved', 'expert_assigned', 'assignment_failed', 'similar_question_review', 'expert_response_submitted'])

export async function handleOperationsEmail(request, env) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/app\/requests\/([^/]+)\/notifications$/)
  if (!match || request.method !== 'POST') return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.permissions?.includes('requests.update')) return response({ error: 'No tienes permisos para enviar notificaciones.' }, 403)
  if (!env.NEON_DATABASE_URL || !(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) return response({ error: 'Falta configurar Neon, RESEND_OPERATIONS_API_KEY o RESEND_FROM_EMAIL.' }, 500)

  const body = await request.json().catch(() => ({}))
  const eventCode = typeof body.eventCode === 'string' ? body.eventCode.trim() : 'request_created'
  if (!['payment_approved', 'payment_rejected', 'request_created', 'status_changed', 'expert_assigned', 'assignment_failed', 'similar_question_review'].includes(eventCode)) return response({ error: 'Evento inválido.' }, 400)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  try {
    const idempotencyKey = request.headers.get('Idempotency-Key') || `manual/${match[1]}/${eventCode}/${crypto.randomUUID()}`
    const result = await enqueueNotification(sql, match[1], eventCode, { env, idempotencyKey, actorId: claims.sub })
    if (!result.queued) return response({ ok: true, queued: false, reason: result.reason }, 200)
    return response({ ok: true, queued: true, eventId: result.eventId, status: result.status }, 202)
  } catch (error) {
    return response({ error: error.message || 'No se pudo enviar la notificación.' }, 502)
  }
}

export async function sendRequestNotification(sql, env, requestId, eventCode, actorId = null, options = {}) {
  if (eventCode === 'expert_assigned' && options.assignmentId && options.expertId) {
    const current = await isCurrentAssignment(sql, requestId, options.assignmentId, options.expertId)
    if (!current) return { sent: false, reason: 'assignment_superseded' }
  }
  const requests = await sql`
    SELECT r.id, r.reference, r.email, r.preferred_locale, r.service_name, r.service_type, r.product_type, r.status, r.source, r.payment_required,
      r.agent_id, r.assigned_expert_id, r.consultation_type_id, r.source_channel, c.full_name AS client_name,
      agent.email AS agent_email, expert.email AS expert_email,
      payment.usd_amount_cents AS paid_usd_amount_cents, payment.cop_amount_cents AS paid_cop_amount_cents
    FROM operations.requests r
    JOIN operations.clients c ON c.id = r.client_id
    LEFT JOIN operations.users agent ON agent.id = r.agent_id
    LEFT JOIN operations.users expert ON expert.id = r.assigned_expert_id AND expert.active = TRUE
      AND EXISTS (SELECT 1 FROM operations.user_roles ur JOIN operations.roles role ON role.id = ur.role_id WHERE ur.user_id = expert.id AND role.name = 'expert')
      AND (r.consultation_type_id IS NULL OR EXISTS (
        SELECT 1 FROM operations.consultation_type_experts cte
        WHERE cte.consultation_type_id = r.consultation_type_id AND cte.user_id = expert.id AND cte.active = TRUE
      ))
    LEFT JOIN LATERAL (
      SELECT usd_amount_cents, cop_amount_cents
      FROM operations.request_payments
      WHERE request_id = r.id AND status = 'approved'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) payment ON TRUE
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
  const ruleSourceChannel = sourceChannel === 'admin_entry' ? 'direct_web' : sourceChannel

  const rules = await sql`
    SELECT id, audiences
    FROM operations.notification_rules
    WHERE event_code = ${eventCode}
      AND service_type IN ('all', ${request.service_type})
      AND (consultation_type_id IS NULL OR consultation_type_id = ${request.consultation_type_id})
      AND (source_channel IS NULL OR source_channel = ${ruleSourceChannel})
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
  let adminEmails = []
  if (audiences.includes('admin') || audiences.includes('all_involved') || paymentPolicy.adminOnly) {
    const admins = await sql`
      SELECT DISTINCT u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'admin'
      WHERE u.active = TRUE
    `
    adminEmails = admins.map((row) => String(row.email).toLowerCase())
    if (adminEmailAllowedForEvent(eventCode) && (paymentPolicy.adminOnly || audiences.includes('admin') || audiences.includes('all_involved'))) dynamic.push(...admins.map((row) => row.email))
  }
  const configured = !paymentPolicy.adminOnly && (audiences.includes('configured') || audiences.includes('admin') || audiences.includes('all_involved'))
    ? recipients.filter((recipient) => adminEmailAllowedForEvent(eventCode) || !adminEmails.includes(String(recipient.email).toLowerCase()))
    : []
  const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
  const validEmails = (values) => [...new Set(values.filter((value) => /^\S+@\S+\.\S+$/.test(normalizeEmail(value))).map(normalizeEmail))]
  const clientEmail = normalizeEmail(request.email)
  const expertEmail = normalizeEmail(assignedExpertRecipient(request))
  const expertIsRecipient = Boolean(expertEmail && dynamic.some((email) => normalizeEmail(email) === expertEmail))
  const clientIsRecipient = Boolean(!paymentPolicy.adminOnly && clientEmail && shouldNotifyClient(eventCode, audiences) && dynamic.some((email) => normalizeEmail(email) === clientEmail) && clientEmail !== expertEmail)
  const generalRecipients = validEmails([
    ...configured.map((recipient) => recipient.email),
    ...dynamic.filter((email) => normalizeEmail(email) !== expertEmail && normalizeEmail(email) !== clientEmail),
  ]).filter((email) => email !== expertEmail && email !== clientEmail)
  const deliveries = [
    ...generalRecipients.map((email) => ({ email, audience: 'general' })),
    ...(clientIsRecipient ? [{ email: clientEmail, audience: 'client' }] : []),
    ...(expertIsRecipient ? [{ email: expertEmail, audience: 'expert' }] : []),
  ]
  if (!deliveries.length) return { sent: false, reason: 'email_not_required' }
  if (!(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) throw new Error('mail_configuration_missing')

  const eventLabel = { payment_approved: 'Pago recibido', payment_rejected: 'Pago rechazado', request_created: 'Nueva solicitud recibida', expert_assigned: 'Solicitud asignada a experto', assignment_failed: 'Solicitud sin experto asignado', similar_question_review: 'Pregunta similar pendiente de validación', status_changed: 'Solicitud actualizada', expert_response_submitted: 'Respuesta de experto pendiente de revisión', feedback_received: 'Feedback recibido', feedback_low: 'Feedback con baja calificación' }[eventCode]
  const clientLocale = request.preferred_locale === 'en' ? 'en' : 'es'
  const clientEventLabel = localizedNotificationLabel(eventCode, clientLocale)
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
  let lastEmailId = null
  for (const delivery of deliveries) {
    // Expert messages use only this fixed allowlist: organization name and a
    // generic operational notice. They contain no request, client, or event data.
    const expertText = 'CORTÉS RODRÍGUEZ ASESORES\n\nTienes una notificación operativa. Ingresa al panel autorizado para consultarla.'
    const expertHtml = '<!doctype html><html lang="es"><body><p>CORTÉS RODRÍGUEZ ASESORES</p><p>Tienes una notificación operativa. Ingresa al panel autorizado para consultarla.</p></body></html>'
    const isExpertDelivery = delivery.audience === 'expert'
    const isPaymentClient = delivery.audience === 'client' && eventCode === 'payment_approved'
    const isClientDelivery = delivery.audience === 'client'
    const portalUrl = clientPortalUrl(env)
    const usdAmount = Number.isFinite(Number(request.paid_usd_amount_cents)) ? `${(Number(request.paid_usd_amount_cents) / 100).toFixed(2)} USD` : ''
    const copAmount = Number.isFinite(Number(request.paid_cop_amount_cents)) ? `${(Number(request.paid_cop_amount_cents) / 100).toLocaleString('es-CO')} COP` : ''
    const paymentText = isPaymentClient
      ? clientLocale === 'en'
        ? ['Hello,', '', 'We received and confirmed the payment for your request. Our team is reviewing your case and will contact you with a response soon.', '', `Reference: ${request.reference}`, usdAmount ? `Consultation price: ${usdAmount}` : '', copAmount ? `Total paid: ${copAmount}` : '', '', `View your requests in the client portal: ${portalUrl}`, '', 'Cortés Rodríguez Asesores'].filter(Boolean).join('\n')
        : ['Hola,', '', 'Recibimos y confirmamos el pago de tu solicitud. Nuestro equipo está revisando tu caso y pronto te contactaremos con la respuesta correspondiente.', '', `Referencia: ${request.reference}`, usdAmount ? `Valor de la consulta: ${usdAmount}` : '', copAmount ? `Total pagado: ${copAmount}` : '', '', `Consulta tus solicitudes en el portal de clientes: ${portalUrl}`, '', 'Cortés Rodríguez Asesores'].filter(Boolean).join('\n')
      : ''
    const clientText = isClientDelivery && !isPaymentClient
      ? [clientLocale === 'en' ? 'Hello,' : 'Hola,', '', notificationDescription(eventCode, clientLocale), '', `${clientLocale === 'en' ? 'Reference' : 'Referencia'}: ${request.reference}`, '', `${clientLocale === 'en' ? 'View your requests in the client portal' : 'Consulta tus solicitudes en el portal de clientes'}: ${portalUrl}`, '', 'Cortés Rodríguez Asesores'].join('\n')
      : ''
    const paymentHtml = isPaymentClient ? paymentConfirmationTemplate(request.reference, usdAmount, copAmount, portalUrl, clientLocale) : ''
    const clientHtml = isClientDelivery && !isPaymentClient ? clientNotificationTemplate(clientEventLabel, request.reference, notificationDescription(eventCode, clientLocale), portalUrl, clientLocale) : ''
    const templateVersion = isExpertDelivery ? 'expert-v1' : isClientDelivery ? `client-${clientLocale}-v1` : 'general-v1'
    const emailPayload = {
      from: env.RESEND_FROM_EMAIL,
      to: [delivery.email],
      subject: isExpertDelivery ? 'Notificación operativa' : isClientDelivery ? `${clientEventLabel} · ${request.reference}` : subject,
      text: isExpertDelivery ? expertText : isPaymentClient ? paymentText : isClientDelivery ? clientText : text,
      html: isExpertDelivery ? expertHtml : isPaymentClient ? paymentHtml : isClientDelivery ? clientHtml : html,
    }
    const effectKey = `${options.idempotencyKey || `request/${request.id}/${eventCode}`}/${templateVersion}`
    const result = await sendEmailEffect(sql, env, {
      effectKey,
      recipient: delivery.email,
      payload: emailPayload,
      requestId: request.id,
      eventCode,
      messageSubject: emailPayload.subject,
      outboxId: options.outboxId,
    })
    if (!result.sent) throw new Error(result.reason || 'notification_delivery_pending')
    lastEmailId = result.emailId || lastEmailId
  }
  if (options.leaseToken) {
    await sql`UPDATE operations.requests r SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW()
      WHERE r.id = ${request.id} AND EXISTS (
        SELECT 1 FROM operations.notification_outbox event
        WHERE event.id = ${options.outboxId} AND event.status = 'processing' AND event.lease_token = ${options.leaseToken}::uuid
      )`
  } else {
    await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW() WHERE id = ${request.id}`
  }
  if (actorId) await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'send', 'notification', ${request.id}, ${JSON.stringify({ eventCode, resendEmailId: lastEmailId })}::jsonb)`
  return { sent: true, emailId: lastEmailId }
}

export async function sendEmailEffect(sql, env, { effectKey, recipient, payload, requestId, eventCode, messageSubject, outboxId = null }) {
  if (!effectKey || !recipient || !payload || !requestId || !eventCode) throw new Error('notification_effect_invalid')
  const payloadJson = JSON.stringify(payload)
  const payloadHash = await sha256(payloadJson)
  // A fixed-length digest keeps the Resend key under its 256 character limit,
  // regardless of caller supplied outbox keys or recipient address length.
  const resendKey = `cra-email-v1-${await sha256(`${effectKey}\n${recipient}\n${payloadHash}`)}`
  await sql`
    INSERT INTO operations.notification_email_effects
      (effect_key, request_id, event_code, recipient_email, resend_idempotency_key, payload_sha256, status)
    VALUES (${effectKey}, ${requestId}, ${eventCode}, ${recipient}, ${resendKey}, ${payloadHash}, 'pending')
    ON CONFLICT (effect_key, recipient_email) DO NOTHING
  `
  let rows = await sql`
    SELECT id, resend_idempotency_key, payload_sha256, status, resend_email_id
    FROM operations.notification_email_effects
    WHERE effect_key = ${effectKey} AND recipient_email = ${recipient}
    LIMIT 1
  `
  const effect = rows[0]
  if (!effect || effect.payload_sha256 !== payloadHash || effect.resend_idempotency_key !== resendKey) {
    throw new Error('notification_effect_payload_conflict')
  }
  if (effect.status === 'accepted') {
    await recordAcceptedEmailMessage(sql, { requestId, eventCode, emailId: effect.resend_email_id, recipient, messageSubject })
    await updateAppNotificationEmail(sql, { outboxId, requestId, recipient, emailId: effect.resend_email_id })
    return { sent: true, emailId: effect.resend_email_id, alreadyAccepted: true }
  }
  if (effect.status === 'uncertain') return { sent: false, reason: 'notification_delivery_uncertain' }

  // The first attempt timestamp is never reset. Within Resend's retention
  // window an expired lease can safely retry with the identical key and body.
  const claimed = await sql`
    UPDATE operations.notification_email_effects
    SET status = 'sending', attempts = attempts + 1, lease_token = gen_random_uuid(),
        first_attempt_at = COALESCE(first_attempt_at, NOW()), last_attempt_at = NOW(),
        last_error_code = NULL, updated_at = NOW()
    WHERE id = ${effect.id}
      AND (status IN ('pending', 'retryable') OR
        (status = 'sending' AND first_attempt_at > NOW() - INTERVAL '24 hours'
          AND last_attempt_at < NOW() - INTERVAL '5 minutes'))
      AND (first_attempt_at IS NULL OR first_attempt_at > NOW() - INTERVAL '24 hours')
    RETURNING id, lease_token
  `
  if (!claimed[0]) {
    await sql`
      UPDATE operations.notification_email_effects
      SET status = 'uncertain', last_error_code = 'resend_idempotency_window_expired', updated_at = NOW()
      WHERE id = ${effect.id} AND status IN ('pending', 'retryable', 'sending')
        AND first_attempt_at <= NOW() - INTERVAL '24 hours'
    `
    rows = await sql`
      SELECT status FROM operations.notification_email_effects WHERE id = ${effect.id} LIMIT 1
    `
    return { sent: false, reason: rows[0]?.status === 'uncertain' ? 'notification_delivery_uncertain' : 'notification_delivery_in_progress' }
  }

  let resendResponse
  let resendBody = {}
  try {
    resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': resendKey,
      },
      body: payloadJson,
    })
    resendBody = await resendResponse.json().catch(() => ({}))
  } catch (error) {
    await sql`
      UPDATE operations.notification_email_effects
      SET status = 'retryable', last_error_code = 'resend_result_unknown', updated_at = NOW()
      WHERE id = ${effect.id} AND status = 'sending' AND lease_token = ${claimed[0].lease_token}::uuid
    `
    throw error
  }
  if (!resendResponse.ok || !resendBody.id) {
    const errorCode = !resendResponse.ok ? `resend_http_${resendResponse.status}` : 'resend_response_invalid'
    await sql`
      UPDATE operations.notification_email_effects
      SET status = 'retryable', last_error_code = ${errorCode}, updated_at = NOW()
      WHERE id = ${effect.id} AND status = 'sending' AND lease_token = ${claimed[0].lease_token}::uuid
    `
    throw new Error(resendBody.message || 'Resend no aceptó el envío.')
  }
  const emailId = String(resendBody.id)
  const acceptedEffect = await sql`
    UPDATE operations.notification_email_effects
    SET status = 'accepted', resend_email_id = ${emailId}, accepted_at = NOW(), updated_at = NOW()
    WHERE id = ${effect.id} AND status = 'sending' AND lease_token = ${claimed[0].lease_token}::uuid
    RETURNING id
  `
  if (!acceptedEffect.length) return { sent: false, reason: 'notification_delivery_in_progress' }
  await recordAcceptedEmailMessage(sql, { requestId, eventCode, emailId, recipient, messageSubject })
  await updateAppNotificationEmail(sql, { outboxId, requestId, recipient, emailId })
  return { sent: true, emailId }
}

async function recordAcceptedEmailMessage(sql, { requestId, eventCode, emailId, recipient, messageSubject }) {
  await sql`
    INSERT INTO operations.notification_messages (request_id, event_code, resend_email_id, subject, to_emails, cc_emails, bcc_emails, status, last_event_at)
    VALUES (${requestId}, ${eventCode}, ${emailId}, ${messageSubject}, ${JSON.stringify([recipient])}::jsonb, '[]'::jsonb, '[]'::jsonb, 'accepted', NOW())
    ON CONFLICT (resend_email_id) DO NOTHING
  `
}

async function updateAppNotificationEmail(sql, { outboxId, requestId, recipient, emailId }) {
  if (!outboxId || !emailId) return
  await sql`
    UPDATE operations.app_notifications notification
    SET resend_email_id = ${emailId}, email_status = 'accepted', updated_at = NOW()
    FROM operations.users u
    WHERE notification.user_id = u.id AND notification.request_id = ${requestId}
      AND notification.idempotency_key LIKE ${`event/${outboxId}/%`}
      AND lower(u.email) = ${recipient}
  `
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
  env = null,
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
  if (env?.NOTIFICATION_EVENTS_QUEUE && outbox.status === 'pending') {
    try { await publishNotificationEvent(sql, env, String(outbox.id)) }
    catch { /* Durable outbox remains eligible for bounded recovery. */ }
  }
  return { queued: true, eventId: String(outbox.id), status: String(outbox.status) }
}

export async function publishNotificationEvent(sql, env, eventId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(eventId)) || !env?.NOTIFICATION_EVENTS_QUEUE) return false
  const claimed = await sql`
    UPDATE operations.notification_outbox
    SET status = 'dispatching', dispatch_lease_expires_at = NOW() + INTERVAL '2 minutes', dispatch_lease_token = gen_random_uuid(), updated_at = NOW()
    WHERE id = ${eventId} AND status = 'pending' AND next_attempt_at <= NOW()
    RETURNING id, dispatch_lease_token
  `
  if (!claimed[0]) return false
  try {
    await env.NOTIFICATION_EVENTS_QUEUE.send({ eventId: String(claimed[0].id) })
    await sql`UPDATE operations.notification_outbox SET status = 'queued', dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL, updated_at = NOW() WHERE id = ${claimed[0].id} AND status = 'dispatching' AND dispatch_lease_token = ${claimed[0].dispatch_lease_token}::uuid`
    return true
  } catch (error) {
    await sql`UPDATE operations.notification_outbox SET status = 'pending', dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL, next_attempt_at = NOW() + INTERVAL '1 minute', last_error_code = 'queue_dispatch_failed', updated_at = NOW() WHERE id = ${claimed[0].id} AND status = 'dispatching' AND dispatch_lease_token = ${claimed[0].dispatch_lease_token}::uuid`
    throw error
  }
}

export async function recordQueueFailure(sql, queueName, message, messageKind) {
  const payload = JSON.stringify(message?.body ?? null)
  const payloadHash = await sha256(payload)
  const rawEventId = message?.body?.eventId
  const eventId = isUuid(rawEventId) ? rawEventId : null
  await sql`
    INSERT INTO operations.notification_queue_failures
      (queue_message_id, queue_name, event_id, message_kind, payload_sha256, delivery_attempts)
    SELECT ${String(message?.id || `${queueName}:${payloadHash}`)}, ${String(queueName)},
      CASE WHEN ${eventId}::text IS NOT NULL AND EXISTS (
        SELECT 1 FROM operations.notification_outbox WHERE id = ${eventId}::uuid
      ) THEN ${eventId}::uuid ELSE NULL END,
      ${messageKind}, ${payloadHash}, ${Math.max(0, Number(message?.attempts) || 0)}
    ON CONFLICT (queue_message_id) DO NOTHING
  `
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
         OR (status = 'queued' AND updated_at < NOW() - INTERVAL '15 minutes')
      ORDER BY next_attempt_at, created_at
      LIMIT ${Math.max(1, Math.min(Number(limit) || 20, 100))}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE operations.notification_outbox AS event
    SET status = 'dispatching', dispatch_lease_expires_at = NOW() + INTERVAL '2 minutes', dispatch_lease_token = gen_random_uuid(), updated_at = NOW()
    FROM due
    WHERE event.id = due.id
    RETURNING event.id, event.dispatch_lease_token
  `
  let dispatched = 0
  for (const item of claimed) {
    try {
      await env.NOTIFICATION_EVENTS_QUEUE.send({ eventId: String(item.id) })
      await sql`
        UPDATE operations.notification_outbox
        SET status = 'queued', dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL, updated_at = NOW()
        WHERE id = ${item.id} AND status = 'dispatching' AND dispatch_lease_token = ${item.dispatch_lease_token}::uuid
      `
      dispatched += 1
    } catch (error) {
      await sql`
        UPDATE operations.notification_outbox
        SET status = 'pending', dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL, next_attempt_at = NOW() + INTERVAL '1 minute',
            last_error_code = 'queue_dispatch_failed', updated_at = NOW()
        WHERE id = ${item.id} AND status = 'dispatching' AND dispatch_lease_token = ${item.dispatch_lease_token}::uuid
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
    SELECT id, request_id, event_code, resend_email_id, event_payload, admin_only, actor_id
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
  if (!env.NEON_DATABASE_URL || typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error('notification_queue_configuration_missing')
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  await deliverNotification(sql, env, String(eventId))
}

export async function deliverNotification(sql, env, outboxId) {
  if (typeof outboxId !== 'string' || !/^[0-9a-f-]{36}$/i.test(outboxId)) return
  const claimed = await sql`
    UPDATE operations.notification_outbox
    SET status = 'processing', attempts = attempts + 1, lease_token = gen_random_uuid(), dispatch_lease_token = NULL,
        lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
    WHERE id = ${outboxId}
      AND (status IN ('queued', 'dispatching')
        OR (status = 'processing' AND lease_expires_at < NOW()))
    RETURNING id, request_id, event_code, idempotency_key, admin_only, actor_id, event_payload, attempts, lease_token
  `
  if (!claimed[0]) return
  const item = claimed[0]
  if (!notificationEventCodes.has(item.event_code) || typeof item.admin_only !== 'boolean' || !item.idempotency_key || !item.request_id) {
    await sql`UPDATE operations.notification_outbox SET status = 'failed', last_error_code = 'notification_contract_invalid', lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, updated_at = NOW() WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid`
    return
  }
  if (item.event_code === 'expert_assigned') {
    const payload = parseEventPayload(item.event_payload)
    const assignmentId = typeof payload?.assignmentId === 'string' ? payload.assignmentId : ''
    const expertId = typeof payload?.expertId === 'string' ? payload.expertId : ''
    if (!isUuid(assignmentId) || !isUuid(expertId) || !await isCurrentAssignment(sql, item.request_id, assignmentId, expertId)) {
      await sql`UPDATE operations.notification_outbox SET status = 'cancelled', last_error_code = 'assignment_superseded', lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, updated_at = NOW() WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid`
      return
    }
    item.event_payload = payload
  }
  if (item.event_code === 'expert_response_approved') {
    let payload
    try { payload = typeof item.event_payload === 'string' ? JSON.parse(item.event_payload || '{}') : item.event_payload } catch { payload = null }
    if (!payload || typeof payload.responseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.responseId)) {
      await sql`UPDATE operations.notification_outbox SET status = 'failed', last_error_code = 'notification_contract_invalid', lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, updated_at = NOW() WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid`
      return
    }
  }
  try { await publishRequestStateUpdate(sql, env, item) }
  catch { console.warn(JSON.stringify({ event: 'request_realtime_publish_failed', severity: 'warning', errorCode: 'realtime_publish_failed' })) }
  try {
    await createEmailAppNotifications(sql, env, item, null, 'pending_retry')
    await sql`UPDATE operations.notification_outbox SET app_notifications_generated_at = COALESCE(app_notifications_generated_at, NOW()), updated_at = NOW() WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid`
    const result = item.event_code === 'expert_response_approved'
      ? await sendApprovedResponseNotification(sql, env, item)
      : await sendRequestNotification(sql, env, item.request_id, item.event_code, item.actor_id, { idempotencyKey: `cra-${item.id}`, outboxId: String(item.id), forceAdminOnly: Boolean(item.admin_only), leaseToken: item.lease_token, assignmentId: item.event_payload?.assignmentId, expertId: item.event_payload?.expertId })
    if (result.reason === 'assignment_superseded') {
      await sql`UPDATE operations.notification_outbox SET status = 'cancelled', last_error_code = 'assignment_superseded', lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, updated_at = NOW() WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid`
      return
    }
    if (!result.sent && result.reason === 'email_not_required') {
      await sql`
        UPDATE operations.notification_outbox
        SET status = 'sent', last_error_code = NULL, lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, sent_at = NOW(), updated_at = NOW()
        WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid
      `
      return
    }
    if (!result.sent) throw new Error(result.reason || 'notification_not_sent')
    await sql`
      UPDATE operations.notification_outbox
      SET status = 'sent', resend_email_id = ${result.emailId}, last_error_code = NULL,
          lease_expires_at = NULL, lease_token = NULL, dispatch_lease_token = NULL, sent_at = NOW(), updated_at = NOW()
      WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid
    `
    try { await dispatchPendingAppNotifications(env, 1) }
    catch { console.warn(JSON.stringify({ event: 'app_notification_materialization_failed', severity: 'warning', outboxId: String(item.id) })) }
  } catch (error) {
    const uncertain = error.message === 'notification_delivery_uncertain'
    const retry = !uncertain && Number(item.attempts) < 8
    const safeCode = ['mail_configuration_missing', 'notification_delivery_uncertain'].includes(error.message)
      ? error.message
      : 'resend_delivery_failed'
    await sql`
      UPDATE operations.app_notifications
      SET email_status = ${retry ? 'pending_retry' : 'failed'}, updated_at = NOW()
      WHERE request_id = ${item.request_id} AND idempotency_key LIKE ${`event/${item.id}/%`}
        AND EXISTS (SELECT 1 FROM operations.notification_outbox current_event WHERE current_event.id = ${item.id} AND current_event.lease_token = ${item.lease_token}::uuid)
    `
    await sql`
      UPDATE operations.notification_outbox
      SET status = ${retry ? 'pending' : 'failed'},
          next_attempt_at = NOW() + (LEAST(3600, 60 * POWER(2, GREATEST(0, ${Number(item.attempts)} - 1))) * INTERVAL '1 second'),
          lease_expires_at = NULL, lease_token = NULL, dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL, last_error_code = ${safeCode}, updated_at = NOW()
      WHERE id = ${item.id} AND lease_token = ${item.lease_token}::uuid
    `
    await sql`
      UPDATE operations.requests
      SET notification_status = ${retry ? 'pending_retry' : 'failed'},
          notification_last_error = ${safeCode}, notification_last_event_at = NOW(), updated_at = NOW()
      WHERE id = ${item.request_id} AND EXISTS (SELECT 1 FROM operations.notification_outbox current_event WHERE current_event.id = ${item.id} AND current_event.lease_token = ${item.lease_token}::uuid)
    `
    console.warn(JSON.stringify({ event: 'notification_retry_scheduled', eventCode: item.event_code, severity: retry ? 'warning' : 'error', outboxId: String(item.id), attempt: Number(item.attempts), errorCode: safeCode }))
    try { await createEmailFailureAlerts(sql, env, item, safeCode, retry) }
    catch { console.warn(JSON.stringify({ event: 'app_notification_persist_failed', severity: 'warning', outboxId: String(item.id) })) }
  }
}

async function sendApprovedResponseNotification(sql, env, item) {
  if (!(env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) || !env.RESEND_FROM_EMAIL) throw new Error('mail_configuration_missing')
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
  const emailResult = await sendEmailEffect(sql, env, {
    effectKey: `cra-${item.id}/general-v1`,
    recipient: String(row.email).trim().toLowerCase(),
    requestId: String(row.request_id),
    eventCode: item.event_code,
    messageSubject: subject,
    outboxId: String(item.id),
    payload: { from: env.RESEND_FROM_EMAIL, to: [row.email], subject, text: textBody, html },
  })
  if (!emailResult.sent) throw new Error(emailResult.reason || 'notification_delivery_pending')
  await sql`UPDATE operations.expert_responses SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
    WHERE id = ${row.id} AND status <> 'sent' AND EXISTS (
      SELECT 1 FROM operations.notification_outbox event
      WHERE event.id = ${item.id} AND event.status = 'processing' AND event.lease_token = ${item.lease_token}::uuid
    )`
  await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_event_at = NOW(), notification_last_error = NULL, updated_at = NOW()
    WHERE id = ${row.request_id} AND EXISTS (
      SELECT 1 FROM operations.notification_outbox event
      WHERE event.id = ${item.id} AND event.status = 'processing' AND event.lease_token = ${item.lease_token}::uuid
    )`
  return { sent: true, emailId: String(emailResult.emailId) }
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

export function adminEmailAllowedForEvent(eventCode) {
  return adminEmailEvents.has(eventCode)
}

function parseEventPayload(value) {
  try { return typeof value === 'string' ? JSON.parse(value || '{}') : value || {} } catch { return null }
}

function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

async function isCurrentAssignment(sql, requestId, assignmentId, expertId) {
  if (!isUuid(String(requestId)) || !isUuid(String(assignmentId)) || !isUuid(String(expertId))) return false
  const rows = await sql`
    SELECT 1
    FROM operations.request_assignments assignment
    JOIN operations.requests request ON request.id = assignment.request_id
    JOIN operations.users expert ON expert.id = assignment.expert_id AND expert.active = TRUE
    JOIN operations.user_roles ur ON ur.user_id = expert.id
    JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
    WHERE assignment.id = ${assignmentId}::uuid AND assignment.request_id = ${requestId}::uuid
      AND assignment.expert_id = ${expertId}::uuid AND assignment.status IN ('assigned', 'reassigned')
      AND request.assigned_expert_id = assignment.expert_id
      AND (request.consultation_type_id IS NULL OR EXISTS (
        SELECT 1 FROM operations.consultation_type_experts cte
        WHERE cte.consultation_type_id = request.consultation_type_id
          AND cte.user_id = expert.id AND cte.active = TRUE
      ))
    LIMIT 1
  `
  return rows.length > 0
}

export function notificationDescription(eventCode, locale = 'es') {
  if (locale === 'en') {
    const descriptions = {
      payment_approved: 'We received and confirmed your payment. Our team is reviewing your case and will contact you with a response soon.',
      payment_rejected: 'The payment for this request was not approved. Please review the payment in the client portal.',
      request_created: 'Your request was received and registered.',
      expert_assigned: 'An expert has been assigned to your request.',
      assignment_failed: 'Your request is being reviewed by our operations team.',
      similar_question_review: 'Your request is being reviewed by our operations team.',
      status_changed: 'The status of your request has been updated.',
      expert_response_submitted: 'A response to your request is being reviewed by our team.',
      expert_response_approved: 'The response reviewed by our team is ready for you.',
    }
    return descriptions[eventCode] || 'There is an update regarding your request.'
  }
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

function localizedNotificationLabel(eventCode, locale) {
  const labels = {
    en: {
      payment_approved: 'Payment received', payment_rejected: 'Payment not approved', request_created: 'Request received',
      expert_assigned: 'Expert assigned', assignment_failed: 'Request under review', similar_question_review: 'Request under review',
      status_changed: 'Request updated', expert_response_submitted: 'Response under review', feedback_received: 'Feedback received', feedback_low: 'Feedback follow-up',
    },
    es: {
      payment_approved: 'Pago recibido', payment_rejected: 'Pago rechazado', request_created: 'Nueva solicitud recibida',
      expert_assigned: 'Solicitud asignada a experto', assignment_failed: 'Solicitud sin experto asignado', similar_question_review: 'Pregunta similar pendiente de validación',
      status_changed: 'Solicitud actualizada', expert_response_submitted: 'Respuesta de experto pendiente de revisión', feedback_received: 'Feedback recibido', feedback_low: 'Feedback con baja calificación',
    },
  }
  return labels[locale]?.[eventCode] || labels.es[eventCode] || 'Actualización de solicitud'
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

function paymentConfirmationTemplate(reference, usdAmount, copAmount, portalUrl, locale = 'es') {
  const english = locale === 'en'
  const safeReference = escapeHtml(reference)
  const amountRows = [
    usdAmount ? `<tr><td style="padding:10px 0;color:#64788a">${english ? 'Consultation price' : 'Valor de la consulta'}</td><td align="right" style="padding:10px 0;color:#173b58;font-weight:700">${escapeHtml(usdAmount)}</td></tr>` : '',
    copAmount ? `<tr><td style="padding:10px 0;color:#64788a">${english ? 'Total paid' : 'Total pagado'}</td><td align="right" style="padding:10px 0;color:#173b58;font-weight:700">${escapeHtml(copAmount)}</td></tr>` : '',
  ].join('')
  const copy = english
    ? { lang: 'en', kicker: 'Payment received', title: 'Your payment is confirmed', intro: 'We received the payment for your request. Our team is reviewing your case and will contact you with a response soon.', reference: 'Request reference', action: 'View my requests', footer: 'Automated message from Cortés Rodríguez Asesores.' }
    : { lang: 'es', kicker: 'Pago recibido', title: 'Confirmamos tu pago', intro: 'Recibimos el pago de tu solicitud. Nuestro equipo está revisando tu caso y pronto te contactaremos con la respuesta correspondiente.', reference: 'Referencia de solicitud', action: 'Consultar mis solicitudes', footer: 'Mensaje automático de Cortés Rodríguez Asesores.' }
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:28px 12px;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#243b53"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e1e8ef;border-radius:12px"><tr><td style="padding:22px 28px;background:#0b3553;color:#fff;font-size:14px;font-weight:700">CORTÉS RODRÍGUEZ ASESORES</td></tr><tr><td style="padding:30px 28px"><p style="margin:0 0 8px;color:#54829a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${copy.kicker}</p><h1 style="margin:0;color:#173b58;font-size:23px">${copy.title}</h1><p style="margin:14px 0;color:#63788b;font-size:14px;line-height:1.6">${copy.intro}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e8edf2;border-bottom:1px solid #e8edf2"><tr><td style="padding:10px 0;color:#64788a">${copy.reference}</td><td align="right" style="padding:10px 0;color:#173b58;font-weight:700">${safeReference}</td></tr>${amountRows}</table><p style="margin:24px 0;text-align:center"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:13px 22px;border-radius:7px;background:#104b6d;color:#fff;font-size:14px;font-weight:700;text-decoration:none">${copy.action}</a></p><p style="margin:0;color:#8796a5;font-size:11px;line-height:1.5">${copy.footer}</p></td></tr></table></td></tr></table></body></html>`
}

function clientNotificationTemplate(title, reference, description, portalUrl, locale) {
  const english = locale === 'en'
  const safeTitle = escapeHtml(title)
  const safeReference = escapeHtml(reference)
  const safeDescription = escapeHtml(description)
  const copy = english
    ? { lang: 'en', kicker: 'Request update', reference: 'Request reference', action: 'View my requests', footer: 'Automated message from Cortés Rodríguez Asesores.' }
    : { lang: 'es', kicker: 'Actualización de solicitud', reference: 'Referencia de solicitud', action: 'Consultar mis solicitudes', footer: 'Mensaje automático de Cortés Rodríguez Asesores.' }
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:28px 12px;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#243b53"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e1e8ef;border-radius:12px"><tr><td style="padding:22px 28px;background:#0b3553;color:#fff;font-size:14px;font-weight:700">CORTÉS RODRÍGUEZ ASESORES</td></tr><tr><td style="padding:30px 28px"><p style="margin:0 0 8px;color:#54829a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${copy.kicker}</p><h1 style="margin:0;color:#173b58;font-size:23px">${safeTitle}</h1><p style="margin:14px 0;color:#63788b;font-size:14px;line-height:1.6">${safeDescription}</p><p style="margin:0 0 8px;color:#64788a;font-size:12px">${copy.reference}</p><div style="padding:15px 17px;border:1px solid #dce7ef;border-radius:8px;background:#f7fafc;color:#174b6b;font-size:16px;font-weight:700">${safeReference}</div><p style="margin:24px 0;text-align:center"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:13px 22px;border-radius:7px;background:#104b6d;color:#fff;font-size:14px;font-weight:700;text-decoration:none">${copy.action}</a></p><p style="margin:0;color:#8796a5;font-size:11px;line-height:1.5">${copy.footer}</p></td></tr></table></td></tr></table></body></html>`
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function clientPortalUrl(env) {
  let base
  try { base = new URL(env.PUBLIC_APP_URL || 'https://cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev') }
  catch { throw new Error('client_portal_url_invalid') }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('client_portal_url_must_use_https')
  return new URL('/portal-cliente', base.origin).toString()
}
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
