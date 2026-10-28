import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { handleOperationsData } from '../worker/routes/operationsData.js'

const jwtSecret = 'client-detail-test-secret'
const dbUrl = 'postgres://test:test@ep-client-detail-test.neon.tech/detail'
const env = { NEON_DATABASE_URL: dbUrl, OPERATIONS_JWT_SECRET: jwtSecret }
let db
let originalFetch
const tokens = {}

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
      // Neon returns timestamptz in Postgres text format, not ISO-8601. The
      // driver parses that format only, so mirror it here; an ISO string is
      // turned into null by the timestamp parser.
      if (value instanceof Date) return value.toISOString().slice(0, 23).replace('T', ' ') + '+00'
      if (typeof value === 'boolean') return value ? 't' : 'f'
      return value == null ? null : String(value)
    })),
  })
}

const agentA = crypto.randomUUID()
const agentB = crypto.randomUUID()
const adminId = crypto.randomUUID()
const clientShared = crypto.randomUUID()
const clientBOnly = crypto.randomUUID()
const clientBulk = crypto.randomUUID()
const requestOwned = crypto.randomUUID()
const requestOwnedPhone = crypto.randomUUID()
const requestForeign = crypto.randomUUID()
const requestUnassigned = crypto.randomUUID()
const requestForeignOnly = crypto.randomUUID()

async function addSession({ role, permission = 'clients.read', id } = {}) {
  const userId = id || crypto.randomUUID()
  const roleId = crypto.randomUUID()
  const permissionId = crypto.randomUUID()
  const token = makeToken(userId)
  await db.query('INSERT INTO operations.users (id,email,full_name) VALUES ($1,$2,$3)', [userId, `${role}-${userId}@example.test`, role])
  await db.query('INSERT INTO operations.roles (id,name) VALUES ($1,$2)', [roleId, role])
  await db.query('INSERT INTO operations.user_roles (user_id,role_id) VALUES ($1,$2)', [userId, roleId])
  await db.query('INSERT INTO operations.permissions (id,code) VALUES ($1,$2)', [permissionId, permission || 'reports.read'])
  if (permission) await db.query('INSERT INTO operations.role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permissionId])
  await db.query('INSERT INTO operations.sessions (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'1 hour\')', [userId, await tokenHash(token)])
  return token
}

function requestFor(token, clientId) {
  return new Request(`https://app.example.test/api/app/clients/${clientId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

function detail(token, clientId) {
  return handleOperationsData(requestFor(token, clientId), env)
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
    CREATE TABLE operations.clients (id uuid PRIMARY KEY, full_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE operations.requests (
      id uuid PRIMARY KEY, client_id uuid NOT NULL, reference text NOT NULL,
      email text, phone text, whatsapp text, status text NOT NULL,
      service_type text NOT NULL, product_type text NOT NULL,
      agent_id uuid, created_by uuid,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE operations.request_payments (
      id uuid PRIMARY KEY, request_id uuid NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL
    );
  `)
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input)
    if (!url.includes('.neon.tech/')) throw new Error(`Unexpected network request in client detail test: ${url}`)
    const { query, params = [] } = JSON.parse(options.body)
    const result = await db.query(query, params)
    return encodeNeonResult(result)
  }

  tokens.admin = await addSession({ role: 'admin', id: adminId })
  tokens.agentA = await addSession({ role: 'advisor', id: agentA })
  tokens.agentB = await addSession({ role: 'advisor', id: agentB })
  tokens.noPermission = await addSession({ role: 'viewer', permission: null })

  await db.query(
    'INSERT INTO operations.clients (id,full_name,created_at) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9)',
    [
      clientShared, 'Cliente Compartido', '2026-09-01T08:00:00Z',
      clientBOnly, 'Cliente Externo', '2026-09-02T08:00:00Z',
      clientBulk, 'Cliente Volumen', '2026-09-03T08:00:00Z',
    ],
  )
  await db.query(
    `INSERT INTO operations.requests
      (id,client_id,reference,email,phone,whatsapp,status,service_type,product_type,agent_id,created_by,created_at,updated_at)
     VALUES ($1,$5,'CRA-001','a@example.test',NULL,NULL,'closed','importacion','mercancias',$7,$7,'2026-10-01T10:00:00Z','2026-10-01T10:00:00Z'),
            ($2,$5,'CRA-002',NULL,'+57 300 000 0000',NULL,'in_progress','exportacion','vehiculos',$7,$7,'2026-10-02T10:00:00Z','2026-10-02T10:00:00Z'),
            ($3,$5,'CRA-003','b@example.test','311',NULL,'pending','importacion','mercancias',$8,$8,'2026-10-03T10:00:00Z','2026-10-03T10:00:00Z'),
            ($4,$5,'CRA-004','','','wa-a','closed','exportacion','vehiculos',NULL,$7,'2026-10-04T10:00:00Z','2026-10-04T10:00:00Z'),
            ($9,$6,'CRA-101','b@example.test','311','wa-b','in_progress','exportacion','vehiculos',$8,$8,'2026-10-05T10:00:00Z','2026-10-05T10:00:00Z')`,
    [requestOwned, requestOwnedPhone, requestForeign, requestUnassigned, clientShared, clientBOnly, agentA, agentB, requestForeignOnly],
  )
  await db.query(
    `INSERT INTO operations.request_payments (id,request_id,status,created_at) VALUES
      ($1,$5,'approved','2026-10-01T10:05:00Z'),
      ($2,$6,'pending','2026-10-02T10:05:00Z'),
      ($3,$7,'approved','2026-10-03T10:05:00Z'),
      ($4,$7,'in_process','2026-10-03T10:06:00Z')`,
    [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), requestOwned, requestOwnedPhone, requestForeign],
  )
  await db.query(
    `INSERT INTO operations.requests
      (id,client_id,reference,email,phone,whatsapp,status,service_type,product_type,agent_id,created_by,created_at,updated_at)
     SELECT gen_random_uuid(), $1, 'BULK-' || i, NULL, NULL, NULL, 'pending', 'importacion', 'mercancias', $2, $2,
       NOW() - (i || ' minutes')::interval, NOW() - (i || ' minutes')::interval
     FROM generate_series(1, 55) AS i`,
    [clientBulk, agentB],
  )
})

