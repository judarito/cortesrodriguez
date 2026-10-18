import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsCatalog(request, env) {
  const url = new URL(request.url)
  const isPublicCatalog = url.pathname === '/api/public/catalog' && request.method === 'GET'
  const publicAgentMatch = url.pathname.match(/^\/api\/public\/agent-links\/([^/]+)$/)
  const isPublicAgentLink = Boolean(publicAgentMatch) && request.method === 'GET'
  const isAdminCatalog = url.pathname === '/api/app/catalog' && request.method === 'GET'
  const isAgentLinks = url.pathname === '/api/app/agent-links' && ['GET', 'POST'].includes(request.method)
  if (!isPublicCatalog && !isPublicAgentLink && !isAdminCatalog && !isAgentLinks) return null
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

  if (!claims.permissions?.includes('agent_links.manage')) return response({ error: 'No tienes permisos para gestionar enlaces de agente.' }, 403)
  if (request.method === 'GET') return listAgentLinks(sql, claims)
  return createAgentLink(sql, request, claims)
}

async function getPublicCatalog(sql) {
  const rows = await sql`
    SELECT s.code AS service_code, s.name AS service_name, s.description AS service_description,
      sp.code AS specialty_code, sp.name AS specialty_name, sp.description AS specialty_description,
      ss.amount_cents, ss.currency
    FROM operations.service_specialties ss
    JOIN operations.services s ON s.id = ss.service_id
    JOIN operations.specialties sp ON sp.id = ss.specialty_id
    WHERE s.active = TRUE AND sp.active = TRUE AND ss.active = TRUE
      AND (ss.valid_until IS NULL OR ss.valid_until > NOW())
    ORDER BY s.sort_order, s.name, sp.name
  `
  return response({ items: rows.map(serializeCatalogItem) })
}

async function getAdminCatalog(sql) {
  const [services, specialties, assignments] = await Promise.all([
    sql`
      SELECT s.id, s.code, s.name, s.description, s.active, s.sort_order,
        COALESCE(json_agg(json_build_object(
          'id', ss.id, 'specialtyId', sp.id, 'specialtyCode', sp.code,
          'specialtyName', sp.name, 'amountCents', ss.amount_cents,
          'currency', ss.currency, 'active', ss.active
        ) ORDER BY sp.name) FILTER (WHERE ss.id IS NOT NULL), '[]'::json) AS specialties
      FROM operations.services s
      LEFT JOIN operations.service_specialties ss ON ss.service_id = s.id
      LEFT JOIN operations.specialties sp ON sp.id = ss.specialty_id
      GROUP BY s.id
      ORDER BY s.sort_order, s.name
    `,
    sql`SELECT id, code, name, description, active FROM operations.specialties ORDER BY name`,
    sql`
      SELECT u.id, u.full_name, u.email, sp.id AS specialty_id, sp.name AS specialty_name
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles r ON r.id = ur.role_id AND r.name = 'expert'
      LEFT JOIN operations.expert_specialties es ON es.user_id = u.id AND es.active = TRUE
      LEFT JOIN operations.specialties sp ON sp.id = es.specialty_id
      WHERE u.active = TRUE
      ORDER BY u.full_name, sp.name
    `,
  ])
  return response({
    services: services.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), description: String(row.description), active: Boolean(row.active), sortOrder: Number(row.sort_order), specialties: Array.isArray(row.specialties) ? row.specialties : [] })),
    specialties: specialties.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), description: String(row.description), active: Boolean(row.active) })),
    experts: assignments.map((row) => ({ id: String(row.id), name: String(row.full_name), email: String(row.email), specialtyId: row.specialty_id ? String(row.specialty_id) : null, specialtyName: row.specialty_name ? String(row.specialty_name) : null })),
  })
}

async function listAgentLinks(sql, claims) {
  const isAdmin = claims.roles?.includes('admin')
  const rows = await sql`
    SELECT l.id, l.agent_id, l.label, l.active, l.expires_at, l.revoked_at, l.created_at,
      u.full_name AS agent_name, u.email AS agent_email
    FROM operations.agent_links l
    JOIN operations.users u ON u.id = l.agent_id
    WHERE ${isAdmin ? sql`TRUE` : sql`l.agent_id = ${claims.sub}`}
    ORDER BY l.created_at DESC
  `
  return response({ items: rows.map((row) => ({
    id: String(row.id), agentId: String(row.agent_id), agentName: String(row.agent_name), agentEmail: String(row.agent_email),
    label: String(row.label), active: Boolean(row.active), expiresAt: row.expires_at ? String(row.expires_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at),
  })) })
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
    specialtyCode: String(row.specialty_code), specialtyName: String(row.specialty_name), specialtyDescription: String(row.specialty_description),
    amountCents: Number(row.amount_cents), currency: String(row.currency),
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
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
