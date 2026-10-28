import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { handleOperationsReports, loadOperationsReports, validateReportDates } from '../worker/routes/operationsReports.js'

const jwtSecret = 'reports-test-secret'
const dbUrl = 'postgres://test:test@ep-reports-test.neon.tech/reports'
let db
let originalFetch

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function makeToken(userId) {
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ sub: userId, scope: 'operations', exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${header}.${payload}.${createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')}`
}
async function tokenHash(token) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url')
}
function encodeNeonResult(result) {
  return Response.json({
    fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
    rows: result.rows.map((row) => result.fields.map((field) => {
      const value = row[field.name]
      if (value instanceof Date) return value.toISOString()
      if (typeof value === 'boolean') return value ? 't' : 'f'
      return value == null ? null : String(value)
    })),
  })
}

before(async () => {
  db = new PGlite()
  originalFetch = globalThis.fetch
  await db.exec(`
    CREATE SCHEMA operations;
    CREATE TABLE operations.users (id uuid PRIMARY KEY, email text NOT NULL, full_name text NOT NULL, active boolean NOT NULL DEFAULT true);
    CREATE TABLE operations.sessions (user_id uuid, token_hash text, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE operations.roles (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE operations.user_roles (user_id uuid, role_id uuid);
    CREATE TABLE operations.permissions (id uuid PRIMARY KEY, code text NOT NULL);
    CREATE TABLE operations.role_permissions (role_id uuid, permission_id uuid);
    CREATE TABLE operations.clients (id uuid PRIMARY KEY, full_name text NOT NULL, email_normalized text);
    CREATE TABLE operations.requests (
      id uuid PRIMARY KEY, client_id uuid NOT NULL, reference text NOT NULL, email text,
      status text NOT NULL, agent_id uuid, assigned_expert_id uuid,
      confirmed_payment_attempt_id uuid, created_at timestamptz NOT NULL
    );
    CREATE TABLE operations.request_payments (
      id uuid PRIMARY KEY, request_id uuid NOT NULL, reference text NOT NULL, status text NOT NULL,
      usd_amount_cents integer NOT NULL, cop_amount_cents integer NOT NULL, trm_cop_per_usd numeric,
      trm_effective_date date, mercado_pago_preference_id text, mercado_pago_payment_id text,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE operations.expert_responses (id uuid PRIMARY KEY, request_id uuid NOT NULL, expert_id uuid NOT NULL, status text NOT NULL);
    CREATE TABLE operations.request_assignments (id uuid PRIMARY KEY, request_id uuid, expert_id uuid, status text, assigned_at timestamptz);
  `)
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input)
    if (!url.includes('.neon.tech/')) throw new Error(`Unexpected network request in report test: ${url}`)
    const { query, params = [] } = JSON.parse(options.body)
    const result = await db.query(query, params)
    return encodeNeonResult(result)
  }
})

after(async () => {
  globalThis.fetch = originalFetch
  await db?.close()
})

