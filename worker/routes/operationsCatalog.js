import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsCatalog(request, env) {
  const url = new URL(request.url)
  const isPublicCatalog = url.pathname === '/api/public/catalog' && request.method === 'GET'
  const publicAgentMatch = url.pathname.match(/^\/api\/public\/agent-links\/([^/]+)$/)
  const isPublicAgentLink = Boolean(publicAgentMatch) && request.method === 'GET'
  const isAdminCatalog = url.pathname === '/api/app/catalog' && request.method === 'GET'
  const isConsultationCreate = url.pathname === '/api/app/catalog/consultation-types' && request.method === 'POST'
  const consultationMatch = url.pathname.match(/^\/api\/app\/catalog\/consultation-types\/([^/]+)$/)
  const isConsultationUpdate = Boolean(consultationMatch) && request.method === 'PUT'
  const linkMatch = url.pathname.match(/^\/api\/app\/agent-links\/([^/]+)$/)
  const isAgentLinks = url.pathname === '/api/app/agent-links' && ['GET', 'POST'].includes(request.method)
  const revokeAgentLink = Boolean(linkMatch) && request.method === 'DELETE'
  if (!isPublicCatalog && !isPublicAgentLink && !isAdminCatalog && !isConsultationCreate && !isConsultationUpdate && !isAgentLinks && !revokeAgentLink) return null
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  if (isPublicCatalog) return getPublicCatalog(sql)
  if (isPublicAgentLink) return resolveAgentLink(sql, publicAgentMatch[1])

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)

  if (isAdminCatalog) {
    if (!claims.permissions?.includes('services.manage')) return response({ error: 'No tienes permisos para consultar el catálogo.' }, 403)
    return getAdminCatalog(sql)
  }

  if (isConsultationCreate || isConsultationUpdate) {
    if (!claims.permissions?.includes('services.manage')) return response({ error: 'No tienes permisos para configurar consultas.' }, 403)
    const body = await request.json().catch(() => ({}))
    return isConsultationCreate ? createConsultationType(sql, body, claims.sub) : updateConsultationType(sql, consultationMatch[1], body, claims.sub)
  }

  if (!claims.permissions?.includes('agent_links.manage')) return response({ error: 'No tienes permisos para gestionar enlaces de agente.' }, 403)
  if (revokeAgentLink) return revokeLink(sql, linkMatch[1], claims)
  if (request.method === 'GET') return listAgentLinks(sql, claims, url)
  return createAgentLink(sql, request, claims)
}

