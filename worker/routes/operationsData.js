import { requireOperationsAuth } from './operationsAuth.js'
import { sendRequestNotification } from './operationsEmail.js'

export async function handleOperationsData(request, env) {
  const url = new URL(request.url)
  const isClients = url.pathname === '/api/app/clients' && request.method === 'GET'
  const isRequests = url.pathname === '/api/app/requests' && request.method === 'GET'
  const createRequest = url.pathname === '/api/app/requests' && request.method === 'POST'
  const requestDetailMatch = url.pathname.match(/^\/api\/app\/requests\/([^/]+)$/)
  const isRequestDetail = Boolean(requestDetailMatch) && request.method === 'GET'
  const isDashboard = url.pathname === '/api/app/dashboard' && request.method === 'GET'
  if (!isClients && !isRequests && !createRequest && !isRequestDetail && !isDashboard) return null

  const claims = await requireOperationsAuth(request, env)
  const permission = isClients ? 'clients.read' : createRequest ? 'requests.create' : isRequests || isRequestDetail ? 'requests.read' : 'dashboard.read'
  if (!claims?.permissions?.includes(permission)) {
    return response({ error: 'No tienes permisos para consultar este módulo.' }, 403)
  }
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isDashboard) return getDashboard(sql, claims)
  if (isRequestDetail) return getRequestDetail(sql, requestDetailMatch[1], claims)
  if (createRequest) return createAgentRequest(sql, request, claims, env)

  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
  const search = String(url.searchParams.get('search') || '').trim()
  const searchPattern = `%${search}%`
  const offset = (page - 1) * pageSize
  const isAdmin = claims.roles?.includes('admin')

  if (isClients) {
    const [countRows, clients] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM operations.clients c WHERE c.full_name ILIKE ${searchPattern}`,
      sql`
        SELECT c.id, c.full_name, c.created_at, COUNT(r.id)::int AS request_count
        FROM operations.clients c
        LEFT JOIN operations.requests r ON r.client_id = c.id
        WHERE c.full_name ILIKE ${searchPattern}
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    ])
    return response({ items: clients.map(serializeClient), pagination: pagination(page, pageSize, countRows[0]?.total) })
  }

  const [countRows, requests] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS total
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      WHERE (c.full_name ILIKE ${searchPattern}
        OR r.reference ILIKE ${searchPattern}
        OR r.service_type ILIKE ${searchPattern}
        OR r.product_type ILIKE ${searchPattern}
        OR r.status ILIKE ${searchPattern}
        OR r.freight_agent ILIKE ${searchPattern}
        OR r.legal_entity_type ILIKE ${searchPattern}
        OR COALESCE(r.email, '') ILIKE ${searchPattern}
        OR COALESCE(r.phone, '') ILIKE ${searchPattern}
        OR COALESCE(r.whatsapp, '') ILIKE ${searchPattern}
        OR r.notification_status ILIKE ${searchPattern}
        OR r.source ILIKE ${searchPattern}) AND ${isAdmin ? sql`TRUE` : sql`r.created_by = ${claims.sub}`}
    `,
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp, r.payment_required,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent, r.product_type, r.status, r.created_at, r.updated_at,
        r.notification_status, r.notification_last_event_at, r.notification_last_opened_at,
        c.id AS client_id, c.full_name AS client_name, u.full_name AS agent_name, u.email AS agent_email
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      LEFT JOIN operations.users u ON u.id = r.created_by
      WHERE (c.full_name ILIKE ${searchPattern}
        OR r.reference ILIKE ${searchPattern}
        OR r.service_type ILIKE ${searchPattern}
        OR r.product_type ILIKE ${searchPattern}
        OR r.status ILIKE ${searchPattern}
        OR r.freight_agent ILIKE ${searchPattern}
        OR r.legal_entity_type ILIKE ${searchPattern}
        OR COALESCE(r.email, '') ILIKE ${searchPattern}
        OR COALESCE(r.phone, '') ILIKE ${searchPattern}
        OR COALESCE(r.whatsapp, '') ILIKE ${searchPattern}
        OR r.notification_status ILIKE ${searchPattern}
        OR r.source ILIKE ${searchPattern}) AND ${isAdmin ? sql`TRUE` : sql`r.created_by = ${claims.sub}`}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ])
  return response({ items: requests.map(serializeRequest), pagination: pagination(page, pageSize, countRows[0]?.total) })
}

async function createAgentRequest(sql, request, claims, env) {
  if (!claims.roles?.includes('agent') && !claims.roles?.includes('admin')) {
    return response({ error: 'Solo los agentes y administradores pueden crear solicitudes desde la app.' }, 403)
  }
  const input = await request.json().catch(() => ({}))
  const fullName = text(input.fullName)
  const legalEntityType = text(input.legalEntityType)
  const email = text(input.email)
  const phone = text(input.phone)
  const whatsapp = text(input.whatsapp)
  const serviceType = text(input.serviceType)
  const freightAgent = text(input.freightAgent)
  const productType = text(input.productType)
  if (!fullName) return response({ error: 'El nombre completo es obligatorio.' }, 400)
  if (!['natural', 'juridica'].includes(legalEntityType)) return response({ error: 'Selecciona la constitución legal.' }, 400)
  if (!email && !phone && !whatsapp) return response({ error: 'Ingresa al menos un medio de contacto.' }, 400)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return response({ error: 'Ingresa un correo electrónico válido.' }, 400)
  if (!['exportacion', 'importacion', 'agente_carga'].includes(serviceType)) return response({ error: 'Selecciona el tipo de servicio.' }, 400)
  if (!['vehiculos', 'mercancias'].includes(productType)) return response({ error: 'Selecciona el tipo de producto.' }, 400)

  const serviceRows = await sql`SELECT name FROM operations.service_catalog WHERE code = 'asesoria_personalizada' AND active = TRUE LIMIT 1`
  const serviceName = String(serviceRows[0]?.name || 'Asesoría personalizada')
  const clientId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const reference = `CRA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  await sql`INSERT INTO operations.clients (id, full_name) VALUES (${clientId}, ${fullName})`
  await sql`
    INSERT INTO operations.requests (
      id, client_id, reference, source, legal_entity_type, email, phone, whatsapp,
      service_name, service_amount_cents, service_currency, service_type, freight_agent,
      product_type, status, created_by, payment_required
    ) VALUES (
      ${requestId}, ${clientId}, ${reference}, 'agent', ${legalEntityType}, ${email || null},
      ${phone || null}, ${whatsapp || null}, ${serviceName}, 0, 'COP', ${serviceType},
      ${freightAgent || null}, ${productType}, 'pending', ${claims.sub}, FALSE
    )
  `
  if ((env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) && env.RESEND_FROM_EMAIL) {
    try {
      await sendRequestNotification(sql, env, requestId, 'request_created', claims.sub)
    } catch (error) {
      console.error('No se pudo enviar la notificación de solicitud del agente:', error.message)
    }
  }
  return response({ ok: true, reference, status: 'pending', paymentRequired: false }, 201)
}

