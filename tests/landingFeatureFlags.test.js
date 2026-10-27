import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../worker/index.js'
import {
  isLandingRequestApi,
  isLandingRequestButtonEnabled,
  isLandingRequestPage,
  LANDING_REQUEST_BUTTON_FLAG,
  isPaymentCheckoutBricksEnabled,
  isPaymentCheckoutBricksConfigured,
  PAYMENT_CHECKOUT_BRICKS_FLAG,
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

test('Checkout Bricks flag defaults to disabled when Flagship is missing or fails', async () => {
  assert.equal(await isPaymentCheckoutBricksEnabled({}), false)
  assert.equal(await isPaymentCheckoutBricksEnabled({
    LANDING_FLAGS: { getBooleanValue: async (_key, fallback) => fallback },
  }), false)
  assert.equal(await isPaymentCheckoutBricksEnabled({
    LANDING_FLAGS: { getBooleanValue: async () => { throw new Error('unavailable') } },
  }), false)
})

test('Checkout Bricks flag reads its independent Flagship boolean', async () => {
  const flags = {
    getBooleanValue: async (key, fallback) => {
      assert.equal(key, PAYMENT_CHECKOUT_BRICKS_FLAG)
      assert.equal(fallback, false)
      return true
    },
  }
  assert.equal(await isPaymentCheckoutBricksEnabled({ LANDING_FLAGS: flags }), true)
})

test('Checkout Bricks requires separate public and access keys before it can be advertised', () => {
  assert.equal(isPaymentCheckoutBricksConfigured({}), false)
  assert.equal(isPaymentCheckoutBricksConfigured({ MP_BRICKS_PUBLIC_KEY: 'pk' }), false)
  assert.equal(isPaymentCheckoutBricksConfigured({ MP_BRICKS_PUBLIC_KEY: 'pk', MP_ACCESS_TOKEN: 'pro' }), false)
  assert.equal(isPaymentCheckoutBricksConfigured({ MP_BRICKS_PUBLIC_KEY: 'pk', MP_BRICKS_ACCESS_TOKEN: 'pro', MP_ACCESS_TOKEN: 'pro' }), false)
  assert.equal(isPaymentCheckoutBricksConfigured({ MP_BRICKS_PUBLIC_KEY: 'pk', MP_BRICKS_ACCESS_TOKEN: 'bricks', MP_ACCESS_TOKEN: 'pro' }), true)
})

test('only the new request routes are gated; landing quote and client feedback remain outside the flag', () => {
  assert.equal(isLandingRequestPage('/solicitud'), true)
  assert.equal(isLandingRequestPage('/solicitud/agente/opaque-token'), true)
  assert.equal(isLandingRequestPage('/solicitud/resultado-pago'), false)
  assert.equal(isLandingRequestPage('/'), false)
  assert.equal(isLandingRequestApi('/api/public/requests'), true)
  assert.equal(isLandingRequestApi('/api/public/request-attribution-token'), true)
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

test('payment return page remains available even if the public request flag is off', async () => {
  const response = await worker.fetch(new Request('https://example.test/solicitud/resultado-pago?payment=success'), mockEnv())
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '/solicitud/resultado-pago')
})

test('request API is unavailable while the flag is off', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/public/requests', { method: 'POST' }), mockEnv())
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Esta función no está disponible.' })
})

test('enabled request page reaches the SPA assets and flag endpoint is never cached', async () => {
  const flags = { getBooleanValue: async () => true }
  const env = mockEnv(flags)
  env.MP_BRICKS_PUBLIC_KEY = 'bricks-public-key'
  env.MP_BRICKS_ACCESS_TOKEN = 'bricks-access-token'
  env.MP_ACCESS_TOKEN = 'pro-access-token'
  const page = await worker.fetch(new Request('https://example.test/solicitud'), env)
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '/solicitud')

  const response = await worker.fetch(new Request('https://example.test/api/public/features'), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { landingRequestButton: true, checkoutMode: 'bricks' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('Bricks is not exposed when Flagship enables it but dedicated credentials are missing', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/public/features'),
    mockEnv({ getBooleanValue: async (key) => key === LANDING_REQUEST_BUTTON_FLAG || key === PAYMENT_CHECKOUT_BRICKS_FLAG }),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { landingRequestButton: true, checkoutMode: 'pro' })
})

test('public feature endpoint defaults checkout to Pro independently from the landing flag', async () => {
  const flags = {
    getBooleanValue: async (key, fallback) => key === LANDING_REQUEST_BUTTON_FLAG ? true : fallback,
  }
  const response = await worker.fetch(new Request('https://example.test/api/public/features'), mockEnv(flags))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { landingRequestButton: true, checkoutMode: 'pro' })
})

test('existing landing path does not depend on Flagship availability', async () => {
  const env = mockEnv({ getBooleanValue: async () => { throw new Error('should not be evaluated') } })
  const response = await worker.fetch(new Request('https://example.test/'), env)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '/')
})
