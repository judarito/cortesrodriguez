import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsNotifications(request, env) {
  const url = new URL(request.url)
  const isConfig = url.pathname === '/api/app/settings/notifications' && request.method === 'GET'
  const isServiceConfig = url.pathname === '/api/app/settings/service' && request.method === 'PUT'
  const createRecipient = url.pathname === '/api/app/settings/notification-recipients' && request.method === 'POST'
  const createRule = url.pathname === '/api/app/settings/notification-rules' && request.method === 'POST'
  const recipientMatch = url.pathname.match(/^\/api\/app\/settings\/notification-recipients\/([^/]+)$/)
  const ruleMatch = url.pathname.match(/^\/api\/app\/settings\/notification-rules\/([^/]+)$/)
  const deleteRecipient = Boolean(recipientMatch) && request.method === 'DELETE'
  const deleteRule = Boolean(ruleMatch) && request.method === 'DELETE'
  if (!isConfig && !isServiceConfig && !createRecipient && !createRule && !deleteRecipient && !deleteRule) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.permissions?.includes('settings.manage')) return response({ error: 'No tienes permisos para configurar notificaciones.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  if (isConfig) {
    const recipientPage = pageParams(url.searchParams.get('recipientPage'))
    const rulePage = pageParams(url.searchParams.get('rulePage'))
    const [recipientCount, recipients, ruleCount, rules, services, consultationTypes] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM operations.notification_recipients`,
      sql`SELECT id, name, email, recipient_type, active, created_at FROM operations.notification_recipients ORDER BY name LIMIT ${recipientPage.pageSize} OFFSET ${recipientPage.offset}`,
      sql`SELECT COUNT(*)::int AS total FROM operations.notification_rules`,
      sql`
        SELECT r.id, r.name, r.event_code, r.service_type, r.consultation_type_id, r.source_channel,
          c.name AS consultation_name, r.active, r.created_at,
          COALESCE(string_agg(nr.name || ' <' || nr.email || '>', ', ' ORDER BY nr.name), '') AS recipients,
          r.audiences
        FROM operations.notification_rules r
        LEFT JOIN operations.consultation_types c ON c.id = r.consultation_type_id
        LEFT JOIN operations.notification_rule_recipients rnr ON rnr.rule_id = r.id
        LEFT JOIN operations.notification_recipients nr ON nr.id = rnr.recipient_id
        GROUP BY r.id, r.audiences, c.name
        ORDER BY r.event_code, r.service_type, c.name, r.source_channel
        LIMIT ${rulePage.pageSize} OFFSET ${rulePage.offset}
      `,
      sql`SELECT code, name, amount_cents, currency, active FROM operations.service_catalog WHERE code = 'asesoria_personalizada' LIMIT 1`,
      sql`SELECT id, code, name FROM operations.consultation_types WHERE active = TRUE ORDER BY name`,
    ])
    return response({
      recipients: recipients.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), recipientType: String(row.recipient_type), active: Boolean(row.active), createdAt: String(row.created_at) })),
      rules: rules.map((row) => ({ id: String(row.id), name: String(row.name), eventCode: String(row.event_code), serviceType: String(row.service_type), consultationTypeId: row.consultation_type_id ? String(row.consultation_type_id) : null, consultationTypeName: row.consultation_name ? String(row.consultation_name) : '', sourceChannel: row.source_channel ? String(row.source_channel) : null, audiences: row.audiences || ['configured'], active: Boolean(row.active), recipients: row.recipients ? String(row.recipients).split(', ') : [] })),
      recipientPagination: pagination(recipientPage, recipientCount[0]?.total),
      rulePagination: pagination(rulePage, ruleCount[0]?.total),
      service: services[0] ? { code: String(services[0].code), name: String(services[0].name), amountCents: Number(services[0].amount_cents), currency: String(services[0].currency), active: Boolean(services[0].active) } : null,
      consultationTypes: consultationTypes.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name) })),
    })
  }

  if (isServiceConfig) return updateServiceConfig(sql, await request.json().catch(() => ({})), claims.sub)
  if (deleteRecipient) return deleteRecipientRecord(sql, recipientMatch[1], claims.sub)
  if (deleteRule) return deleteRuleRecord(sql, ruleMatch[1], claims.sub)

  const claimsUser = claims.sub
  const body = await request.json().catch(() => ({}))
  if (createRecipient) return createRecipientRecord(sql, body, claimsUser)
  return createRuleRecord(sql, body, claimsUser)
}

function pageParams(value) {
  const page = Math.max(1, Number(value || 1)); const pageSize = 10
  return { page, pageSize, offset: (page - 1) * pageSize }
}
function pagination(page, total) { const totalItems = Number(total || 0); return { page: page.page, pageSize: page.pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / page.pageSize)) } }

async function deleteRecipientRecord(sql, id, actorId) {
  const linked = await sql`SELECT 1 FROM operations.notification_rule_recipients WHERE recipient_id = ${id} LIMIT 1`
  if (linked.length) return response({ error: 'No puedes eliminar un destinatario usado por una regla. Desactívalo desde la configuración.' }, 409)
  const rows = await sql`DELETE FROM operations.notification_recipients WHERE id = ${id} RETURNING id`
  if (!rows[0]) return response({ error: 'Destinatario no encontrado.' }, 404)
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id) VALUES (${actorId}, 'delete', 'notification_recipient', ${id})`
  return response({ ok: true })
}

async function deleteRuleRecord(sql, id, actorId) {
  const rows = await sql`DELETE FROM operations.notification_rules WHERE id = ${id} RETURNING id`
  if (!rows[0]) return response({ error: 'Regla no encontrada.' }, 404)
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id) VALUES (${actorId}, 'delete', 'notification_rule', ${id})`
  return response({ ok: true })
}

async function updateServiceConfig(sql, body, actorId) {
  const amount = Number(body.amountCents)
  const currency = text(body.currency) || 'COP'
  if (!Number.isInteger(amount) || amount < 0) return response({ error: 'Ingresa un valor entero mayor o igual a cero.' }, 400)
  if (!['COP', 'USD'].includes(currency)) return response({ error: 'Moneda inválida.' }, 400)
  const rows = await sql`UPDATE operations.service_catalog SET amount_cents = ${amount}, currency = ${currency}, updated_at = NOW() WHERE code = 'asesoria_personalizada' RETURNING code, name, amount_cents, currency, active`
  if (!rows[0]) return response({ error: 'El servicio no está configurado.' }, 404)
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'update', 'service_catalog', NULL, ${JSON.stringify({ code: 'asesoria_personalizada', amountCents: amount, currency })}::jsonb)`
  return response({ ok: true, service: { code: String(rows[0].code), name: String(rows[0].name), amountCents: Number(rows[0].amount_cents), currency: String(rows[0].currency), active: Boolean(rows[0].active) } })
}

