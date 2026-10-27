import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  bricksChargeAllowed,
  bricksIntentResponse,
  bricksProcessResponse,
  buildBricksProviderPayload,
  classifyBricksPaymentSearch,
  createClientBricksPaymentIntent,
  findBricksPaymentByAttempt,
  getBricksPublicKey,
  getPaymentAccessToken,
  getProviderPaymentById,
  handlePublicRequests,
  isBricksPaymentBoundToAttempt,
  paymentMatchReason,
  processClientBricksPayment,
  recoverClientBricksPayment,
  resolveWebhookPaymentCredential,
  selectPaymentAttemptCandidate,
  searchPaymentsForModes,
  stableBricksIdempotencyKey,
  validateBricksPaymentInput,
} from '../worker/routes/publicRequests.js'

const attemptId = '2efcc558-5054-4c68-a49a-77f1a730c6a7'
const otherAttemptId = '671b1bfd-c8d3-48ec-b647-a14345db69e4'
const reference = 'CRA-20261027-A1B2C3'
const payerEmail = 'cliente@example.com'

test('intent is closed by default when the server-side feature flag is missing or errors', async () => {
  const request = new Request('https://example.test/api/public/payments/bricks/intent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, submissionToken: attemptId, idempotencyKey: otherAttemptId }),
  })
  const unavailable = await handlePublicRequests(request, { NEON_DATABASE_URL: 'unused' })
  assert.equal(unavailable.status, 404)

  const failingFlag = await handlePublicRequests(request.clone(), {
    NEON_DATABASE_URL: 'unused',
    LANDING_FLAGS: { getBooleanValue: async () => { throw new Error('flag provider error') } },
  })
  assert.equal(failingFlag.status, 404)
})

test('Bricks credentials never fall back to the Pro token or public key', async () => {
  const env = { MP_ACCESS_TOKEN: 'APP_USR-pro-test', MP_PUBLIC_KEY: 'APP_USR-pro-public' }
  assert.equal(getPaymentAccessToken(env, 'bricks'), null)
  assert.equal(getBricksPublicKey(env), null)
  assert.equal(getPaymentAccessToken(env, 'pro'), 'APP_USR-pro-test')
  assert.equal(getPaymentAccessToken({ ...env, MP_BRICKS_ACCESS_TOKEN: 'TEST-bricks' }, 'bricks'), 'TEST-bricks')
  assert.equal(getPaymentAccessToken({ MP_ACCESS_TOKEN: 'APP_USR-pro-test', MP_BRICKS_ACCESS_TOKEN: 'APP_USR-pro-test' }, 'bricks'), null)
  assert.equal(getBricksPublicKey({ MP_PUBLIC_KEY: 'APP_USR-pro-public', MP_BRICKS_PUBLIC_KEY: 'TEST-public' }), 'TEST-public')
  assert.equal(getBricksPublicKey({ MP_PUBLIC_KEY: 'same-key', MP_BRICKS_PUBLIC_KEY: 'same-key' }), null)
  assert.equal(getPaymentAccessToken({ MP_BRICKS_ACCESS_TOKEN: '   ', MP_ACCESS_TOKEN: 'APP_USR-pro-test' }, 'bricks'), null)

  const request = new Request('https://example.test/api/client/payments/bricks/intent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, idempotencyKey: otherAttemptId }),
  })
  const response = await createClientBricksPaymentIntent(request, {
    ...env,
    NEON_DATABASE_URL: 'unused',
    LANDING_FLAGS: { getBooleanValue: async () => true },
  }, payerEmail)
  assert.equal(response.status, 503)

  const processRequest = new Request('https://example.test/api/public/payments/bricks/process', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attemptId, token: 'provider-token', payment_method_id: 'visa', installments: 1, payer: { email: payerEmail } }),
  })
  const processResponse = await handlePublicRequests(processRequest, {
    NEON_DATABASE_URL: 'unused', MP_ACCESS_TOKEN: 'APP_USR-pro-test', MP_PUBLIC_KEY: 'APP_USR-pro-public',
  })
  assert.equal(processResponse.status, 503)
})

