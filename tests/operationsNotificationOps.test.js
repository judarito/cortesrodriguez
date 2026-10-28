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

function mockDb(roles = ['admin'], { template = 'general-v1', effectKey, pending = false, race = false } = {}) {
  const queries = []
  return {
    queries,
    fetch: async (_url, options) => {
      const { query, params } = JSON.parse(options.body)
      queries.push(query)
      if (query.includes('FROM operations.sessions s')) return pgResult([{ id: adminId, email: 'admin@example.test', full_name: 'Admin' }], ['id', 'email', 'full_name'])
      if (query.includes('FROM operations.user_roles ur JOIN operations.roles')) return pgResult(roles.map((name) => ({ name })), ['name'])
      if (query.includes('JOIN operations.role_permissions rp')) return pgResult([], ['code'])
      if (query.includes('SELECT id, request_id, event_code, recipient_email, effect_key')) return pgResult([{
        id: effectId, request_id: outboxId, event_code: 'payment_approved', recipient_email: 'client@example.test',
        effect_key: effectKey ?? `cra-${outboxId}/${template}`, resend_email_id: null,
      }], ['id', 'request_id', 'event_code', 'recipient_email', 'effect_key', 'resend_email_id'])
      if (query.includes("SET status = 'accepted', resend_email_id")) {
        assert.ok(params.includes(resendEmailId))
        assert.match(query, /INSERT INTO operations.audit_log/)
        return pgResult(race ? [] : [{ id: effectId }], ['id'])
      }
      if (query.includes('INSERT INTO operations.notification_messages')) {
        assert.ok(params.includes(resendEmailId))
        assert.match(query, /ON CONFLICT \(resend_email_id\) DO NOTHING/)
        return pgResult([], [])
      }
      if (query.includes('UPDATE operations.app_notifications')) return pgResult([], [])
      if (query.includes('SELECT 1 FROM operations.notification_email_effects')) {
        assert.ok(params.includes(`cra-${outboxId}/%`))
        return pgResult(pending ? [{ exists: '1' }] : [], ['exists'])
      }
      if (query.includes('UPDATE operations.notification_outbox') || query.includes('UPDATE operations.requests')) return pgResult([], [])
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


const resendEmailId = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794'

async function resolveAccepted(db, id = resendEmailId) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    return await handleOperationsNotificationOps(new Request(`https://app.example.test/api/app/notification-ops/email-effects/${effectId}/resolve`, {
      method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'accepted', resendEmailId: id, note: 'Se verificó en Resend la aceptación del correo y su destinatario.' }),
    }), {
      NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: secret,
      NOTIFICATION_EVENTS_QUEUE: { send: async () => assert.fail('reconciliation must not resend accepted email') },
    })
  } finally { globalThis.fetch = originalFetch }
}

for (const template of ['general-v1', 'expert-v1', 'client-es-v1', 'client-en-v1']) {
  test(`accepted email reconciliation supports ${template} and real Resend UUIDs`, async () => {
    const db = mockDb(['admin'], { template })
    const result = await resolveAccepted(db)
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { ok: true, resolution: 'accepted', eventComplete: true })
    assert.equal(db.queries.filter((q) => q.includes('INSERT INTO operations.notification_messages')).length, 1)
    assert.equal(db.queries.filter((q) => q.includes('UPDATE operations.notification_outbox')).length, 1)
  })
}

test('accepted reconciliation leaves the event open when another recipient is pending', async () => {
  const db = mockDb(['admin'], { template: 'client-en-v1', pending: true })
  const result = await resolveAccepted(db)
  assert.equal(result.status, 200)
  assert.equal((await result.json()).eventComplete, false)
  assert.equal(db.queries.some((q) => q.includes('UPDATE operations.notification_outbox')), false)
  assert.equal(db.queries.some((q) => q.includes('UPDATE operations.requests')), false)
})

test('accepted reconciliation rejects credentials and invalid IDs before mutations', async () => {
  for (const id of ['re_testCredential12345', 'invalid', '', `${resendEmailId}/extra`]) {
    const db = mockDb()
    const result = await resolveAccepted(db, id)
    assert.equal(result.status, 400)
    assert.equal(db.queries.some((q) => /UPDATE|INSERT INTO/.test(q)), false)
  }
})

test('accepted reconciliation refuses malformed or unknown durable effect keys', async () => {
  for (const effectKey of [`cra-${outboxId}/client-fr-v1`, `cra-${outboxId}/general-v1/extra`, 'cra-invalid/client-es-v1']) {
    const db = mockDb(['admin'], { effectKey })
    const result = await resolveAccepted(db)
    assert.equal(result.status, 409)
    assert.equal(db.queries.some((q) => /UPDATE|INSERT INTO/.test(q)), false)
  }
})

test('accepted reconciliation returns conflict if another admin resolved it first', async () => {
  const db = mockDb(['admin'], { race: true })
  const result = await resolveAccepted(db)
  assert.equal(result.status, 409)
  assert.equal(db.queries.some((q) => q.includes('INSERT INTO operations.notification_messages')), false)
})
