import { requireOperationsAuth } from './operationsAuth.js'

const CASES_PATH = '/api/app/payment-exceptions'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,128}$/
const PAGE_SIZE_MAX = 50
const REASON_MIN_LENGTH = 10
const REASON_MAX_LENGTH = 1000
const EXTERNAL_REFERENCE_MAX_LENGTH = 160

const actionPolicy = {
  duplicate_approved: {
    refund_requested: 'pending_external',
    refund_confirmed: 'resolved',
    retain_approved_payment: 'resolved',
  },
  refunded: { refund_verified: 'resolved' },
  chargeback: {
    chargeback_acknowledged: 'pending_external',
    chargeback_disputed: 'pending_external',
    chargeback_closed: 'resolved',
  },
}

const actionsRequiringExternalReference = new Set(['refund_confirmed', 'chargeback_disputed', 'chargeback_closed'])

/** Admin-only case tracking for provider-synchronized payment exceptions. */
export async function handleOperationsPaymentExceptions(request, env) {
  const url = new URL(request.url)
  const listRequest = url.pathname === CASES_PATH && request.method === 'GET'
  const caseMatch = url.pathname.match(/^\/api\/app\/payment-exceptions\/([^/]+)$/)
  const actionMatch = url.pathname.match(/^\/api\/app\/payment-exceptions\/([^/]+)\/actions$/)
  const detailRequest = Boolean(caseMatch) && request.method === 'GET'
  const createAction = Boolean(actionMatch) && request.method === 'POST'
  if (!listRequest && !detailRequest && !createAction) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return json({ error: 'Sesión requerida.' }, 401)
  if (!claims.roles?.includes('admin')) return json({ error: 'Solo administración puede gestionar excepciones de pago.' }, 403)
  if (!env.NEON_DATABASE_URL) return json({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (listRequest) return listCases(sql, url)

  const caseId = caseMatch?.[1] || actionMatch?.[1]
  if (!uuidPattern.test(String(caseId))) return json({ error: 'Caso financiero no encontrado.' }, 404)
  if (detailRequest) return getCase(sql, caseId)
  return createActionForCase(sql, request, caseId, claims)
}

async function listCases(sql, url) {
  const status = String(url.searchParams.get('status') || 'open').trim()
  const exceptionType = String(url.searchParams.get('type') || '').trim()
  if (!['open', 'pending_external', 'resolved', 'all'].includes(status)) {
    return json({ error: 'El estado del caso no es válido.' }, 400)
  }
  if (exceptionType && !Object.hasOwn(actionPolicy, exceptionType)) {
    return json({ error: 'El tipo de excepción no es válido.' }, 400)
  }
  const page = positiveInteger(url.searchParams.get('page'), 1)
  const pageSize = Math.min(positiveInteger(url.searchParams.get('pageSize'), 20), PAGE_SIZE_MAX)
  const offset = (page - 1) * pageSize
  const [countRows, rows] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS total
      FROM operations.payment_exception_cases c
      WHERE (${status} = 'all' OR c.resolution_status = ${status})
        AND (${exceptionType} = '' OR c.exception_type = ${exceptionType})
    `,
    sql`
      SELECT c.id AS case_id, c.request_id, c.payment_id, c.exception_type,
        c.resolution_status, c.created_at, c.updated_at, c.resolved_at,
        r.reference AS request_reference, p.reference AS payment_reference,
        p.status AS provider_payment_status, p.mercado_pago_payment_id,
        p.usd_amount_cents, p.cop_amount_cents
      FROM operations.payment_exception_cases c
      JOIN operations.requests r ON r.id = c.request_id
      JOIN operations.request_payments p ON p.id = c.payment_id
      WHERE (${status} = 'all' OR c.resolution_status = ${status})
        AND (${exceptionType} = '' OR c.exception_type = ${exceptionType})
      ORDER BY CASE c.resolution_status WHEN 'open' THEN 0 WHEN 'pending_external' THEN 1 ELSE 2 END,
        c.created_at DESC, c.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ])
  return json({
    items: rows.map(serializeCase),
    pagination: pagination(page, pageSize, countRows[0]?.total),
  })
}

async function getCase(sql, caseId) {
  const rows = await sql`
    SELECT c.id AS case_id, c.request_id, c.payment_id, c.exception_type,
      c.resolution_status, c.created_at, c.updated_at, c.resolved_at,
      r.reference AS request_reference, p.reference AS payment_reference,
      p.status AS provider_payment_status, p.mercado_pago_payment_id,
      p.usd_amount_cents, p.cop_amount_cents
    FROM operations.payment_exception_cases c
    JOIN operations.requests r ON r.id = c.request_id
    JOIN operations.request_payments p ON p.id = c.payment_id
    WHERE c.id = ${caseId}::uuid LIMIT 1
  `
  if (!rows[0]) return json({ error: 'Caso financiero no encontrado.' }, 404)
  const actions = await sql`
    SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action_type,
      a.from_status, a.to_status, a.reason, a.external_reference, a.created_at
    FROM operations.payment_exception_actions a
    LEFT JOIN operations.users u ON u.id = a.actor_id
    WHERE a.case_id = ${caseId}::uuid
    ORDER BY a.created_at DESC, a.id DESC
  `
  return json({ case: serializeCase(rows[0]), actions: actions.map(serializeAction) })
}

