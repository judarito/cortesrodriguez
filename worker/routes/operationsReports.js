import { requireOperationsAuth } from './operationsAuth.js'

const REPORT_PATH = '/api/app/reports'
const MAX_RANGE_DAYS = 366
const PAGE_SIZE_MAX = 50

export async function handleOperationsReports(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== REPORT_PATH || request.method !== 'GET') return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return json({ error: 'Sesión requerida.' }, 401)
  if (!claims.roles?.includes('admin')) return json({ error: 'Solo administración puede consultar los reportes.' }, 403)
  if (!claims.permissions?.includes('reports.read')) return json({ error: 'No tienes permisos para consultar reportes.' }, 403)

  const filters = validateReportDates(url.searchParams.get('dateFrom'), url.searchParams.get('dateTo'))
  if (filters.error) return json({ error: filters.error }, 400)
  const page = parsePositiveInteger(url.searchParams.get('page'), 1)
  const pageSize = Math.min(parsePositiveInteger(url.searchParams.get('pageSize'), 20), PAGE_SIZE_MAX)
  if (!env.NEON_DATABASE_URL) return json({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const report = await loadOperationsReports(neon(env.NEON_DATABASE_URL), {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    page,
    pageSize,
  })
  return json(report)
}

export function validateReportDates(dateFromInput, dateToInput) {
  const dateFrom = String(dateFromInput || '').trim()
  const dateTo = String(dateToInput || '').trim()
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
    return { error: 'Indica dateFrom y dateTo en formato YYYY-MM-DD con fechas válidas.' }
  }
  const days = (Date.parse(`${dateTo}T00:00:00.000Z`) - Date.parse(`${dateFrom}T00:00:00.000Z`)) / 86400000 + 1
  if (days < 1) return { error: 'dateFrom no puede ser posterior a dateTo.' }
  if (days > MAX_RANGE_DAYS) return { error: `El rango máximo permitido es de ${MAX_RANGE_DAYS} días.` }
  return { dateFrom, dateTo }
}

/**
 * The canonical attempt is confirmed_payment_attempt_id when present, else the
 * latest attempt by creation time. duplicate_approved is excluded from canonical
 * financial totals but retained in payment detail and exception counters.
 * Reports use current rows, not an immutable financial ledger: refund/chargeback
 * totals are not net cash, settlement, fee, or historical-flow figures.
 */
