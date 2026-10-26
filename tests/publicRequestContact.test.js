import test from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../worker/routes/publicRequests.js'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'

const requiredRequestFields = {
  fullName: 'Ana Ríos',
  legalEntityType: 'natural',
  serviceType: 'importacion',
  consultationType: 'consulta_basica',
  productType: 'mercancias',
  question: 'Necesito orientación para importar mercancías desde otro país.',
}

test('requires a valid email while allowing phone and WhatsApp to remain empty', () => {
  assert.throws(() => validate({ ...requiredRequestFields }), /El correo electrónico es obligatorio/)

  const result = validate({ ...requiredRequestFields, email: 'ana@example.com' })
  assert.equal(result.email, 'ana@example.com')
  assert.equal(result.phone, '')
  assert.equal(result.whatsapp, '')
})

test('still validates optional phone numbers when they are provided', () => {
  assert.throws(() => validate({ ...requiredRequestFields, email: 'ana@example.com', phone: 'abc' }), /El teléfono debe tener/)
})

test('public request input accepts the opaque attribution token without a client agent id', () => {
  const token = 'A'.repeat(43)
  const result = validate({ ...requiredRequestFields, email: 'ana@example.com', attributionToken: token, agentId: 'forged-agent-id' })
  assert.equal(result.agentToken, token)
  assert.equal(Object.hasOwn(result, 'agentId'), false)
})

test('request creation rejects missing attribution even when a client agentId is supplied', async () => {
  const response = await handlePublicRequests(new Request('https://example.test/api/public/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...requiredRequestFields, email: 'ana@example.com', agentId: 'forged-agent-id' }),
  }), { NEON_DATABASE_URL: 'postgres://unused' })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /enlace de origen no es válido/i)
})
