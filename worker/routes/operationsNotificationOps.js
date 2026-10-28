import { isResendEmailId } from '../../src/lib/resendEmailId.js'
import { requireOperationsAuth } from './operationsAuth.js'
import { publishNotificationEvent } from './operationsEmail.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function handleOperationsNotificationOps(request, env) {
  const url = new URL(request.url)
  const dlqMatch = url.pathname.match(/^\/api\/app\/notification-ops\/dlq\/([^/]+)(?:\/(redrive|ignore))?$/)
  const effectMatch = url.pathname.match(/^\/api\/app\/notification-ops\/email-effects\/([^/]+)\/resolve$/)
  const outboxMatch = url.pathname.match(/^\/api\/app\/notification-ops\/outbox\/([^/]+)\/redrive$/)
  const isDlqList = url.pathname === '/api/app/notification-ops/dlq' && request.method === 'GET'
  const isEffectList = url.pathname === '/api/app/notification-ops/email-effects' && request.method === 'GET'
  const isDlqAction = Boolean(dlqMatch?.[1] && dlqMatch?.[2]) && request.method === 'POST'
  const isEffectAction = Boolean(effectMatch) && request.method === 'POST'
  const isOutboxAction = Boolean(outboxMatch) && request.method === 'POST'
  if (!isDlqList && !isEffectList && !isDlqAction && !isEffectAction && !isOutboxAction) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.roles?.includes('admin')) return response({ error: 'Solo administración puede gestionar colas y notificaciones.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 503)
  if ((isDlqAction && dlqMatch[2] === 'redrive') || isEffectAction && (await request.clone().json().catch(() => ({}))).resolution === 'not_sent' || isOutboxAction) {
    if (!env.NOTIFICATION_EVENTS_QUEUE) return response({ error: 'La cola de notificaciones no está configurada.' }, 503)
  }

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isDlqList) return listQueueFailures(sql, url)
  if (isEffectList) return listUncertainEffects(sql, url)
  const input = await request.json().catch(() => ({}))
  if (isDlqAction) {
    if (!uuidPattern.test(dlqMatch[1])) return response({ error: 'Identificador de DLQ inválido.' }, 400)
    if (dlqMatch[2] === 'ignore') return ignoreQueueFailure(sql, dlqMatch[1], claims.sub, text(input.reason))
    return redriveDeadLetter(sql, env, dlqMatch[1], claims.sub, text(input.reason))
  }
  if (isEffectAction) {
    if (!uuidPattern.test(effectMatch[1])) return response({ error: 'Identificador de efecto inválido.' }, 400)
    return resolveUncertainEffect(sql, env, effectMatch[1], claims.sub, input)
  }
  if (!uuidPattern.test(outboxMatch[1])) return response({ error: 'Identificador de evento inválido.' }, 400)
  return redriveOutboxEvent(sql, env, outboxMatch[1], claims.sub, text(input.reason))
}

async function listQueueFailures(sql, url) {
  const { page, pageSize, offset } = pageOptions(url)
  const [counts, rows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.notification_queue_failures WHERE status = 'pending'`,
    sql`SELECT f.id, f.queue_message_id, f.queue_name, f.event_id, f.message_kind, f.payload_sha256,
        f.delivery_attempts, f.created_at, o.event_code, o.status AS outbox_status,
        o.last_error_code, r.reference
      FROM operations.notification_queue_failures f
      LEFT JOIN operations.notification_outbox o ON o.id = f.event_id
      LEFT JOIN operations.requests r ON r.id = o.request_id
      WHERE f.status = 'pending'
      ORDER BY f.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
  ])
  return response({
    items: rows.map((row) => ({
      id: String(row.id), queue: String(row.queue_name), messageKind: String(row.message_kind),
      eventId: row.event_id ? String(row.event_id) : null, eventCode: row.event_code ? String(row.event_code) : '',
      requestReference: row.reference ? String(row.reference) : '', outboxStatus: row.outbox_status ? String(row.outbox_status) : '',
      errorCode: row.last_error_code ? String(row.last_error_code) : '', attempts: Number(row.delivery_attempts || 0),
      payloadHash: String(row.payload_sha256), createdAt: String(row.created_at),
    })),
    pagination: pagination(page, pageSize, counts[0]?.total),
  })
}