async function revokeLink(sql, id, claims) {
  const isAdmin = claims.roles?.includes('admin')
  const rows = await sql`UPDATE operations.agent_links SET active = FALSE, revoked_at = NOW() WHERE id = ${id} AND ${isAdmin ? sql`TRUE` : sql`agent_id = ${claims.sub}`} RETURNING id`
  if (!rows[0]) return response({ error: 'Enlace no encontrado.' }, 404)
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id) VALUES (${claims.sub}, 'revoke', 'agent_link', ${id})`
  return response({ ok: true })
}

async function getPublicCatalog(sql) {
  const rows = await sql`
    SELECT s.code AS service_code, s.name AS service_name, s.description AS service_description,
      c.code AS consultation_code, c.name AS consultation_name, c.description AS consultation_description,
      sct.amount_cents, sct.currency, sct.payment_required
    FROM operations.service_consultation_types sct
    JOIN operations.services s ON s.id = sct.service_id
    JOIN operations.consultation_types c ON c.id = sct.consultation_type_id
    WHERE s.active = TRUE AND c.active = TRUE AND sct.active = TRUE
    ORDER BY s.sort_order, s.name, c.name
  `
  return response({ items: rows.map(serializeCatalogItem) })
}

async function getAdminCatalog(sql) {
  const [services, specialties, assignments, agents, allExperts] = await Promise.all([
    sql`
      SELECT s.id, s.code, s.name, s.description, s.active, s.sort_order,
        COALESCE(json_agg(json_build_object(
          'id', sct.id, 'consultationId', c.id, 'consultationCode', c.code,
          'consultationName', c.name, 'consultationDescription', c.description, 'amountCents', sct.amount_cents,
          'currency', sct.currency, 'active', sct.active
        ) ORDER BY c.name) FILTER (WHERE sct.id IS NOT NULL), '[]'::json) AS consultations
      FROM operations.services s
      LEFT JOIN operations.service_consultation_types sct ON sct.service_id = s.id
      LEFT JOIN operations.consultation_types c ON c.id = sct.consultation_type_id
      GROUP BY s.id
      ORDER BY s.sort_order, s.name
    `,
    sql`SELECT id, code, name, description, active FROM operations.consultation_types ORDER BY name`,
    sql`
      SELECT u.id, u.full_name, u.email, c.id AS consultation_type_id, c.name AS consultation_type_name
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'expert'
      LEFT JOIN operations.consultation_type_experts cte ON cte.user_id = u.id AND cte.active = TRUE
      LEFT JOIN operations.consultation_types c ON c.id = cte.consultation_type_id
      WHERE u.active = TRUE
      ORDER BY u.full_name
    `,
    sql`
      SELECT DISTINCT u.id, u.full_name, u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'agent'
      WHERE u.active = TRUE
      ORDER BY u.full_name
    `,
    sql`
      SELECT DISTINCT u.id, u.full_name, u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'expert'
      WHERE u.active = TRUE
      ORDER BY u.full_name
    `,
  ])
  return response({
    services: services.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), description: String(row.description), active: Boolean(row.active), sortOrder: Number(row.sort_order), consultations: Array.isArray(row.consultations) ? row.consultations : [] })),
    consultationTypes: specialties.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), description: String(row.description), active: Boolean(row.active) })),
    experts: assignments.map((row) => ({ id: String(row.id), name: String(row.full_name), email: String(row.email), consultationTypeId: row.consultation_type_id ? String(row.consultation_type_id) : null, consultationTypeName: row.consultation_type_name ? String(row.consultation_type_name) : null })),
    agents: agents.map((row) => ({ id: String(row.id), name: String(row.full_name), email: String(row.email) })),
    allExperts: allExperts.map((row) => ({ id: String(row.id), name: String(row.full_name), email: String(row.email) })),
  })
}

async function createConsultationType(sql, body, actorId) {
  const input = validateConsultation(body)
  const service = await sql`SELECT id FROM operations.services WHERE code = ${input.serviceCode} AND active = TRUE LIMIT 1`
  if (!service[0]) return response({ error: 'El servicio general no existe.' }, 400)
  const experts = await validExperts(sql, input.expertIds)
  if (experts.length !== input.expertIds.length) return response({ error: 'Uno o más expertos no son válidos o están inactivos.' }, 400)
  try {
    const created = await sql`INSERT INTO operations.consultation_types (code, name, description) VALUES (${input.code}, ${input.name}, ${input.description}) RETURNING id`
    await sql`INSERT INTO operations.service_consultation_types (service_id, consultation_type_id, amount_cents, currency, payment_required) VALUES (${service[0].id}, ${created[0].id}, ${input.amountCents}, ${input.currency}, ${input.paymentRequired})`
    await replaceConsultationExperts(sql, created[0].id, input.expertIds)
    await audit(sql, actorId, 'create', created[0].id, input)
    return response({ ok: true, id: String(created[0].id) }, 201)
  } catch (error) {
    if (String(error.message).includes('consultation_types_code_key') || String(error.message).includes('service_consultation_types_service_id_consultation_type_id_key')) return response({ error: 'Ya existe ese tipo de consulta para el servicio.' }, 409)
    throw error
  }
}

async function updateConsultationType(sql, id, body, actorId) {
  const input = validateConsultation(body)
  const service = await sql`SELECT id FROM operations.services WHERE code = ${input.serviceCode} AND active = TRUE LIMIT 1`
  if (!service[0]) return response({ error: 'El servicio general no existe.' }, 400)
  const experts = await validExperts(sql, input.expertIds)
  if (experts.length !== input.expertIds.length) return response({ error: 'Uno o más expertos no son válidos o están inactivos.' }, 400)
  const updated = await sql`UPDATE operations.consultation_types SET name = ${input.name}, description = ${input.description}, active = ${input.active}, updated_at = NOW() WHERE id = ${id} RETURNING id`
  if (!updated[0]) return response({ error: 'Tipo de consulta no encontrado.' }, 404)
  await sql`UPDATE operations.service_consultation_types SET amount_cents = ${input.amountCents}, currency = ${input.currency}, payment_required = ${input.paymentRequired}, active = ${input.active}, updated_at = NOW() WHERE service_id = ${service[0].id} AND consultation_type_id = ${id}`
  await replaceConsultationExperts(sql, id, input.expertIds)
  await audit(sql, actorId, 'update', id, input)
  return response({ ok: true, id: String(id) })
}

function validateConsultation(body) {
  const code = text(body.code).toLowerCase()
  const name = text(body.name)
  const serviceCode = text(body.serviceCode)
  const description = text(body.description)
  const amountCents = Number(body.amountCents)
  const currency = text(body.currency) || 'USD'
  const expertIds = Array.isArray(body.expertIds) ? body.expertIds.filter((value) => typeof value === 'string') : []
  const active = body.active !== false
  const paymentRequired = body.paymentRequired !== false
  if (!/^[a-z][a-z0-9_-]{2,50}$/.test(code) || !name || !serviceCode || !description) throw new RequestError('Código, nombre, servicio y descripción son obligatorios.')
  if (!Number.isInteger(amountCents) || amountCents < 0 || !['COP', 'USD'].includes(currency)) throw new RequestError('Precio o moneda inválidos.')
  return { code, name, serviceCode, description, amountCents, currency, expertIds, active, paymentRequired }
}

async function validExperts(sql, ids) {
  if (!ids.length) return []
  return sql`
    SELECT DISTINCT u.id
    FROM operations.users u
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'expert'
    WHERE u.active = TRUE AND u.id = ANY(${ids})
  `
}

async function replaceConsultationExperts(sql, consultationTypeId, expertIds) {
  await sql`DELETE FROM operations.consultation_type_experts WHERE consultation_type_id = ${consultationTypeId}`
  for (const expertId of expertIds) await sql`INSERT INTO operations.consultation_type_experts (consultation_type_id, user_id) VALUES (${consultationTypeId}, ${expertId})`
}

async function audit(sql, actorId, action, entityId, metadata) {
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, ${action}, 'consultation_type', ${entityId}, ${JSON.stringify(metadata)}::jsonb)`
}

