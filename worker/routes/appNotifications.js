import { requireActiveOperationsAuth } from './operationsAuth.js'

export async function handleAppNotifications(request, env) {
  const url = new URL(request.url)
  const isCollection = url.pathname === '/api/app/notifications' && request.method === 'GET'
  const isTicket = url.pathname === '/api/app/notifications/realtime-ticket' && request.method === 'POST'
  const readMatch = url.pathname.match(/^\/api\/app\/notifications\/([^/]+)\/read$/)
  const isRead = Boolean(readMatch) && request.method === 'POST'
  const isRealtime = url.pathname === '/api/app/notifications/realtime' && request.method === 'GET'
  if (!isCollection && !isTicket && !isRead && !isRealtime) return null
  if (isRead && !/^[0-9a-f-]{36}$/i.test(readMatch[1])) return json({ error: 'Identificador de notificación inválido.' }, 400)
  if (!env.NEON_DATABASE_URL) return json({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  if (isRealtime) {
    if (!env.APP_NOTIFICATION_HUB || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Realtime no disponible.', { status: 503 })
    if (request.headers.get('origin') !== url.origin) return new Response('Origen no autorizado.', { status: 403 })
    const rawTicket = url.searchParams.get('ticket') || ''
    if (!rawTicket || rawTicket.length > 120) return new Response('Ticket requerido.', { status: 401 })
    const ticketHash = await sha256(rawTicket)
    const tickets = await sql`
      UPDATE operations.notification_realtime_tickets AS ticket
      SET consumed_at = NOW()
      FROM operations.sessions s JOIN operations.users u ON u.id = s.user_id
      WHERE ticket.token_hash = ${ticketHash} AND ticket.consumed_at IS NULL AND ticket.expires_at > NOW()
        AND s.token_hash = ticket.session_token_hash AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.active = TRUE
      RETURNING ticket.user_id
    `
    if (!tickets[0]) return new Response('Ticket inválido o vencido.', { status: 401 })
    const userId = String(tickets[0].user_id)
    const id = env.APP_NOTIFICATION_HUB.idFromName(userId)
    const stub = env.APP_NOTIFICATION_HUB.get(id)
    return stub.fetch(new Request('https://notifications.internal/connect', {
      headers: { Upgrade: 'websocket', 'x-notification-user-id': userId },
    }))
  }

  const claims = await requireActiveOperationsAuth(request, env)
  if (!claims) return json({ error: 'Sesión requerida.' }, 401)

  if (isTicket) {
    const rawTicket = crypto.randomUUID() + crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 90_000).toISOString()
    await sql`DELETE FROM operations.notification_realtime_tickets WHERE expires_at < NOW() OR consumed_at < NOW() - INTERVAL '1 day'`
    await sql`INSERT INTO operations.notification_realtime_tickets (token_hash, user_id, session_token_hash, expires_at) VALUES (${await sha256(rawTicket)}, ${claims.sub}, ${await sha256(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '')}, ${expiresAt})`
    return json({ ticket: rawTicket, expiresAt })
  }

  if (isCollection) {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50)
    const cursor = parseCursor(url.searchParams.get('before'))
    const [items, counts] = await Promise.all([
      sql`
        SELECT id, request_id, event_code, audience_role, title, message, target_path, email_status, read_at, created_at
        FROM operations.app_notifications
        WHERE user_id = ${claims.sub}
          AND (${cursor ? sql`(created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql`TRUE`})
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `,
      sql`SELECT COUNT(*)::int AS unread_count FROM operations.app_notifications WHERE user_id = ${claims.sub} AND read_at IS NULL`,
    ])
    return json({
      items: items.map(serializeNotification),
      unreadCount: Number(counts[0]?.unread_count || 0),
      nextCursor: items.length === limit ? `${items.at(-1).created_at}|${items.at(-1).id}` : null,
    })
  }

  const updated = await sql`
    UPDATE operations.app_notifications
    SET read_at = COALESCE(read_at, NOW()), updated_at = NOW()
    WHERE id = ${readMatch[1]} AND user_id = ${claims.sub}
    RETURNING id, request_id, event_code, audience_role, title, message, target_path, email_status, read_at, created_at
  `
  if (!updated[0]) return json({ error: 'Notificación no encontrada.' }, 404)
  const counts = await sql`SELECT COUNT(*)::int AS unread_count FROM operations.app_notifications WHERE user_id = ${claims.sub} AND read_at IS NULL`
  return json({ item: serializeNotification(updated[0]), unreadCount: Number(counts[0]?.unread_count || 0) })
}

export async function createEmailAppNotifications(sql, env, outboxItem, resendEmailId) {
  const requests = await sql`
    SELECT r.id, r.reference, r.source_channel, r.source, r.agent_id, r.assigned_expert_id, r.created_by
    FROM operations.requests r WHERE r.id = ${outboxItem.request_id} LIMIT 1
  `
  const request = requests[0]
  if (!request) return
  const eventCode = String(outboxItem.event_code)
  const audiences = roleAudiences(eventCode, request)
  const recipientIds = roleRecipientIds(eventCode, request)
  const emailRows = await sql`SELECT status FROM operations.notification_messages WHERE resend_email_id = ${resendEmailId} LIMIT 1`
  const emailStatus = String(emailRows[0]?.status || 'accepted')
  const resolvedFailures = await sql`
    UPDATE operations.app_notifications
    SET message = ${`${request.reference}: el reintento fue aceptado por Resend; la entrega todavía está pendiente.`},
        email_status = ${emailStatus}, updated_at = NOW()
    WHERE request_id = ${request.id} AND idempotency_key = ${`email_failure/${outboxItem.id}`}
    RETURNING id, user_id
  `
  await publishRealtime(env, resolvedFailures)
  const users = await sql`
    SELECT DISTINCT ON (u.id) u.id, role.name AS role_name
    FROM operations.users u
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles role ON role.id = ur.role_id
    WHERE u.active = TRUE AND (
      (role.name = 'admin' AND ${audiences.admin}) OR
      (u.id = ${recipientIds.agentId} AND role.name = 'agent') OR
      (u.id = ${recipientIds.expertId} AND role.name = 'expert')
    )
    ORDER BY u.id, CASE role.name WHEN 'admin' THEN 0 WHEN 'agent' THEN 1 ELSE 2 END
  `
  const messages = notificationCopy(eventCode, request.reference)
  const inserted = []
  for (const user of users) {
    const role = String(user.role_name)
    const copy = messages[role]
    if (!copy) continue
    const rows = await sql`
      INSERT INTO operations.app_notifications
        (user_id, request_id, resend_email_id, idempotency_key, event_code, audience_role, title, message, target_path, email_status)
      VALUES (
        ${user.id}, ${request.id}, ${resendEmailId}, ${`email/${outboxItem.id}/${role}/${user.id}`}, ${eventCode}, ${role},
        ${copy.title}, ${copy.message}, ${`/app?request=${request.id}`}, ${emailStatus}
      )
      ON CONFLICT (user_id, idempotency_key) DO NOTHING
      RETURNING id, user_id
    `
    inserted.push(...rows)
  }
  await publishRealtime(env, inserted)
}

export async function createEmailFailureAlerts(sql, env, outboxItem, errorCode, willRetry) {
  const admins = await sql`
    SELECT DISTINCT u.id FROM operations.users u
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'admin'
    WHERE u.active = TRUE
  `
  const requestRows = await sql`SELECT id, reference FROM operations.requests WHERE id = ${outboxItem.request_id} LIMIT 1`
  if (!requestRows[0]) return
  const request = requestRows[0]
  const inserted = []
  for (const admin of admins) {
    const rows = await sql`
      INSERT INTO operations.app_notifications
        (user_id, request_id, idempotency_key, event_code, audience_role, title, message, target_path, email_status)
      VALUES (
        ${admin.id}, ${request.id}, ${`email_failure/${outboxItem.id}`}, 'email_delivery_failed', 'admin',
        'No se pudo enviar un correo', ${`${request.reference}: ${willRetry ? 'queda programado para reintento' : 'agotó los reintentos'} (${errorCode}).`},
        ${`/app?request=${request.id}`}, ${willRetry ? 'pending_retry' : 'failed'}
      ) ON CONFLICT (user_id, idempotency_key) DO UPDATE SET
        message = EXCLUDED.message, email_status = EXCLUDED.email_status, updated_at = NOW()
      RETURNING id, user_id
    `
    inserted.push(...rows)
  }
  await publishRealtime(env, inserted)
}

export async function updateEmailAppNotificationStatus(sql, env, resendEmailId, status) {
  const rows = await sql`
    UPDATE operations.app_notifications
    SET email_status = CASE
      WHEN CASE email_status WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'opened' THEN 3 WHEN 'failed' THEN 4 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5 ELSE 0 END
         > CASE ${status} WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'opened' THEN 3 WHEN 'failed' THEN 4 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5 ELSE 0 END
      THEN email_status ELSE ${status} END,
      updated_at = NOW()
    WHERE resend_email_id = ${resendEmailId}
      AND (email_status <> ${status})
    RETURNING id, user_id
  `
  await publishRealtime(env, rows)
  if (['failed', 'bounced', 'complained'].includes(status)) {
    const outbox = await sql`SELECT id, request_id, event_code, attempts FROM operations.notification_outbox WHERE resend_email_id = ${resendEmailId}`
    for (const item of outbox) await createEmailFailureAlerts(sql, env, item, `resend_${status}`, false)
  }
}

async function publishRealtime(env, rows) {
  if (!env.APP_NOTIFICATION_HUB || !rows.length) return
  for (const row of rows) {
    try {
      const stub = env.APP_NOTIFICATION_HUB.get(env.APP_NOTIFICATION_HUB.idFromName(String(row.user_id)))
      await stub.fetch('https://notifications.internal/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notificationId: String(row.id) }),
      })
    } catch (error) {
      console.warn(JSON.stringify({ event: 'app_notification_realtime_publish_failed', severity: 'warning', errorCode: 'realtime_publish_failed' }))
    }
  }
}

export function roleAudiences(eventCode, request) {
  const fromAgent = request.source_channel === 'agent_link' || request.source === 'agent'
  const audiences = { admin: true, agent: false, expert: false }
  if (fromAgent && request.agent_id && ['request_created', 'payment_approved', 'expert_assigned', 'status_changed', 'expert_response_approved', 'feedback_received', 'feedback_low'].includes(eventCode)) audiences.agent = true
  if (request.assigned_expert_id && ['request_created', 'payment_approved', 'expert_assigned', 'status_changed', 'expert_response_approved'].includes(eventCode)) audiences.expert = true
  if (['payment_rejected', 'assignment_failed', 'similar_question_review'].includes(eventCode)) { audiences.agent = false; audiences.expert = false }
  return audiences
}

export function roleRecipientIds(eventCode, request) {
  const audiences = roleAudiences(eventCode, request)
  return {
    agentId: audiences.agent ? request.agent_id : null,
    // Deliberately use the persisted assignment, never the consultation's expert pool.
    expertId: audiences.expert ? request.assigned_expert_id : null,
  }
}

export function notificationCopy(eventCode, reference) {
  const config = {
    request_created: { admin: ['Nueva solicitud', `${reference}: recibida y pendiente de gestión.`], agent: ['Tu cliente envió una solicitud', `${reference}: ya está registrada desde tu enlace.`], expert: ['Nueva consulta asignada', `${reference}: tienes una pregunta disponible para responder.`] },
    payment_approved: { admin: ['Pago confirmado', `${reference}: Mercado Pago confirmó el pago.`], agent: ['Pago confirmado', `${reference}: el pago de la solicitud de tu cliente fue recibido.`], expert: ['Caso habilitado', `${reference}: el pago fue confirmado y puedes continuar con la consulta.`] },
    expert_assigned: { admin: ['Experto asignado', `${reference}: la asignación quedó registrada.`], agent: ['Solicitud en gestión', `${reference}: se asignó un experto al caso de tu cliente.`], expert: ['Tienes una solicitud asignada', `${reference}: revisa la pregunta disponible en tu bandeja.`] },
    status_changed: { admin: ['Solicitud actualizada', `${reference}: cambió el estado del caso.`], agent: ['Actualización de tu solicitud', `${reference}: hay un cambio de estado en el caso de tu cliente.`], expert: ['Caso actualizado', `${reference}: revisa el nuevo estado de tu solicitud asignada.`] },
    expert_response_approved: { admin: ['Respuesta aprobada y enviada', `${reference}: Resend aceptó el correo dirigido al cliente.`], agent: ['Respuesta enviada al cliente', `${reference}: el correo con la respuesta fue enviado al cliente.`], expert: ['Respuesta aprobada', `${reference}: administración aprobó y envió tu respuesta.`] },
    feedback_received: { admin: ['Feedback recibido', `${reference}: el cliente calificó la respuesta.`], agent: ['Tu cliente dejó feedback', `${reference}: hay una nueva calificación para revisar.`] },
    feedback_low: { admin: ['Alerta de feedback', `${reference}: recibimos una calificación baja que requiere seguimiento.`], agent: ['Feedback requiere seguimiento', `${reference}: la calificación de tu cliente requiere atención.`] },
    expert_response_submitted: { admin: ['Respuesta pendiente de revisión', `${reference}: un experto envió una respuesta para aprobación.`] },
    assignment_failed: { admin: ['Solicitud sin experto asignado', `${reference}: revisa la disponibilidad y asigna un experto.`] },
    similar_question_review: { admin: ['Pregunta similar por validar', `${reference}: revisa si se puede reutilizar una respuesta existente.`] },
    payment_rejected: { admin: ['Pago no confirmado', `${reference}: revisa el estado del intento de pago.`] },
  }[eventCode] || {}
  return Object.fromEntries(Object.entries(config).map(([role, [title, message]]) => [role, { title, message }]))
}

function serializeNotification(row) {
  return { id: String(row.id), requestId: row.request_id ? String(row.request_id) : null, eventCode: String(row.event_code), audienceRole: String(row.audience_role), title: String(row.title), message: String(row.message), targetPath: String(row.target_path), emailStatus: String(row.email_status), readAt: row.read_at ? String(row.read_at) : null, createdAt: String(row.created_at) }
}

function parseCursor(value) {
  if (typeof value !== 'string') return null
  const [createdAt, id] = value.split('|')
  if (!createdAt || !/^[0-9a-f-]{36}$/i.test(id || '') || !Number.isFinite(Date.parse(createdAt))) return null
  return { createdAt, id }
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''; digest.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) }