after(async () => {
  globalThis.fetch = originalFetch
  await db?.close()
})

test('client detail requires a live session and clients.read permission', async () => {
  const noSession = await detail(null, clientShared)
  assert.equal(noSession.status, 401)

  const forbidden = await detail(tokens.noPermission, clientShared)
  assert.equal(forbidden.status, 403)
  assert.match((await forbidden.json()).error, /permisos/)

  const revokedUserId = crypto.randomUUID()
  const revokedToken = await addSession({ role: 'advisor', id: revokedUserId })
  await db.query('UPDATE operations.sessions SET revoked_at = NOW() WHERE user_id = $1', [revokedUserId])
  const revoked = await detail(revokedToken, clientShared)
  assert.equal(revoked.status, 401)
})

test('admin gets the full client detail with metrics and most recent requests first', async () => {
  const res = await detail(tokens.admin, clientShared)
  assert.equal(res.status, 200)
  const body = await res.json()

  assert.deepEqual(Object.keys(body).sort(), ['client', 'metrics', 'requests'])
  assert.deepEqual(Object.keys(body.client).sort(), ['createdAt', 'email', 'fullName', 'id', 'phone', 'whatsapp'])
  assert.equal(body.client.id, clientShared)
  assert.equal(body.client.fullName, 'Cliente Compartido')
  assert.equal(body.client.createdAt, '2026-09-01T08:00:00.000Z')
  // Contact fallback is resolved per field from the most recent request that carries it.
  assert.equal(body.client.email, 'b@example.test')
  assert.equal(body.client.phone, '311')
  assert.equal(body.client.whatsapp, 'wa-a')

  assert.deepEqual(body.metrics, {
    totalRequests: 4,
    openRequests: 2,
    closedRequests: 2,
    approvedPayments: 2,
    pendingPayments: 2,
  })

  assert.equal(body.requests.length, 4)
  assert.deepEqual(body.requests.map((item) => item.reference), ['CRA-004', 'CRA-003', 'CRA-002', 'CRA-001'])
  assert.deepEqual(Object.keys(body.requests[0]).sort(), ['createdAt', 'id', 'paymentStatus', 'productType', 'reference', 'serviceType', 'status', 'updatedAt'])
  assert.deepEqual(body.requests[1], {
    id: requestForeign,
    reference: 'CRA-003',
    status: 'pending',
    serviceType: 'importacion',
    productType: 'mercancias',
    paymentStatus: 'approved',
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
  })
  assert.equal(body.requests[0].paymentStatus, '')
})

test('non-admin only sees clients and requests inside their own scope', async () => {
  const res = await detail(tokens.agentA, clientShared)
  assert.equal(res.status, 200)
  const body = await res.json()

  // CRA-003 belongs to agent B, so it must not leak into the detail, the
  // metrics, or the contact fallback.
  assert.equal(body.client.email, 'a@example.test')
  assert.equal(body.client.phone, '+57 300 000 0000')
  assert.equal(body.client.whatsapp, 'wa-a')
  assert.deepEqual(body.metrics, {
    totalRequests: 3,
    openRequests: 1,
    closedRequests: 2,
    approvedPayments: 1,
    pendingPayments: 1,
  })
  assert.deepEqual(body.requests.map((item) => item.reference), ['CRA-004', 'CRA-002', 'CRA-001'])

  const foreign = await detail(tokens.agentA, clientBOnly)
  assert.equal(foreign.status, 404)
  assert.deepEqual(await foreign.json(), { error: 'Cliente no encontrado.' })

  const foreignAsAdmin = await detail(tokens.admin, clientBOnly)
  assert.equal(foreignAsAdmin.status, 200)
  assert.equal((await foreignAsAdmin.json()).client.fullName, 'Cliente Externo')
})

test('invalid and unknown client ids return 404 without disclosing existence', async () => {
  for (const clientId of ['no-es-un-uuid', '123', crypto.randomUUID()]) {
    const res = await detail(tokens.admin, clientId)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'Cliente no encontrado.' })
  }
})

test('admin detail caps the request history at 50 and keeps descending order', async () => {
  const res = await detail(tokens.admin, clientBulk)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.metrics.totalRequests, 55)
  assert.equal(body.requests.length, 50)
  assert.equal(body.requests[0].reference, 'BULK-1')
  const timestamps = body.requests.map((item) => item.createdAt)
  assert.deepEqual(timestamps, [...timestamps].sort().reverse())
})
