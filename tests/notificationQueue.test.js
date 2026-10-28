import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverNotification, sendRequestNotification } from '../worker/routes/operationsEmail.js'

function createEmailEffectStore() {
  const rows = new Map()
  let nextId = 0
  return {
    rows,
    query(query, values) {
      if (query.includes('INSERT INTO operations.notification_email_effects')) {
        const key = `${values[0]}\n${values[3]}`
        if (!rows.has(key)) rows.set(key, {
          id: `effect-${++nextId}`,
          effect_key: values[0],
          recipient_email: values[3],
          resend_idempotency_key: values[4],
          payload_sha256: values[5],
          status: 'pending',
          resend_email_id: null,
        })
        return []
      }
      if (query.includes('SELECT id, resend_idempotency_key, payload_sha256')) {
        const row = rows.get(`${values[0]}\n${values[1]}`)
        return row ? [{ ...row }] : []
      }
      if (query.includes("SET status = 'sending'")) {
        const row = [...rows.values()].find((item) => item.id === values[0])
        if (!row || !['pending', 'retryable'].includes(row.status)) return []
        row.status = 'sending'
        return [{ id: row.id, lease_token: 'lease-effect-1' }]
      }
      if (query.includes("SET status = 'retryable'")) {
        const row = [...rows.values()].find((item) => item.id === values[1])
        if (row) row.status = 'retryable'
        return []
      }
      if (query.includes("SET status = 'accepted'")) {
        const row = [...rows.values()].find((item) => item.id === values[1])
        if (row) {
          row.status = 'accepted'
          row.resend_email_id = values[0]
          return [{ id: row.id }]
        }
        return []
      }
      if (query.includes('SELECT status FROM operations.notification_email_effects')) {
        const row = [...rows.values()].find((item) => item.id === values[0])
        return row ? [{ status: row.status }] : []
      }
      return null
    },
  }
}

