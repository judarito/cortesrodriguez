import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationDescription, notificationPolicyForPayment, shouldNotifyClient } from '../worker/routes/operationsEmail.js'

test('always includes the client in payment approval notifications', () => {
  assert.equal(shouldNotifyClient('payment_approved', ['admin', 'expert']), true)
})

test('keeps client notifications audience-controlled for other events', () => {
  assert.equal(shouldNotifyClient('request_created', ['admin', 'expert']), false)
  assert.equal(shouldNotifyClient('request_created', ['client']), true)
  assert.equal(shouldNotifyClient('request_created', ['all_involved']), true)
})

test('payment approval message confirms receipt and promises follow-up', () => {
  const message = notificationDescription('payment_approved')
  assert.match(message, /confirmamos el pago/i)
  assert.match(message, /pronto te contactaremos/i)
})

test('unpaid or failed payment notifications are restricted to administrators', () => {
  assert.deepEqual(notificationPolicyForPayment('payment_rejected', true, false), { send: true, adminOnly: true, reason: null })
  assert.deepEqual(notificationPolicyForPayment('request_created', true, false), { send: true, adminOnly: true, reason: null })
})

test('payment approval cannot be notified unless the required payment is confirmed', () => {
  assert.deepEqual(notificationPolicyForPayment('payment_approved', true, false), { send: false, adminOnly: false, reason: 'payment_required' })
  assert.deepEqual(notificationPolicyForPayment('payment_approved', false, false), { send: false, adminOnly: false, reason: 'payment_required' })
  assert.deepEqual(notificationPolicyForPayment('payment_approved', true, true), { send: true, adminOnly: false, reason: null })
})
