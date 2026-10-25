import { requireOperationsAuth } from './operationsAuth.js'
import { enqueueNotification } from './operationsEmail.js'

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
  if (!claims?.permissions?.includes('responses.review')) return response({ error: 'No tienes permisos para revisar respuestas.' }, 403)
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
  const adminNote = text(input.adminNote)
  if (!['approve', 'reject'].includes(action)) return response({ error: 'Acción de revisión inválida.' }, 400)
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

  if (action === 'reject') {
    const updated = await sql`
      UPDATE operations.expert_responses
      SET status = 'rejected', admin_note = ${adminNote || null}, reviewed_by = ${claims.sub}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${match[1]}
      RETURNING id, status, admin_note
    `
    await sql`UPDATE operations.requests SET status = 'in_progress', updated_at = NOW() WHERE id = ${rows[0].request_id}`
    return response({ ok: true, response: { id: String(updated[0].id), status: String(updated[0].status), adminNote: updated[0].admin_note || '' } })
  }

  const approved = await sql`
    UPDATE operations.expert_responses
    SET status = 'approved', admin_note = ${adminNote || null}, reviewed_by = ${claims.sub}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${match[1]}
    RETURNING id, status, admin_note
  `
  await enqueueNotification(sql, rows[0].request_id, 'expert_response_approved', {
    idempotencyKey: `expert_response_approved/${approved[0].id}`,
    actorId: claims.sub,
    payload: { responseId: String(approved[0].id) },
  })
  await sql`UPDATE operations.requests SET status = 'closed', updated_at = NOW() WHERE id = ${rows[0].request_id}`
  return response({ ok: true, queued: true, response: { id: String(approved[0].id), status: 'approved', adminNote: approved[0].admin_note || '' } }, 202)
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
    const assignments = await sql`
      INSERT INTO operations.request_assignments (request_id, expert_id, consultation_type_id, candidate_count, strategy, status, reason, assigned_by)
      VALUES (${requestId}, ${expert.id}, ${review.consultation_type_id}, ${experts.length}, 'admin_similarity_review', 'assigned', 'Administración descartó la coincidencia sugerida', ${claims.sub})
      RETURNING id
    `
    await sql`UPDATE operations.requests SET assigned_expert_id = ${expert.id}, status = 'in_progress', updated_at = NOW() WHERE id = ${requestId}`
    await sql`UPDATE operations.request_similarity_reviews SET status = 'forwarded_to_expert', resolved_by = ${claims.sub}, resolved_at = NOW() WHERE request_id = ${requestId}`
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${claims.sub}, 'similarity_forward', 'request', ${requestId}, ${JSON.stringify({ expertId: String(expert.id) })}::jsonb)`
    try { await enqueueNotification(sql, requestId, 'expert_assigned', { idempotencyKey: `expert_assigned/${assignments[0].id}`, actorId: claims.sub }) } catch (error) { console.error('No se pudo encolar la notificación de asignación:', error.message) }
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
  let responseRecord = existing[0]
  if (responseRecord) {
    const updated = await sql`
      UPDATE operations.expert_responses
      SET body = ${body}, admin_note = ${adminNote || null}, updated_at = NOW()
      WHERE id = ${responseRecord.id}
      RETURNING id, version, body, status
    `
    responseRecord = updated[0]
  } else {
    const versions = await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM operations.expert_responses WHERE request_id = ${requestId}`
    const inserted = await sql`
      INSERT INTO operations.expert_responses (request_id, expert_id, version, body, status, admin_note, reviewed_by, reviewed_at, response_origin, source_response_id, authored_by)
      VALUES (${requestId}, NULL, ${Number(versions[0]?.version || 0) + 1}, ${body}, 'approved', ${adminNote || null}, ${claims.sub}, NOW(), 'reused_answer', ${responseId}, ${claims.sub})
      RETURNING id, version, body, status
    `
    responseRecord = inserted[0]
  }
  try {
    await enqueueNotification(sql, requestId, 'expert_response_approved', {
      idempotencyKey: `expert_response_approved/${responseRecord.id}`,
      actorId: claims.sub,
      payload: { responseId: String(responseRecord.id) },
    })
    await sql`UPDATE operations.requests SET status = 'closed', updated_at = NOW() WHERE id = ${requestId}`
    await sql`UPDATE operations.request_assignments SET status = 'completed' WHERE request_id = ${requestId} AND status = 'similarity_review'`
    await sql`UPDATE operations.request_similarity_reviews SET status = 'answer_reused', selected_response_id = ${responseId}, resolved_by = ${claims.sub}, resolved_at = NOW() WHERE request_id = ${requestId}`
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${claims.sub}, 'similarity_reuse', 'request', ${requestId}, ${JSON.stringify({ sourceResponseId: responseId, responseId: String(responseRecord.id) })}::jsonb)`
  } catch (error) {
    console.error('No se pudo enviar la respuesta reutilizada:', error.message)
    return response({ error: 'No se pudo encolar la respuesta reutilizada. Puedes reintentar la validación.' }, 502)
  }
  return response({ ok: true, action, queued: true }, 202)
}

function serializeReview(row) { return { id: String(row.id), requestId: String(row.request_id), reference: String(row.reference), version: Number(row.version), body: String(row.body), status: String(row.status), serviceType: String(row.service_type), consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '', clientName: String(row.client_name), clientEmail: row.email ? String(row.email) : '', expertName: String(row.expert_name), createdAt: String(row.created_at) } }
function pagination(page, pageSize, totalValue) { const totalItems = Number(totalValue || 0); return { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) } }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
