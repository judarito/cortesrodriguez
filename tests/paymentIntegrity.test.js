import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { matchesExpectedPayment, paymentMatchReason, verifyMercadoPagoWebhookSignature } from '../worker/routes/publicRequests.js'

const secret = 'dev-webhook-secret-for-unit-tests'

function signatureFor(dataId, requestId, timestamp = '1782259200') {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`
  const digest = createHmac('sha256', secret).update(manifest).digest('hex')
  return `ts=${timestamp},v1=${digest}`
}

test('accepts only a valid Mercado Pago webhook signature for the signed event', async () => {
  const id = '987654321'
  const requestId = 'mp-request-id'
  assert.equal(await verifyMercadoPagoWebhookSignature(signatureFor(id, requestId), requestId, id, secret), true)
  assert.equal(await verifyMercadoPagoWebhookSignature(signatureFor(id, requestId), 'different-request', id, secret), false)
  assert.equal(await verifyMercadoPagoWebhookSignature(signatureFor(id, requestId), requestId, 'different-id', secret), false)
  assert.equal(await verifyMercadoPagoWebhookSignature('', requestId, id, secret), false)
})

test('matches payment reference, preference, currency and exact expected COP amount', () => {
  const record = { mercado_pago_preference_id: 'pref-1', cop_amount_cents: 125000 }
  const payment = { external_reference: 'CRA-20261024-A1B2C3', preference_id: 'pref-1', currency_id: 'COP', transaction_amount: 1250 }
  assert.equal(matchesExpectedPayment(payment, 'CRA-20261024-A1B2C3', record), true)
  assert.equal(matchesExpectedPayment({ ...payment, transaction_amount: 1250.01 }, 'CRA-20261024-A1B2C3', record), false)
  assert.equal(matchesExpectedPayment({ ...payment, currency_id: 'USD' }, 'CRA-20261024-A1B2C3', record), false)
  assert.equal(matchesExpectedPayment({ ...payment, preference_id: 'other-pref' }, 'CRA-20261024-A1B2C3', record), false)
  assert.equal(matchesExpectedPayment({ ...payment, preference_id: undefined }, 'CRA-20261024-A1B2C3', record), true)
  assert.equal(matchesExpectedPayment({ ...payment, external_reference: 'other-request' }, 'CRA-20261024-A1B2C3', record), false)
})

test('diagnoses the specific payment mismatch without accepting non-approved states', () => {
  const record = { reference: 'CRA-20261024-A1B2C3', mercado_pago_preference_id: 'pref-1', cop_amount_cents: 125000 }
  const payment = { id: 123, external_reference: record.reference, preference_id: 'pref-1', currency_id: 'COP', transaction_amount: 1250, status: 'approved' }
  assert.equal(paymentMatchReason(payment, record), null)
  assert.equal(paymentMatchReason({ ...payment, external_reference: 'other' }, record), 'reference_mismatch')
  assert.equal(paymentMatchReason({ ...payment, preference_id: 'other' }, record), 'preference_mismatch')
  assert.equal(paymentMatchReason({ ...payment, preference_id: undefined }, record), null)
  assert.equal(paymentMatchReason({ ...payment, currency_id: 'USD' }, record), 'currency_mismatch')
  assert.equal(paymentMatchReason({ ...payment, transaction_amount: 1 }, record), 'amount_mismatch')
  assert.equal(paymentMatchReason({ ...payment, status: 'pending' }, record), 'payment_not_approved')
})
