import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectImage } from '../worker/routes/publicRequests.js'

function minimalPng(width = 1, height = 1) {
  const bytes = new Uint8Array(45)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(bytes.buffer).setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes.set([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44], 33)
  return bytes
}

test('accepts supported image signatures with bounded dimensions', () => {
  assert.deepEqual(inspectImage(minimalPng(800, 600)), { type: 'image/png', width: 800, height: 600 })
})

test('rejects malformed images and oversized image dimensions', () => {
  assert.equal(inspectImage(new TextEncoder().encode('<svg></svg>')), null)
  assert.equal(inspectImage(minimalPng(12000, 12000)), null)
  const malformed = minimalPng()
  malformed[12] = 0
  assert.equal(inspectImage(malformed), null)
})
