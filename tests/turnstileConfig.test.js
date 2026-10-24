import test from 'node:test'
import assert from 'node:assert/strict'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'

test('public Turnstile config exposes only a well-formed site key and is not cacheable', async () => {
  const request = new Request('https://dev.example.test/api/public/turnstile-config')
  const valid = await handlePublicRequests(request, {
    TURNSTILE_SITE_KEY: '0x4AAAAAA123456789012345',
    TURNSTILE_SECRET_KEY: 'private-turnstile-secret',
  })
  assert.deepEqual(await valid.json(), { siteKey: '0x4AAAAAA123456789012345', enabled: true })
  assert.equal(valid.headers.get('cache-control'), 'no-store')

  const malformed = await handlePublicRequests(request, {
    TURNSTILE_SITE_KEY: '0x4AAAAAA123456789012345TURNSTILE_SECRET_KEY=private-turnstile-secret',
    TURNSTILE_SECRET_KEY: 'private-turnstile-secret',
  })
  assert.deepEqual(await malformed.json(), { siteKey: '', enabled: false })
})
