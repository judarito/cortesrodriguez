import test from 'node:test'
import assert from 'node:assert/strict'
import { handleClientPortal } from '../worker/routes/clientPortal.js'

const sessionToken = 'portal-test-session'
const ownerEmail = 'cliente@example.test'
const reference = 'CRA-20261025-AB12CD'
const requestId = '90199877-a6f9-46fc-8f87-6117846d8eef'
const attachmentId = 'a0199877-a6f9-46fc-8f87-6117846d8eef'

function queryResult(rows, columns, types = []) {
  return new Response(JSON.stringify({
    fields: columns.map((name, index) => ({ name, dataTypeID: types[index] || 25 })),
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  }), { headers: { 'content-type': 'application/json' } })
}

function mockDatabase({ requestExists = true, downloadAttachment = null } = {}) {
  const queries = []
  return {
    queries,
    fetch: async (_url, options) => {
      const { query } = JSON.parse(options.body)
      queries.push(query)
      if (query.includes('FROM operations.client_sessions')) return queryResult([{ email: ownerEmail }], ['email'])
      if (query.includes('FROM operations.requests') && query.includes('WHERE reference =')) {
        if (!requestExists) return queryResult([], ['id', 'reference', 'question', 'service_type', 'general_service_name', 'consultation_type_name', 'specialty_name', 'status', 'created_at', 'payment_required', 'service_amount_cents', 'service_currency'], [2950, 25, 25, 25, 25, 25, 25, 25, 1184, 16, 23, 25])
        return queryResult([{
          id: requestId, reference, question: '¿Cómo registro mi importación?', service_type: 'Importación',
          general_service_name: 'Importación', consultation_type_name: 'Consulta básica', specialty_name: '',
          status: 'pending', created_at: '2026-10-25T12:00:00Z', payment_required: false,
          service_amount_cents: 1000, service_currency: 'USD',
        }], ['id', 'reference', 'question', 'service_type', 'general_service_name', 'consultation_type_name', 'specialty_name', 'status', 'created_at', 'payment_required', 'service_amount_cents', 'service_currency'], [2950, 25, 25, 25, 25, 25, 25, 25, 1184, 16, 23, 25])
      }
      if (query.includes('FROM operations.request_payments')) return queryResult([], ['status', 'init_point', 'usd_amount_cents', 'cop_amount_cents', 'trm_cop_per_usd', 'trm_effective_date', 'created_at'])
      if (query.includes('SELECT attachment.storage_key')) {
        return queryResult(downloadAttachment ? [downloadAttachment] : [], ['storage_key', 'mime_type', 'original_name', 'size_bytes'])
      }
      if (query.includes('FROM operations.request_attachments')) return queryResult([], ['id', 'original_name', 'mime_type', 'created_at'])
      if (query.includes('FROM operations.expert_responses')) return queryResult([], ['body', 'admin_note', 'updated_at'])
      throw new Error(`Unexpected SQL: ${query}`)
    },
  }
}

function authenticatedRequest(path) {
  return new Request(`https://app.example.test${path}`, {
    headers: { cookie: `client_session=${sessionToken}` },
  })
}

const env = { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db' }

test('client request details require a valid portal session', async () => {
  const db = mockDatabase()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body)
    db.queries.push(query)
    return queryResult([], ['email'])
  }
  try {
    const result = await handleClientPortal(new Request(`https://app.example.test/api/client/requests/${reference}`), env)
    assert.equal(result.status, 401)
    assert.equal(db.queries.some((query) => query.includes('FROM operations.requests')), false)
  } finally { globalThis.fetch = originalFetch }
})

test('client request detail scopes ownership and only returns approved or sent responses', async () => {
  const db = mockDatabase()
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const result = await handleClientPortal(authenticatedRequest(`/api/client/requests/${reference}`), env)
    assert.equal(result.status, 200)
    assert.equal((await result.json()).item.reference, reference)
    assert.match(db.queries.find((query) => query.includes('WHERE reference =')), /lower\(trim\(email\)\) =/)
    assert.match(db.queries.find((query) => query.includes('FROM operations.expert_responses')), /status IN \('approved', 'sent'\)/)
  } finally { globalThis.fetch = originalFetch }
})

test('client cannot read a request registered to another email', async () => {
  const db = mockDatabase({ requestExists: false })
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const result = await handleClientPortal(authenticatedRequest(`/api/client/requests/${reference}`), env)
    assert.equal(result.status, 404)
    assert.equal(db.queries.some((query) => query.includes('FROM operations.request_attachments')), false)
    assert.equal(db.queries.some((query) => query.includes('FROM operations.expert_responses')), false)
  } finally { globalThis.fetch = originalFetch }
})

