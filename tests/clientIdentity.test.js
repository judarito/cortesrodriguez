import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeClientEmail } from '../worker/lib/clientIdentity.js'

test('normalizes customer email for case-insensitive identity matching', () => {
  assert.equal(normalizeClientEmail('  Ana.Rios@Example.COM  '), 'ana.rios@example.com')
  assert.equal(normalizeClientEmail('   '), null)
  assert.equal(normalizeClientEmail(null), null)
})
