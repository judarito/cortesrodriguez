import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../worker/index.js'
import {
  isLandingRequestApi,
  isLandingRequestButtonEnabled,
  isLandingRequestPage,
  LANDING_REQUEST_BUTTON_FLAG,
} from '../worker/lib/landingFeatureFlags.js'

function mockEnv(flags) {
  return {
    LANDING_FLAGS: flags,
    ASSETS: {
      fetch: async (request) => new Response(new URL(request.url).pathname),
    },
  }
}

test('feature flag falls back to disabled when binding is missing or errors', async () => {
  assert.equal(await isLandingRequestButtonEnabled({}), false)
  assert.equal(await isLandingRequestButtonEnabled({
    LANDING_FLAGS: { getBooleanValue: async (_key, fallback) => fallback },
  }), false)
  assert.equal(await isLandingRequestButtonEnabled({
    LANDING_FLAGS: { getBooleanValue: async () => { throw new Error('unavailable') } },
  }), false)
})

test('feature flag reads the expected Flagship boolean and preserves enabled state', async () => {
  const flags = {
    getBooleanValue: async (key, fallback) => {
      assert.equal(key, LANDING_REQUEST_BUTTON_FLAG)
      assert.equal(fallback, false)
      return true
    },
  }
  assert.equal(await isLandingRequestButtonEnabled({ LANDING_FLAGS: flags }), true)
})

test('only the new request routes are gated; landing quote and client feedback remain outside the flag', () => {
  assert.equal(isLandingRequestPage('/solicitud'), true)
  assert.equal(isLandingRequestPage('/solicitud/agente/opaque-token'), true)
  assert.equal(isLandingRequestPage('/'), false)
  assert.equal(isLandingRequestApi('/api/public/requests'), true)
  assert.equal(isLandingRequestApi('/api/public/agent-links/token'), true)
  assert.equal(isLandingRequestApi('/api/public/feedback'), false)
  assert.equal(isLandingRequestApi('/api/quote-requests'), false)
})

test('request page falls back to the existing landing URL while the flag is off', async () => {
  const response = await worker.fetch(new Request('https://example.test/solicitud'), mockEnv())
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://example.test/')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('request API is unavailable while the flag is off', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/public/requests', { method: 'POST' }), mockEnv())
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Esta función no está disponible.' })
})

test('enabled request page reaches the SPA assets and flag endpoint is never cached', async () => {
  const flags = { getBooleanValue: async () => true }
  const env = mockEnv(flags)
  const page = await worker.fetch(new Request('https://example.test/solicitud'), env)
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '/solicitud')

  const response = await worker.fetch(new Request('https://example.test/api/public/features'), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { landingRequestButton: true })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('existing landing path does not depend on Flagship availability', async () => {
  const env = mockEnv({ getBooleanValue: async () => { throw new Error('should not be evaluated') } })
  const response = await worker.fetch(new Request('https://example.test/'), env)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '/')
})