async function createActionForCase(sql, request, caseId, claims) {
  const parsed = await readJson(request)
  if (parsed.error) return json({ error: parsed.error }, 400)
  const actionType = text(parsed.value.actionType).toLowerCase()
  const reason = text(parsed.value.reason)
  const externalReference = text(parsed.value.externalReference) || null
  const idempotencyKey = text(parsed.value.idempotencyKey)

  if (reason.length < REASON_MIN_LENGTH) return json({ error: `El motivo debe tener al menos ${REASON_MIN_LENGTH} caracteres.` }, 400)
  if (reason.length > REASON_MAX_LENGTH || reason.includes('\u0000')) return json({ error: 'El motivo no es válido.' }, 400)
  if (externalReference && (externalReference.length > EXTERNAL_REFERENCE_MAX_LENGTH || externalReference.includes('\u0000'))) {
    return json({ error: 'La referencia externa no es válida.' }, 400)
  }
  if (!idempotencyPattern.test(idempotencyKey)) return json({ error: 'Indica una clave de idempotencia válida.' }, 400)

  const cases = await sql`
    SELECT id, exception_type, resolution_status
    FROM operations.payment_exception_cases WHERE id = ${caseId}::uuid LIMIT 1
  `
  const target = cases[0]
  if (!target) return json({ error: 'Caso financiero no encontrado.' }, 404)

  const toStatus = actionPolicy[target.exception_type]?.[actionType]
  if (!toStatus) return json({ error: 'La acción no corresponde al tipo de excepción.' }, 400)
  if (actionsRequiringExternalReference.has(actionType) && !externalReference) {
    return json({ error: 'Esta acción requiere la referencia externa de la operación verificada.' }, 400)
  }

  const rows = await sql`
    WITH target AS MATERIALIZED (
      SELECT id, resolution_status
      FROM operations.payment_exception_cases
      WHERE id = ${caseId}::uuid
        AND resolution_status IN ('open', 'pending_external')
        AND NOT EXISTS (
          SELECT 1 FROM operations.payment_exception_actions prior
          WHERE prior.case_id = ${caseId}::uuid AND prior.action_type = ${actionType}
        )
      FOR UPDATE
    ), inserted AS (
      INSERT INTO operations.payment_exception_actions (
        case_id, actor_id, action_type, from_status, to_status, reason, external_reference, idempotency_key
      )
      SELECT t.id, ${claims.sub}::uuid, ${actionType}, t.resolution_status,
        ${toStatus}, ${reason}, ${externalReference}, ${idempotencyKey}
      FROM target t
      ON CONFLICT (case_id, actor_id, idempotency_key) DO NOTHING
      RETURNING id, case_id, actor_id, action_type, from_status, to_status,
        reason, external_reference, idempotency_key, created_at
    ), updated AS (
      UPDATE operations.payment_exception_cases c
      SET resolution_status = i.to_status,
          updated_at = NOW(),
          resolved_at = CASE WHEN i.to_status = 'resolved' THEN NOW() ELSE NULL END
      FROM inserted i
      WHERE c.id = i.case_id AND c.resolution_status = i.from_status
      RETURNING c.id
    ), audited AS (
      INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata)
      SELECT i.actor_id, 'payment_exception_' || i.action_type, 'payment_exception_case', i.case_id,
        jsonb_build_object(
          'actionId', i.id::text,
          'actionType', i.action_type,
          'fromStatus', i.from_status,
          'toStatus', i.to_status,
          'reason', i.reason,
          'externalReference', i.external_reference
        )
      FROM inserted i JOIN updated u ON u.id = i.case_id
      RETURNING entity_id
    )
    SELECT i.id, i.case_id, i.actor_id, i.action_type, i.from_status, i.to_status,
      i.reason, i.external_reference, i.created_at
    FROM inserted i JOIN updated u ON u.id = i.case_id
    JOIN audited a ON a.entity_id = i.case_id
  `
  if (rows[0]) {
    return json({ ok: true, reused: false, action: serializeAction(rows[0]) }, 201)
  }

  const existing = await sql`
    SELECT id, case_id, actor_id, action_type, from_status, to_status,
      reason, external_reference, created_at
    FROM operations.payment_exception_actions
    WHERE case_id = ${caseId}::uuid AND actor_id = ${claims.sub}::uuid
      AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `
  if (existing[0]) {
    const prior = existing[0]
    const isExactReplay = prior.action_type === actionType
      && prior.reason === reason
      && (prior.external_reference || null) === externalReference
    if (!isExactReplay) return json({ error: 'La clave de idempotencia ya fue usada para otra acción.' }, 409)
    return json({ ok: true, reused: true, action: serializeAction(prior) })
  }
  return json({ error: 'El caso cambió, ya tiene esta resolución o fue resuelto. Actualiza la lista antes de continuar.' }, 409)
}

function serializeCase(row) {
  return {
    id: String(row.case_id),
    requestId: String(row.request_id),
    requestReference: String(row.request_reference),
    paymentId: String(row.payment_id),
    paymentReference: String(row.payment_reference),
    providerPaymentId: row.mercado_pago_payment_id ? String(row.mercado_pago_payment_id) : null,
    providerPaymentStatus: String(row.provider_payment_status),
    exceptionType: String(row.exception_type),
    resolutionStatus: String(row.resolution_status),
    usdAmountCents: Number(row.usd_amount_cents),
    copAmountCents: Number(row.cop_amount_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || null,
  }
}

function serializeAction(row) {
  return {
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorName: row.actor_name ? String(row.actor_name) : null,
    actionType: String(row.action_type),
    fromStatus: String(row.from_status),
    toStatus: String(row.to_status),
    reason: String(row.reason),
    externalReference: row.external_reference ? String(row.external_reference) : null,
    createdAt: row.created_at,
  }
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 8192) return { error: 'La solicitud es demasiado grande.' }
  const value = await request.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'El cuerpo JSON no es válido.' }
  return { value }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function pagination(page, pageSize, total) {
  const count = Number(total || 0)
  return { page, pageSize, total: count, pageCount: Math.max(1, Math.ceil(count / pageSize)) }
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
