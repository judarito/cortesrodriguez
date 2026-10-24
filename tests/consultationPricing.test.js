import test from 'node:test'
import assert from 'node:assert/strict'
import { fromMinorUnits, toMinorUnits } from '../src/operations/consultationPricing.js'

test('converts admin prices from currency units to minor units for the API', () => {
  assert.equal(toMinorUnits(10), 1000)
  assert.equal(toMinorUnits(15), 1500)
  assert.equal(toMinorUnits(10.25), 1025)
})

test('converts API prices from minor units to currency units for editing', () => {
  assert.equal(fromMinorUnits(1000), 10)
  assert.equal(fromMinorUnits(1500), 15)
})
