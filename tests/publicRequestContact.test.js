import test from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../worker/routes/publicRequests.js'

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
