import test from 'node:test'
import assert from 'node:assert/strict'
import { handlePublicAttachments } from '../worker/routes/publicAttachments.js'

const requirement = {
  category: 'documento_general',
  label_es: 'Documento general',
  label_en: 'General document',
  description_es: 'Documento o imagen de soporte para la cotización.',
  description_en: 'Supporting document or image for the quote.',
  stage: 'any',
  min_files: 0,
  max_files: 10,
  max_size_bytes: 10 * 1024 * 1024,
  allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  allowed_extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
  sort_order: 0,
}

function pgResult(rows, columns) {
  return new Response(JSON.stringify({
    fields: columns.map((name) => ({ name, dataTypeID: 25 })),
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  }), { headers: { 'content-type': 'application/json' } })
}

const requirementColumns = [
  'category', 'label_es', 'label_en', 'description_es', 'description_en', 'stage',
  'min_files', 'max_files', 'max_size_bytes', 'allowed_mime_types', 'allowed_extensions', 'sort_order',
]

function mockEnv(overrides = {}) {
  return {
    NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db',
    LANDING_FLAGS: { getBooleanValue: async () => true },
    ...overrides,
  }
}

function mockDatabase(requirements = [requirement]) {
  const queries = []
  const params = []
  return {
    queries,
    params,
    fetch: async (_url, options) => {
      const { query, params: values = [] } = JSON.parse(options.body)
      queries.push(query)
      params.push(values)
      if (query.includes('FROM operations.request_attachment_requirements')) {
        return pgResult(requirements, requirementColumns)
      }
      throw new Error(`Unexpected SQL: ${query}`)
    },
  }
}

function requirementsRequest(query = '?serviceType=importacion&stage=cotizacion') {
  return new Request(`https://example.test/api/public/attachment-requirements${query}`, {
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
  })
}

async function withMockedFetch(db, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try { return await callback() } finally { globalThis.fetch = originalFetch }
}

test('serves the configured matrix for a service and stage without a quote token', async () => {
  const db = mockDatabase()
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(requirementsRequest(), mockEnv())
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /no-store/)
    const payload = await response.json()
    assert.equal(payload.serviceType, 'importacion')
    assert.equal(payload.stage, 'cotizacion')
    assert.deepEqual(payload.requirements, [{
      category: 'documento_general',
      labelEs: 'Documento general',
      labelEn: 'General document',
      descriptionEs: 'Documento o imagen de soporte para la cotización.',
      descriptionEn: 'Supporting document or image for the quote.',
      stage: 'any',
      minFiles: 0,
      maxFiles: 10,
      maxSizeBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    }])
  })
  assert.match(db.queries[0], /FROM operations.request_attachment_requirements/)
  assert.equal(db.params[0][0], 'importacion')
  assert.equal(db.params[0][1], 'cotizacion')
})

test('rejects unknown services', async () => {
  await withMockedFetch(mockDatabase(), async () => {
    const response = await handlePublicAttachments(requirementsRequest('?serviceType=otro'), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /servicio válido/i)
  })
})

test('defaults an unknown stage to quote and keeps the request scoped', async () => {
  const db = mockDatabase()
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(requirementsRequest('?serviceType=agente_carga&stage=pago'), mockEnv())
    assert.equal(response.status, 200)
    assert.equal((await response.json()).stage, 'cotizacion')
  })
  assert.equal(db.params[0][0], 'agente_carga')
  assert.equal(db.params[0][1], 'cotizacion')
})

test('stays hidden when the public request flow is disabled', async () => {
  await withMockedFetch(mockDatabase(), async () => {
    const response = await handlePublicAttachments(requirementsRequest(), mockEnv({
      LANDING_FLAGS: { getBooleanValue: async () => false },
    }))
    assert.equal(response.status, 404)
  })
})

test('fails closed when the operational database is not configured', async () => {
  await withMockedFetch(mockDatabase(), async () => {
    const response = await handlePublicAttachments(requirementsRequest(), mockEnv({ NEON_DATABASE_URL: '' }))
    assert.equal(response.status, 500)
  })
})
