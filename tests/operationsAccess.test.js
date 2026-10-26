import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { handleOperationsExpert } from '../worker/routes/operationsExpert.js'
import { handleOperationsData } from '../worker/routes/operationsData.js'

const jwtSecret = 'operations-access-test-secret'
const userId = '80199877-a6f9-46fc-8f87-6117846d8eef'

function tokenWithPermissions(permissions) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ sub: userId, scope: 'operations', exp: Math.floor(Date.now() / 1000) + 3600, permissions })
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function queryResult(rows, columns, types = []) {
  return new Response(JSON.stringify({
    fields: columns.map((name, index) => ({ name, dataTypeID: types[index] || 25 })),
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  }), { headers: { 'content-type': 'application/json' } })
}

function mockDatabaseFetch(currentPermissions, activeSession = true, requestPaymentState = null, currentRoles = ['expert']) {
  const statements = []
  return {
    statements,
    fetch: async (_url, options) => {
      const { query } = JSON.parse(options.body)
      statements.push(query)
      if (query.includes('FROM operations.sessions s')) {
        return queryResult(activeSession ? [{ id: userId, email: 'expert@example.test', full_name: 'Experto' }] : [], ['id', 'email', 'full_name'])
      }
      if (query.includes('FROM operations.user_roles ur JOIN operations.roles')) {
        return queryResult(currentRoles.map((name) => ({ name })), ['name'])
      }
      if (query.includes('JOIN operations.role_permissions rp')) {
        return queryResult(currentPermissions.map((code) => ({ code })), ['code'])
      }
      if (query.includes('SELECT r.id, r.payment_required, r.status')) {
        return queryResult(requestPaymentState ? [{ id: userId, ...requestPaymentState }] : [], ['id', 'payment_required', 'status', 'payment_approved'], [25, 16, 25, 16])
      }
      if (query.includes('WITH eligible AS MATERIALIZED')) return queryResult([], ['id', 'version', 'status', 'created_at'])
      if (query.includes('FROM operations.clients c')) {
        return queryResult([], query.includes('COUNT(*)::int') ? ['total'] : ['id', 'full_name', 'created_at', 'request_count'])
      }
      if (query.includes('COUNT(*)::int AS total')) return queryResult([{ total: 0 }], ['total'])
      if (query.includes('FROM operations.requests r') && query.includes('LIMIT')) return queryResult([], ['id'])
      throw new Error(`Unexpected SQL in auth test: ${query}`)
    },
  }
}

test('expert API rejects a revoked session before accessing request data', async () => {
  const db = mockDatabaseFetch([], false)
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request('https://app.example.test/api/app/expert/requests', {
      headers: { authorization: `Bearer ${tokenWithPermissions(['expert_requests.read'])}` },
    })
    const result = await handleOperationsExpert(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret })
    assert.equal(result.status, 401)
    assert.equal(db.statements.some((query) => query.includes('FROM operations.requests r')), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expert inbox excludes unpaid requests in both page rows and total count', async () => {
  const db = mockDatabaseFetch(['expert_requests.read'])
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request('https://app.example.test/api/app/expert/requests', {
      headers: { authorization: `Bearer ${tokenWithPermissions([])}` },
    })
    const result = await handleOperationsExpert(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret })
    assert.equal(result.status, 200)
    const requestQueries = db.statements.filter((query) => query.includes('FROM operations.requests r'))
    assert.equal(requestQueries.length, 2)
    assert.ok(requestQueries.every((query) => query.includes('r.payment_required = FALSE OR EXISTS')))
    assert.deepEqual((await result.json()).items, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expert dashboard metrics and recent cases exclude unpaid assigned requests', async () => {
  const db = mockDatabaseFetch(['dashboard.read'])
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request('https://app.example.test/api/app/dashboard', {
      headers: { authorization: `Bearer ${tokenWithPermissions([])}` },
    })
    const result = await handleOperationsData(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret })
    assert.equal(result.status, 200)
    const dashboardQueries = db.statements.filter((query) => query.includes('operations.requests r'))
    assert.equal(dashboardQueries.length, 5)
    assert.ok(dashboardQueries.every((query) => query.includes('r.payment_required = FALSE OR EXISTS')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expert cannot answer with stale JWT permission after it is removed from the current role', async () => {
  const db = mockDatabaseFetch(['expert_requests.read'])
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request(`https://app.example.test/api/app/expert/requests/${userId}/response`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenWithPermissions(['expert_requests.read', 'expert_responses.create'])}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Respuesta de prueba' }),
    })
    const result = await handleOperationsExpert(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret })
    assert.equal(result.status, 403)
    assert.match((await result.json()).error, /permisos para responder/i)
    assert.equal(db.statements.some((query) => query.includes('INSERT INTO operations.expert_responses')), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expert cannot submit a response for an assigned request with payment pending', async () => {
  const db = mockDatabaseFetch(['expert_requests.read', 'expert_responses.create'], true, {
    payment_required: true, payment_approved: false, status: 'pending',
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request(`https://app.example.test/api/app/expert/requests/${userId}/response`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenWithPermissions([])}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Respuesta de prueba' }),
    })
    const result = await handleOperationsExpert(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret })
    assert.equal(result.status, 409)
    assert.match((await result.json()).error, /cambió/i)
    const guardedInsert = db.statements.find((query) => query.includes('WITH eligible AS MATERIALIZED'))
    assert.ok(guardedInsert)
    assert.match(guardedInsert, /r\.payment_required = FALSE OR EXISTS/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('non-admin client list is scoped to clients connected to their own requests', async () => {
  const db = mockDatabaseFetch(['clients.read'], true, null, ['advisor'])
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request('https://app.example.test/api/app/clients', {
      headers: { authorization: `Bearer ${tokenWithPermissions([])}` },
    })
    const result = await handleOperationsData(request, {
      NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: jwtSecret,
    })
    assert.equal(result.status, 200)
    const clientQueries = db.statements.filter((query) => query.includes('FROM operations.clients c'))
    assert.equal(clientQueries.length, 2)
    assert.ok(clientQueries.every((query) => query.includes('r.agent_id =') && query.includes('r.created_by =')))
    assert.deepEqual((await result.json()).items, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