async function getRequestDetail(sql, requestId, claims) {
  const accessFilter = claims.roles?.includes('admin') ? sql`TRUE` : sql`r.created_by = ${claims.sub}`
  const [requestRows, historyRows] = await Promise.all([
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp, r.payment_required,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent,
        r.product_type, r.status, r.created_at, r.updated_at, r.notification_status,
        r.notification_last_event_at, r.notification_last_opened_at,
        c.id AS client_id, c.full_name AS client_name, c.created_at AS client_created_at,
        u.full_name AS agent_name, u.email AS agent_email
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      LEFT JOIN operations.users u ON u.id = r.created_by
      WHERE r.id = ${requestId} AND ${accessFilter}
      LIMIT 1
    `,
    sql`
      SELECT r.id, r.reference, r.service_type, r.product_type, r.status, r.created_at
      FROM operations.requests r
      WHERE r.client_id = (SELECT client_id FROM operations.requests WHERE id = ${requestId})
        AND ${claims.roles?.includes('admin') ? sql`TRUE` : sql`r.created_by = ${claims.sub}`}
      ORDER BY r.created_at DESC
    `,
  ])
  if (!requestRows[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  return response({ request: serializeRequestDetail(requestRows[0]), history: historyRows.map(serializeRequestHistory) })
}

async function getDashboard(sql, claims) {
  const accessFilter = claims.roles?.includes('admin') ? sql`TRUE` : sql`created_by = ${claims.sub}`
  const [totalRows, activeRows, pendingRows, closedRows, notSentRows, openedRows, statusRows, recentRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE ${accessFilter}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status NOT IN ('closed', 'cancelled') AND ${accessFilter}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status = 'pending' AND ${accessFilter}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status = 'closed' AND created_at >= date_trunc('month', NOW()) AND ${accessFilter}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE notification_status = 'not_sent' AND ${accessFilter}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE notification_status = 'opened' AND ${accessFilter}`,
    sql`SELECT status, COUNT(*)::int AS total FROM operations.requests WHERE ${accessFilter} GROUP BY status ORDER BY status`,
    sql`
      SELECT r.reference, r.status, r.service_type, r.product_type, r.source, r.created_at, r.notification_status,
        c.full_name AS client_name
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      WHERE ${claims.roles?.includes('admin') ? sql`TRUE` : sql`r.created_by = ${claims.sub}`}
      ORDER BY r.created_at DESC
      LIMIT 5
    `,
  ])
  const byStatus = Object.fromEntries(statusRows.map((row) => [String(row.status), Number(row.total || 0)]))
  const total = Number(totalRows[0]?.total || 0)
  const recent = recentRows.map((row) => ({
    reference: String(row.reference),
    clientName: String(row.client_name),
    status: String(row.status),
    serviceName: String(row.service_name || 'Asesoría personalizada'),
    serviceAmountCents: Number(row.service_amount_cents || 0),
    serviceCurrency: String(row.service_currency || 'COP'),
    serviceType: String(row.service_type),
    productType: String(row.product_type),
    source: String(row.source),
    paymentRequired: row.payment_required === undefined ? true : Boolean(row.payment_required),
      notificationStatus: String(row.notification_status || 'not_sent'),
    createdAt: String(row.created_at),
  }))
  return response({
    metrics: {
      active: Number(activeRows[0]?.total || 0),
      pending: Number(pendingRows[0]?.total || 0),
      inProgress: Number(byStatus.in_progress || 0),
      closedThisMonth: Number(closedRows[0]?.total || 0),
      emailsPending: Number(notSentRows[0]?.total || 0),
      emailsOpened: Number(openedRows[0]?.total || 0),
      total,
    },
    pipeline: [
      { label: 'Pendientes', value: Number(byStatus.pending || 0), color: 'amber' },
      { label: 'En revisión', value: Number(byStatus.in_review || 0), color: 'violet' },
      { label: 'En gestión', value: Number(byStatus.in_progress || 0), color: 'blue' },
      { label: 'Cerradas', value: Number(byStatus.closed || 0), color: 'green' },
    ],
    recent,
  })
}

