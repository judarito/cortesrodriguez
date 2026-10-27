import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsReviews(request, env) {
  const url = new URL(request.url)
  const isList = url.pathname === '/api/app/reviews/responses' && request.method === 'GET'
  const isFeedbackList = url.pathname === '/api/app/reviews/feedback' && request.method === 'GET'
  const isSimilarityList = url.pathname === '/api/app/reviews/similar-questions' && request.method === 'GET'
  const similarityMatch = url.pathname.match(/^\/api\/app\/reviews\/similar-questions\/([^/]+)$/)
  const isSimilarityAction = Boolean(similarityMatch) && request.method === 'PUT'
  const match = url.pathname.match(/^\/api\/app\/reviews\/responses\/([^/]+)$/)
  const isUpdate = Boolean(match) && request.method === 'PUT'
  if (!isList && !isFeedbackList && !isSimilarityList && !isSimilarityAction && !isUpdate) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.permissions?.includes('responses.review')) return response({ error: 'No tienes permisos para revisar respuestas.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isSimilarityList || isSimilarityAction) {
    if (!claims.roles?.includes('admin')) return response({ error: 'Solo administración puede validar preguntas similares.' }, 403)
    if (isSimilarityList) return listSimilarQuestions(sql, url)
    return resolveSimilarQuestion(sql, request, similarityMatch[1], claims, env)
  }
  if (isFeedbackList) {
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
    const offset = (page - 1) * pageSize
    const [countRows, rows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM operations.client_feedback WHERE rating IS NOT NULL`,
      sql`SELECT f.id, f.rating, f.comment, f.status, f.created_at, f.received_at,
          r.reference, r.consultation_type_name, c.full_name AS client_name,
          u.full_name AS expert_name
        FROM operations.client_feedback f
        JOIN operations.requests r ON r.id = f.request_id
        JOIN operations.clients c ON c.id = r.client_id
        LEFT JOIN operations.users u ON u.id = r.assigned_expert_id
        WHERE f.rating IS NOT NULL
        ORDER BY f.received_at DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}`,
    ])
    return response({ items: rows.map((row) => ({ id: String(row.id), reference: String(row.reference), rating: Number(row.rating), comment: row.comment ? String(row.comment) : '', status: String(row.status), consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '', clientName: String(row.client_name), expertName: row.expert_name ? String(row.expert_name) : '', receivedAt: row.received_at ? String(row.received_at) : String(row.created_at) })), pagination: pagination(page, pageSize, countRows[0]?.total) })
  }
  if (isList) {
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
    const offset = (page - 1) * pageSize
    const [countRows, rows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM operations.expert_responses WHERE status = 'pending_admin_review'`,
      sql`SELECT er.id, er.request_id, er.version, er.body, er.status, er.created_at,
          r.reference, r.service_type, r.consultation_type_name, r.email,
          c.full_name AS client_name, u.full_name AS expert_name
        FROM operations.expert_responses er
        JOIN operations.requests r ON r.id = er.request_id
        JOIN operations.clients c ON c.id = r.client_id
        JOIN operations.users u ON u.id = er.expert_id
        WHERE er.status = 'pending_admin_review'
        ORDER BY er.created_at ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
    ])
    return response({ items: rows.map(serializeReview), pagination: pagination(page, pageSize, countRows[0]?.total) })
  }

  const input = await request.json().catch(() => ({}))
  const action = text(input.action)
  const publicNote = text(input.publicNote)
  const internalNote = text(input.internalNote ?? input.adminNote)
  if (!['approve', 'reject'].includes(action)) return response({ error: 'Acción de revisión inválida.' }, 400)
  if (publicNote.length > 5000 || internalNote.length > 5000) return response({ error: 'El texto supera la longitud permitida.' }, 400)
  const rows = await sql`
    SELECT er.id, er.request_id, er.body, er.status, r.reference, r.email, c.full_name AS client_name
    FROM operations.expert_responses er
    JOIN operations.requests r ON r.id = er.request_id
    JOIN operations.clients c ON c.id = r.client_id
    WHERE er.id = ${match[1]}
    LIMIT 1
  `
  if (!rows[0]) return response({ error: 'Respuesta no encontrada.' }, 404)
  if (rows[0].status !== 'pending_admin_review') return response({ error: 'La respuesta ya fue revisada.' }, 409)
  if (action === 'approve' && !rows[0].email) return response({ error: 'El cliente no tiene correo registrado.' }, 409)

  const transitioned = await transitionReview(sql, {
    responseId: rows[0].id,
    requestId: rows[0].request_id,
    action,
    actorId: claims.sub,
    publicNote,
    internalNote,
  })
  if (!transitioned[0]) return response({ error: 'La respuesta ya fue revisada.' }, 409)
  if (action === 'approve' && env.NOTIFICATION_EVENTS_QUEUE) {
    try {
      const { publishNotificationEvent } = await import('./operationsEmail.js')
      const eventRows = await sql`SELECT id FROM operations.notification_outbox WHERE idempotency_key = ${`expert_response_approved/${transitioned[0].id}`} LIMIT 1`
      if (eventRows[0]) await publishNotificationEvent(sql, env, String(eventRows[0].id))
    } catch { console.warn(JSON.stringify({ event: 'notification_immediate_publish_failed', severity: 'warning' })) }
  }
  const reviewed = transitioned[0]
  return response({
    ok: true,
    ...(action === 'approve' ? { queued: true } : {}),
    response: {
      id: String(reviewed.id),
      version: Number(reviewed.version),
      status: String(reviewed.status),
      publicNote: reviewed.public_note || '',
    },
  }, action === 'approve' ? 202 : 200)
}

// One statement makes the conditional review, outbox event, and case status atomic.
export async function transitionReview(sql, { responseId, requestId, action, actorId, publicNote, internalNote }) {
  if (action === 'reject') return sql`
    WITH changed AS (
      UPDATE operations.expert_responses
      SET status = 'rejected', admin_note = NULL, internal_note = ${internalNote || null},
          reviewed_by = ${actorId}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${responseId} AND request_id = ${requestId} AND status = 'pending_admin_review'
      RETURNING id, version, status, admin_note AS public_note, internal_note
    ), request_updated AS (
      UPDATE operations.requests
      SET status = 'in_progress', updated_at = NOW()
      WHERE id = ${requestId} AND EXISTS (SELECT 1 FROM changed)
      RETURNING id
    )
    SELECT changed.* FROM changed CROSS JOIN request_updated
  `

  return sql`
    WITH changed AS (
      UPDATE operations.expert_responses
      SET status = 'approved', admin_note = ${publicNote || null}, internal_note = ${internalNote || null},
          reviewed_by = ${actorId}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${responseId} AND request_id = ${requestId} AND status = 'pending_admin_review'
      RETURNING id, version, status, admin_note AS public_note, internal_note
    ), event_written AS (
      INSERT INTO operations.notification_outbox (request_id, event_code, idempotency_key, actor_id, event_payload)
      SELECT ${requestId}, 'expert_response_approved', 'expert_response_approved/' || changed.id::TEXT,
        ${actorId}, jsonb_build_object('responseId', changed.id, 'version', changed.version)
      FROM changed
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING id
    ), durable_event AS (
      SELECT id FROM event_written
    ), request_updated AS (
      UPDATE operations.requests
      SET status = 'closed', updated_at = NOW()
      WHERE id = ${requestId} AND EXISTS (SELECT 1 FROM durable_event)
        AND EXISTS (SELECT 1 FROM changed)
      RETURNING id
    )
    SELECT changed.* FROM changed CROSS JOIN durable_event CROSS JOIN request_updated
  `
}

async function listSimilarQuestions(sql, url) {
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
  const offset = (page - 1) * pageSize
  const [counts, rows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.request_similarity_reviews WHERE status = 'pending'`,
    sql`
      SELECT sr.request_id, sr.created_at, r.reference, r.question, r.service_type,
        r.consultation_type_name, COALESCE(r.source_channel, CASE WHEN r.source = 'agent' THEN 'agent_link' ELSE 'direct_web' END) AS source_channel,
        r.agent_id, agent.full_name AS agent_name
      FROM operations.request_similarity_reviews sr
      JOIN operations.requests r ON r.id = sr.request_id
      LEFT JOIN operations.users agent ON agent.id = r.agent_id
      WHERE sr.status = 'pending'
      ORDER BY sr.created_at ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ])
  const ids = rows.map((row) => String(row.request_id))
  const candidates = ids.length ? await sql`
    SELECT sc.request_id, sc.response_id, sc.similarity_score, sc.shared_terms,
      er.body AS response_body, er.version, er.sent_at,
      source_request.reference AS source_reference, source_request.question AS source_question,
      source_request.consultation_type_name
    FROM operations.request_similarity_candidates sc
    JOIN operations.expert_responses er ON er.id = sc.response_id AND er.status = 'sent'
    JOIN operations.requests source_request ON source_request.id = er.request_id
    WHERE sc.request_id = ANY(${ids})
    ORDER BY sc.request_id, sc.similarity_score DESC
  ` : []
  const byRequest = new Map(ids.map((id) => [id, []]))
  for (const row of candidates) byRequest.get(String(row.request_id))?.push({
    responseId: String(row.response_id),
    score: Number(row.similarity_score),
    sharedTerms: row.shared_terms || [],
    responseBody: String(row.response_body),
    version: Number(row.version),
    sentAt: row.sent_at ? String(row.sent_at) : '',
    sourceReference: String(row.source_reference),
    sourceQuestion: String(row.source_question),
    consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '',
  })
  const totalItems = Number(counts[0]?.total || 0)
  return response({
    items: rows.map((row) => ({
      requestId: String(row.request_id), reference: String(row.reference), question: String(row.question || ''),
      serviceType: String(row.service_type), consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '',
      sourceChannel: String(row.source_channel), agentName: row.agent_name ? String(row.agent_name) : '',
      createdAt: String(row.created_at), candidates: byRequest.get(String(row.request_id)) || [],
    })),
    pagination: { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) },
  })
}

async function resolveSimilarQuestion(sql, request, requestId, claims, env) {
  const input = await request.json().catch(() => ({}))
  const action = text(input.action)
  const reviews = await sql`
    SELECT sr.status, r.consultation_type_id, r.assigned_expert_id, r.status AS request_status,
      r.reference, r.email, r.question, c.full_name AS client_name
    FROM operations.request_similarity_reviews sr
    JOIN operations.requests r ON r.id = sr.request_id
    JOIN operations.clients c ON c.id = r.client_id
    WHERE sr.request_id = ${requestId}
    LIMIT 1
  `
  const review = reviews[0]
  if (!review) return response({ error: 'La revisión de similitud no existe.' }, 404)
  if (review.status !== 'pending') return response({ error: 'Esta pregunta ya fue resuelta.' }, 409)

  if (action === 'forward') {
    const experts = await sql`
      SELECT DISTINCT u.id, u.full_name
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
      JOIN operations.consultation_type_experts cte ON cte.user_id = u.id AND cte.active = TRUE
      WHERE u.active = TRUE AND cte.consultation_type_id = ${review.consultation_type_id}
      ORDER BY u.id
    `
    if (!experts.length) return response({ error: 'No hay expertos activos asociados a esta consulta.' }, 409)
    const expert = experts[crypto.getRandomValues(new Uint32Array(1))[0] % experts.length]
    const resolved = await forwardSimilarQuestion(sql, {
      requestId, expertId: expert.id, expertName: expert.full_name,
      consultationTypeId: review.consultation_type_id, candidateCount: experts.length, actorId: claims.sub,
    })
    if (!resolved[0]) return response({ error: 'Esta pregunta ya fue resuelta o su asignación cambió.' }, 409)
    await publishSimilarityEvent(sql, env, resolved[0].event_id)
    return response({ ok: true, action, expertName: String(expert.full_name) })
  }

  if (action !== 'reuse') return response({ error: 'Selecciona reutilizar una respuesta o derivar a experto.' }, 400)
  const responseId = text(input.responseId)
  const answer = text(input.answer)
  const adminNote = text(input.adminNote)
  if (!responseId) return response({ error: 'Selecciona una respuesta candidata.' }, 400)
  if (answer.length > 15000 || adminNote.length > 5000) return response({ error: 'El texto supera la longitud permitida.' }, 400)
  const candidates = await sql`
    SELECT er.id, er.body
    FROM operations.request_similarity_candidates sc
    JOIN operations.expert_responses er ON er.id = sc.response_id AND er.status = 'sent'
    WHERE sc.request_id = ${requestId} AND sc.response_id = ${responseId}
    LIMIT 1
  `
  if (!candidates[0]) return response({ error: 'La respuesta elegida no es una coincidencia candidata válida.' }, 400)
  if (!review.email) return response({ error: 'El cliente no tiene un correo registrado.' }, 409)
  const body = answer || String(candidates[0].body)
  const existing = await sql`
    SELECT id, version, body, status
    FROM operations.expert_responses
    WHERE request_id = ${requestId} AND response_origin = 'reused_answer' AND source_response_id = ${responseId}
      AND status IN ('approved', 'sent')
    ORDER BY version DESC LIMIT 1
  `
  if (existing[0]?.status === 'sent') return response({ error: 'La respuesta ya fue reutilizada y enviada.' }, 409)
  const resolved = await reuseSimilarQuestion(sql, {
    requestId, responseId, body, adminNote, actorId: claims.sub,
  })
  if (!resolved[0]) return response({ error: 'Esta pregunta ya fue resuelta o su asignación cambió.' }, 409)
  await publishSimilarityEvent(sql, env, resolved[0].event_id)
  return response({ ok: true, action, queued: true }, 202)
}

// A single Neon query is a PostgreSQL statement-level transaction. Keep every
// domain write and the idempotent outbox event in that statement; dispatch only
// after Neon has returned (and therefore committed) its result.
export async function forwardSimilarQuestion(sql, { requestId, expertId, expertName, consultationTypeId, candidateCount, actorId }) {
  return sql`
    WITH claimed AS (
      UPDATE operations.request_similarity_reviews sr
      SET status = 'forwarded_to_expert', resolved_by = ${actorId}, resolved_at = NOW()
      WHERE sr.request_id = ${requestId} AND sr.status = 'pending'
        AND EXISTS (SELECT 1 FROM operations.request_assignments a WHERE a.request_id = sr.request_id AND a.status = 'similarity_review')
      RETURNING sr.request_id
    ), previous_assignment AS (
      UPDATE operations.request_assignments a
      SET status = 'completed'
      FROM claimed c
      WHERE a.request_id = c.request_id AND a.status = 'similarity_review'
      RETURNING a.request_id
    ), assigned AS (
      INSERT INTO operations.request_assignments (request_id, expert_id, consultation_type_id, candidate_count, strategy, status, reason, assigned_by)
      SELECT c.request_id, ${expertId}, ${consultationTypeId}, ${candidateCount}, 'admin_similarity_review', 'assigned',
        'Administración descartó la coincidencia sugerida', ${actorId}
      FROM claimed c JOIN previous_assignment p ON p.request_id = c.request_id
      RETURNING id, request_id
    ), request_updated AS (
      UPDATE operations.requests r
      SET assigned_expert_id = ${expertId}, status = 'in_progress', notification_status = 'pending_retry', updated_at = NOW()
      FROM assigned a WHERE r.id = a.request_id
      RETURNING r.id
    ), event_inserted AS (
      INSERT INTO operations.notification_outbox (request_id, event_code, idempotency_key, actor_id, event_payload)
      SELECT a.request_id, 'expert_assigned', 'expert_assigned/' || a.id::TEXT, ${actorId},
        jsonb_build_object('expertName', ${expertName})
      FROM assigned a JOIN request_updated r ON r.id = a.request_id
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING id, idempotency_key
    ), event_written AS (
      SELECT id FROM event_inserted
    ), audit_written AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'similarity_forward', 'request', a.request_id,
        ${JSON.stringify({ expertId: String(expertId) })}::jsonb
      FROM assigned a JOIN request_updated r ON r.id = a.request_id
      RETURNING entity_id
    )
    SELECT a.id AS assignment_id, ${expertName}::TEXT AS expert_name, e.id AS event_id
    FROM assigned a JOIN request_updated r ON r.id = a.request_id
    JOIN event_written e ON TRUE JOIN audit_written l ON l.entity_id = a.request_id
  `
}

export async function reuseSimilarQuestion(sql, { requestId, responseId, body, adminNote, actorId }) {
  return sql`
    WITH claimed AS (
      UPDATE operations.request_similarity_reviews sr
      SET status = 'answer_reused', selected_response_id = ${responseId}, resolved_by = ${actorId}, resolved_at = NOW()
      FROM operations.requests r
      WHERE sr.request_id = ${requestId} AND sr.status = 'pending' AND r.id = sr.request_id AND r.email IS NOT NULL
        AND EXISTS (SELECT 1 FROM operations.request_assignments a WHERE a.request_id = sr.request_id AND a.status = 'similarity_review')
        AND EXISTS (SELECT 1 FROM operations.request_similarity_candidates sc JOIN operations.expert_responses source
          ON source.id = sc.response_id AND source.status = 'sent'
          WHERE sc.request_id = sr.request_id AND sc.response_id = ${responseId})
        AND NOT EXISTS (SELECT 1 FROM operations.expert_responses sent
          WHERE sent.request_id = sr.request_id AND sent.response_origin = 'reused_answer'
            AND sent.source_response_id = ${responseId} AND sent.status = 'sent')
      RETURNING sr.request_id
    ), existing AS (
      SELECT er.id, er.version FROM operations.expert_responses er JOIN claimed c ON c.request_id = er.request_id
      WHERE er.response_origin = 'reused_answer' AND er.source_response_id = ${responseId} AND er.status = 'approved'
      ORDER BY er.version DESC LIMIT 1
    ), response_updated AS (
      UPDATE operations.expert_responses er
      SET body = ${body}, admin_note = ${adminNote || null}, updated_at = NOW()
      FROM existing e JOIN claimed c ON TRUE
      WHERE er.id = e.id
      RETURNING er.id, er.request_id, er.version
    ), response_inserted AS (
      INSERT INTO operations.expert_responses (request_id, expert_id, version, body, status, admin_note, reviewed_by, reviewed_at, response_origin, source_response_id, authored_by)
      SELECT c.request_id, NULL,
        (SELECT COALESCE(MAX(version), 0)::int + 1 FROM operations.expert_responses WHERE request_id = c.request_id),
        ${body}, 'approved', ${adminNote || null}, ${actorId}, NOW(), 'reused_answer', ${responseId}, ${actorId}
      FROM claimed c WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id, request_id, version
    ), response_written AS (
      SELECT id, request_id, version FROM response_updated
      UNION ALL
      SELECT id, request_id, version FROM response_inserted
    ), assignments_updated AS (
      UPDATE operations.request_assignments a SET status = 'completed'
      FROM claimed c WHERE a.request_id = c.request_id AND a.status = 'similarity_review'
      RETURNING a.request_id
    ), event_inserted AS (
      INSERT INTO operations.notification_outbox (request_id, event_code, idempotency_key, actor_id, event_payload)
      SELECT rw.request_id, 'expert_response_approved', 'expert_response_approved/' || rw.id::TEXT, ${actorId},
        jsonb_build_object('responseId', rw.id)
      FROM response_written rw JOIN assignments_updated a ON a.request_id = rw.request_id
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING id, idempotency_key
    ), event_written AS (
      SELECT id FROM event_inserted
    ), request_updated AS (
      UPDATE operations.requests r
      SET status = 'closed', notification_status = 'pending_retry', updated_at = NOW()
      FROM response_written rw JOIN assignments_updated a ON a.request_id = rw.request_id
        JOIN event_written e ON TRUE
      WHERE r.id = rw.request_id
      RETURNING r.id
    ), audit_written AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT ${actorId}, 'similarity_reuse', 'request', rw.request_id,
        jsonb_build_object('sourceResponseId', ${responseId}::TEXT, 'responseId', rw.id::TEXT)
      FROM response_written rw JOIN request_updated r ON r.id = rw.request_id
      RETURNING entity_id
    )
    SELECT rw.id AS response_id, e.id AS event_id
    FROM response_written rw JOIN assignments_updated a ON a.request_id = rw.request_id
    JOIN request_updated r ON r.id = rw.request_id
    JOIN event_written e ON TRUE JOIN audit_written l ON l.entity_id = rw.request_id
  `
}

async function publishSimilarityEvent(sql, env, eventId) {
  if (!env.NOTIFICATION_EVENTS_QUEUE || !eventId) return
  try {
    const { publishNotificationEvent } = await import('./operationsEmail.js')
    await publishNotificationEvent(sql, env, String(eventId))
  } catch { console.warn(JSON.stringify({ event: 'notification_immediate_publish_failed', severity: 'warning' })) }
}

function serializeReview(row) { return { id: String(row.id), requestId: String(row.request_id), reference: String(row.reference), version: Number(row.version), body: String(row.body), status: String(row.status), serviceType: String(row.service_type), consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '', clientName: String(row.client_name), clientEmail: row.email ? String(row.email) : '', expertName: String(row.expert_name), createdAt: String(row.created_at) } }
function pagination(page, pageSize, totalValue) { const totalItems = Number(totalValue || 0); return { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) } }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
