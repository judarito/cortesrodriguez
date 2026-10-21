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
  if (!['payment_approved', 'payment_rejected', 'request_created', 'status_changed', 'expert_assigned', 'assignment_failed', 'similar_question_review'].includes(eventCode)) return response({ error: 'Evento inválido.' }, 400)

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
    SELECT r.id, r.reference, r.email, r.service_name, r.service_type, r.product_type, r.status, r.source,
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
  const sourceChannel = request.source_channel || (request.source === 'agent' ? 'agent_link' : 'direct_web')

  const rules = await sql`
    SELECT id, name, audiences
    FROM operations.notification_rules
    WHERE event_code = ${eventCode}
      AND service_type IN ('all', ${request.service_type})
      AND (consultation_type_id IS NULL OR consultation_type_id = ${request.consultation_type_id})
      AND (source_channel IS NULL OR source_channel = ${sourceChannel})
      AND active = TRUE
    ORDER BY (consultation_type_id IS NOT NULL) DESC,
      (source_channel IS NOT NULL) DESC,
      (service_type <> 'all') DESC
    LIMIT 1
  `
  const defaultAudiences = {
    request_created: ['admin', 'expert', 'agent', 'client'],
    expert_assigned: ['admin', 'expert', 'agent'],
    assignment_failed: ['admin'],
    similar_question_review: ['admin'],
  }
  if (!rules.length && !defaultAudiences[eventCode]) return { sent: false, reason: 'no_active_rule' }

  const recipients = rules[0] ? await sql`
    SELECT nr.email, nr.recipient_type
    FROM operations.notification_rule_recipients rnr
    JOIN operations.notification_recipients nr ON nr.id = rnr.recipient_id
    WHERE rnr.rule_id = ${rules[0].id} AND nr.active = TRUE
    ORDER BY nr.name
  ` : []
  const audiences = [...new Set([...(rules[0]?.audiences || defaultAudiences[eventCode] || ['configured']), ...(['assignment_failed', 'similar_question_review'].includes(eventCode) ? ['admin'] : [])])]
  const dynamic = []
  if (audiences.includes('client') || audiences.includes('all_involved')) dynamic.push(request.email)
  if ((audiences.includes('agent') || audiences.includes('all_involved')) && sourceChannel === 'agent_link') dynamic.push(request.agent_email)
  if (audiences.includes('expert') || audiences.includes('all_involved')) dynamic.push(request.expert_email)
  if (audiences.includes('admin') || audiences.includes('all_involved')) {
    const admins = await sql`
      SELECT DISTINCT u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'admin'
      WHERE u.active = TRUE
    `
    dynamic.push(...admins.map((row) => row.email))
  }
  const configured = audiences.includes('configured') || audiences.includes('admin') || audiences.includes('all_involved') ? recipients : []
  const unique = (values) => [...new Set(values.filter((value) => value && /^\S+@\S+\.\S+$/.test(String(value))).map(String))]
  const to = unique([...configured.filter((item) => item.recipient_type === 'to').map((item) => item.email), ...dynamic])
  const cc = unique(configured.filter((item) => item.recipient_type === 'cc').map((item) => item.email)).filter((email) => !to.includes(email))
  const bcc = unique(configured.filter((item) => item.recipient_type === 'bcc').map((item) => item.email)).filter((email) => !to.includes(email) && !cc.includes(email))
  if (!to.length) throw new Error('La regla no tiene un destinatario principal tipo Para.')

  const eventLabel = { payment_approved: 'Pago aprobado', payment_rejected: 'Pago rechazado', request_created: 'Nueva solicitud recibida', expert_assigned: 'Solicitud asignada a experto', assignment_failed: 'Solicitud sin experto asignado', similar_question_review: 'Pregunta similar pendiente de validación', status_changed: 'Solicitud actualizada', expert_response_submitted: 'Respuesta de experto pendiente de revisión', feedback_received: 'Feedback recibido', feedback_low: 'Feedback con baja calificación' }[eventCode]
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

function notificationDescription(eventCode) {
  const descriptions = {
    payment_approved: 'El pago asociado a esta solicitud fue aprobado.',
    payment_rejected: 'El pago asociado a esta solicitud no fue aprobado. Revisa el caso en el panel.',
    request_created: 'Se recibió una nueva solicitud y quedó registrada en la plataforma.',
    expert_assigned: 'La solicitud fue asignada o reasignada a un experto.',
    assignment_failed: 'No hay expertos activos asociados a este tipo de consulta. La solicitud quedó en la cola administrativa y requiere asignación manual.',
    similar_question_review: 'La solicitud tiene coincidencias con respuestas aprobadas anteriores y requiere validación administrativa antes de asignarse.',
    status_changed: 'El estado de esta solicitud fue actualizado.',
    expert_response_submitted: 'Un experto envió su respuesta y está pendiente de revisión administrativa.',
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
