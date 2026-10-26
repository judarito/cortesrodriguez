import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverNotification, publishNotificationEvent } from '../worker/routes/operationsEmail.js'

const eventId = '7a2a8d75-3f73-4fd0-8d9f-2563b3761ddd'

test('immediate publication atomically claims a pending event and marks it queued', async () => {
  const calls = []
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    calls.push(query)
    if (query.includes('RETURNING id')) return [{ id: eventId }]
    return []
  }
  const sent = []
  assert.equal(await publishNotificationEvent(sql, { NOTIFICATION_EVENTS_QUEUE: { send: async (body) => sent.push(body) } }, eventId), true)
  assert.deepEqual(sent, [{ eventId }])
  assert.match(calls[0], /status = 'pending'/)
  assert.match(calls[1], /status = 'queued'/)
})

test('invalid queue IDs and invalid outbox contracts cannot deliver', async () => {
  let calls = 0
  const sql = async () => { calls += 1; return [] }
  await deliverNotification(sql, {}, 'not-an-event-id')
  assert.equal(calls, 0)

  const invalidEventSql = async (parts) => {
    const query = parts.join(' ')
    if (query.includes('RETURNING id, request_id')) return [{ id: eventId, request_id: 'request-1', event_code: 'unknown_event', idempotency_key: 'bad', admin_only: false, actor_id: null, event_payload: {}, attempts: 1 }]
    if (query.includes("last_error_code = 'notification_contract_invalid'")) return []
    throw new Error(`Unexpected SQL: ${query}`)
  }
  await deliverNotification(invalidEventSql, {}, eventId)
})

test('completed or otherwise ineligible duplicate events are neutralized by the conditional claim', async () => {
  let sideEffects = 0
  const sql = async (parts) => {
    const query = parts.join(' ')
    if (query.includes('RETURNING id, request_id')) return []
    sideEffects += 1
    return []
  }
  await deliverNotification(sql, {}, eventId)
  assert.equal(sideEffects, 0)
})

test('a superseded assignment event is cancelled before publishing or sending', async () => {
  const calls = []
  let finalStatus = ''
  const sql = async (parts) => {
    const query = parts.join(' ')
    calls.push(query)
    if (query.includes('RETURNING id, request_id')) return [{
      id: eventId, request_id: '90199877-a6f9-46fc-8f87-6117846d8eef', event_code: 'expert_assigned',
      idempotency_key: `expert_assigned/${eventId}`, admin_only: false, actor_id: null,
      event_payload: { assignmentId: 'a0199877-a6f9-46fc-8f87-6117846d8eef', expertId: 'b0199877-a6f9-46fc-8f87-6117846d8eef' },
      attempts: 1, lease_token: 'c0199877-a6f9-46fc-8f87-6117846d8eef',
    }]
    if (query.includes('FROM operations.request_assignments assignment')) return []
    if (query.includes("SET status = 'cancelled'")) { finalStatus = 'cancelled'; return [] }
    throw new Error(`Unexpected SQL: ${query}`)
  }
  await deliverNotification(sql, {}, eventId)
  assert.equal(finalStatus, 'cancelled')
  assert.match(calls.at(-1), /lease_token =/)
  assert.equal(calls.some((query) => query.includes('INSERT INTO operations.app_notifications')), false)
  assert.equal(calls.some((query) => query.includes('notification_messages')), false)
})
