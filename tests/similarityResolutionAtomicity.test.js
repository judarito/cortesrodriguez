import test from 'node:test'
import assert from 'node:assert/strict'
import { forwardSimilarQuestion, reuseSimilarQuestion } from '../worker/routes/operationsReviews.js'

function recordingSql(result = []) {
  const calls = []
  const sql = async (parts, ...values) => {
    calls.push({ query: parts.join(' '), values })
    return result
  }
  return { sql, calls }
}

test('forward resolves review, old/new assignments, request, audit and idempotent event in one SQL statement', async () => {
  const { sql, calls } = recordingSql([{ assignment_id: 'assignment-new', event_id: 'event-1' }])

  const rows = await forwardSimilarQuestion(sql, {
    requestId: 'request-1', expertId: 'expert-1', expertName: 'Experta',
    consultationTypeId: 'type-1', candidateCount: 2, actorId: 'admin-1',
  })

  assert.equal(rows[0].assignment_id, 'assignment-new')
  assert.equal(calls.length, 1)
  for (const fragment of [
    'WITH claimed AS', "sr.status = 'pending'", "status = 'similarity_review'",
    'previous_assignment AS', 'INSERT INTO operations.request_assignments',
    'UPDATE operations.requests', "'in_progress'", "notification_status = 'pending_retry'",
    "'forwarded_to_expert'", 'INSERT INTO operations.audit_log',
    'INSERT INTO operations.notification_outbox', "'expert_assigned/' || a.id::TEXT",
    'ON CONFLICT (idempotency_key) DO UPDATE',
  ]) assert.ok(calls[0].query.includes(fragment), `missing SQL fragment: ${fragment}`)
})

test('reuse resolves response, review, assignment, request, audit and idempotent event in one SQL statement', async () => {
  const { sql, calls } = recordingSql([{ response_id: 'response-new', event_id: 'event-2' }])

  const rows = await reuseSimilarQuestion(sql, {
    requestId: 'request-1', responseId: 'response-source', body: 'Respuesta',
    adminNote: 'Nota', actorId: 'admin-1',
  })

  assert.equal(rows[0].response_id, 'response-new')
  assert.equal(calls.length, 1)
  for (const fragment of [
    'WITH claimed AS', "sr.status = 'pending'", "'answer_reused'",
    'response_updated AS', 'response_inserted AS', "'reused_answer'",
    'UPDATE operations.request_assignments', "status = 'completed'",
    'UPDATE operations.requests', "status = 'closed'", 'notification_status =',
    'INSERT INTO operations.audit_log', 'INSERT INTO operations.notification_outbox',
    "'expert_response_approved/' || rw.id::TEXT",
    'ON CONFLICT (idempotency_key) DO UPDATE',
  ]) assert.ok(calls[0].query.includes(fragment), `missing SQL fragment: ${fragment}`)
})

test('a statement failure rejects without issuing follow-up writes', async () => {
  const calls = []
  const sql = async (parts) => {
    calls.push(parts.join(' '))
    throw new Error('database write failed')
  }

  await assert.rejects(forwardSimilarQuestion(sql, {
    requestId: 'request-1', expertId: 'expert-1', expertName: 'Experta',
    consultationTypeId: 'type-1', candidateCount: 1, actorId: 'admin-1',
  }), /database write failed/)
  assert.equal(calls.length, 1)
})
