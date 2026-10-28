import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { serializeRequest } from '../worker/routes/operationsData.js'

test('request list and detail resolve the agent only from verified agent_id', async () => {
  const source = await readFile(new URL('../worker/routes/operationsData.js', import.meta.url), 'utf8')
  const agentJoins = source.match(/LEFT JOIN operations\.users u ON u\.id = r\.agent_id/g) || []

  assert.equal(agentJoins.length, 2)
  assert.doesNotMatch(source, /COALESCE\(r\.agent_id,\s*r\.created_by\)/)
})

test('direct request does not present its creator as the originating agent', () => {
  const item = serializeRequest({
    id: 'request-1',
    reference: 'CRA-20261027-ABC123',
    source: 'landingpage',
    source_channel: 'direct_web',
    created_by: 'admin-user-id',
    agent_name: null,
    agent_email: null,
  })

  assert.equal(item.sourceChannel, 'direct_web')
  assert.equal(item.agentName, '')
  assert.equal(item.agentEmail, '')
  assert.equal(Object.hasOwn(item, 'createdBy'), false)
})

test('agent-linked request keeps the verified agent label', () => {
  const item = serializeRequest({
    id: 'request-2',
    reference: 'CRA-20261027-DEF456',
    source: 'agent',
    source_channel: 'agent_link',
    agent_name: 'Agente verificado',
    agent_email: 'agent@example.test',
  })

  assert.equal(item.sourceChannel, 'agent_link')
  assert.equal(item.agentName, 'Agente verificado')
  assert.equal(item.agentEmail, 'agent@example.test')
})

test('administrative requests keep a distinct origin and do not inherit an admin as agent', () => {
  const item = serializeRequest({
    id: 'request-3',
    reference: 'CRA-20261027-GHI789',
    source: 'agent',
    source_channel: 'admin_entry',
    created_by: 'admin-user-id',
    agent_name: null,
    agent_email: null,
  })

  assert.equal(item.sourceChannel, 'admin_entry')
  assert.equal(item.source, 'Administración')
  assert.equal(item.agentName, '')
  assert.equal(item.agentEmail, '')
})
