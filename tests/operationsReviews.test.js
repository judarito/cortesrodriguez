import test from 'node:test'
import assert from 'node:assert/strict'
import { transitionReview } from '../worker/routes/operationsReviews.js'

function recordingSql(result) {
  const calls = []
  const sql = async (parts, ...values) => {
    calls.push({ query: parts.join(' '), values })
    return result
  }
  return { sql, calls }
}

test('approval is conditional and closes only with a durable outbox event in the same statement', async () => {
  const { sql, calls } = recordingSql([{
    id: 'response-1', version: 3, status: 'approved', public_note: 'Para el cliente', internal_note: 'Nota interna',
  }])

  const rows = await transitionReview(sql, {
    responseId: 'response-1', requestId: 'request-1', action: 'approve', actorId: 'admin-1',
    publicNote: 'Para el cliente', internalNote: 'Nota interna',
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].query, /status = 'pending_admin_review'/)
  assert.match(calls[0].query, /INSERT INTO operations\.notification_outbox/)
  assert.match(calls[0].query, /SELECT id FROM event_written/)
  assert.match(calls[0].query, /EXISTS \(SELECT 1 FROM durable_event\)/)
  assert.match(calls[0].query, /SET status = 'closed'/)
  assert.match(calls[0].query, /admin_note = .*internal_note =/)
  assert.deepEqual(rows[0], {
    id: 'response-1', version: 3, status: 'approved', public_note: 'Para el cliente', internal_note: 'Nota interna',
  })
})

test('a lost review race returns no transition and rejection never closes the request', async () => {
  const approval = recordingSql([])
  assert.deepEqual(await transitionReview(approval.sql, {
    responseId: 'response-1', requestId: 'request-1', action: 'approve', actorId: 'admin-2',
    publicNote: '', internalNote: '',
  }), [])

  const rejection = recordingSql([{ id: 'response-1', version: 1, status: 'rejected', public_note: null, internal_note: 'Revisar cifras' }])
  await transitionReview(rejection.sql, {
    responseId: 'response-1', requestId: 'request-1', action: 'reject', actorId: 'admin-1',
    publicNote: 'No debe ser pública', internalNote: 'Revisar cifras',
  })
  assert.match(rejection.calls[0].query, /status = 'pending_admin_review'/)
  assert.match(rejection.calls[0].query, /SET status = 'in_progress'/)
  assert.doesNotMatch(rejection.calls[0].query, /status = 'closed'/)
  assert.doesNotMatch(rejection.calls[0].query, /INSERT INTO operations\.notification_outbox/)
  assert.match(rejection.calls[0].query, /admin_note = NULL/)
})
