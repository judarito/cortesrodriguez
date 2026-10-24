import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverNotification } from '../worker/routes/operationsEmail.js'

test('retries a failed Resend delivery and succeeds idempotently without changing payment state', async () => {
  const event = {
    id: 'event-test-1',
    request_id: 'request-test-1',
    event_code: 'payment_approved',
    idempotency_key: 'payment_approved/request-test-1',
    admin_only: false,
    actor_id: null,
    event_payload: {},
    attempts: 0,
  }
  let outboxStatus = 'queued'
  let attempts = 0
  const paymentStatus = 'approved'
  let notificationStatus = null
  const requestStatuses = []
  const resendKeys = []
  const sentTo = []
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    if (query.includes('UPDATE operations.notification_outbox') && query.includes('RETURNING id, request_id')) {
      if (!['queued', 'dispatching'].includes(outboxStatus)) return []
      outboxStatus = 'processing'
      event.attempts = ++attempts
      return [{ ...event }]
    }
    if (query.includes('SELECT r.id, r.reference')) return [{
      id: event.request_id,
      reference: 'CRA-TEST-QUEUE',
      email: 'client@example.test',
      service_name: 'Consulta de prueba',
      service_type: 'importacion',
      product_type: 'mercancias',
      status: 'pending',
      source: 'landingpage',
      payment_required: true,
      source_channel: 'direct_web',
      client_name: 'Cliente de prueba',
      agent_email: null,
      expert_email: null,
    }]
    if (query.includes('SELECT EXISTS (SELECT 1 FROM operations.request_payments')) return [{ paid: paymentStatus === 'approved' }]
    if (query.includes('SELECT id, name, audiences')) return [{ id: 'rule-test', name: 'Pago aprobado', audiences: ['admin', 'client'] }]
    if (query.includes('SELECT nr.email, nr.recipient_type')) return []
    if (query.includes('SELECT DISTINCT u.email')) return [{ email: 'admin@example.test' }]
    if (query.includes('INSERT INTO operations.notification_messages')) return []
    if (query.includes('UPDATE operations.requests') && query.includes('notification_status')) {
      notificationStatus = query.includes("notification_status = 'accepted'") ? 'accepted' : values[0]
      requestStatuses.push(notificationStatus)
      return []
    }
    if (query.includes('UPDATE operations.notification_outbox') && query.includes('SET status =')) {
      outboxStatus = query.includes("SET status = 'sent'") ? 'sent' : values[0]
      return []
    }
    throw new Error(`Unexpected SQL in test: ${query}`)
  }

  const originalFetch = globalThis.fetch
  let sendAttempt = 0
  globalThis.fetch = async (_url, options) => {
    sendAttempt += 1
    resendKeys.push(new Headers(options.headers).get('Idempotency-Key'))
    const body = JSON.parse(options.body)
    sentTo.push(body.to)
    if (sendAttempt === 1) return new Response(JSON.stringify({ message: 'temporary outage' }), { status: 503 })
    return new Response(JSON.stringify({ id: 'resend-test-1' }), { status: 200 })
  }

  try {
    const env = { RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'test@example.test' }
    await deliverNotification(sql, env, event.id)
    assert.equal(outboxStatus, 'pending')
    assert.equal(notificationStatus, 'pending_retry')

    // The scheduled dispatcher requeues the durable outbox row when its retry time is due.
    outboxStatus = 'queued'
    await deliverNotification(sql, env, event.id)

    assert.equal(outboxStatus, 'sent')
    assert.equal(notificationStatus, 'accepted')
    assert.equal(paymentStatus, 'approved')
    assert.deepEqual(resendKeys, ['cra-event-test-1', 'cra-event-test-1'])
    assert.deepEqual(sentTo[1], ['client@example.test', 'admin@example.test'])
    assert.deepEqual(requestStatuses, ['pending_retry', 'accepted'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
