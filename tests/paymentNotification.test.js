import test from 'node:test'
import assert from 'node:assert/strict'
import { adminEmailAllowedForEvent, enqueueNotification, notificationDescription, notificationPolicyForPayment, shouldNotifyClient } from '../worker/routes/operationsEmail.js'
import { roleAudiences, roleRecipientIds } from '../worker/routes/appNotifications.js'

test('administrative email is limited to assignment and review events', () => {
  assert.equal(adminEmailAllowedForEvent('expert_assigned'), true)
  assert.equal(adminEmailAllowedForEvent('payment_approved'), true)
  assert.equal(adminEmailAllowedForEvent('expert_response_submitted'), true)
  assert.equal(adminEmailAllowedForEvent('similar_question_review'), true)
  assert.equal(adminEmailAllowedForEvent('request_created'), false)
  assert.equal(adminEmailAllowedForEvent('status_changed'), false)
})

test('admin-only events stay in the admin bell and do not leak to an assigned expert', () => {
  const request = { source: 'landingpage', source_channel: 'direct_web', agent_id: null, assigned_expert_id: 'expert-1' }
  assert.deepEqual(roleAudiences('request_created', request, true), { admin: true, agent: false, expert: false })
  assert.deepEqual(roleRecipientIds('request_created', request, true), { agentId: null, expertId: null })
})

test('always includes the client in payment approval notifications', () => {
  assert.equal(shouldNotifyClient('payment_approved', ['admin', 'expert']), true)
})

test('keeps client notifications audience-controlled for other events', () => {
  assert.equal(shouldNotifyClient('request_created', ['admin', 'expert']), false)
  assert.equal(shouldNotifyClient('request_created', ['client']), true)
  assert.equal(shouldNotifyClient('request_created', ['all_involved']), true)
})

test('payment approval message confirms receipt and promises follow-up', () => {
  const message = notificationDescription('payment_approved')
  assert.match(message, /confirmamos el pago/i)
  assert.match(message, /pronto te contactaremos/i)
})

test('unpaid or failed payment notifications are restricted to administrators', () => {
  assert.deepEqual(notificationPolicyForPayment('payment_rejected', true, false), { send: true, adminOnly: true, reason: null })
  assert.deepEqual(notificationPolicyForPayment('payment_rejected', true, true), { send: true, adminOnly: true, reason: null })
  assert.deepEqual(notificationPolicyForPayment('request_created', true, false), { send: true, adminOnly: true, reason: null })
  assert.deepEqual(notificationPolicyForPayment('request_created', true, true, true), { send: true, adminOnly: true, reason: null })
})

test('payment approval cannot be notified unless the required payment is confirmed', () => {
  assert.deepEqual(notificationPolicyForPayment('payment_approved', true, false), { send: false, adminOnly: false, reason: 'payment_required' })
  assert.deepEqual(notificationPolicyForPayment('payment_approved', false, false), { send: false, adminOnly: false, reason: 'payment_required' })
  assert.deepEqual(notificationPolicyForPayment('payment_approved', true, true), { send: true, adminOnly: false, reason: null })
})

test('notification queue deduplicates retries by idempotency key but allows a new event of the same type', async () => {
  const outbox = new Map()
  let nextId = 1
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    if (query.includes('INSERT INTO operations.notification_outbox')) {
      const key = values[2]
      if (outbox.has(key)) return []
      const row = { id: `event-${nextId++}`, status: 'pending' }
      outbox.set(key, row)
      return [row]
    }
    if (query.includes('SELECT id, status FROM operations.notification_outbox')) return [outbox.get(values[0])].filter(Boolean)
    return []
  }

  const first = await enqueueNotification(sql, 'request-1', 'expert_assigned', { idempotencyKey: 'assignment-1' })
  const retry = await enqueueNotification(sql, 'request-1', 'expert_assigned', { idempotencyKey: 'assignment-1' })
  const reassignment = await enqueueNotification(sql, 'request-1', 'expert_assigned', { idempotencyKey: 'assignment-2' })

  assert.equal(first.eventId, retry.eventId)
  assert.equal(retry.status, 'pending')
  assert.notEqual(first.eventId, reassignment.eventId)
  assert.equal(outbox.size, 2)
})