async function listUncertainEffects(sql, url) {
  const { page, pageSize, offset } = pageOptions(url)
  const [counts, rows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.notification_email_effects WHERE status = 'uncertain'`,
    sql`SELECT effect.id, effect.request_id, request.reference, effect.event_code, effect.recipient_email,
        effect.effect_key, effect.last_error_code, effect.attempts, effect.first_attempt_at, effect.updated_at
      FROM operations.notification_email_effects effect
      JOIN operations.requests request ON request.id = effect.request_id
      WHERE effect.status = 'uncertain'
      ORDER BY effect.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
  ])
  return response({
    items: rows.map((row) => ({
      id: String(row.id), requestId: String(row.request_id), requestReference: String(row.reference),
      eventCode: String(row.event_code), recipient: String(row.recipient_email), lastErrorCode: String(row.last_error_code || ''),
      attempts: Number(row.attempts || 0), firstAttemptAt: row.first_attempt_at ? String(row.first_attempt_at) : null,
      updatedAt: String(row.updated_at),
    })),
    pagination: pagination(page, pageSize, counts[0]?.total),
  })
}

async function resolveUncertainEffect(sql, env, effectId, actorId, input) {
  const resolution = text(input.resolution)
  const note = text(input.note)
  if (!note || note.length < 20 || note.length > 1000) return response({ error: 'Registra una justificación de 20 a 1.000 caracteres.' }, 400)
  const effectRows = await sql`
    SELECT id, request_id, event_code, recipient_email, effect_key, resend_email_id
    FROM operations.notification_email_effects
    WHERE id = ${effectId}::uuid AND status = 'uncertain' LIMIT 1
  `
  const effect = effectRows[0]
  if (!effect) return response({ error: 'El efecto incierto no existe o ya fue conciliado.' }, 409)
  const outboxId = extractOutboxId(String(effect.effect_key))
  if (!outboxId) return response({ error: 'No se pudo vincular el efecto con su evento durable.' }, 409)

  if (resolution === 'accepted') {
    const resendEmailId = text(input.resendEmailId)
    if (!isResendEmailId(resendEmailId)) return response({ error: 'Ingresa el ID del correo confirmado en Resend.' }, 400)
    const changed = await sql`
      WITH updated AS (
        UPDATE operations.notification_email_effects
        SET status = 'accepted', resend_email_id = ${resendEmailId}, accepted_at = COALESCE(accepted_at, NOW()),
            last_error_code = NULL, lease_token = NULL, updated_at = NOW()
        WHERE id = ${effect.id} AND status = 'uncertain'
        RETURNING id, request_id, event_code, recipient_email, effect_key
      ), audited AS (
        INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
        SELECT ${actorId}, 'reconcile', 'notification_email_effect', id,
          jsonb_build_object('resolution', 'accepted', 'resendEmailId', ${resendEmailId}, 'note', ${note})
        FROM updated RETURNING entity_id
      )
      SELECT updated.* FROM updated JOIN audited ON audited.entity_id = updated.id
    `
    if (!changed[0]) return response({ error: 'El efecto ya fue conciliado por otro administrador.' }, 409)
    await sql`
      INSERT INTO operations.notification_messages
        (request_id, event_code, resend_email_id, subject, to_emails, cc_emails, bcc_emails, status, last_event_at)
      VALUES (${effect.request_id}, ${effect.event_code}, ${resendEmailId}, 'Notificación conciliada',
        ${JSON.stringify([effect.recipient_email])}::jsonb, '[]'::jsonb, '[]'::jsonb, 'accepted', NOW())
      ON CONFLICT (resend_email_id) DO NOTHING
    `
    await linkAppNotification(sql, effect, outboxId, resendEmailId)
    const pending = await sql`
      SELECT 1 FROM operations.notification_email_effects
      WHERE effect_key LIKE ${`cra-${outboxId}/%`} AND status <> 'accepted' LIMIT 1
    `
    if (!pending.length) {
      await sql`UPDATE operations.notification_outbox SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), lease_expires_at = NULL, lease_token = NULL, last_error_code = NULL, updated_at = NOW() WHERE id = ${outboxId} AND status NOT IN ('cancelled')`
      await sql`UPDATE operations.requests SET notification_status = 'accepted', notification_last_error = NULL, notification_last_event_at = NOW(), updated_at = NOW() WHERE id = ${effect.request_id}`
    }
    return response({ ok: true, resolution: 'accepted', eventComplete: !pending.length })
  }

  if (resolution !== 'not_sent' || input.confirmedNotSent !== true) {
    return response({ error: 'Para reintentar, confirma explícitamente que Resend no aceptó el correo.' }, 400)
  }
  const changed = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT effect.id, event.id AS outbox_id, effect.request_id, effect.event_code, effect.attempts
      FROM operations.notification_email_effects effect
      JOIN operations.notification_outbox event ON event.id = ${outboxId}::uuid
      WHERE effect.id = ${effect.id} AND effect.status = 'uncertain'
        AND event.status NOT IN ('sent', 'cancelled')
        AND (event.status <> 'processing' OR event.lease_expires_at < NOW())
      FOR UPDATE OF effect, event
    ), updated_effect AS (
      UPDATE operations.notification_email_effects effect
      SET status = 'retryable', first_attempt_at = NULL, last_attempt_at = NULL,
          lease_token = NULL, last_error_code = 'admin_confirmed_not_sent', updated_at = NOW()
      FROM eligible WHERE effect.id = eligible.id
      RETURNING effect.id, effect.request_id, effect.event_code, effect.effect_key, effect.attempts
    ), reset_event AS (
      UPDATE operations.notification_outbox event
      SET status = 'pending', attempts = 0, next_attempt_at = NOW(), lease_expires_at = NULL,
          dispatch_lease_expires_at = NULL, lease_token = NULL, last_error_code = 'admin_confirmed_not_sent', updated_at = NOW()
      FROM updated_effect WHERE event.id = ${outboxId}::uuid
      RETURNING event.id
    ), audited AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'redrive', 'notification_email_effect', effect.id,
        jsonb_build_object('resolution', 'not_sent', 'note', ${note}, 'previousAttempts', effect.attempts, 'outboxId', event.id)
      FROM updated_effect effect JOIN reset_event event ON TRUE
      RETURNING entity_id
    )
    SELECT effect.id, event.id AS outbox_id FROM updated_effect effect
    JOIN reset_event event ON TRUE JOIN audited audit ON audit.entity_id = effect.id
  `
  if (!changed[0]) return response({ error: 'No se pudo reintentar: el evento ya terminó o está siendo procesado.' }, 409)
  let queued = false
  try { queued = await publishNotificationEvent(sql, env, String(changed[0].outbox_id)) } catch { /* The durable pending row is recovered by the cron. */ }
  return response({ ok: true, resolution: 'not_sent', queued }, 202)
}

async function linkAppNotification(sql, effect, outboxId, resendEmailId) {
  await sql`
    UPDATE operations.app_notifications notification
    SET resend_email_id = ${resendEmailId}, email_status = 'accepted', updated_at = NOW()
    FROM operations.users user_record
    WHERE notification.user_id = user_record.id AND notification.request_id = ${effect.request_id}
      AND notification.idempotency_key LIKE ${`event/${outboxId}/%`}
      AND lower(user_record.email) = lower(${effect.recipient_email})
  `
}

async function redriveOutboxEvent(sql, env, eventId, actorId, reason) {
  if (!reason || reason.length < 20 || reason.length > 1000) return response({ error: 'Registra una justificación de 20 a 1.000 caracteres.' }, 400)
  const changed = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT event.id, event.status, event.attempts, event.request_id
      FROM operations.notification_outbox event
      WHERE event.id = ${eventId}::uuid AND event.status NOT IN ('sent', 'cancelled')
        AND (event.status <> 'processing' OR event.lease_expires_at < NOW())
        AND NOT EXISTS (
          SELECT 1 FROM operations.notification_email_effects effect
          WHERE effect.effect_key LIKE ${`cra-${eventId}/%`} AND effect.status = 'uncertain'
        )
      FOR UPDATE
    ), reset AS (
      UPDATE operations.notification_outbox event
      SET status = 'pending', attempts = 0, next_attempt_at = NOW(), lease_expires_at = NULL,
          dispatch_lease_expires_at = NULL, lease_token = NULL, last_error_code = NULL, updated_at = NOW()
      FROM eligible WHERE event.id = eligible.id
      RETURNING event.id, event.request_id
    ), audited AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'redrive', 'notification_outbox', reset.id,
        jsonb_build_object('reason', ${reason}, 'previousStatus', eligible.status, 'previousAttempts', eligible.attempts)
      FROM reset JOIN eligible ON eligible.id = reset.id
      RETURNING entity_id
    )
    SELECT reset.id FROM reset JOIN audited ON audited.entity_id = reset.id
  `
  if (!changed[0]) return response({ error: 'Evento no redrivable: puede estar activo, completado o tener correos inciertos sin conciliar.' }, 409)
  let queued = false
  try { queued = await publishNotificationEvent(sql, env, String(changed[0].id)) } catch { /* The durable pending row is recovered by the cron. */ }
  return response({ ok: true, eventId: String(changed[0].id), queued }, 202)
}