export async function loadOperationsReports(sql, { dateFrom, dateTo, page = 1, pageSize = 20 }) {
  const offset = (page - 1) * pageSize
  const [summaryRows, attentionRows, agentRows, expertRows, clientRows, paymentCountRows, paymentRows] = await Promise.all([
    sql`
      WITH scoped AS (
        SELECT r.id, r.confirmed_payment_attempt_id FROM operations.requests r
        WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      ), current_attempt AS (
        SELECT DISTINCT ON (s.id) p.*
        FROM scoped s LEFT JOIN operations.request_payments p ON p.request_id = s.id
        ORDER BY s.id, (p.id = s.confirmed_payment_attempt_id) DESC NULLS LAST,
          p.created_at DESC, p.updated_at DESC, p.id DESC
      )
      SELECT
        (SELECT COUNT(*)::int FROM scoped) AS request_count,
        (SELECT COUNT(*)::int FROM scoped s JOIN operations.requests r ON r.id=s.id WHERE r.status='pending') AS pending_count,
        (SELECT COUNT(*)::int FROM scoped s JOIN operations.requests r ON r.id=s.id WHERE r.status='in_review') AS in_review_count,
        (SELECT COUNT(*)::int FROM scoped s JOIN operations.requests r ON r.id=s.id WHERE r.status='in_progress') AS in_progress_count,
        (SELECT COUNT(*)::int FROM scoped s JOIN operations.requests r ON r.id=s.id WHERE r.status='closed') AS closed_count,
        (SELECT COUNT(*)::int FROM scoped s JOIN operations.requests r ON r.id=s.id WHERE r.status='cancelled') AS cancelled_count,
        (SELECT COUNT(*)::int FROM operations.request_payments p JOIN scoped s ON s.id=p.request_id WHERE p.status='duplicate_approved') AS duplicate_approved_attempt_count,
        (SELECT COUNT(DISTINCT p.request_id)::int FROM operations.request_payments p JOIN scoped s ON s.id=p.request_id WHERE p.status='duplicate_approved') AS duplicate_approved_request_count,
        COUNT(*) FILTER (WHERE p.status='approved')::int AS approved_requests,
        COALESCE(SUM(p.usd_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_usd_cents,
        COALESCE(SUM(p.cop_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_cop_cents,
        COUNT(*) FILTER (WHERE p.status='refunded')::int AS refunded_requests,
        COALESCE(SUM(p.usd_amount_cents) FILTER (WHERE p.status='refunded'),0)::bigint AS refunded_usd_cents,
        COALESCE(SUM(p.cop_amount_cents) FILTER (WHERE p.status='refunded'),0)::bigint AS refunded_cop_cents,
        COUNT(*) FILTER (WHERE p.status='charged_back')::int AS charged_back_requests,
        COALESCE(SUM(p.usd_amount_cents) FILTER (WHERE p.status='charged_back'),0)::bigint AS charged_back_usd_cents,
        COALESCE(SUM(p.cop_amount_cents) FILTER (WHERE p.status='charged_back'),0)::bigint AS charged_back_cop_cents
      FROM scoped s LEFT JOIN current_attempt p ON p.request_id=s.id
    `,
    sql`
      SELECT r.status, COUNT(*)::int AS request_count
      FROM operations.requests r
      WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      GROUP BY r.status ORDER BY r.status
    `,
    sql`
      WITH scoped AS (
        SELECT r.id, r.agent_id, r.confirmed_payment_attempt_id FROM operations.requests r
        WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      ), current_attempt AS (
        SELECT DISTINCT ON (s.id) p.* FROM scoped s LEFT JOIN operations.request_payments p ON p.request_id=s.id
        ORDER BY s.id, (p.id = s.confirmed_payment_attempt_id) DESC NULLS LAST,
          p.created_at DESC, p.updated_at DESC, p.id DESC
      )
      SELECT s.agent_id, COALESCE(u.full_name, 'Sin agente') AS agent_name,
        COUNT(DISTINCT s.id)::int AS request_count,
        COUNT(DISTINCT s.id) FILTER (WHERE p.status='approved')::int AS paid_request_count,
        COALESCE(SUM(p.usd_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_usd_cents,
        COALESCE(SUM(p.cop_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_cop_cents
      FROM scoped s LEFT JOIN operations.users u ON u.id=s.agent_id
      LEFT JOIN current_attempt p ON p.request_id=s.id
      GROUP BY s.agent_id, u.full_name ORDER BY request_count DESC, agent_name
    `,
    sql`
      WITH scoped AS (
        SELECT r.id, r.assigned_expert_id FROM operations.requests r
        WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      ), expert_ids AS (
        SELECT assigned_expert_id AS expert_id FROM scoped WHERE assigned_expert_id IS NOT NULL
        UNION SELECT er.expert_id FROM operations.expert_responses er JOIN scoped s ON s.id=er.request_id
        UNION SELECT assignment.expert_id FROM operations.request_assignments assignment JOIN scoped s ON s.id=assignment.request_id
      ), assigned AS (
        SELECT s.assigned_expert_id AS expert_id, COUNT(DISTINCT s.id)::int AS request_count
        FROM scoped s WHERE s.assigned_expert_id IS NOT NULL GROUP BY s.assigned_expert_id
      ), assignment_history AS (
        SELECT assignment.expert_id, COUNT(DISTINCT assignment.request_id)::int AS request_count
        FROM operations.request_assignments assignment JOIN scoped s ON s.id=assignment.request_id
        WHERE assignment.status IN ('assigned', 'reassigned', 'completed')
        GROUP BY assignment.expert_id
      ), response_counts AS (
        SELECT er.expert_id,
          COUNT(*) FILTER (WHERE er.status='draft')::int AS draft,
          COUNT(*) FILTER (WHERE er.status='pending_admin_review')::int AS pending_admin_review,
          COUNT(*) FILTER (WHERE er.status='rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE er.status='approved')::int AS approved,
          COUNT(*) FILTER (WHERE er.status='sent')::int AS sent
        FROM operations.expert_responses er JOIN scoped s ON s.id=er.request_id
        GROUP BY er.expert_id
      )
      SELECT e.expert_id, u.full_name AS expert_name, COALESCE(a.request_count,0)::int AS request_count,
        COALESCE(ah.request_count,0)::int AS historical_request_count,
        COALESCE(rc.draft,0)::int AS draft, COALESCE(rc.pending_admin_review,0)::int AS pending_admin_review,
        COALESCE(rc.rejected,0)::int AS rejected, COALESCE(rc.approved,0)::int AS approved, COALESCE(rc.sent,0)::int AS sent
      FROM expert_ids e JOIN operations.users u ON u.id=e.expert_id
      LEFT JOIN assigned a ON a.expert_id=e.expert_id LEFT JOIN assignment_history ah ON ah.expert_id=e.expert_id
      LEFT JOIN response_counts rc ON rc.expert_id=e.expert_id
      ORDER BY request_count DESC, u.full_name
    `,
    sql`
      WITH scoped AS (
        SELECT r.id, r.client_id, r.confirmed_payment_attempt_id FROM operations.requests r
        WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      ), current_attempt AS (
        SELECT DISTINCT ON (s.id) p.* FROM scoped s LEFT JOIN operations.request_payments p ON p.request_id=s.id
        ORDER BY s.id, (p.id = s.confirmed_payment_attempt_id) DESC NULLS LAST,
          p.created_at DESC, p.updated_at DESC, p.id DESC
      )
      SELECT c.id AS client_id, c.full_name AS client_name,
        COALESCE((SELECT NULLIF(BTRIM(r2.email),'') FROM operations.requests r2
          WHERE r2.client_id=c.id AND r2.created_at >= ${dateFrom}::date
            AND r2.created_at < (${dateTo}::date + INTERVAL '1 day')
          ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1), c.email_normalized) AS client_email,
        COUNT(DISTINCT s.id)::int AS request_count,
        COUNT(DISTINCT s.id) FILTER (WHERE p.status='approved')::int AS paid_request_count,
        COALESCE(SUM(p.usd_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_usd_cents,
        COALESCE(SUM(p.cop_amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS approved_cop_cents
      FROM scoped s JOIN operations.clients c ON c.id=s.client_id
      LEFT JOIN current_attempt p ON p.request_id=s.id
      GROUP BY c.id, c.full_name, c.email_normalized ORDER BY request_count DESC, c.full_name
    `,
    sql`
      SELECT COUNT(*)::int AS total FROM operations.request_payments p
      JOIN operations.requests r ON r.id=p.request_id
      WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
    `,
    sql`
      SELECT p.id AS payment_id, p.request_id, r.reference AS request_reference,
        c.full_name AS client_name, r.email AS client_email, p.reference AS payment_reference,
        p.status, p.usd_amount_cents, p.cop_amount_cents, p.trm_cop_per_usd,
        p.trm_effective_date, p.mercado_pago_preference_id, p.mercado_pago_payment_id,
        p.created_at, p.updated_at
      FROM operations.request_payments p JOIN operations.requests r ON r.id=p.request_id
      JOIN operations.clients c ON c.id=r.client_id
      WHERE r.created_at >= ${dateFrom}::date AND r.created_at < (${dateTo}::date + INTERVAL '1 day')
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${pageSize} OFFSET ${offset}
    `,
  ])

  const summary = summaryRows[0] || {}
  const numeric = (value) => Number(value || 0)
  const financialState = (prefix) => ({
    requestCount: numeric(summary[`${prefix}_requests`]),
    usdCents: numeric(summary[`${prefix}_usd_cents`]),
    copCents: numeric(summary[`${prefix}_cop_cents`]),
  })
  const totalPayments = numeric(paymentCountRows[0]?.total)

  return {
    period: { dateFrom, dateTo },
    summary: {
      requestCount: numeric(summary.request_count),
      attentionByStatus: attentionRows.map((row) => ({ status: String(row.status), requestCount: numeric(row.request_count) })),
      payments: {
        approved: financialState('approved'),
        refunded: financialState('refunded'),
        chargedBack: financialState('charged_back'),
        duplicateApproved: {
          attemptCount: numeric(summary.duplicate_approved_attempt_count),
          requestCount: numeric(summary.duplicate_approved_request_count),
        },
      },
    },
    byAgent: agentRows.map((row) => ({
      agentId: row.agent_id ? String(row.agent_id) : null,
      agentName: String(row.agent_name || 'Sin agente'),
      requestCount: numeric(row.request_count),
      paidRequestCount: numeric(row.paid_request_count),
      approvedUsdCents: numeric(row.approved_usd_cents),
      approvedCopCents: numeric(row.approved_cop_cents),
    })),
    byExpert: expertRows.map((row) => ({
      expertId: String(row.expert_id),
      expertName: String(row.expert_name),
      currentAssignedRequestCount: numeric(row.request_count),
      historicallyAssignedRequestCount: numeric(row.historical_request_count),
      responsesByStatus: {
        draft: numeric(row.draft), pending_admin_review: numeric(row.pending_admin_review),
        rejected: numeric(row.rejected), approved: numeric(row.approved), sent: numeric(row.sent),
      },
    })),
    byClient: clientRows.map((row) => ({
      clientId: String(row.client_id), clientName: String(row.client_name), clientEmail: row.client_email ? String(row.client_email) : null,
      requestCount: numeric(row.request_count), paidRequestCount: numeric(row.paid_request_count),
      approvedUsdCents: numeric(row.approved_usd_cents), approvedCopCents: numeric(row.approved_cop_cents),
    })),
    payments: {
      items: paymentRows.map((row) => ({
        paymentId: String(row.payment_id), requestId: String(row.request_id), requestReference: String(row.request_reference),
        clientName: String(row.client_name), clientEmail: row.client_email ? String(row.client_email) : null,
        paymentReference: String(row.payment_reference), status: String(row.status),
        usdCents: numeric(row.usd_amount_cents), copCents: numeric(row.cop_amount_cents),
        trmCopPerUsd: row.trm_cop_per_usd == null ? null : Number(row.trm_cop_per_usd),
        trmEffectiveDate: row.trm_effective_date ? String(row.trm_effective_date).slice(0, 10) : null,
        preferenceId: row.mercado_pago_preference_id ? String(row.mercado_pago_preference_id) : null,
        providerPaymentId: row.mercado_pago_payment_id ? String(row.mercado_pago_payment_id) : null,
        createdAt: row.created_at, updatedAt: row.updated_at,
      })),
      pagination: { page, pageSize, totalItems: totalPayments, totalPages: Math.max(Math.ceil(totalPayments / pageSize), 1) },
    },
  }
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })
}