test('client downloads an own validated PDF as an attachment without exposing storage keys', async () => {
  const db = mockDatabase({
    downloadAttachment: {
      storage_key: `requests/${requestId}/${attachmentId}-factura.pdf`,
      mime_type: 'application/pdf', original_name: 'factura.pdf', size_bytes: 1024,
    },
  })
  const requested = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const result = await handleClientPortal(authenticatedRequest(`/api/client/requests/${reference}/attachments/${attachmentId}`), {
      ...env,
      GALLERY_IMAGES: { get: async (key) => { requested.push(key); return { body: new Blob(['%PDF-1.4']) } } },
    })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('content-type'), 'application/pdf')
    assert.match(result.headers.get('content-disposition'), /^attachment; filename="factura\.pdf"/)
    assert.equal(result.headers.get('content-length'), '1024')
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(result.headers.get('content-security-policy'), "default-src 'none'; sandbox")
    for (const value of result.headers.values()) assert.equal(value.includes('requests/'), false)
    assert.deepEqual(requested, [`requests/${requestId}/${attachmentId}-factura.pdf`])
    const query = db.queries.find((item) => item.includes('SELECT attachment.storage_key'))
    assert.match(query, /lower\(trim\(request\.email\)\) =/)
    assert.match(query, /attachment\.status = 'validated'/)
    assert.match(query, /attachment\.storage_key LIKE/)
  } finally { globalThis.fetch = originalFetch }
})

test('client images keep inline disposition for viewing', async () => {
  const db = mockDatabase({
    downloadAttachment: {
      storage_key: `requests/${requestId}/${attachmentId}-foto.png`,
      mime_type: 'image/png', original_name: 'foto.png', size_bytes: 64,
    },
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const result = await handleClientPortal(authenticatedRequest(`/api/client/requests/${reference}/attachments/${attachmentId}`), {
      ...env, GALLERY_IMAGES: { get: async () => ({ body: new Blob(['png']) }) },
    })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('content-type'), 'image/png')
    assert.match(result.headers.get('content-disposition'), /^inline; filename="foto\.png"/)
  } finally { globalThis.fetch = originalFetch }
})

test('client attachment download is not found for another owner or an unsupported type', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const downloadAttachment of [null, {
      storage_key: `requests/${requestId}/${attachmentId}-svg.svg`,
      mime_type: 'image/svg+xml', original_name: 'dibujo.svg', size_bytes: 64,
    }]) {
      const db = mockDatabase({ downloadAttachment })
      globalThis.fetch = db.fetch
      let reads = 0
      const result = await handleClientPortal(authenticatedRequest(`/api/client/requests/${reference}/attachments/${attachmentId}`), {
        ...env, GALLERY_IMAGES: { get: async () => { reads += 1; return { body: new Blob(['x']) } } },
      })
      assert.equal(result.status, 404)
      assert.equal(reads, 0)
    }
  } finally { globalThis.fetch = originalFetch }
})

test('parallel access-code checks reserve attempts atomically in the database', async () => {
  const queries = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body)
    queries.push(query)
    if (query.includes('WITH next_challenge AS MATERIALIZED')) {
      return queryResult([{ id: attachmentId, code_hash: 'not-a-matching-hash', attempts_count: 5 }], ['id', 'code_hash', 'attempts_count'], [2950, 25, 23])
    }
    if (query.includes('UPDATE operations.client_login_challenges SET consumed_at')) return queryResult([], ['id'])
    throw new Error(`Unexpected SQL: ${query}`)
  }
  try {
    const request = new Request('https://app.example.test/api/client/session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, code: '123456' }),
    })
    const result = await handleClientPortal(request, { ...env, OPERATIONS_JWT_SECRET: 'portal-test-secret' })
    assert.equal(result.status, 400)
    assert.match(queries[0], /FOR UPDATE/)
    assert.match(queries[0], /attempts_count = challenge\.attempts_count \+ 1/)
  } finally { globalThis.fetch = originalFetch }
})

test('failed access-code email does not invalidate the previously delivered code', async () => {
  const queries = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.resend.com/')) return new Response('temporary failure', { status: 503 })
    const { query } = JSON.parse(options.body)
    queries.push(query)
    if (query.includes('FROM operations.requests')) return queryResult([{ '?column?': 1 }], ['?column?'], [23])
    if (query.includes('INSERT INTO operations.client_login_rate_limits')) return queryResult([{ request_count: 1 }], ['request_count'], [23])
    if (query.includes('INSERT INTO operations.client_login_challenges')) return queryResult([{ id: attachmentId }], ['id'], [2950])
    return queryResult([], ['id'])
  }
  try {
    const request = new Request('https://app.example.test/api/client/access-code', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail }),
    })
    const result = await handleClientPortal(request, {
      ...env, OPERATIONS_JWT_SECRET: 'portal-test-secret',
      RESEND_FROM_EMAIL: 'noreply@example.test', RESEND_API_KEY: 'test-key',
    })
    assert.equal(result.status, 200)
    assert.equal(queries.some((query) => query.includes('id <>')), false)
    assert.ok(queries.some((query) => query.includes('SET consumed_at = NOW() WHERE id =')))
    assert.ok(queries.some((query) => query.includes('request_lease_token = NULL')))
  } finally { globalThis.fetch = originalFetch }
})