async function redriveDeadLetter(sql, env, failureId, actorId, reason) {
  if (!reason || reason.length < 20 || reason.length > 1000) return response({ error: 'Registra una justificación de 20 a 1.000 caracteres.' }, 400)
  const changed = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT failure.id AS failure_id, failure.event_id, event.status AS previous_status, event.attempts
      FROM operations.notification_queue_failures failure
      JOIN operations.notification_outbox event ON event.id = failure.event_id
      WHERE failure.id = ${failureId}::uuid AND failure.status = 'pending'
        AND failure.message_kind = 'dead_letter' AND event.status NOT IN ('sent', 'cancelled')
        AND (event.status <> 'processing' OR event.lease_expires_at < NOW())
        AND NOT EXISTS (
          SELECT 1 FROM operations.notification_email_effects effect
          WHERE effect.effect_key LIKE ('cra-' || event.id::text || '/%') AND effect.status = 'uncertain'
        )
      FOR UPDATE OF failure, event
    ), reset_event AS (
      UPDATE operations.notification_outbox event
      SET status = 'pending', attempts = 0, next_attempt_at = NOW(), lease_expires_at = NULL,
          dispatch_lease_expires_at = NULL, lease_token = NULL, last_error_code = NULL, updated_at = NOW()
      FROM eligible WHERE event.id = eligible.event_id
      RETURNING event.id
    ), resolved_failure AS (
      UPDATE operations.notification_queue_failures failure
      SET status = 'redriven', resolved_by = ${actorId}::uuid, resolved_at = NOW(), resolution_note = ${reason}
      FROM eligible JOIN reset_event ON reset_event.id = eligible.event_id
      WHERE failure.id = eligible.failure_id AND failure.status = 'pending'
      RETURNING failure.id, failure.event_id
    ), audited AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'redrive', 'notification_dlq', failure.id,
        jsonb_build_object('eventId', failure.event_id, 'reason', ${reason}, 'previousStatus', eligible.previous_status, 'previousAttempts', eligible.attempts)
      FROM resolved_failure failure JOIN eligible ON eligible.failure_id = failure.id
      RETURNING entity_id
    )
    SELECT failure.id, failure.event_id FROM resolved_failure failure JOIN audited ON audited.entity_id = failure.id
  `
  if (!changed[0]) return response({ error: 'Mensaje no redrivable: revisa su estado, el evento asociado o los correos inciertos.' }, 409)
  let queued = false
  try { queued = await publishNotificationEvent(sql, env, String(changed[0].event_id)) } catch { /* The durable pending row is recovered by the cron. */ }
  return response({ ok: true, failureId: String(changed[0].id), eventId: String(changed[0].event_id), queued }, 202)
}

async function ignoreQueueFailure(sql, failureId, actorId, reason) {
  if (!reason || reason.length < 20 || reason.length > 1000) return response({ error: 'Registra una justificación de 20 a 1.000 caracteres.' }, 400)
  const rows = await sql`
    WITH changed AS (
      UPDATE operations.notification_queue_failures
      SET status = 'ignored', resolved_by = ${actorId}::uuid, resolved_at = NOW(), resolution_note = ${reason}
      WHERE id = ${failureId}::uuid AND status = 'pending'
      RETURNING id, event_id, message_kind
    ), audited AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'ignore', 'notification_dlq', id,
        jsonb_build_object('eventId', event_id, 'messageKind', message_kind, 'reason', ${reason})
      FROM changed RETURNING entity_id
    )
    SELECT changed.id FROM changed JOIN audited ON audited.entity_id = changed.id
  `
  if (!rows[0]) return response({ error: 'Mensaje no encontrado o ya resuelto.' }, 409)
  return response({ ok: true, status: 'ignored' })
}

function extractOutboxId(effectKey) {
  const match = effectKey.match(/^cra-([0-9a-f-]{36})\/(?:general|expert|client-(?:es|en))-v\d+$/i)
  return match && uuidPattern.test(match[1]) ? match[1] : null
}

function pageOptions(url) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || 10))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function pagination(page, pageSize, total) {
  const totalItems = Number(total || 0)
  return { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) }
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