async function listAgentLinks(sql, claims, url) {
  const isAdmin = claims.roles?.includes('admin')
  const page = Math.max(1, Number(url.searchParams.get('page') || 1))
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || 10)))
  const search = text(url.searchParams.get('search'))
  const offset = (page - 1) * pageSize
  const filter = search ? `%${search}%` : null
  const [countRows, rows] = await Promise.all([sql`
    SELECT COUNT(*)::int AS total
    FROM operations.agent_links l
    JOIN operations.users u ON u.id = l.agent_id
    WHERE ${isAdmin ? sql`TRUE` : sql`l.agent_id = ${claims.sub}`}
      AND (${filter}::text IS NULL OR l.label ILIKE ${filter} OR u.full_name ILIKE ${filter} OR u.email ILIKE ${filter})
  `, sql`
    SELECT l.id, l.agent_id, l.label, l.active, l.expires_at, l.revoked_at, l.created_at,
      u.full_name AS agent_name, u.email AS agent_email
    FROM operations.agent_links l
    JOIN operations.users u ON u.id = l.agent_id
    WHERE ${isAdmin ? sql`TRUE` : sql`l.agent_id = ${claims.sub}`}
      AND (${filter}::text IS NULL OR l.label ILIKE ${filter} OR u.full_name ILIKE ${filter} OR u.email ILIKE ${filter})
    ORDER BY l.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `])
  return response({ items: rows.map((row) => ({
    id: String(row.id), agentId: String(row.agent_id), agentName: String(row.agent_name), agentEmail: String(row.agent_email),
    label: String(row.label), active: Boolean(row.active), expiresAt: row.expires_at ? String(row.expires_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at),
  })), pagination: { page, pageSize, totalItems: Number(countRows[0]?.total || 0), totalPages: Math.max(1, Math.ceil(Number(countRows[0]?.total || 0) / pageSize)) } })
}

async function createAgentLink(sql, request, claims) {
  const input = await request.json().catch(() => ({}))
  const label = text(input.label) || 'Enlace principal'
  const requestedAgentId = text(input.agentId)
  const agentId = claims.roles?.includes('admin') && requestedAgentId ? requestedAgentId : claims.sub
  const agentRows = await sql`
    SELECT u.id
    FROM operations.users u
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'agent'
    WHERE u.id = ${agentId} AND u.active = TRUE
    LIMIT 1
  `
  if (!agentRows[0]) return response({ error: 'El usuario seleccionado no es un agente activo.' }, 400)

  const token = randomToken()
  const tokenHash = await sha256(token)
  const rows = await sql`
    INSERT INTO operations.agent_links (agent_id, token_hash, label)
    VALUES (${agentId}, ${tokenHash}, ${label})
    RETURNING id, label, active, created_at
  `
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${claims.sub}, 'create', 'agent_link', ${rows[0].id}, ${JSON.stringify({ agentId, label })}::jsonb)`
  return response({ ok: true, link: { id: String(rows[0].id), label: String(rows[0].label), active: Boolean(rows[0].active), createdAt: String(rows[0].created_at), token, path: `/solicitud/agente/${token}` } }, 201)
}

async function resolveAgentLink(sql, token) {
  if (!token || token.length < 20) return response({ error: 'Enlace inválido.' }, 404)
  const rows = await sql`
    SELECT l.id, l.agent_id, l.label, u.full_name AS agent_name
    FROM operations.agent_links l
    JOIN operations.users u ON u.id = l.agent_id
    WHERE l.token_hash = ${await sha256(token)}
      AND l.active = TRUE AND l.revoked_at IS NULL
      AND (l.expires_at IS NULL OR l.expires_at > NOW())
      AND u.active = TRUE
    LIMIT 1
  `
  if (!rows[0]) return response({ error: 'Enlace inválido o vencido.' }, 404)
  return response({ valid: true, source: 'agent_link', agentLinkId: String(rows[0].id), agentId: String(rows[0].agent_id), label: String(rows[0].label), displayLabel: 'Solicitud referida por su asesor' })
}

function serializeCatalogItem(row) {
  return {
    serviceCode: String(row.service_code), serviceName: String(row.service_name), serviceDescription: String(row.service_description),
    consultationCode: String(row.consultation_code), consultationName: String(row.consultation_name), consultationDescription: String(row.consultation_description),
    amountCents: Number(row.amount_cents), currency: String(row.currency), paymentRequired: Boolean(row.payment_required),
  }
}

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function base64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }
class RequestError extends Error { constructor(message) { super(message); this.status = 400 } }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
