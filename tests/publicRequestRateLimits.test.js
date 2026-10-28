import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'

test('attribution token issuance fails closed without Cloudflare IP or pseudonymization secret', async () => {
  const url = 'https://example.test/api/public/request-start'
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

test('retired attribution endpoint does not issue tokens', async () => {
  const response = await handlePublicRequests(new Request('https://example.test/api/public/request-attribution-token'), {})
  assert.equal(response.status, 404)
})

test('current token issuer enforces its limit and persists only the hash of a valid token', async () => {
  const originalFetch = globalThis.fetch
  const queries = []
  let count = 21
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    queries.push(payload)
    return new Response(JSON.stringify({
      fields: [{ name: 'request_count', dataTypeID: 23 }],
      rows: payload.query.includes('WITH expired_rate_rows') ? [[String(count)]] : [],
    }), { headers: { 'content-type': 'application/json' } })
  }
  const env = { NEON_DATABASE_URL: 'postgres://test:test@ep-test.neon.tech/db', PUBLIC_RATE_LIMIT_SECRET: 'test-only' }
  const request = () => new Request('https://example.test/api/public/request-start', {
    headers: { 'CF-Connecting-IP': '203.0.113.10', accept: 'application/json' },
  })
  try {
    assert.equal((await handlePublicRequests(request(), env)).status, 429)
    assert.equal(queries.some(({ query }) => query.startsWith('INSERT INTO operations.public_request_attribution_tokens')), false)
    count = 1
    const response = await handlePublicRequests(request(), env)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const result = await response.json()
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(result.type, 'direct_web')
    const insertion = queries.find(({ query }) => query.startsWith('INSERT INTO operations.public_request_attribution_tokens'))
    assert.ok(insertion)
    assert.equal(JSON.stringify(insertion).includes(result.token), false)
    assert.match(insertion.query, /INTERVAL '2 hours'/)
  } finally { globalThis.fetch = originalFetch }
})
