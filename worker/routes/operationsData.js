import { requireOperationsAuth } from './operationsAuth.js'
import { sendRequestNotification } from './operationsEmail.js'

export async function handleOperationsData(request, env) {
  const url = new URL(request.url)
  const isClients = url.pathname === '/api/app/clients' && request.method === 'GET'
  const isRequests = url.pathname === '/api/app/requests' && request.method === 'GET'
  const createRequest = url.pathname === '/api/app/requests' && request.method === 'POST'
  const requestDetailMatch = url.pathname.match(/^\/api\/app\/requests\/([^/]+)$/)
  const isRequestDetail = Boolean(requestDetailMatch) && request.method === 'GET'
  const requestAssignmentMatch = url.pathname.match(/^\/api\/app\/requests\/([^/]+)\/assignment$/)
  const isRequestAssignment = Boolean(requestAssignmentMatch) && request.method === 'POST'
  const isDashboard = url.pathname === '/api/app/dashboard' && request.method === 'GET'
  if (!isClients && !isRequests && !createRequest && !isRequestDetail && !isRequestAssignment && !isDashboard) return null

  const claims = await requireOperationsAuth(request, env)
  const permission = isClients ? 'clients.read' : createRequest ? 'requests.create' : isRequestAssignment ? 'requests.update' : isRequests || isRequestDetail ? 'requests.read' : 'dashboard.read'
  if (!claims?.permissions?.includes(permission)) {
    return response({ error: 'No tienes permisos para consultar este módulo.' }, 403)
  }
  if (createRequest && claims.roles?.includes('agent') && !claims.roles?.includes('admin')) {
    return response({ error: 'Los agentes deben compartir su enlace para que el cliente cree la solicitud.' }, 403)
  }
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isDashboard) return getDashboard(sql, claims)
  if (isRequestAssignment) {
    if (!claims.roles?.includes('admin')) return response({ error: 'Solo administración puede asignar o reasignar expertos.' }, 403)
    return assignRequestExpert(sql, request, requestAssignmentMatch[1], claims, env)
  }
  if (isRequestDetail) return getRequestDetail(sql, requestDetailMatch[1], claims)
  if (createRequest) return createAgentRequest(sql, request, claims, env)

  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
  const search = String(url.searchParams.get('search') || '').trim()
  const requestStatus = String(url.searchParams.get('status') || '').trim()
  const requestServiceType = String(url.searchParams.get('serviceType') || '').trim()
  const requestSource = String(url.searchParams.get('source') || '').trim()
  const requestAgentId = String(url.searchParams.get('agentId') || '').trim()
  const requestDateFrom = String(url.searchParams.get('dateFrom') || '').trim()
  const requestDateTo = String(url.searchParams.get('dateTo') || '').trim()
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

  const requestAccess = isAdmin ? sql`TRUE` : sql`(r.agent_id = ${claims.sub} OR (r.agent_id IS NULL AND r.created_by = ${claims.sub}))`
  const [countRows, requests, agents] = await Promise.all([
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
        OR r.source ILIKE ${searchPattern})
        AND ${requestAccess}
        AND (${requestStatus ? sql`r.status = ${requestStatus}` : sql`TRUE`})
        AND (${requestServiceType ? sql`r.service_type = ${requestServiceType}` : sql`TRUE`})
        AND (${requestSource ? sql`COALESCE(r.source_channel, CASE WHEN r.source = 'agent' THEN 'agent_link' ELSE 'direct_web' END) = ${requestSource}` : sql`TRUE`})
        AND (${requestAgentId && isAdmin ? sql`r.agent_id = ${requestAgentId}` : sql`TRUE`})
        AND (${requestDateFrom ? sql`r.created_at >= ${requestDateFrom}::date` : sql`TRUE`})
        AND (${requestDateTo ? sql`r.created_at < (${requestDateTo}::date + INTERVAL '1 day')` : sql`TRUE`})
    `,
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp, r.payment_required,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent, r.product_type, r.status, r.created_at, r.updated_at,
        r.notification_status, r.notification_last_event_at, r.notification_last_opened_at,
        c.id AS client_id, c.full_name AS client_name, u.full_name AS agent_name, u.email AS agent_email,
        payment.status AS payment_status, payment.mercado_pago_payment_id, payment.mercado_pago_preference_id,
        payment.usd_amount_cents, payment.cop_amount_cents, payment.trm_cop_per_usd, payment.trm_effective_date,
        payment.updated_at AS payment_updated_at
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      LEFT JOIN operations.users u ON u.id = COALESCE(r.agent_id, r.created_by)
      LEFT JOIN LATERAL (
        SELECT * FROM operations.request_payments p
        WHERE p.request_id = r.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) payment ON TRUE
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
        OR r.source ILIKE ${searchPattern})
        AND ${requestAccess}
        AND (${requestStatus ? sql`r.status = ${requestStatus}` : sql`TRUE`})
        AND (${requestServiceType ? sql`r.service_type = ${requestServiceType}` : sql`TRUE`})
        AND (${requestSource ? sql`COALESCE(r.source_channel, CASE WHEN r.source = 'agent' THEN 'agent_link' ELSE 'direct_web' END) = ${requestSource}` : sql`TRUE`})
        AND (${requestAgentId && isAdmin ? sql`r.agent_id = ${requestAgentId}` : sql`TRUE`})
        AND (${requestDateFrom ? sql`r.created_at >= ${requestDateFrom}::date` : sql`TRUE`})
        AND (${requestDateTo ? sql`r.created_at < (${requestDateTo}::date + INTERVAL '1 day')` : sql`TRUE`})
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql`
      SELECT DISTINCT u.id, u.full_name, u.email
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles r ON r.id = ur.role_id
      WHERE r.name = 'agent' AND u.active = TRUE
      ORDER BY u.full_name
    `,
  ])
  return response({ items: requests.map(serializeRequest), pagination: pagination(page, pageSize, countRows[0]?.total), filters: { agents: agents.map((row) => ({ id: String(row.id), name: String(row.full_name), email: String(row.email) })) } })
}

async function createAgentRequest(sql, request, claims, env) {
  if (!claims.roles?.includes('admin')) {
    return response({ error: 'Las solicitudes deben ser creadas por el cliente desde el formulario público.' }, 403)
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
  const accessFilter = claims.roles?.includes('admin') ? sql`TRUE` : sql`(r.agent_id = ${claims.sub} OR (r.agent_id IS NULL AND r.created_by = ${claims.sub}))`
  const [requestRows, historyRows, responseRows] = await Promise.all([
    sql`
      SELECT r.id, r.reference, r.source, r.legal_entity_type, r.email, r.phone, r.whatsapp, r.payment_required,
        r.service_name, r.service_amount_cents, r.service_currency, r.service_type, r.freight_agent,
        r.product_type, r.status, r.created_at, r.updated_at, r.notification_status, r.consultation_type_id,
        r.consultation_type_name, r.assigned_expert_id, assigned.full_name AS assigned_expert_name,
        r.notification_last_event_at, r.notification_last_opened_at,
        payment.status AS payment_status, payment.mercado_pago_payment_id, payment.mercado_pago_preference_id,
        payment.usd_amount_cents, payment.cop_amount_cents, payment.trm_cop_per_usd, payment.trm_effective_date,
        payment.updated_at AS payment_updated_at,
        c.id AS client_id, c.full_name AS client_name, c.created_at AS client_created_at,
        u.full_name AS agent_name, u.email AS agent_email
      FROM operations.requests r
      JOIN operations.clients c ON c.id = r.client_id
      LEFT JOIN operations.users u ON u.id = COALESCE(r.agent_id, r.created_by)
      LEFT JOIN operations.users assigned ON assigned.id = r.assigned_expert_id
      LEFT JOIN LATERAL (
        SELECT * FROM operations.request_payments p
        WHERE p.request_id = r.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) payment ON TRUE
      WHERE r.id = ${requestId} AND ${accessFilter}
      LIMIT 1
    `,
    sql`
      SELECT r.id, r.reference, r.service_type, r.product_type, r.status, r.created_at
      FROM operations.requests r
      WHERE r.client_id = (SELECT client_id FROM operations.requests WHERE id = ${requestId})
        AND ${claims.roles?.includes('admin') ? sql`TRUE` : sql`(r.agent_id = ${claims.sub} OR (r.agent_id IS NULL AND r.created_by = ${claims.sub}))`}
      ORDER BY r.created_at DESC
    `,
    sql`
      SELECT er.id, er.version, er.body, er.status, er.admin_note, er.created_at, er.updated_at,
        er.reviewed_at, er.sent_at, er.response_origin, COALESCE(u.full_name, 'Administración') AS expert_name
      FROM operations.expert_responses er
      LEFT JOIN operations.users u ON u.id = er.expert_id
      WHERE er.request_id = ${requestId}
      ORDER BY er.version DESC
    `,
  ])
  if (!requestRows[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  const isAdmin = claims.roles?.includes('admin')
  const [assignmentHistory, eligibleExperts] = await Promise.all([
    sql`SELECT a.id, a.expert_id, u.full_name AS expert_name, a.status, a.strategy, a.candidate_count, a.reason, a.assigned_at
      FROM operations.request_assignments a LEFT JOIN operations.users u ON u.id = a.expert_id
      WHERE a.request_id = ${requestId} ORDER BY a.assigned_at DESC`,
    sql`SELECT DISTINCT u.id, u.full_name
      FROM operations.users u
      JOIN operations.user_roles ur ON ur.user_id = u.id
      JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
      JOIN operations.consultation_type_experts cte ON cte.user_id = u.id AND cte.active = TRUE
      WHERE u.active = TRUE AND cte.consultation_type_id = ${requestRows[0].consultation_type_id}
      ORDER BY u.full_name`,
  ])
  return response({
    request: serializeRequestDetail(requestRows[0]),
    history: historyRows.map(serializeRequestHistory),
    responses: responseRows.map((row) => serializeRequestResponse(row, isAdmin || ['approved', 'sent'].includes(String(row.status)))),
    assignment: { expertId: requestRows[0].assigned_expert_id ? String(requestRows[0].assigned_expert_id) : null, expertName: requestRows[0].assigned_expert_name ? String(requestRows[0].assigned_expert_name) : '', history: assignmentHistory.map((row) => ({ id: String(row.id), expertId: row.expert_id ? String(row.expert_id) : null, expertName: row.expert_name ? String(row.expert_name) : '', status: String(row.status), strategy: String(row.strategy), candidateCount: Number(row.candidate_count), reason: row.reason ? String(row.reason) : '', assignedAt: String(row.assigned_at) })) },
    eligibleExperts: eligibleExperts.map((row) => ({ id: String(row.id), name: String(row.full_name) })),
  })
}

async function assignRequestExpert(sql, request, requestId, claims, env) {
  const body = await request.json().catch(() => ({}))
  const expertId = text(body.expertId)
  if (!expertId) return response({ error: 'Selecciona un experto para asignar la solicitud.' }, 400)
  const requests = await sql`SELECT id, consultation_type_id, assigned_expert_id, status FROM operations.requests WHERE id = ${requestId} LIMIT 1`
  if (!requests[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  if (['closed', 'cancelled'].includes(String(requests[0].status))) return response({ error: 'No se puede asignar una solicitud cerrada o cancelada.' }, 409)
  const pendingResponses = await sql`SELECT 1 FROM operations.expert_responses WHERE request_id = ${requestId} AND status = 'pending_admin_review' LIMIT 1`
  if (pendingResponses.length) return response({ error: 'Revisa la respuesta pendiente antes de reasignar el experto.' }, 409)
  const experts = await sql`
    SELECT DISTINCT u.id, u.full_name
    FROM operations.users u
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
    JOIN operations.consultation_type_experts cte ON cte.user_id = u.id AND cte.active = TRUE
    WHERE u.active = TRUE AND u.id = ${expertId} AND cte.consultation_type_id = ${requests[0].consultation_type_id}
    LIMIT 1
  `
  if (!experts[0]) return response({ error: 'El experto debe estar activo y asociado al tipo de consulta de esta solicitud.' }, 400)
  await sql`UPDATE operations.request_assignments SET status = 'reassigned' WHERE request_id = ${requestId} AND status = 'assigned'`
  await sql`
    INSERT INTO operations.request_assignments (request_id, expert_id, consultation_type_id, candidate_count, strategy, status, reason, assigned_by)
    VALUES (${requestId}, ${expertId}, ${requests[0].consultation_type_id}, 1, 'admin_manual', ${requests[0].assigned_expert_id ? 'reassigned' : 'assigned'}, ${text(body.reason) || (requests[0].assigned_expert_id ? 'Reasignación administrativa' : 'Asignación administrativa')}, ${claims.sub})
  `
  await sql`UPDATE operations.requests SET assigned_expert_id = ${expertId}, updated_at = NOW() WHERE id = ${requestId}`
  await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${claims.sub}, 'assign', 'request', ${requestId}, ${JSON.stringify({ expertId, previousExpertId: requests[0].assigned_expert_id ? String(requests[0].assigned_expert_id) : null })}::jsonb)`
  if ((env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) && env.RESEND_FROM_EMAIL) {
    try { await sendRequestNotification(sql, env, requestId, 'expert_assigned', claims.sub) } catch (error) { console.error('No se pudo notificar la asignación del experto:', error.message) }
  }
  return response({ ok: true, expert: { id: String(experts[0].id), name: String(experts[0].full_name) } })
}

