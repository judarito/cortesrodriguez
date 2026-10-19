import { requireOperationsAuth } from './operationsAuth.js'
import { sendRequestNotification } from './operationsEmail.js'

export async function handleOperationsExpert(request, env) {
  const url = new URL(request.url)
  const isInbox = url.pathname === '/api/app/expert/requests' && request.method === 'GET'
  const responseMatch = url.pathname.match(/^\/api\/app\/expert\/requests\/([^/]+)\/response$/)
  const isResponse = Boolean(responseMatch) && request.method === 'POST'
  if (!isInbox && !isResponse) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims?.permissions?.includes('expert_requests.read')) return response({ error: 'No tienes permisos para consultar solicitudes de experto.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isInbox) {
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
    const search = `%${String(url.searchParams.get('search') || '').trim()}%`
    const offset = (page - 1) * pageSize
    const [countRows, rows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total
        FROM operations.requests r
        WHERE r.assigned_expert_id = ${claims.sub}
          AND (r.reference ILIKE ${search} OR COALESCE(r.consultation_type_name, '') ILIKE ${search}
            OR COALESCE(r.question, '') ILIKE ${search})`,
      sql`SELECT r.id, r.reference, r.status, r.service_type, r.general_service_name,
          r.consultation_type_name, r.consultation_type_description, r.question, r.created_at,
          COUNT(DISTINCT a.id)::int AS attachment_count,
          COALESCE(latest.status, 'none') AS response_status,
          latest.body AS response_body
        FROM operations.requests r
        LEFT JOIN operations.request_attachments a ON a.request_id = r.id AND a.status = 'available'
        LEFT JOIN LATERAL (
          SELECT er.status, er.body
          FROM operations.expert_responses er
          WHERE er.request_id = r.id AND er.expert_id = ${claims.sub}
          ORDER BY er.version DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE r.assigned_expert_id = ${claims.sub}
          AND (r.reference ILIKE ${search} OR COALESCE(r.consultation_type_name, '') ILIKE ${search}
            OR COALESCE(r.question, '') ILIKE ${search})
        GROUP BY r.id, latest.status, latest.body
        ORDER BY r.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
    ])
    return response({ items: rows.map(serializeAssignment), pagination: pagination(page, pageSize, countRows[0]?.total) })
  }

  const input = await request.json().catch(() => ({}))
  const body = text(input.body)
  if (!body) return response({ error: 'La respuesta no puede estar vacía.' }, 400)
  if (body.length > 20000) return response({ error: 'La respuesta no puede superar 20.000 caracteres.' }, 400)
  const requestId = responseMatch[1]
  const [assigned] = await Promise.all([
    sql`SELECT id FROM operations.requests WHERE id = ${requestId} AND assigned_expert_id = ${claims.sub} LIMIT 1`,
  ])
  if (!assigned[0]) return response({ error: 'La solicitud no está asignada a este experto.' }, 404)
  const versionRows = await sql`SELECT COALESCE(MAX(version), 0)::int AS version FROM operations.expert_responses WHERE request_id = ${requestId}`
  const version = Number(versionRows[0]?.version || 0) + 1
  const created = await sql`
    INSERT INTO operations.expert_responses (request_id, expert_id, version, body, status)
    VALUES (${requestId}, ${claims.sub}, ${version}, ${body}, 'pending_admin_review')
    RETURNING id, version, status, created_at
  `
  await sql`UPDATE operations.requests SET status = 'in_review', updated_at = NOW() WHERE id = ${requestId}`
  if ((env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) && env.RESEND_FROM_EMAIL) {
    try { await sendRequestNotification(sql, env, requestId, 'expert_response_submitted', claims.sub) } catch (error) { console.error('No se pudo notificar la respuesta pendiente de revisión:', error.message) }
  }
  return response({ ok: true, response: { id: String(created[0].id), version: Number(created[0].version), status: String(created[0].status), createdAt: String(created[0].created_at) } }, 201)
}

function serializeAssignment(row) {
  return {
    id: String(row.id),
    reference: String(row.reference),
    status: String(row.status),
    serviceType: String(row.service_type),
    serviceName: row.general_service_name ? String(row.general_service_name) : '',
    consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '',
    consultationDescription: row.consultation_type_description ? String(row.consultation_type_description) : '',
    question: row.question ? String(row.question) : '',
    attachmentCount: Number(row.attachment_count || 0),
    responseStatus: String(row.response_status || 'none'),
    responseBody: row.response_body ? String(row.response_body) : '',
    createdAt: String(row.created_at),
  }
}

function pagination(page, pageSize, totalValue) {
  const totalItems = Number(totalValue || 0)
  return { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) }
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
