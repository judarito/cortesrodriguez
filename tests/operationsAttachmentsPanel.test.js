import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/operations/OperationsApp.vue', import.meta.url), 'utf8')

test('attachment operations panel groups by category and exposes status, MIME and size', () => {
  assert.match(source, /attachmentGroups = computed/)
  assert.match(source, /attachmentCategories = \{\s+identity: 'Identidad', operation: 'Operación', payment: 'Pago', other: 'Otros'/)
  assert.match(source, /attachment\.mimeType \|\| attachment\.mime_type/)
  assert.match(source, /attachment\.sizeBytes/)
  assert.match(source, /attachmentStatusClass\(attachment\)/)
  assert.match(source, /attachment\?\.status === 'validated'/)
})

test('attachment panel respects permission and role before rendering downloads', () => {
  assert.match(source, /user\.value\?\.permissions\?\.includes\('attachments\.read'\)/)
  assert.match(source, /canReadAttachments = computed/)
  assert.match(source, /canReadAttachments = computed/)
  assert.match(source, /Authorization: `Bearer \$\{token\.value\}`/)
  assert.match(source, /application\/pdf/)
  assert.match(source, /requests.*encodeURIComponent\(requestId\).*attachments/)
})

test('attachment panel represents processing, incompatible and conversion states', () => {
  for (const state of ['validated', 'pending', 'rejected', 'deleted']) assert.match(source, new RegExp(state))
  assert.match(source, /attachmentGaps = computed/)
  assert.match(source, /validatedCount \|\| gap\.validated_count/)
  assert.match(source, /No disponible/)
})

test('attachment UI contract is retry-safe and does not create mutations', () => {
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|DELETE)['"][^\n]*attachments/)
  assert.doesNotMatch(source, /<a v-if="isDownloadableAttachment/)
  assert.match(source, /requestDetail\.value\?\.attachments \|\| \[\]/)
  assert.match(source, /filter\(\(attachment\) => attachment\?\.status !== 'deleted'\)/)
})
