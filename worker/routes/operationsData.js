import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsData(request, env) {
  const url = new URL(request.url)
  const isClients = url.pathname === '/api/app/clients' && request.method === 'GET'
  const isRequests = url.pathname === '/api/app/requests' && request.method === 'GET'
  const requestDetailMatch = url.pathname.match(/^\/api\/app\/requests\/([^/]+)$/)
  const isRequestDetail = Boolean(requestDetailMatch) && request.method === 'GET'
  const isDashboard = url.pathname === '/api/app/dashboard' && request.method === 'GET'
  if (!isClients && !isRequests && !isRequestDetail && !isDashboard) return null

  const claims = await requireOperationsAuth(request, env)
  const permission = isClients ? 'clients.read' : isRequests || isRequestDetail ? 'requests.read' : 'dashboard.read'
  if (!claims?.permissions?.includes(permission)) {
    return response({ error: 'No tienes permisos para consultar este módulo.' }, 403)
  }
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isDashboard) return getDashboard(sql)
  if (isRequestDetail) return getRequestDetail(sql, requestDetailMatch[1])

  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
  const search = String(url.searchParams.get('search') || '').trim()
  const searchPattern = `%${search}%`
  const offset = (page - 1) * pageSize

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
      WHERE c.full_name ILIKE ${searchPattern}
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
        OR r.source ILIKE ${searchPattern}
    `,
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent, r.product_type, r.status, r.created_at, r.updated_at,
        r.notification_status, r.notification_last_event_at, r.notification_last_opened_at,
        c.id AS client_id, c.full_name AS client_name
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      WHERE c.full_name ILIKE ${searchPattern}
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
        OR r.source ILIKE ${searchPattern}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ])
  return response({ items: requests.map(serializeRequest), pagination: pagination(page, pageSize, countRows[0]?.total) })
}

async function getRequestDetail(sql, requestId) {
  const [requestRows, historyRows] = await Promise.all([
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent,
        r.product_type, r.status, r.created_at, r.updated_at, r.notification_status,
        r.notification_last_event_at, r.notification_last_opened_at,
        c.id AS client_id, c.full_name AS client_name, c.created_at AS client_created_at
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      WHERE r.id = ${requestId}
      LIMIT 1
    `,
    sql`
      SELECT r.id, r.reference, r.service_type, r.product_type, r.status, r.created_at
      FROM operations.requests r
      WHERE r.client_id = (SELECT client_id FROM operations.requests WHERE id = ${requestId})
      ORDER BY r.created_at DESC
    `,
  ])
  if (!requestRows[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  return response({ request: serializeRequestDetail(requestRows[0]), history: historyRows.map(serializeRequestHistory) })
}

async function getDashboard(sql) {
  const [totalRows, activeRows, pendingRows, closedRows, notSentRows, openedRows, statusRows, recentRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.requests`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status NOT IN ('closed', 'cancelled')`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status = 'pending'`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status = 'closed' AND created_at >= date_trunc('month', NOW())`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE notification_status = 'not_sent'`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE notification_status = 'opened'`,
    sql`SELECT status, COUNT(*)::int AS total FROM operations.requests GROUP BY status ORDER BY status`,
    sql`
      SELECT r.reference, r.status, r.service_type, r.product_type, r.source, r.created_at, r.notification_status,
        c.full_name AS client_name
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
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
