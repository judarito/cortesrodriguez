import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'

test('attribution token issuance fails closed without Cloudflare IP or pseudonymization secret', async () => {
  const url = 'https://example.test/api/public/request-attribution-token'
  const withoutCloudflareIp = await handlePublicRequests(new Request(url, {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  }), { NEON_DATABASE_URL: 'postgres://unused' })
  assert.equal(withoutCloudflareIp.status, 503)

  const withoutSecret = await handlePublicRequests(new Request(url, {
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
  }), { NEON_DATABASE_URL: 'postgres://unused' })
  assert.equal(withoutSecret.status, 503)
})

test('public request POST rejects a missing attribution token before rate-limit database work', async () => {
  const request = new Request('https://example.test/api/public/requests', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.10', 'content-type': 'application/json' },
    body: '{}',
  })
  const response = await handlePublicRequests(request, {
    NEON_DATABASE_URL: 'postgres://unused',
    PUBLIC_RATE_LIMIT_SECRET: 'test-secret',
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /enlace de origen no es válido/i)
})

test('rate limit cleanup selects at most 100 expired rows in index order', async () => {
  const route = await readFile(new URL('../worker/routes/publicRequests.js', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../worker/db/migrations/035_public_request_rate_limits.sql', import.meta.url), 'utf8')
  const cleanupSql = route.slice(route.indexOf('WITH expired_rate_rows'), route.indexOf('RETURNING request_count'))

  assert.match(cleanupSql, /FROM operations\.public_request_rate_limits[\s\S]*?ORDER BY window_started_at[\s\S]*?LIMIT 100/)
  assert.match(cleanupSql, /FROM operations\.public_request_attribution_tokens[\s\S]*?ORDER BY expires_at, id[\s\S]*?LIMIT 100/)
  assert.match(migration, /ON operations\.public_request_rate_limits\(window_started_at\)/)
  assert.match(migration, /ON operations\.public_request_attribution_tokens\(expires_at, id\)[\s\S]*?WHERE attribution_type = 'direct_web'/)
  assert.match(cleanupSql, /ON CONFLICT \(ip_hash, action\) DO UPDATE/)
})
