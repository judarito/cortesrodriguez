import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationDescription, shouldNotifyClient } from '../worker/routes/operationsEmail.js'

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
