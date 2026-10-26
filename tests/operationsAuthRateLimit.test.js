import test from 'node:test'
import assert from 'node:assert/strict'
import { handleOperationsAuth } from '../worker/routes/operationsAuth.js'

const env = { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: 'rate-limit-test-secret' }

function queryResult(rows, columns) {
  return new Response(JSON.stringify({
    fields: columns.map((name) => ({ name, dataTypeID: 25 })),
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  }), { headers: { 'content-type': 'application/json' } })
}

function mockDatabase({ locked = false, users = [] } = {}) {
  const requests = []
  return {
    requests,
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body)
      requests.push(body)
      if (body.query.includes('AS locked')) return queryResult([{ locked: locked ? 'true' : '' }], ['locked'])
      if (body.query.includes('FROM operations.users u')) return queryResult(users, ['id', 'email', 'full_name', 'active', 'password_hash', 'password_salt', 'locked_until'])
      return queryResult([], [])
    },
  }
}

async function attemptLogin(db) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    return await handleOperationsAuth(new Request('https://app.example.test/api/app/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.27' },
      body: JSON.stringify({ email: 'missing@example.test', password: 'Never persist this password' }),
    }), env)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('failed operational login uses generic response and atomically increments account and IP counters', async () => {
  const db = mockDatabase()
  const result = await attemptLogin(db)

  assert.equal(result.status, 401)
  assert.deepEqual(await result.json(), { error: 'Credenciales inválidas.' })
  const failure = db.requests.find(({ query }) => query.includes('INSERT INTO operations.login_attempt_limits'))
  assert.ok(failure, JSON.stringify(db.requests))
  assert.match(failure.query, /\('account', .*\),\s*\('ip', .*\)/s)
  assert.match(failure.query, /ON CONFLICT \(scope, identifier_hash\) DO UPDATE/)
  assert.doesNotMatch(JSON.stringify(db.requests), /Never persist this password|198\.51\.100\.27/)
})

test('locked operational login returns the same generic response without looking up the account', async () => {
  const db = mockDatabase({ locked: true })
  const result = await attemptLogin(db)

  assert.equal(result.status, 401)
  assert.deepEqual(await result.json(), { error: 'Credenciales inválidas.' })
  assert.equal(db.requests.some(({ query }) => query.includes('SELECT u.id, u.email')), false)
  assert.equal(db.requests.some(({ query }) => query.includes('INSERT INTO operations.login_attempt_limits')), false)
})

test('expired login attempt cleanup is limited to 100 rows and locks selected rows safely', async () => {
  const db = mockDatabase()
  await attemptLogin(db)
  const cleanup = db.requests.find(({ query }) => query.includes('WITH expired AS'))
  assert.ok(cleanup)
  assert.match(cleanup.query, /LIMIT 100/)
  assert.match(cleanup.query, /FOR UPDATE SKIP LOCKED/)
})