async function getDashboard(sql, claims) {
  // Experts get an operational summary of their assigned cases only. Never
  // join clients or expose customer-identifying fields in their dashboard.
  if (claims.roles?.includes('expert') && !claims.roles?.includes('admin')) return getExpertDashboard(sql, claims)
  const accessFilter = claims.roles?.includes('admin') ? sql`TRUE` : sql`(agent_id = ${claims.sub} OR (agent_id IS NULL AND created_by = ${claims.sub}))`
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
      WHERE ${claims.roles?.includes('admin') ? sql`TRUE` : sql`(r.agent_id = ${claims.sub} OR (r.agent_id IS NULL AND r.created_by = ${claims.sub}))`}
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

async function getExpertDashboard(sql, claims) {
  const assigned = sql`assigned_expert_id = ${claims.sub}`
  const [totalRows, activeRows, pendingRows, statusRows, recentRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE ${assigned}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.requests WHERE status NOT IN ('closed', 'cancelled') AND ${assigned}`,
    sql`SELECT COUNT(*)::int AS total FROM operations.expert_responses er JOIN operations.requests r ON r.id = er.request_id WHERE er.expert_id = ${claims.sub} AND er.status = 'pending_admin_review'`,
    sql`SELECT r.status, COUNT(*)::int AS total FROM operations.requests r WHERE ${assigned} GROUP BY r.status`,
    sql`SELECT r.reference, r.status, r.service_type, r.consultation_type_name, r.created_at,
          COALESCE(latest.status, 'none') AS response_status
        FROM operations.requests r
        LEFT JOIN LATERAL (
          SELECT er.status FROM operations.expert_responses er
          WHERE er.request_id = r.id AND er.expert_id = ${claims.sub}
          ORDER BY er.version DESC LIMIT 1
        ) latest ON TRUE
        WHERE r.assigned_expert_id = ${claims.sub}
        ORDER BY r.created_at DESC LIMIT 5`,
  ])
  const byStatus = Object.fromEntries(statusRows.map((row) => [String(row.status), Number(row.total || 0)]))
  const total = Number(totalRows[0]?.total || 0)
  return response({
    metrics: {
      total,
      active: Number(activeRows[0]?.total || 0),
      pending: Number(pendingRows[0]?.total || 0),
      inProgress: Number(byStatus.in_review || 0),
      closedThisMonth: Number(byStatus.closed || 0),
      emailsPending: 0,
      emailsOpened: 0,
    },
    pipeline: [
      { label: 'Pendientes', value: Number(byStatus.pending || 0), color: 'amber' },
      { label: 'En revisión', value: Number(byStatus.in_review || 0), color: 'violet' },
      { label: 'En gestión', value: Number(byStatus.in_progress || 0), color: 'blue' },
      { label: 'Cerradas', value: Number(byStatus.closed || 0), color: 'green' },
    ],
    recent: recentRows.map((row) => ({
      reference: String(row.reference),
      clientName: '',
      status: String(row.status),
      serviceType: String(row.consultation_type_name || row.service_type),
      productType: '',
      createdAt: String(row.created_at),
      source: '',
    })),
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
  const sourceChannel = row.source_channel ? String(row.source_channel) : (row.source === 'agent' ? 'agent_link' : 'direct_web')
  return {
    id: String(row.id),
    reference: String(row.reference),
    source: sourceChannel === 'agent_link' ? 'Agente' : 'Página web',
    sourceChannel,
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
    payment: row.payment_status ? {
      status: String(row.payment_status),
      paymentId: row.mercado_pago_payment_id ? String(row.mercado_pago_payment_id) : '',
      preferenceId: row.mercado_pago_preference_id ? String(row.mercado_pago_preference_id) : '',
      usdAmountCents: Number(row.usd_amount_cents || 0),
      copAmountCents: Number(row.cop_amount_cents || 0),
      trm: Number(row.trm_cop_per_usd || 0),
      trmDate: row.trm_effective_date ? String(row.trm_effective_date) : '',
      updatedAt: row.payment_updated_at ? String(row.payment_updated_at) : '',
    } : null,
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

function serializeRequestResponse(row, canViewBody) {
  return {
    id: String(row.id),
    version: Number(row.version),
    body: canViewBody ? String(row.body) : '',
    status: String(row.status),
    adminNote: canViewBody && row.admin_note ? String(row.admin_note) : '',
    expertName: row.response_origin === 'reused_answer' ? 'Administración (respuesta reutilizada)' : String(row.expert_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    sentAt: row.sent_at ? String(row.sent_at) : null,
    bodyVisible: Boolean(canViewBody),
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
