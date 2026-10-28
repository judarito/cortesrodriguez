import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'

const requestId = '76e55d95-b683-43e4-9868-5e07a4b47820'
const reference = 'CRA-20261027-A1B2C3'
const submissionToken = '58d68a3a-b1ac-412d-9f61-58a79bd32c11'
const idempotencyKey = 'd6f2c7bc-4e56-4cdf-94ca-d2588ab6135c'

function neonResult(rows, columns = []) {
  const fields = columns.map((column) => ({ name: column.name, dataTypeID: column.dataTypeID }))
  const values = rows.map((row) => columns.map(({ name }) => {
    const value = row[name]
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'boolean') return value ? 't' : 'f'
    return value == null ? null : String(value)
  }))
  return new Response(JSON.stringify({ fields, rows: values }), {
    headers: { 'content-type': 'application/json' },
  })
}

test('Checkout Pro preference route sends expected provider payload and persists its preference', async () => {
  const db = new PGlite()
  const originalFetch = globalThis.fetch
  const providerRequests = []
  const databaseQueries = []
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(submissionToken))).toString('base64url')

  try {
    await db.exec(`
      CREATE SCHEMA operations;
      CREATE TABLE operations.requests (
        id UUID PRIMARY KEY,
        reference TEXT NOT NULL,
        email TEXT NOT NULL,
        service_amount_cents INTEGER NOT NULL,
        service_currency TEXT NOT NULL,
        payment_required BOOLEAN NOT NULL,
        status TEXT NOT NULL,
        confirmed_payment_attempt_id UUID,
        public_idempotency_key_hash TEXT,
        public_submission_completed_at TIMESTAMPTZ,
        payment_preference_lease_token UUID,
        payment_preference_lease_expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE operations.public_request_rate_limits (
        ip_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        window_started_at TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ip_hash, action)
      );
      CREATE TABLE operations.public_request_attribution_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attribution_type TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      );
      CREATE TABLE operations.request_payments (
        id UUID PRIMARY KEY,
        request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
        reference TEXT NOT NULL,
        idempotency_key TEXT,
        usd_amount_cents INTEGER NOT NULL,
        trm_cop_per_usd NUMERIC(14,4) NOT NULL,
        cop_amount_cents INTEGER NOT NULL,
        trm_effective_date DATE NOT NULL,
        mercado_pago_preference_id TEXT,
        init_point TEXT,
        mercado_pago_payment_id TEXT,
        provider_submission_started_at TIMESTAMPTZ,
        checkout_mode TEXT NOT NULL DEFAULT 'pro',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO operations.requests (
        id, reference, email, service_amount_cents, service_currency, payment_required, status,
        public_idempotency_key_hash, public_submission_completed_at
      ) VALUES (
        '${requestId}', '${reference}', 'cliente@example.test', 2000, 'USD', TRUE, 'pending',
        '${tokenHash}', NOW()
      );
    `)

    globalThis.fetch = async (input, options = {}) => {
      const url = String(input)
      if (url.includes('SuperfinancieraWebServiceTRM')) {
        return new Response('<Envelope><valor>3157.94</valor><fecha>2026-10-27T00:00:00</fecha></Envelope>', { status: 200 })
      }
      if (url === 'https://api.mercadopago.com/checkout/preferences') {
        providerRequests.push({ url, options, payload: JSON.parse(options.body) })
        return Response.json({ id: 'pref-pro-test-001', init_point: 'https://checkout.example.test/pay/pref-pro-test-001' })
      }
      if (url.includes('.neon.tech/')) {
        const { query, params } = JSON.parse(options.body)
        databaseQueries.push(query)
        const result = await db.query(query, params)
        return neonResult(result.rows, result.fields)
      }
      throw new Error(`Unexpected network request in isolated Checkout Pro test: ${url}`)
    }

    const request = new Request('https://app.example.test/api/public/payments/preference', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10',
      },
      body: JSON.stringify({ reference, submissionToken, idempotencyKey }),
    })
    const response = await handlePublicRequests(request, {
      NEON_DATABASE_URL: 'postgres://test:test@ep-isolated-test.neon.tech/test',
      MP_ACCESS_TOKEN: 'test-only-pro-token',
      PUBLIC_RATE_LIMIT_SECRET: 'test-only-rate-limit-secret',
      PUBLIC_APP_URL: 'https://app.example.test',
    })

    assert.equal(response.status, 200)
    const responseBody = await response.json()
    assert.equal(responseBody.initPoint, 'https://checkout.example.test/pay/pref-pro-test-001')
    assert.equal(providerRequests.length, 1)

    const { payload } = providerRequests[0]
    assert.deepEqual(payload.back_urls, {
      success: `https://app.example.test/solicitud/resultado-pago?payment=success&reference=${reference}`,
      failure: `https://app.example.test/solicitud/resultado-pago?payment=failure&reference=${reference}`,
      pending: `https://app.example.test/solicitud/resultado-pago?payment=pending&reference=${reference}`,
    })
    assert.equal(payload.auto_return, 'approved')
    assert.equal(payload.external_reference, reference)
    assert.match(payload.metadata.cra_payment_attempt_id, /^[0-9a-f-]{36}$/i)
    assert.equal(payload.notification_url, 'https://app.example.test/api/public/payments/webhook')

    const paymentRows = await db.query(`
      SELECT id, mercado_pago_preference_id, init_point, status
      FROM operations.request_payments WHERE request_id = $1
    `, [requestId])
    assert.equal(paymentRows.rows.length, 1)
    assert.equal(paymentRows.rows[0].id, payload.metadata.cra_payment_attempt_id)
    assert.equal(paymentRows.rows[0].mercado_pago_preference_id, 'pref-pro-test-001')
    assert.equal(paymentRows.rows[0].init_point, 'https://checkout.example.test/pay/pref-pro-test-001')
    assert.equal(paymentRows.rows[0].status, 'pending')
    assert.ok(databaseQueries.some((query) => query.includes('mercado_pago_preference_id =')))
  } finally {
    globalThis.fetch = originalFetch
    await db.close()
  }
})