function pagination(page, pageSize, totalValue) {
  const totalItems = Number(totalValue || 0)
  return { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) }
}

function serializeClient(row) {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    createdAt: String(row.created_at),
    requestCount: Number(row.request_count || 0),
  }
}

function serializeRequest(row) {
  return {
    id: String(row.id),
    reference: String(row.reference),
    source: String(row.source),
    legalEntityType: String(row.legal_entity_type),
    email: row.email ? String(row.email) : '',
    phone: row.phone ? String(row.phone) : '',
    whatsapp: row.whatsapp ? String(row.whatsapp) : '',
    serviceType: String(row.service_type),
    freightAgent: row.freight_agent ? String(row.freight_agent) : '',
    productType: String(row.product_type),
    status: String(row.status),
    notificationStatus: String(row.notification_status || 'not_sent'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    agentName: row.agent_name ? String(row.agent_name) : '',
    agentEmail: row.agent_email ? String(row.agent_email) : '',
  }
}

function serializeRequestDetail(row) {
  return {
    ...serializeRequest(row),
    serviceName: row.service_name ? String(row.service_name) : 'Asesoría personalizada',
    serviceAmountCents: Number(row.service_amount_cents || 0),
    serviceCurrency: String(row.service_currency || 'COP'),
    clientCreatedAt: String(row.client_created_at),
  }
}

function serializeRequestHistory(row) {
  return {
    id: String(row.id),
    reference: String(row.reference),
    serviceType: String(row.service_type),
    productType: String(row.product_type),
    status: String(row.status),
    createdAt: String(row.created_at),
  }
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
