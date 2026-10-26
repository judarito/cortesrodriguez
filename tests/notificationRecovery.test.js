import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchPendingNotifications } from '../worker/routes/operationsEmail.js'

const recovered = [
  { id: '11111111-1111-4111-8111-111111111111', dispatch_lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  { id: '22222222-2222-4222-8222-222222222222', dispatch_lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { id: '33333333-3333-4333-8333-333333333333', dispatch_lease_token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
]

test('scheduled recovery republishes due, expired-lease, and stale-queued outbox events with fencing', async () => {
  const originalFetch = globalThis.fetch
  const queries = []
  const sent = []
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body)
    queries.push(query)
    const rows = query.includes('RETURNING event.id, event.dispatch_lease_token')
      ? recovered.map(({ id, dispatch_lease_token }) => [id, dispatch_lease_token])
      : []
    return new Response(JSON.stringify({
      fields: query.includes('RETURNING event.id, event.dispatch_lease_token')
        ? [{ name: 'id', dataTypeID: 25 }, { name: 'dispatch_lease_token', dataTypeID: 25 }]
        : [],
      rows,
    }), { headers: { 'content-type': 'application/json' } })
  }

  try {
    const result = await dispatchPendingNotifications({
      NEON_DATABASE_URL: 'postgres://test:test@ep-test.neon.tech/neondb',
      NOTIFICATION_EVENTS_QUEUE: { send: async (message) => sent.push(message) },
    })
    assert.equal(result.dispatched, 3)
    assert.deepEqual(sent, recovered.map(({ id }) => ({ eventId: id })))
    assert.match(queries[0], /status = 'pending' AND next_attempt_at <= NOW\(\)/)
    assert.match(queries[0], /status = 'processing' AND lease_expires_at < NOW\(\)/)
    assert.match(queries[0], /status = 'dispatching' AND dispatch_lease_expires_at < NOW\(\)/)
    assert.match(queries[0], /status = 'queued' AND updated_at < NOW\(\) - INTERVAL '15 minutes'/)
    const completions = queries.filter((query) => query.includes("SET status = 'queued'"))
    assert.equal(completions.length, 3)
    assert.ok(completions.every((query) => query.includes('dispatch_lease_token =')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failed queue publication restores pending state only for the current dispatch lease', async () => {
  const originalFetch = globalThis.fetch
  const queries = []
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body)
    queries.push(query)
    const isClaim = query.includes('RETURNING event.id, event.dispatch_lease_token')
    return new Response(JSON.stringify({
      fields: isClaim ? [{ name: 'id', dataTypeID: 25 }, { name: 'dispatch_lease_token', dataTypeID: 25 }] : [],
      rows: isClaim ? [[recovered[0].id, recovered[0].dispatch_lease_token]] : [],
    }), { headers: { 'content-type': 'application/json' } })
  }

  try {
    const result = await dispatchPendingNotifications({
      NEON_DATABASE_URL: 'postgres://test:test@ep-test.neon.tech/neondb',
      NOTIFICATION_EVENTS_QUEUE: { send: async () => { throw new Error('synthetic queue outage') } },
    })
    assert.equal(result.dispatched, 0)
    const restoration = queries.find((query) => query.includes("SET status = 'pending'"))
    assert.ok(restoration)
    assert.match(restoration, /dispatch_lease_token = .*::uuid/)
    assert.match(restoration, /next_attempt_at = NOW\(\) \+ INTERVAL '1 minute'/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
