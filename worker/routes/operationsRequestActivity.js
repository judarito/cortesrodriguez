import { requireActiveOperationsAuth } from './operationsAuth.js'
import { publishRequestStateUpdate } from './appNotifications.js'
import { publishNotificationEvent } from './operationsEmail.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,128}$/

export async function handleOperationsRequestActivity(request, env) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/app\/requests\/([^/]+)\/(activity|comments|status-transition)$/)
  if (!match || !['GET', 'POST'].includes(request.method)) return null
  const [, requestId, action] = match
  if (!uuidPattern.test(requestId)) return response({ error: 'Solicitud no encontrada.' }, 404)
  if ((action === 'activity' && request.method !== 'GET') || (action !== 'activity' && request.method !== 'POST')) return null
  const claims = await requireActiveOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  const isAdmin = Boolean(claims.roles?.includes('admin'))
  const isAgent = Boolean(claims.roles?.includes('agent')) && claims.permissions?.includes('requests.read')
  const isExpert = Boolean(claims.roles?.includes('expert')) && claims.permissions?.includes('expert_requests.read')
  if (!(isAdmin || isAgent || isExpert)) return response({ error: 'No tienes permisos para consultar la actividad de solicitudes.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const scope = isAdmin ? sql`TRUE` : isExpert
    ? sql`r.assigned_expert_id = ${claims.sub}`
    : sql`(r.agent_id = ${claims.sub} OR (r.agent_id IS NULL AND r.created_by = ${claims.sub}))`
  const requests = await sql`SELECT r.id, r.status FROM operations.requests r WHERE r.id = ${requestId} AND ${scope} LIMIT 1`
  if (!requests[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  if (action === 'activity') return listActivity(sql, requestId)
  const input = await request.json().catch(() => ({}))
  if (action === 'comments') return addComment(sql, requestId, claims, input)
  if (!isAdmin && !(isAgent && claims.permissions?.includes('requests.update'))) {
    return response({ error: 'Se requiere permiso para actualizar solicitudes.' }, 403)
  }
  return transitionStatus(sql, env, requestId, claims, input, isAdmin)
}

async function listActivity(sql, requestId) {
  const rows = await sql`SELECT * FROM (
      SELECT 'created'::text AS id, 'request_created'::text AS kind, 'Solicitud creada'::text AS summary,
        r.created_by AS actor_id, COALESCE(u.full_name, 'Sistema') AS actor_name, r.created_at AS occurred_at, NULL::text AS body
      FROM operations.requests r LEFT JOIN operations.users u ON u.id = r.created_by WHERE r.id = ${requestId}
      UNION ALL
      SELECT transition.id::text, 'status_' || transition.action, 'Estado: ' || transition.from_status || ' → ' || transition.to_status,
        transition.actor_id, COALESCE(u.full_name, 'Usuario'), transition.created_at, transition.reason
      FROM operations.request_status_transitions transition LEFT JOIN operations.users u ON u.id = transition.actor_id
      WHERE transition.request_id = ${requestId}
      UNION ALL
      SELECT assignment.id::text, 'expert_' || assignment.status,
        CASE WHEN assignment.status = 'reassigned' THEN 'Experto reasignado'
          WHEN assignment.status = 'completed' THEN 'Asignación de experto completada'
          WHEN assignment.status = 'failed' THEN 'Asignación de experto fallida'
          WHEN assignment.status = 'similarity_review' THEN 'Coincidencia pendiente de revisión administrativa'
          ELSE 'Experto asignado' END,
        assignment.assigned_by, COALESCE(actor.full_name, 'Sistema'), assignment.assigned_at,
        CASE WHEN assignment.status = 'similarity_review'
          THEN 'Se detectó una respuesta anterior parecida. Administración debe decidir si se reutiliza o se asigna un experto.'
          ELSE COALESCE(assignment.reason, expert.full_name) END
      FROM operations.request_assignments assignment
      LEFT JOIN operations.users actor ON actor.id = assignment.assigned_by
      LEFT JOIN operations.users expert ON expert.id = assignment.expert_id
      WHERE assignment.request_id = ${requestId}
      UNION ALL
      SELECT comment.id::text, 'internal_comment', 'Nota interna', comment.author_id,
        COALESCE(u.full_name, 'Usuario'), comment.created_at, comment.body
      FROM operations.request_comments comment LEFT JOIN operations.users u ON u.id = comment.author_id
      WHERE comment.request_id = ${requestId} AND comment.visibility = 'internal'
      UNION ALL
      SELECT payment.id::text, 'payment_' || payment.status, 'Pago: ' || payment.status, NULL::uuid,
        'Mercado Pago', payment.updated_at, NULL::text
      FROM operations.request_payments payment WHERE payment.request_id = ${requestId}
      UNION ALL
      SELECT er.id::text, 'expert_response_' || er.status, 'Respuesta del experto: ' || er.status,
        er.expert_id, COALESCE(u.full_name, 'Experto'), er.updated_at, NULL::text
      FROM operations.expert_responses er LEFT JOIN operations.users u ON u.id = er.expert_id
      WHERE er.request_id = ${requestId}
    ) activity ORDER BY occurred_at DESC LIMIT 200`
  return response({ items: rows.map((row) => ({ id: String(row.id), kind: String(row.kind), summary: String(row.summary), actorName: String(row.actor_name || 'Sistema'), occurredAt: row.occurred_at, body: row.body ? String(row.body) : '' })) })
}

async function addComment(sql, requestId, claims, input) {
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey ? input.idempotencyKey : crypto.randomUUID()
  if (!body || body.length > 5000) return response({ error: 'La nota interna debe tener entre 1 y 5.000 caracteres.' }, 400)
  if (idempotencyKey && !idempotencyPattern.test(idempotencyKey)) return response({ error: 'La clave de operación no es válida.' }, 400)
  const rows = await sql`WITH inserted AS (
      INSERT INTO operations.request_comments (request_id, author_id, body, idempotency_key)
      VALUES (${requestId}, ${claims.sub}, ${body}, ${idempotencyKey || null})
      ON CONFLICT (request_id, author_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING id, body, created_at
    )
    SELECT id, body, created_at, TRUE AS created FROM inserted
    UNION ALL
    SELECT id, body, created_at, FALSE AS created FROM operations.request_comments
      WHERE request_id = ${requestId} AND author_id = ${claims.sub} AND idempotency_key = ${idempotencyKey || null}
        AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1`
  if (!rows[0]) return response({ error: 'No se pudo guardar la nota.' }, 500)
  const created = rows[0].created === true || rows[0].created === 't' || rows[0].created === 'true'
  return response({ ok: true, item: { id: String(rows[0].id), body: String(rows[0].body), occurredAt: rows[0].created_at }, duplicate: !created }, created ? 201 : 200)
}

async function transitionStatus(sql, env, requestId, claims, input, isAdmin) {
  const action = typeof input.action === 'string' ? input.action : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : ''
  if (!['cancel', 'close', 'reopen'].includes(action)) return response({ error: 'La transición solicitada no es válida.' }, 400)
  if (reason.length < 5 || reason.length > 1000) return response({ error: 'Indica un motivo de entre 5 y 1.000 caracteres.' }, 400)
  if (!idempotencyPattern.test(idempotencyKey)) return response({ error: 'La clave de operación no es válida.' }, 400)
  if (action === 'reopen' && !isAdmin) return response({ error: 'Solo administración puede reabrir una solicitud.' }, 403)
  const target = action === 'cancel' ? 'cancelled' : action === 'close' ? 'closed' : 'in_progress'
  const rows = await sql`WITH current_request AS MATERIALIZED (
      SELECT id, status FROM operations.requests WHERE id = ${requestId} FOR UPDATE
    ), eligible AS MATERIALIZED (
      SELECT id, status FROM current_request WHERE
        (${action === 'cancel' || action === 'close' ? sql`status IN ('pending', 'in_review', 'in_progress')` : sql`status IN ('closed', 'cancelled')`})
    ), changed AS (
      UPDATE operations.requests r SET status = ${target}, updated_at = NOW()
      FROM eligible WHERE r.id = eligible.id RETURNING r.id, eligible.status AS old_status, r.status AS new_status
    ), transition AS (
      INSERT INTO operations.request_status_transitions (request_id, actor_id, action, from_status, to_status, reason, idempotency_key)
      SELECT id, ${claims.sub}, ${action}, old_status, new_status, ${reason}, ${idempotencyKey} FROM changed
      ON CONFLICT (request_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id, request_id, from_status, to_status, created_at
    ), audit AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${claims.sub}, ${action}, 'request', request_id, jsonb_build_object('from', from_status, 'to', to_status, 'reason', ${reason}, 'transitionId', id)
      FROM transition RETURNING entity_id
    ), result AS (
      SELECT transition.id, transition.request_id, transition.from_status, transition.to_status, transition.created_at, TRUE AS created
      FROM transition JOIN audit ON audit.entity_id = transition.request_id
      UNION ALL
      SELECT existing.id, existing.request_id, existing.from_status, existing.to_status, existing.created_at, FALSE AS created
      FROM operations.request_status_transitions existing
      WHERE existing.request_id = ${requestId} AND existing.idempotency_key = ${idempotencyKey}
        AND NOT EXISTS (SELECT 1 FROM transition)
    ) SELECT * FROM result LIMIT 1`
  if (!rows[0]) return response({ error: 'La solicitud cambió de estado o ya no admite esta transición. Actualiza el detalle.' }, 409)
  const created = rows[0].created === true || rows[0].created === 't' || rows[0].created === 'true'
  if (created) {
    try {
      // The trigger stores this event in the durable outbox in the same
      // transaction as the status update. Publish only after the commit.
      const events = await sql`
        SELECT id, request_id, event_code, admin_only, event_payload
        FROM operations.notification_outbox
        WHERE request_id = ${requestId} AND event_code = 'status_changed'
          AND created_at = ${rows[0].created_at}
        ORDER BY id DESC LIMIT 1
      `
      if (events[0]) {
        try {
          await publishRequestStateUpdate(sql, env, events[0])
        } catch {
          console.warn(JSON.stringify({ event: 'request_realtime_publish_failed', severity: 'warning', errorCode: 'realtime_publish_failed', eventCode: 'status_changed' }))
        }
        // Dispatch the durable event now so the bell/email consumers do not
        // wait for the scheduled outbox sweep. The dispatcher is idempotent.
        try {
          await publishNotificationEvent(sql, env, String(events[0].id))
        } catch {
          console.warn(JSON.stringify({ event: 'notification_event_dispatch_failed', severity: 'warning', errorCode: 'queue_dispatch_failed', eventCode: 'status_changed' }))
        }
      }
    } catch {
      // The committed status/outbox remain authoritative; scheduled dispatch
      // can recover if the immediate outbox lookup itself is unavailable.
      console.warn(JSON.stringify({ event: 'request_status_event_lookup_failed', severity: 'warning', errorCode: 'status_event_lookup_failed', eventCode: 'status_changed' }))
    }
  }
  return response({ ok: true, duplicate: !created, transition: { action, from: String(rows[0].from_status), to: String(rows[0].to_status), occurredAt: rows[0].created_at } })
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
