import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationCopy, notificationVisibilityFilter, requestUpdateRecipientIds, roleAudiences, roleRecipientIds } from '../worker/routes/appNotifications.js'
import { assignedExpertRecipient } from '../worker/routes/operationsEmail.js'

test('notification copy is tailored by role and contains no client identity', () => {
  const copy = notificationCopy('expert_response_approved', 'CRA-20261024-123ABC')
  assert.notEqual(copy.admin.message, copy.agent.message)
  assert.notEqual(copy.agent.message, copy.expert.message)
  for (const message of Object.values(copy)) {
    assert.match(message.message, /CRA-20261024-123ABC/)
    assert.doesNotMatch(message.message.split(': ').slice(1).join(': '), /@|\+?\d{7,}/)
  }
})

test('expert-facing messages do not expose customer data', () => {
  const copy = notificationCopy('request_created', 'CRA-20261024-123ABC')
  assert.equal(copy.expert.message, 'CRA-20261024-123ABC: tienes una pregunta disponible para responder.')
  assert.doesNotMatch(copy.expert.message, /cliente|nombre|correo|teléfono/i)
})

test('agent notifications are limited to requests attributed to the agent', () => {
  const agentRequest = roleAudiences('payment_approved', { source_channel: 'agent_link', source: 'agent', agent_id: 'agent-id', assigned_expert_id: 'expert-id' })
  const directRequest = roleAudiences('payment_approved', { source_channel: 'direct_web', source: 'direct_web', agent_id: null, assigned_expert_id: 'expert-id' })
  assert.equal(agentRequest.agent, true)
  assert.equal(directRequest.agent, false)
  assert.equal(agentRequest.expert, true)
  assert.equal(roleAudiences('payment_rejected', { source_channel: 'agent_link', source: 'agent', agent_id: 'agent-id' }).agent, false)
})

test('expert notification recipients are only the expert assigned to that request', () => {
  const request = { source_channel: 'direct_web', assigned_expert_id: 'expert-assigned', consultationTypeExpertIds: ['expert-assigned', 'expert-other'] }
  assert.deepEqual(roleRecipientIds('request_created', request), { agentId: null, expertId: 'expert-assigned' })
  assert.deepEqual(roleRecipientIds('assignment_failed', { ...request, assigned_expert_id: null }), { agentId: null, expertId: null })
  assert.equal(assignedExpertRecipient({ assigned_expert_id: 'expert-assigned', expert_email: 'assigned@example.com' }), 'assigned@example.com')
  assert.equal(assignedExpertRecipient({ assigned_expert_id: null, expert_email: 'stale@example.com' }), null)
})

test('request realtime updates target the originating agent and only the assigned expert', () => {
  const agentRequest = requestUpdateRecipientIds({ source_channel: 'agent_link', agent_id: 'agent-1', assigned_expert_id: 'expert-1', eligibleExpertIds: ['expert-1', 'expert-2'] })
  assert.deepEqual(agentRequest, { agentId: 'agent-1', expertId: 'expert-1' })
  assert.deepEqual(requestUpdateRecipientIds({ source_channel: 'direct_web', agent_id: 'agent-1', assigned_expert_id: null }), { agentId: null, expertId: null })
})

test('notification API scopes expert history to current role and current assignment', () => {
  const sql = (parts, ...values) => ({ text: parts.join('?'), values })
  const filter = notificationVisibilityFilter(sql, 'expert-current')
  assert.match(filter.text, /audience_role = 'expert'/)
  assert.match(filter.text, /role\.name = 'expert'/)
  assert.match(filter.text, /r\.assigned_expert_id = \?/)
  assert.ok(filter.values.includes('expert-current'))
})
