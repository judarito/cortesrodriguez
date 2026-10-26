import test from 'node:test'
import assert from 'node:assert/strict'
import { sendEmailEffect } from '../worker/routes/operationsEmail.js'

function effectStore(initial = null) {
  const state = { row: initial, calls: [] }
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    state.calls.push(query)
    if (query.includes('INSERT INTO operations.notification_email_effects')) {
      if (!state.row) state.row = {
        id: 'effect-1', effect_key: values[0], resend_idempotency_key: values[4],
        payload_sha256: values[5], status: 'pending', resend_email_id: null,
      }
      return []
    }
    if (query.includes('SELECT id, resend_idempotency_key')) return state.row ? [{ ...state.row }] : []
    if (query.includes("SET status = 'sending'")) {
      if (state.row.status === 'pending' || state.row.status === 'retryable' || state.row.leaseExpired) {
        state.row.status = 'sending'
        state.row.leaseExpired = false
        return [{ id: state.row.id }]
      }
      return []
    }
    if (query.includes("SET status = 'uncertain'")) {
      state.row.status = 'uncertain'
      state.row.last_error_code = 'resend_idempotency_window_expired'
      return []
    }
    if (query.includes('SELECT status FROM operations.notification_email_effects')) return [{ status: state.row.status }]
    if (query.includes("SET status = 'retryable'")) {
      state.row.status = 'retryable'
      return []
    }
    if (query.includes("SET status = 'accepted'")) {
      state.row.status = 'accepted'
      state.row.resend_email_id = values[0]
      return []
    }
    if (query.includes('INSERT INTO operations.notification_messages')) return []
    throw new Error(`Unexpected SQL: ${query}`)
  }
  return { sql, state }
}

const env = { RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'test@example.test' }
const effect = {
  effectKey: 'cra-outbox-event/general-v1', recipient: 'person@example.test',
  requestId: 'request-1', eventCode: 'request_created', messageSubject: 'Nueva solicitud',
  payload: { from: 'test@example.test', to: ['person@example.test'], subject: 'Nueva solicitud', text: 'stable', html: '<p>stable</p>' },
}

test('persists a per-recipient attempt, retries with the same key and body, then skips accepted effects', async () => {
  const { sql, state } = effectStore()
  const originalFetch = globalThis.fetch
  const attempts = []
  globalThis.fetch = async (_url, options) => {
    attempts.push({ key: new Headers(options.headers).get('Idempotency-Key'), body: options.body })
    if (attempts.length === 1) throw new Error('connection reset')
    return new Response(JSON.stringify({ id: 'resend-accepted-1' }), { status: 200 })
  }
  try {
    await assert.rejects(sendEmailEffect(sql, env, effect), /connection reset/)
    assert.equal(state.row.status, 'retryable')
    const accepted = await sendEmailEffect(sql, env, effect)
    assert.deepEqual(accepted, { sent: true, emailId: 'resend-accepted-1' })
    const alreadyAccepted = await sendEmailEffect(sql, env, effect)
    assert.equal(alreadyAccepted.alreadyAccepted, true)
    assert.equal(attempts.length, 2)
    assert.equal(attempts[0].key, attempts[1].key)
    assert.equal(attempts[0].body, attempts[1].body)
    assert.ok(attempts[0].key.length <= 256)
    assert.equal(state.row.status, 'accepted')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('marks an unresolved effect uncertain and does not send once the 24-hour key window expires', async () => {
  const { sql, state } = effectStore({
    id: 'effect-old', effect_key: effect.effectKey, resend_idempotency_key: 'cra-email-v1-placeholder',
    payload_sha256: '', status: 'retryable', resend_email_id: null,
  })
  // Compute the persisted fingerprint/key via a fresh insert, then model an old
  // retryable row to exercise the expiry path without depending on wall-clock time.
  const fresh = effectStore()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('must not send') }
  try {
    await assert.rejects(sendEmailEffect(fresh.sql, env, effect), /must not send/)
    state.row.resend_idempotency_key = fresh.state.row.resend_idempotency_key
    state.row.payload_sha256 = fresh.state.row.payload_sha256
    state.row.leaseExpired = false
    const expiredSql = async (parts, ...values) => {
      const query = parts.join(' ')
      if (query.includes('INSERT INTO operations.notification_email_effects')) return []
      if (query.includes('SELECT id, resend_idempotency_key')) return [{ ...state.row }]
      if (query.includes("SET status = 'sending'")) return []
      if (query.includes("SET status = 'uncertain'")) { state.row.status = 'uncertain'; return [] }
      if (query.includes('SELECT status FROM operations.notification_email_effects')) return [{ status: state.row.status }]
      throw new Error(`Unexpected SQL: ${query}`)
    }
    const result = await sendEmailEffect(expiredSql, env, effect)
    assert.deepEqual(result, { sent: false, reason: 'notification_delivery_uncertain' })
    assert.equal(state.row.status, 'uncertain')
  } finally {
    globalThis.fetch = originalFetch
  }
})
