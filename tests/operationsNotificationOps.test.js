import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { handleOperationsNotificationOps } from '../worker/routes/operationsNotificationOps.js'

const secret = 'notification-ops-test-secret'
const adminId = '80199877-a6f9-46fc-8f87-6117846d8eef'
const effectId = 'a0199877-a6f9-46fc-8f87-6117846d8eef'
const outboxId = '90199877-a6f9-46fc-8f87-6117846d8eef'

function token() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ sub: adminId, scope: 'operations', exp: Math.floor(Date.now() / 1000) + 3600 })
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function pgResult(rows, columns) {
  return new Response(JSON.stringify({ fields: columns.map((name) => ({ name, dataTypeID: 25 })), rows: rows.map((row) => columns.map((column) => row[column] ?? null)) }), {
    headers: { 'content-type': 'application/json' },
  })
}

function mockDb(roles = ['admin']) {
  const queries = []
  return {
    queries,
    fetch: async (_url, options) => {
      const { query } = JSON.parse(options.body)
      queries.push(query)
      if (query.includes('FROM operations.sessions s')) return pgResult([{ id: adminId, email: 'admin@example.test', full_name: 'Admin' }], ['id', 'email', 'full_name'])
      if (query.includes('FROM operations.user_roles ur JOIN operations.roles')) return pgResult(roles.map((name) => ({ name })), ['name'])
      if (query.includes('JOIN operations.role_permissions rp')) return pgResult([], ['code'])
      if (query.includes('SELECT id, request_id, event_code, recipient_email, effect_key')) return pgResult([{
        id: effectId, request_id: outboxId, event_code: 'payment_approved', recipient_email: 'client@example.test',
        effect_key: `cra-${outboxId}/general-v1`, resend_email_id: null,
      }], ['id', 'request_id', 'event_code', 'recipient_email', 'effect_key', 'resend_email_id'])
      throw new Error(`Unexpected SQL: ${query}`)
    },
  }
}

test('notification operations endpoints reject non-admin roles', async () => {
  const db = mockDb(['expert'])
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request('https://app.example.test/api/app/notification-ops/dlq', { headers: { authorization: `Bearer ${token()}` } })
    const result = await handleOperationsNotificationOps(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: secret })
    assert.equal(result.status, 403)
    assert.equal(db.queries.some((query) => query.includes('notification_queue_failures')), false)
  } finally { globalThis.fetch = originalFetch }
})

test('uncertain email retry requires explicit proof that Resend did not accept it', async () => {
  const db = mockDb()
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request(`https://app.example.test/api/app/notification-ops/email-effects/${effectId}/resolve`, {
      method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'not_sent', note: 'Se revisó el panel de Resend y no aparece un correo aceptado.' }),
    })
    const result = await handleOperationsNotificationOps(request, {
      NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: secret,
      NOTIFICATION_EVENTS_QUEUE: { send: async () => assert.fail('must not publish without explicit confirmation') },
    })
    assert.equal(result.status, 400)
    assert.equal(db.queries.some((query) => query.includes('UPDATE operations.notification_email_effects')), false)
  } finally { globalThis.fetch = originalFetch }
})