test('Bricks intent response uses only the dedicated public key and preserves locale', () => {
  const response = bricksIntentResponse({ id: attemptId, cop_amount_cents: 1234500 }, 'TEST-bricks-public', 'en')
  assert.equal(response.status, 200)
  return response.json().then((body) => {
    assert.deepEqual(body, {
      attemptId,
      publicKey: 'TEST-bricks-public',
      amountCents: 1234500,
      currency: 'COP',
      locale: 'en-US',
    })
  })
})

test('payment GET uses the credential selected by checkout mode and Brick has no Pro fallback', async () => {
  const originalFetch = globalThis.fetch
  const authorizationHeaders = []
  globalThis.fetch = async (_url, options) => {
    authorizationHeaders.push(options.headers.get('authorization'))
    return new Response(JSON.stringify({ id: '987654321', status: 'pending' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await getProviderPaymentById('987654321', 'bricks', {
      MP_ACCESS_TOKEN: 'APP_USR-pro', MP_BRICKS_ACCESS_TOKEN: 'TEST-bricks',
    })
    assert.equal(result.id, '987654321')
    await getProviderPaymentById('987654321', 'pro', { MP_ACCESS_TOKEN: 'APP_USR-pro' })
    await assert.rejects(getProviderPaymentById('987654321', 'bricks', { MP_ACCESS_TOKEN: 'APP_USR-pro' }), /Missing bricks payment credential/)
    assert.deepEqual(authorizationHeaders, ['Bearer TEST-bricks', 'Bearer APP_USR-pro'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uncertain Brick recovery search uses only MP_BRICKS_ACCESS_TOKEN', async () => {
  const originalFetch = globalThis.fetch
  const authorizationHeaders = []
  globalThis.fetch = async (_url, options) => {
    authorizationHeaders.push(options.headers.get('authorization'))
    return new Response(JSON.stringify({
      results: [{
        id: '987654321', external_reference: reference,
        metadata: { cra_payment_attempt_id: attemptId },
      }],
      paging: { total: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const attempt = { id: attemptId, reference }
  try {
    const found = await findBricksPaymentByAttempt(attempt, {
      MP_ACCESS_TOKEN: 'APP_USR-pro-test', MP_BRICKS_ACCESS_TOKEN: 'TEST-bricks',
    })
    assert.deepEqual(found, { state: 'found', paymentId: '987654321' })
    assert.deepEqual(authorizationHeaders, ['Bearer TEST-bricks'])
    await assert.rejects(findBricksPaymentByAttempt(attempt, { MP_ACCESS_TOKEN: 'APP_USR-pro-test' }), /credential/i)
    assert.deepEqual(authorizationHeaders, ['Bearer TEST-bricks'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('list/admin provider searches use each mode token and report missing Brick credentials without fallback', async () => {
  const originalFetch = globalThis.fetch
  const authorizationHeaders = []
  globalThis.fetch = async (_url, options) => {
    authorizationHeaders.push(options.headers.get('authorization'))
    return new Response(JSON.stringify({ results: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const both = await searchPaymentsForModes(reference, {
      MP_ACCESS_TOKEN: 'APP_USR-pro-test', MP_BRICKS_ACCESS_TOKEN: 'TEST-bricks',
    }, ['bricks', 'pro'])
    assert.deepEqual(authorizationHeaders, ['Bearer TEST-bricks', 'Bearer APP_USR-pro-test'])
    assert.deepEqual(both.unavailableModes, [])
    authorizationHeaders.length = 0

    const noBrick = await searchPaymentsForModes(reference, { MP_ACCESS_TOKEN: 'APP_USR-pro-test' }, ['bricks', 'pro'])
    assert.deepEqual(authorizationHeaders, ['Bearer APP_USR-pro-test'])
    assert.deepEqual(noBrick.unavailableModes, ['bricks'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('webhook payment lookup accepts only the response fetched with its attempt mode credential', () => {
  const candidates = [
    { id: otherAttemptId, reference, checkout_mode: 'pro', mercado_pago_preference_id: 'pref-pro', cop_amount_cents: 2_000_000 },
    { id: attemptId, reference, checkout_mode: 'bricks', mercado_pago_preference_id: null, cop_amount_cents: 6_316_900 },
  ]
  const bricksPayment = {
    id: '987654321', external_reference: reference,
    metadata: { cra_payment_attempt_id: attemptId }, transaction_amount: 63_169, currency_id: 'COP',
  }
  const proPayment = {
    id: '987654321', external_reference: reference,
    preference_id: 'pref-pro', transaction_amount: 20_000, currency_id: 'COP',
  }

  assert.equal(resolveWebhookPaymentCredential([{ payment: bricksPayment, providerMode: 'pro' }], candidates, bricksPayment.id), null)
  assert.equal(resolveWebhookPaymentCredential([{ payment: bricksPayment, providerMode: 'bricks' }], candidates, bricksPayment.id).attempt.id, attemptId)
  assert.equal(resolveWebhookPaymentCredential([{ payment: proPayment, providerMode: 'bricks' }], candidates, proPayment.id), null)
  assert.equal(resolveWebhookPaymentCredential([{ payment: proPayment, providerMode: 'pro' }], candidates, proPayment.id).attempt.id, otherAttemptId)
})

test('portal helpers are exported and require the authenticated email for their ownership-scoped SQL paths', async () => {
  assert.equal(typeof createClientBricksPaymentIntent, 'function')
  assert.equal(typeof processClientBricksPayment, 'function')
  assert.equal(typeof recoverClientBricksPayment, 'function')
  const route = await readFile(new URL('../worker/routes/publicRequests.js', import.meta.url), 'utf8')
  assert.match(route, /export async function createClientBricksPaymentIntent\(request, env, verifiedEmail\)/)
  assert.match(route, /export async function processClientBricksPayment\(request, env, verifiedEmail\)/)
  assert.match(route, /export async function recoverClientBricksPayment\(request, env, verifiedEmail\)/)
  assert.match(route, /lower\(trim\(request\.email\)\) = \$\{verifiedEmail\}/)
  assert.match(route, /lower\(trim\(request\.email\)\) = \$\{email\}/)
})

test('Bricks input validates only bounded payment fields and never accepts client amount as authority', () => {
  const valid = validateBricksPaymentInput({
    attemptId, token: 'opaque-provider-token', payment_method_id: 'visa', installments: 3,
    payer: { email: payerEmail }, amountCents: 1, reference: 'forged-reference',
  })
  assert.equal(valid.attemptId, attemptId)
  assert.equal(valid.payerEmail, payerEmail)
  assert.equal(validateBricksPaymentInput({ attemptId, token: 'x'.repeat(4097), payment_method_id: 'visa', installments: 1, payer: { email: payerEmail } }), null)
  assert.equal(validateBricksPaymentInput({ attemptId, token: 'token', payment_method_id: 'visa', installments: 0, payer: { email: payerEmail } }), null)
  assert.equal(validateBricksPaymentInput({ attemptId, token: 'token', payment_method_id: 'visa', installments: 1, payer: { email: 'bad' } }), null)

  const attempt = { id: attemptId, reference, cop_amount_cents: 6_316_900, email: payerEmail }
  const payload = buildBricksProviderPayload(attempt, valid, 'https://example.test/api/public/payments/webhook')
  assert.equal(payload.transaction_amount, 63_169)
  assert.equal(payload.external_reference, reference)
  assert.equal(payload.payer.email, payerEmail)
  assert.deepEqual(payload.metadata, { cra_payment_attempt_id: attemptId })
  assert.equal('amountCents' in payload, false)
  assert.equal('reference' in payload, false)
})

test('two local attempts sharing one request reference resolve by provider metadata, never recency', () => {
  const attempts = [
    { id: otherAttemptId, reference, mercado_pago_preference_id: null, cop_amount_cents: 2_000_000 },
    { id: attemptId, reference, mercado_pago_preference_id: null, cop_amount_cents: 6_316_900 },
  ]
  const providerPayment = {
    id: '123456789', external_reference: reference, currency_id: 'COP',
    transaction_amount: 63_169, status: 'approved', metadata: { cra_payment_attempt_id: attemptId },
  }

  const selected = selectPaymentAttemptCandidate(attempts, providerPayment)
  assert.equal(selected.id, attemptId)
  assert.equal(isBricksPaymentBoundToAttempt(providerPayment, attemptId), true)
  assert.equal(isBricksPaymentBoundToAttempt({ ...providerPayment, metadata: {} }, attemptId), false)
  assert.equal(paymentMatchReason(providerPayment, selected), null)
  assert.equal(selectPaymentAttemptCandidate(attempts, { ...providerPayment, metadata: {} }), null)
  assert.equal(selectPaymentAttemptCandidate(attempts, { ...providerPayment, metadata: { cra_payment_attempt_id: otherAttemptId } }).id, otherAttemptId)
  assert.equal(paymentMatchReason({ ...providerPayment, transaction_amount: 20_000 }, selected), 'amount_mismatch')
  assert.equal(paymentMatchReason({ ...providerPayment, currency_id: 'USD' }, selected), 'currency_mismatch')
})

test('provider idempotency key is stable per attempt and checkout-off blocks only new charges', () => {
  assert.equal(stableBricksIdempotencyKey(attemptId), stableBricksIdempotencyKey(attemptId))
  assert.notEqual(stableBricksIdempotencyKey(attemptId), stableBricksIdempotencyKey(otherAttemptId))
  assert.equal(bricksChargeAllowed(false, { provider_submission_started_at: null }), false)
  assert.equal(bricksChargeAllowed(false, { provider_submission_started_at: '2026-10-27T12:00:00Z' }), true)
  assert.equal(bricksChargeAllowed(true, { mercado_pago_payment_id: null }), true)
})

test('rollback recovery requires exhaustive provider search and matches the unique attempt metadata', () => {
  const attempt = { id: attemptId, reference }
  const payment = { id: '123456789', external_reference: reference, metadata: { cra_payment_attempt_id: attemptId } }
  assert.deepEqual(classifyBricksPaymentSearch(attempt, [payment], 8), { state: 'found', paymentId: '123456789' })
  assert.deepEqual(classifyBricksPaymentSearch(attempt, [{ ...payment, metadata: { cra_payment_attempt_id: otherAttemptId } }], 1), { state: 'not_found' })
  assert.deepEqual(classifyBricksPaymentSearch(attempt, Array.from({ length: 50 }, (_, id) => ({ ...payment, id: String(id), metadata: {} })), null), { state: 'ambiguous' })
  assert.deepEqual(classifyBricksPaymentSearch(attempt, [], 0), { state: 'not_found' })
})

test('process response only reports approved when the provider result was matched and registered', async () => {
  const attempt = { id: attemptId, reference }
  const registered = await bricksProcessResponse(attempt, { matched: true, approved: true, status: 'approved' }).json()
  assert.equal(registered.confirmed, true)
  assert.equal(registered.providerVerified, true)

  const unregistered = await bricksProcessResponse(attempt, { matched: false, approved: false, status: 'approved' }).json()
  assert.equal(unregistered.confirmed, false)
  assert.equal(unregistered.status, 'unverified')
})

test('migration keeps historical attempts on Pro and adds the Bricks diagnostic source', async () => {
  const migration = await readFile(new URL('../worker/db/migrations/043_checkout_bricks_attempts.sql', import.meta.url), 'utf8')
  assert.match(migration, /checkout_mode TEXT NOT NULL DEFAULT 'pro'/)
  assert.match(migration, /SET checkout_mode = 'pro'/)
  assert.match(migration, /'admin_verify', 'bricks_process'/)
  assert.match(migration, /'unmatched', 'unverified', 'stale'/)

  const route = await readFile(new URL('../worker/routes/publicRequests.js', import.meta.url), 'utf8')
  assert.match(route, /mercadoPago\('\/checkout\/preferences'/)
  assert.match(route, /recordVerifiedPayment\(payment, String\(payment\.id\), env, sql, 'bricks_process'[\s\S]*?String\(attempt\.id\)\)/)
})

test('rate-limit migration permits the exact action buckets used by Pro and Bricks endpoints', async () => {
  const migration = await readFile(new URL('../worker/db/migrations/044_bricks_rate_limit_actions.sql', import.meta.url), 'utf8')
  for (const action of ['token', 'request', 'payment_preference', 'payment_bricks_intent', 'payment_bricks_process']) {
    assert.match(migration, new RegExp(`'${action}'`))
  }
})