async function createRecipientRecord(sql, body, actorId) {
  const name = text(body.name)
  const email = text(body.email).toLowerCase()
  const recipientType = text(body.recipientType) || 'to'
  if (!name || !email) return response({ error: 'Nombre y correo son obligatorios.' }, 400)
  if (!/^\S+@\S+\.\S+$/.test(email)) return response({ error: 'Ingresa un correo válido.' }, 400)
  if (!['to', 'cc', 'bcc'].includes(recipientType)) return response({ error: 'Tipo de destinatario inválido.' }, 400)
  try {
    const rows = await sql`INSERT INTO operations.notification_recipients (name, email, recipient_type) VALUES (${name}, ${email}, ${recipientType}) RETURNING id, name, email, recipient_type, active`
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'create', 'notification_recipient', ${rows[0].id}, ${JSON.stringify({ email })}::jsonb)`
    return response({ ok: true, recipient: { id: String(rows[0].id), name: String(rows[0].name), email: String(rows[0].email), recipientType: String(rows[0].recipient_type), active: Boolean(rows[0].active) } }, 201)
  } catch (error) {
    if (String(error.message).includes('notification_recipients_email_key')) return response({ error: 'Ya existe un destinatario con ese correo.' }, 409)
    throw error
  }
}

async function createRuleRecord(sql, body, actorId) {
  const name = text(body.name)
  const eventCode = text(body.eventCode)
  const serviceType = text(body.serviceType) || 'all'
  const consultationTypeId = text(body.consultationTypeId) || null
  const sourceChannel = text(body.sourceChannel) || null
  const audiences = Array.isArray(body.audiences) ? body.audiences.filter((value) => typeof value === 'string') : ['configured']
  const recipientIds = Array.isArray(body.recipientIds) ? body.recipientIds.filter((value) => typeof value === 'string') : []
  const requiresConfiguredRecipient = audiences.includes('configured')
  if (!name || !eventCode || !serviceType || (requiresConfiguredRecipient && !recipientIds.length)) return response({ error: requiresConfiguredRecipient ? 'Nombre, evento, servicio y al menos un destinatario configurado son obligatorios.' : 'Nombre, evento y servicio son obligatorios.' }, 400)
  if (!['payment_approved', 'payment_rejected', 'request_created', 'status_changed', 'expert_response_submitted', 'feedback_received', 'feedback_low', 'expert_assigned', 'assignment_failed'].includes(eventCode)) return response({ error: 'Evento inválido.' }, 400)
  if (!['all', 'importacion', 'exportacion', 'agente_carga'].includes(serviceType)) return response({ error: 'Tipo de servicio inválido.' }, 400)
  if (sourceChannel && !['direct_web', 'agent_link'].includes(sourceChannel)) return response({ error: 'Origen de solicitud inválido.' }, 400)
  if (!audiences.length || audiences.some((value) => !['configured', 'client', 'agent', 'expert', 'admin', 'all_involved'].includes(value))) return response({ error: 'Audiencia de notificación inválida.' }, 400)
  try {
    if (consultationTypeId) {
      const consultation = await sql`SELECT id FROM operations.consultation_types WHERE id = ${consultationTypeId} AND active = TRUE LIMIT 1`
      if (!consultation[0]) return response({ error: 'El tipo de consulta no existe o está inactivo.' }, 400)
    }
    const recipients = await sql`SELECT id FROM operations.notification_recipients WHERE id = ANY(${recipientIds}) AND active = TRUE`
    if (requiresConfiguredRecipient && !recipients.length) return response({ error: 'No hay destinatarios activos válidos.' }, 400)
    const rows = await sql`INSERT INTO operations.notification_rules (name, event_code, service_type, consultation_type_id, source_channel, audiences) VALUES (${name}, ${eventCode}, ${serviceType}, ${consultationTypeId}, ${sourceChannel}, ${audiences}) RETURNING id, name, event_code, service_type, consultation_type_id, source_channel, audiences, active`
    for (const recipient of recipients) await sql`INSERT INTO operations.notification_rule_recipients (rule_id, recipient_id) VALUES (${rows[0].id}, ${recipient.id}) ON CONFLICT DO NOTHING`
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'create', 'notification_rule', ${rows[0].id}, ${JSON.stringify({ eventCode, serviceType, recipientIds })}::jsonb)`
    return response({ ok: true, rule: { id: String(rows[0].id), name: String(rows[0].name), eventCode: String(rows[0].event_code), serviceType: String(rows[0].service_type), consultationTypeId: rows[0].consultation_type_id ? String(rows[0].consultation_type_id) : null, sourceChannel: rows[0].source_channel ? String(rows[0].source_channel) : null, audiences: rows[0].audiences || audiences, active: Boolean(rows[0].active) } }, 201)
  } catch (error) {
    if (String(error.message).includes('idx_notification_rules_matching')) return response({ error: 'Ya existe una regla con la misma combinación de evento, servicio, consulta y origen.' }, 409)
    throw error
  }
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
