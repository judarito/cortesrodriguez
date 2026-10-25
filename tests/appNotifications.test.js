import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationCopy, roleAudiences, roleRecipientIds } from '../worker/routes/appNotifications.js'
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