async function addSession({ role, permission = true, id }) {
  const userId = id || crypto.randomUUID()
  const roleId = crypto.randomUUID()
  const permissionId = crypto.randomUUID()
  const token = makeToken(userId)
  await db.query('INSERT INTO operations.users (id,email,full_name) VALUES ($1,$2,$3)', [userId, `${role}@example.test`, role])
  await db.query('INSERT INTO operations.roles (id,name) VALUES ($1,$2)', [roleId, role])
  await db.query('INSERT INTO operations.user_roles (user_id,role_id) VALUES ($1,$2)', [userId, roleId])
  await db.query('INSERT INTO operations.permissions (id,code) VALUES ($1,$2)', [permissionId, 'reports.read'])
  if (permission) await db.query('INSERT INTO operations.role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissionId])
  await db.query('INSERT INTO operations.sessions (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'1 hour\')', [userId, await tokenHash(token)])
  return token
}

function requestFor(token, query = 'dateFrom=2026-10-01&dateTo=2026-10-31') {
  return new Request(`https://app.example.test/api/app/reports?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

test('reports require a live session, admin role, and reports.read permission', async () => {
  const noSession = await handleOperationsReports(requestFor(null), { NEON_DATABASE_URL: dbUrl, OPERATIONS_JWT_SECRET: jwtSecret })
  assert.equal(noSession.status, 401)

  const advisorToken = await addSession({ role: 'advisor' })
  const nonAdmin = await handleOperationsReports(requestFor(advisorToken), { NEON_DATABASE_URL: dbUrl, OPERATIONS_JWT_SECRET: jwtSecret })
  assert.equal(nonAdmin.status, 403)
  assert.match((await nonAdmin.json()).error, /Solo administración/)

  const noReportPermission = await addSession({ role: 'admin', permission: false })
  const forbidden = await handleOperationsReports(requestFor(noReportPermission), { NEON_DATABASE_URL: dbUrl, OPERATIONS_JWT_SECRET: jwtSecret })
  assert.equal(forbidden.status, 403)
  assert.match((await forbidden.json()).error, /permisos/)
})

test('report date range is valid, ordered, and limited to 366 inclusive days', async () => {
  assert.deepEqual(validateReportDates('2026-01-01', '2027-01-01'), { dateFrom: '2026-01-01', dateTo: '2027-01-01' })
  assert.match(validateReportDates('2026-01-01', '2027-01-02').error, /366 días/)
  assert.match(validateReportDates('2026-02-30', '2026-03-01').error, /YYYY-MM-DD/)
  assert.match(validateReportDates('2026-02-02', '2026-02-01').error, /posterior/)

  const adminToken = await addSession({ role: 'admin' })
  const invalid = await handleOperationsReports(requestFor(adminToken, 'dateFrom=2026-02-30&dateTo=2026-03-01'), {
    NEON_DATABASE_URL: dbUrl, OPERATIONS_JWT_SECRET: jwtSecret,
  })
  assert.equal(invalid.status, 400)
})

test('report totals use the confirmed attempt once per request and preserve currency separation', async () => {
  const clientId = crypto.randomUUID()
  const agentId = crypto.randomUUID()
  const expertId = crypto.randomUUID()
  const requestRefunded = crypto.randomUUID()
  const requestPaid = crypto.randomUUID()
  const requestWeb = crypto.randomUUID()
  const refundAttempt = crypto.randomUUID()
  const oldApprovedAttempt = crypto.randomUUID()
  const paidAttempt = crypto.randomUUID()
  const duplicateAttempt = crypto.randomUUID()
  const webPendingAttempt = crypto.randomUUID()
  await db.query('INSERT INTO operations.clients (id,full_name,email_normalized) VALUES ($1,$2,$3)', [clientId, 'Cliente Ejemplo', 'cliente@example.test'])
  await db.query(`INSERT INTO operations.users (id,email,full_name) VALUES ($1,$2,$3),($4,$5,$6)`, [
    agentId, 'agente@example.test', 'Agente actual', expertId, 'experto@example.test', 'Experto actual',
  ])
  await db.query(`INSERT INTO operations.requests (id,client_id,reference,email,status,agent_id,assigned_expert_id,confirmed_payment_attempt_id,created_at)
    VALUES ($1,$4,'R-REFUND','cliente@example.test','closed',$5,$6,$7,'2026-10-10'),
      ($2,$4,'R-PAID','cliente@example.test','in_progress',$5,$6,$8,'2026-10-11'),
      ($3,$4,'R-WEB','cliente@example.test','pending',NULL,NULL,NULL,'2026-10-12')`, [
    requestRefunded, requestPaid, requestWeb, clientId, agentId, expertId, refundAttempt, paidAttempt,
  ])
  await db.query(`INSERT INTO operations.request_payments
    (id,request_id,reference,status,usd_amount_cents,cop_amount_cents,trm_cop_per_usd,trm_effective_date,created_at,updated_at)
    VALUES ($1,$4,'P-OLD-APPROVED','approved',2500,8000000,3200,'2026-10-10','2026-10-10','2026-10-10'),
      ($2,$4,'P-REFUNDED','refunded',2500,8000000,3200,'2026-10-10','2026-10-11','2026-10-13'),
      ($3,$5,'P-APPROVED','approved',3000,9600000,3200,'2026-10-11','2026-10-11','2026-10-11'),
      ($6,$5,'P-DUPLICATE','duplicate_approved',3000,9600000,3200,'2026-10-11','2026-10-12','2026-10-12'),
      ($7,$8,'P-WEB-PENDING','pending',1000,3200000,3200,'2026-10-12','2026-10-12','2026-10-12')`, [
    oldApprovedAttempt, refundAttempt, paidAttempt, requestRefunded, requestPaid, duplicateAttempt, webPendingAttempt, requestWeb,
  ])
  await db.query(`INSERT INTO operations.expert_responses (id,request_id,expert_id,status) VALUES
    ($1,$3,$4,'sent'),($2,$3,$4,'pending_admin_review')`, [crypto.randomUUID(), crypto.randomUUID(), requestPaid, expertId])
  await db.query(`INSERT INTO operations.request_assignments (id,request_id,expert_id,status,assigned_at) VALUES
    ($1,$3,$4,'assigned','2026-10-11'),($2,$3,$5,'reassigned','2026-10-12')`, [crypto.randomUUID(), crypto.randomUUID(), requestPaid, expertId, crypto.randomUUID()])

  const sql = async (parts, ...params) => {
    const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
    return (await db.query(query, params)).rows
  }
  const report = await loadOperationsReports(sql, { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: 1, pageSize: 20 })

  assert.deepEqual(report.summary.payments.approved, { requestCount: 1, usdCents: 3000, copCents: 9600000 })
  assert.deepEqual(report.summary.payments.refunded, { requestCount: 1, usdCents: 2500, copCents: 8000000 })
  assert.deepEqual(report.summary.payments.chargedBack, { requestCount: 0, usdCents: 0, copCents: 0 })
  assert.deepEqual(report.summary.payments.duplicateApproved, { attemptCount: 1, requestCount: 1 })
  assert.equal(report.summary.requestCount, 3)
  const agent = report.byAgent.find((row) => row.agentId === agentId)
  assert.deepEqual({ requests: agent.requestCount, paid: agent.paidRequestCount, usd: agent.approvedUsdCents, cop: agent.approvedCopCents }, {
    requests: 2, paid: 1, usd: 3000, cop: 9600000,
  })
  assert.deepEqual(report.byAgent.find((row) => row.agentId === null), {
    agentId: null, agentName: 'Sin agente', requestCount: 1, paidRequestCount: 0, approvedUsdCents: 0, approvedCopCents: 0,
  })
  const expert = report.byExpert.find((row) => row.expertId === expertId)
  assert.equal(expert.currentAssignedRequestCount, 2)
  assert.equal(expert.historicallyAssignedRequestCount, 1)
  assert.equal(expert.responsesByStatus.sent, 1)
  assert.equal(expert.responsesByStatus.pending_admin_review, 1)
  assert.equal(report.byClient[0].requestCount, 3)
  assert.equal(report.byClient[0].clientEmail, 'cliente@example.test')
  assert.equal(report.payments.items.length, 5)
  assert.ok(report.payments.items.some((item) => item.status === 'duplicate_approved'))
})