test('expert notification is isolated from client identity, request details, and other recipients', async () => {
  const sends = []
  let reverseConfiguredOrder = false
  const effects = createEmailEffectStore()
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    const effectResult = effects.query(query, values)
    if (effectResult !== null) return effectResult
    if (query.includes('SELECT r.id, r.reference')) return [{
      id: 'request-private', reference: 'CRA-PRIVATE-123', email: 'client@example.test',
      service_name: 'Servicio privado', service_type: 'importacion', product_type: 'mercancias',
      status: 'pending', source: 'landingpage', payment_required: false, source_channel: 'direct_web',
      client_name: 'Nombre Privado', agent_email: null, expert_email: 'expert@example.test',
      assigned_expert_id: 'expert-1', consultation_type_id: null,
    }]
    if (query.includes('SELECT id, audiences')) return [{ id: 'rule-test', audiences: ['admin', 'client', 'expert'] }]
    if (query.includes('SELECT nr.email, nr.recipient_type')) return reverseConfiguredOrder ? [
      { email: 'ops-two@example.test', recipient_type: 'to' },
      { email: 'expert@example.test', recipient_type: 'cc' },
      { email: 'ops@example.test', recipient_type: 'bcc' },
    ] : [
      { email: 'expert@example.test', recipient_type: 'cc' },
      { email: 'ops@example.test', recipient_type: 'bcc' },
      { email: 'ops-two@example.test', recipient_type: 'to' },
    ]
    if (query.includes('SELECT DISTINCT u.email')) return [{ email: 'admin@example.test' }]
    if (query.includes('INSERT INTO operations.notification_messages')) return []
    if (query.includes('UPDATE operations.requests')) return []
    throw new Error(`Unexpected SQL in test: ${query}`)
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    body.idempotencyKey = new Headers(options.headers).get('Idempotency-Key')
    sends.push(body)
    return new Response(JSON.stringify({ id: `resend-${sends.length}` }), { status: 200 })
  }

  try {
    const result = await sendRequestNotification(sql, { RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'test@example.test' }, 'request-private', 'request_created', null, { idempotencyKey: 'test-event' })
    assert.equal(result.sent, true)
    assert.deepEqual(sends.map((message) => message.to), [['ops@example.test'], ['ops-two@example.test'], ['client@example.test'], ['expert@example.test']])
    const expertMessage = sends[3]
    const expertContent = JSON.stringify(expertMessage)
    for (const privateValue of ['client@example.test', 'Nombre Privado', 'CRA-PRIVATE-123', 'Servicio privado']) {
      assert.equal(expertContent.includes(privateValue), false)
    }
    assert.equal('cc' in expertMessage, false)
    assert.equal('bcc' in expertMessage, false)
    assert.equal('reply_to' in expertMessage, false)
    assert.equal(expertMessage.subject, 'Notificación operativa')

    const firstKeys = new Map(sends.map((message) => [message.to[0], message.idempotencyKey]))
    reverseConfiguredOrder = true
    await sendRequestNotification(sql, { RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'test@example.test' }, 'request-private', 'request_created', null, { idempotencyKey: 'test-event' })
    assert.equal(sends.length, 4, 'accepted recipients must not be sent again')
    assert.deepEqual(new Map(sends.map((message) => [message.to[0], message.idempotencyKey])), firstKeys)
    for (const [recipient, key] of firstKeys) {
      assert.ok(key.length > 0 && key.length <= 256)
      const effect = effects.rows.get(`test-event/${recipient === 'expert@example.test' ? 'expert-v1' : recipient === 'client@example.test' ? 'client-es-v1' : 'general-v1'}\n${recipient}`)
      assert.equal(effect.status, 'accepted')
      assert.equal('payload' in effect, false, 'the local ledger keeps only the payload hash')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries a failed Resend delivery and succeeds idempotently without changing payment state', async () => {
  const event = {
    id: '7a2a8d75-3f73-4fd0-8d9f-2563b3761ddd',
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
  const effects = createEmailEffectStore()
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    const effectResult = effects.query(query, values)
    if (effectResult !== null) return effectResult
    if (query.includes('UPDATE operations.notification_outbox') && query.includes('RETURNING id, request_id')) {
      if (!['queued', 'dispatching'].includes(outboxStatus)) return []
      outboxStatus = 'processing'
      event.attempts = ++attempts
      return [{ ...event, lease_token: 'lease-outbox-1' }]
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
    if (query.includes('SELECT id, audiences')) return [{ id: 'rule-test', audiences: ['admin', 'client'] }]
    if (query.includes('SELECT nr.email, nr.recipient_type')) return []
    if (query.includes('SELECT DISTINCT u.email')) return [{ email: 'admin@example.test' }]
    if (query.includes('SELECT DISTINCT ON (u.id)')) return [{ id: 'admin-test', role_name: 'admin' }]
    if (query.includes('SELECT status FROM operations.notification_messages')) return []
    if (query.includes('SELECT id, request_id, event_code, resend_email_id')) return []
    if (query.includes('UPDATE operations.app_notifications')) return []
    if (query.includes('INSERT INTO operations.app_notifications')) return []
    if (query.includes('app_notifications_generated_at')) return []
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
    assert.equal(resendKeys.length, 3)
    assert.equal(resendKeys[0], resendKeys[1])
    assert.notEqual(resendKeys[0], resendKeys[2])
    assert.ok(resendKeys.every((key) => key.length > 0 && key.length <= 256))
    assert.equal(effects.rows.size, 2)
    assert.deepEqual([...effects.rows.values()].map((row) => row.status), ['accepted', 'accepted'])
    assert.ok([...effects.rows.values()].every((row) => !('payload' in row) && row.payload_sha256))
    assert.deepEqual(sentTo, [['admin@example.test'], ['admin@example.test'], ['client@example.test']])
    const accepted = [...effects.rows.values()]
    assert.equal(accepted.find((row) => row.recipient_email === 'admin@example.test').status, 'accepted')
    assert.equal(accepted.find((row) => row.recipient_email === 'client@example.test').status, 'accepted')
    assert.deepEqual(requestStatuses, ['pending_retry', 'accepted'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
