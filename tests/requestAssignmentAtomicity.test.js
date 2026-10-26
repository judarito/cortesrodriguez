import test from 'node:test'
import assert from 'node:assert/strict'
import { assignRequestExpert } from '../worker/routes/operationsData.js'

const assignmentId = '11111111-1111-4111-8111-111111111111'
const outboxId = '22222222-2222-4222-8222-222222222222'

function setupSql({ failAtomic = false } = {}) {
  const calls = []
  let committed = false
  const sql = async (parts, ...values) => {
    const query = parts.join(' ')
    calls.push({ query, values })
    if (query.includes('SELECT id, consultation_type_id, assigned_expert_id, status FROM operations.requests')) {
      return [{ id: 'request-1', consultation_type_id: 'consultation-1', assigned_expert_id: 'old-expert', status: 'pending' }]
    }
    if (query.includes('FROM operations.expert_responses WHERE')) return []
    if (query.includes('FROM operations.users u') && query.includes('consultation_type_experts')) {
      return [{ id: 'new-expert', full_name: 'Nuevo experto' }]
    }
    if (query.includes('WITH locked_request AS MATERIALIZED')) {
      if (failAtomic) throw new Error('database write failed')
      committed = true
      return [{ id: assignmentId }]
    }
    if (query.includes('FROM operations.notification_outbox')) return [{ id: outboxId }]
    if (query.includes('UPDATE operations.notification_outbox') && query.includes('RETURNING id')) return [{ id: outboxId }]
    return []
  }
  return { sql, calls, isCommitted: () => committed }
}

function makeRequest() {
  return new Request('https://example.test/api/app/requests/request-1/assignment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expertId: 'new-expert', reason: 'Cobertura de vacaciones' }),
  })
}

test('admin reassignment writes assignment history, request pointer, and audit in one atomic statement, then publishes', async () => {
  const db = setupSql()
  let queuePublished = false
  const env = {
    NOTIFICATION_EVENTS_QUEUE: {
      async send(message) {
        assert.equal(db.isCommitted(), true, 'queue publication must follow the committed SQL statement')
        assert.deepEqual(message, { eventId: outboxId })
        queuePublished = true
      },
    },
  }

  const result = await assignRequestExpert(db.sql, makeRequest(), 'request-1', { sub: 'admin-1' }, env)
  const atomicWrite = db.calls.find(({ query }) => query.includes('WITH locked_request AS MATERIALIZED'))
  assert.ok(atomicWrite)
  assert.match(atomicWrite.query, /UPDATE operations\.request_assignments/)
  assert.match(atomicWrite.query, /INSERT INTO operations\.request_assignments/)
  assert.match(atomicWrite.query, /UPDATE operations\.requests/)
  assert.match(atomicWrite.query, /INSERT INTO operations\.audit_log/)
  assert.match(atomicWrite.query, /FOR UPDATE/)
  assert.match(atomicWrite.query, /previousExpertId/)
  assert.deepEqual(atomicWrite.values.slice(0, 2), ['request-1', 'new-expert'])
  assert.ok(db.calls.find(({ query, values }) => query.includes('FROM operations.notification_outbox')
    && values.includes(`expert_assigned/${assignmentId}`)), 'outbox lookup retains the trigger key derived from assignment id')
  assert.equal(queuePublished, true)
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { ok: true, expert: { id: 'new-expert', name: 'Nuevo experto' } })
})

test('a failed atomic write does not publish an assignment event', async () => {
  const db = setupSql({ failAtomic: true })
  let queuePublished = false
  const env = { NOTIFICATION_EVENTS_QUEUE: { async send() { queuePublished = true } } }

  await assert.rejects(
    assignRequestExpert(db.sql, makeRequest(), 'request-1', { sub: 'admin-1' }, env),
    /database write failed/,
  )
  assert.equal(queuePublished, false)
  assert.equal(db.calls.some(({ query }) => query.includes('FROM operations.notification_outbox')), false)
})
