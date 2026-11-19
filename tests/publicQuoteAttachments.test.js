import test from 'node:test'
import assert from 'node:assert/strict'
import { handlePublicAttachments } from '../worker/routes/publicAttachments.js'
import { handlePublicRequests } from '../worker/routes/publicRequests.js'
import { verifyAttachmentFiles } from '../worker/routes/publicAttachments.js'

const quoteId = '90199877-a6f9-46fc-8f87-6117846d8eef'
const attachmentId = 'a0199877-a6f9-46fc-8f87-6117846d8eef'
const quoteToken = 'Q'.repeat(43)
const baseUrl = 'https://example.test/api/public/quotes'

const pngRequirement = {
  category: 'documento_general', label_es: 'Documento general', label_en: 'General document',
  description_es: null, description_en: null, stage: 'any', min_files: 0, max_files: 10,
  max_size_bytes: 10 * 1024 * 1024, allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  allowed_extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], sort_order: 0,
}
const invoiceRequirement = {
  ...pngRequirement, category: 'factura_comercial', label_es: 'Factura comercial', label_en: 'Commercial invoice',
  max_files: 5, sort_order: 10,
}

function minimalPng(width = 1, height = 1) {
  const bytes = new Uint8Array(45)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(bytes.buffer).setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes.set([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44], 33)
  return bytes
}

function pdfBytes(label = 'doc') {
  return new TextEncoder().encode(`%PDF-1.4\n% ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`)
}

// Las columnas booleanas viajan en formato texto de PostgreSQL ('t'/'f').
function pgResult(rows, columns, booleanColumns = []) {
  return new Response(JSON.stringify({
    fields: columns.map((name) => ({ name, dataTypeID: booleanColumns.includes(name) ? 16 : 25 })),
    rows: rows.map((row) => columns.map((column) => {
      const value = row[column] ?? null
      if (booleanColumns.includes(column) && value !== null) return value ? 't' : 'f'
      return value
    })),
  }), { headers: { 'content-type': 'application/json' } })
}

function mockDatabase({
  quote = {
    id: quoteId, reference: 'CRA-20261118-ABC123', status: 'cotizacion', service_type: 'importacion',
    product_type: 'mercancias', quote_expires_at: '2026-11-18T23:00:00Z', quote_active: true,
  },
  requirements = [pngRequirement, invoiceRequirement],
  existing = [],
  complete = true,
  gaps = [],
  updateRows = [{ reference: 'CRA-20261118-ABC123', payment_required: true, service_amount_cents: 5000, service_currency: 'USD' }],
  serviceActive = true,
  attachmentRequestId = quoteId,
} = {}) {
  const queries = []
  const params = []
  const inserted = []
  return {
    queries,
    params,
    inserted,
    fetch: async (_url, options) => {
      const { query, params: values = [] } = JSON.parse(options.body)
      queries.push(query)
      params.push(values)
      if (query.includes('WITH expired_rate_rows')) return pgResult([{ request_count: 1 }], ['request_count'])
      if (query.includes('FROM operations.requests') && query.includes('quote_token_hash')) {
        return pgResult(quote ? [quote] : [], ['id', 'reference', 'status', 'service_type', 'product_type', 'payment_required', 'service_amount_cents', 'service_currency', 'quote_expires_at', 'quote_active'], ['quote_active', 'payment_required'])
      }
      if (query.includes('FROM operations.services')) {
        return pgResult(serviceActive ? [{ active: 1 }] : [], ['active'])
      }
      if (query.includes('FROM operations.request_attachment_requirements')) {
        return pgResult(requirements, ['category', 'label_es', 'label_en', 'description_es', 'description_en', 'stage', 'min_files', 'max_files', 'max_size_bytes', 'allowed_mime_types', 'allowed_extensions', 'sort_order'])
      }
      if (query.includes('FROM operations.request_attachments') && query.includes('checksum_sha256')) {
        return pgResult(existing, ['category', 'checksum_sha256'])
      }
      if (query.includes('INSERT INTO operations.request_attachments')) {
        inserted.push({
          id: values[0], original_name: values[3], mime_type: values[4], size_bytes: Number(values[5]),
          status: 'validated', category: values[6], stage: values[7], created_at: '2026-11-18T12:00:00Z',
        })
        return pgResult([{ id: values[0] }], ['id'])
      }
      if (query.includes('operations.request_attachments_complete')) return pgResult([{ complete }], ['complete'], ['complete'])
      if (query.includes('SELECT storage_key, mime_type, original_name, size_bytes')) {
        if (attachmentRequestId !== quoteId) return pgResult([], ['storage_key', 'mime_type', 'original_name', 'size_bytes'])
        return pgResult([{ storage_key: `requests/${quoteId}/${attachmentId}-factura.pdf`, mime_type: 'application/pdf', original_name: 'factura.pdf', size_bytes: 42 }], ['storage_key', 'mime_type', 'original_name', 'size_bytes'])
      }
      if (query.includes('FROM operations.request_attachments')) {
        const visibleExisting = query.includes("status = 'validated'") ? existing.filter((row) => (row.status || 'validated') === 'validated') : existing
        return pgResult([...visibleExisting.map((row, index) => ({
          id: row.id || `${index}`.padStart(8, '0') + '-0000-4000-8000-000000000000',
          original_name: row.original_name || 'documento.png', mime_type: row.mime_type || 'image/png',
          size_bytes: row.size_bytes || 10, status: row.status || 'validated', category: row.category || 'documento_general',
          stage: row.stage || 'cotizacion', created_at: '2026-11-18T12:00:00Z',
        })), ...inserted], ['id', 'original_name', 'mime_type', 'size_bytes', 'status', 'category', 'stage', 'created_at'])
      }
      if (query.includes('FROM operations.request_attachment_gaps')) {
        return pgResult(gaps, ['category', 'label_es', 'label_en', 'stage', 'min_files', 'validated_count'])
      }
      if (query.includes('UPDATE operations.request_attachments')) return pgResult([{ id: attachmentId, storage_key: `requests/${quoteId}/documento_general/${attachmentId}-pozo.png` }], ['id', 'storage_key'])
      if (query.includes("UPDATE operations.requests") && query.includes("status = 'pending'")) return pgResult(updateRows, ['reference', 'payment_required', 'service_amount_cents', 'service_currency'], ['payment_required'])
      if (query.includes('DELETE FROM operations.request_attachments')) return pgResult([], [])
      throw new Error(`Unexpected SQL: ${query}`)
    },
  }
}

function mockEnv(overrides = {}) {
  return {
    NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db',
    PUBLIC_RATE_LIMIT_SECRET: 'test-secret',
    LANDING_FLAGS: { getBooleanValue: async () => true },
    GALLERY_IMAGES: { put: async () => {}, delete: async () => {} },
    ...overrides,
  }
}

function attachmentForm(fields, files) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  for (const file of files) {
    form.append('attachments', new File([file.bytes], file.name, { type: file.type }))
    form.append('attachmentCategory', file.category)
  }
  return form
}

async function withMockedFetch(db, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try { return await callback() } finally { globalThis.fetch = originalFetch }
}

function uploadRequest(form) {
  return new Request(`${baseUrl}/attachments`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
    body: form,
  })
}

test('attachment listing requires the opaque quote token and hides storage keys', async () => {
  const invalid = await handlePublicAttachments(new Request(`${baseUrl}/attachments?token=short`), mockEnv())
  assert.equal(invalid.status, 400)

  const db = mockDatabase({ existing: [{ category: 'factura_comercial', checksum_sha256: null }] })
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments?token=${quoteToken}`), mockEnv())
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.request.reference, 'CRA-20261118-ABC123')
    assert.deepEqual(payload.requirements.map((item) => item.category), ['documento_general', 'factura_comercial'])
    assert.equal(payload.attachments[0].category, 'factura_comercial')
    assert.equal('storageKey' in payload.attachments[0], false)
    assert.equal(JSON.stringify(payload).includes('requests/'), false)
  })
})

test('public listing excludes pending and deleted attachments', async () => {
  const db = mockDatabase({ existing: [
    { id: attachmentId, status: 'validated', category: 'factura_comercial' },
    { id: 'b0199877-a6f9-46fc-8f87-6117846d8eef', status: 'pending', category: 'documento_general' },
    { id: 'c0199877-a6f9-46fc-8f87-6117846d8eef', status: 'deleted', category: 'documento_general' },
  ] })
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments?token=${quoteToken}`), mockEnv())
    const payload = await response.json()
    assert.deepEqual(payload.attachments.map((item) => item.id), [attachmentId])
  })
})

test('public quote download is scoped by quote token and serves only validated attachments', async () => {
  const db = mockDatabase()
  const requested = []
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments/${attachmentId}?token=${quoteToken}`), mockEnv({
      GALLERY_IMAGES: { get: async (key) => { requested.push(key); return { body: new Blob(['%PDF-1.4']) } } },
    }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/pdf')
    assert.match(response.headers.get('content-disposition'), /^attachment;/)
    for (const value of response.headers.values()) assert.equal(value.includes('requests/'), false)
    assert.deepEqual(requested, [`requests/${quoteId}/${attachmentId}-factura.pdf`])
    const query = db.queries.find((item) => item.includes('SELECT storage_key, mime_type, original_name, size_bytes'))
    assert.match(query, /request_id = \$/)
    assert.match(query, /status = 'validated'/)
    assert.match(query, /storage_key LIKE/)
  })
})

test('public quote download does not read storage when the token does not own the attachment', async () => {
  const db = mockDatabase({ quote: null })
  let reads = 0
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments/${attachmentId}?token=${quoteToken}`), mockEnv({
      GALLERY_IMAGES: { get: async () => { reads += 1; return { body: new Blob(['%PDF-1.4']) } } },
    }))
    assert.equal(response.status, 404)
    assert.equal(reads, 0)
  })
})

test('public quote download rejects a foreign attachment even with a valid quote token', async () => {
  const foreignAttachmentId = 'b0199877-a6f9-46fc-8f87-6117846d8eef'
  const db = mockDatabase({ attachmentRequestId: '81199877-a6f9-46fc-8f87-6117846d8eef' })
  let reads = 0
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments/${foreignAttachmentId}?token=${quoteToken}`), mockEnv({
      GALLERY_IMAGES: { get: async () => { reads += 1; return { body: new Blob(['%PDF-1.4']) } } },
    }))
    assert.equal(response.status, 404)
    assert.equal(reads, 0)
  })
})

test('uploads several files into their categories linked to the token-resolved request', async () => {
  const db = mockDatabase()
  const puts = []
  const env = mockEnv({
    GALLERY_IMAGES: { put: async (key, bytes, options) => { puts.push({ key, type: options.httpMetadata.contentType }) }, delete: async () => {} },
  })
  const form = attachmentForm({ quoteToken }, [
    { name: 'factura.pdf', bytes: pdfBytes('factura'), type: 'application/pdf', category: 'factura_comercial' },
    { name: 'foto.png', bytes: minimalPng(800, 600), type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), env)
    assert.equal(response.status, 201)
    const payload = await response.json()
    assert.equal(payload.stored, 2)
    assert.deepEqual(payload.attachments.map((item) => item.category).sort(), ['documento_general', 'factura_comercial'])
  })
  assert.equal(puts.length, 2)
  assert.ok(puts.every((put) => put.key.startsWith(`requests/${quoteId}/`)))
  assert.ok(puts.some((put) => put.key.startsWith(`requests/${quoteId}/factura_comercial/`) && put.type === 'application/pdf'))

  const inserts = db.queries.filter((query) => query.includes('INSERT INTO operations.request_attachments'))
  assert.equal(inserts.length, 2)
  const insertParams = db.params[db.queries.findIndex((query) => query.includes('INSERT INTO operations.request_attachments'))]
  assert.ok(insertParams.includes(quoteId))
  assert.match(inserts[0], /'validated'/)
  assert.ok(insertParams.includes('cotizacion'))
  assert.ok(insertParams.includes('client'))
  assert.equal(insertParams.filter((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)).length, 1)
})

test('rejects categories that do not belong to the request service', async () => {
  const db = mockDatabase()
  const puts = []
  const form = attachmentForm({ quoteToken }, [
    { name: 'origen.pdf', bytes: pdfBytes(), type: 'application/pdf', category: 'certificado_origen' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), mockEnv({
      GALLERY_IMAGES: { put: async (key) => puts.push(key), delete: async () => {} },
    }))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /no está permitida para este servicio/i)
  })
  assert.equal(puts.length, 0)
  assert.equal(db.queries.some((query) => query.includes('INSERT INTO operations.request_attachments')), false)
})

test('rejects content that does not match its declared type or allowed extension', async () => {
  const db = mockDatabase()
  const spoofed = attachmentForm({ quoteToken }, [
    { name: 'factura.png', bytes: pdfBytes(), type: 'image/png', category: 'factura_comercial' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(spoofed), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /no coincide con su tipo declarado/i)
  })

  const wrongExtension = attachmentForm({ quoteToken }, [
    { name: 'factura.exe', bytes: minimalPng(), type: 'image/png', category: 'factura_comercial' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(wrongExtension), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /extensión/i)
  })
})

test('rejects files that exceed the category size limit', async () => {
  const db = mockDatabase({
    requirements: [{ ...pngRequirement, max_size_bytes: 10 }],
  })
  const form = attachmentForm({ quoteToken }, [
    { name: 'grande.png', bytes: minimalPng(), type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /tamaño máximo/i)
  })
})

test('rejects duplicate checksums already active on the request', async () => {
  const bytes = minimalPng()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const checksum = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const db = mockDatabase({ existing: [{ category: 'documento_general', checksum_sha256: checksum }] })
  const form = attachmentForm({ quoteToken }, [
    { name: 'repetido.png', bytes, type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), mockEnv())
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /ya fue adjuntado/i)
  })
})

test('rejects duplicate checksums within the same multi-file upload before storing either file', async () => {
  const bytes = minimalPng(2, 2)
  const db = mockDatabase()
  const form = attachmentForm({ quoteToken }, [
    { name: 'primero.png', bytes, type: 'image/png', category: 'documento_general' },
    { name: 'copia.png', bytes, type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), mockEnv())
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /ya fue adjuntado/i)
  })
  assert.equal(db.queries.some((query) => query.includes('INSERT INTO operations.request_attachments')), false)
})

test('enforces the service category contract for import, export and freight-agent fixtures', async () => {
  const fixtures = {
    importacion: ['factura_comercial'],
    exportacion: ['factura_comercial'],
    agente_carga: ['documento_general'],
  }
  for (const [serviceType, allowedCategory] of Object.entries(fixtures)) {
    const requirements = [{
      ...pngRequirement,
      category: allowedCategory[0],
      labelEs: pngRequirement.label_es,
      labelEn: pngRequirement.label_en,
      minFiles: pngRequirement.min_files,
      maxFiles: pngRequirement.max_files,
      maxSizeBytes: pngRequirement.max_size_bytes,
      allowedMimeTypes: pngRequirement.allowed_mime_types,
      allowedExtensions: pngRequirement.allowed_extensions,
    }]
    const verified = await verifyAttachmentFiles({
      files: [new File([minimalPng()], `${serviceType}.png`, { type: 'image/png' })],
      categories: allowedCategory,
      requirements,
      snapshot: { counts: new Map(), checksums: new Set(), total: 0 },
    })
    assert.equal(verified[0].category, allowedCategory[0])
    await assert.rejects(
      verifyAttachmentFiles({
        files: [new File([minimalPng(3, 3)], `${serviceType}-invalid.png`, { type: 'image/png' })],
        categories: ['categoria_no_configurada'],
        requirements,
        snapshot: { counts: new Map(), checksums: new Set(), total: 0 },
      }),
      /no está permitida para este servicio/i,
    )
  }
})

test('rejects attachment changes once the quote was converted', async () => {
  const db = mockDatabase({ quote: { ...mockDatabase().quote, id: quoteId, reference: 'CRA-1', status: 'pending', service_type: 'importacion', product_type: 'mercancias', quote_active: false } })
  const form = attachmentForm({ quoteToken }, [
    { name: 'foto.png', bytes: minimalPng(), type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(uploadRequest(form), mockEnv())
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /ya fue convertida/i)
  })
})

test('deleting an attachment is scoped to the same request and removes the stored object', async () => {
  const db = mockDatabase()
  const deleted = []
  await withMockedFetch(db, async () => {
    const response = await handlePublicAttachments(new Request(`${baseUrl}/attachments/${attachmentId}`, {
      method: 'DELETE',
      headers: { 'CF-Connecting-IP': '203.0.113.10', 'content-type': 'application/json' },
      body: JSON.stringify({ quoteToken }),
    }), mockEnv({ GALLERY_IMAGES: { put: async () => {}, delete: async (key) => deleted.push(key) } }))
    assert.equal(response.status, 200)
    assert.deepEqual(deleted, [`requests/${quoteId}/documento_general/${attachmentId}-pozo.png`])
    const update = db.queries.find((query) => query.includes('UPDATE operations.request_attachments'))
    assert.match(update, /request_id = \$/)
    assert.match(update, /status IN \('pending', 'validated'\)/)
  })
})

test('conversion stores reservation attachments on the same request and marks it converted once', async () => {
  const db = mockDatabase()
  const puts = []
  const form = attachmentForm({ quoteToken, email: 'ana@example.com' }, [
    { name: 'factura.pdf', bytes: pdfBytes('reserva'), type: 'application/pdf', category: 'factura_comercial' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicRequests(new Request(`${baseUrl}/convert`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: form,
    }), mockEnv({ GALLERY_IMAGES: { put: async (key) => puts.push(key), delete: async () => {} } }))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.converted, true)
    assert.equal(payload.stored, 1)
    assert.equal(payload.attachments[0].status, 'validated')
  })
  assert.ok(puts[0].startsWith(`requests/${quoteId}/factura_comercial/`))
  const insertParams = db.params[db.queries.findIndex((query) => query.includes('INSERT INTO operations.request_attachments'))]
  assert.ok(insertParams.includes('reserva'))
  const conversion = db.queries.find((query) => query.includes("SET status = 'pending'"))
  assert.match(conversion, /WHERE id = \$/)
  assert.doesNotMatch(conversion, /quote_token_hash/)
})

test('conversion preserves quote attachments and appends reservation attachments on the same request', async () => {
  const existing = [{
    id: 'b0199877-a6f9-46fc-8f87-6117846d8eef',
    original_name: 'cotizacion.png', mime_type: 'image/png', size_bytes: 10,
    category: 'documento_general', stage: 'cotizacion', checksum_sha256: 'c'.repeat(64),
  }]
  const db = mockDatabase({ existing })
  const puts = []
  const form = attachmentForm({ quoteToken, email: 'ana@example.com' }, [
    { name: 'reserva.pdf', bytes: pdfBytes('reserva-preserva'), type: 'application/pdf', category: 'factura_comercial' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicRequests(new Request(`${baseUrl}/convert`, {
      method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.10' }, body: form,
    }), mockEnv({ GALLERY_IMAGES: { put: async (key) => puts.push(key), delete: async () => {} } }))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.attachments.length, 2)
    assert.deepEqual(payload.attachments.map((item) => item.stage).sort(), ['cotizacion', 'reserva'])
    assert.equal(payload.attachments.some((item) => item.originalName === 'cotizacion.png'), true)
  })
  assert.equal(puts.length, 1)
  assert.equal(db.queries.filter((query) => query.includes('INSERT INTO operations.request_attachments')).length, 1)
})

test('conversion refuses missing required documents and reverts the files uploaded in that attempt', async () => {
  const db = mockDatabase({ complete: false, gaps: [{ category: 'documento_transporte', label_es: 'Documento de transporte', label_en: 'Transport document', stage: 'any', min_files: 1, validated_count: 0 }] })
  const deleted = []
  const form = attachmentForm({ quoteToken }, [
    { name: 'foto.png', bytes: minimalPng(), type: 'image/png', category: 'documento_general' },
  ])
  await withMockedFetch(db, async () => {
    const response = await handlePublicRequests(new Request(`${baseUrl}/convert`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: form,
    }), mockEnv({ GALLERY_IMAGES: { put: async () => {}, delete: async (key) => deleted.push(key) } }))
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.missing[0].category, 'documento_transporte')
  })
  assert.equal(deleted.length, 1)
  assert.ok(db.queries.some((query) => query.includes('DELETE FROM operations.request_attachments')))
  assert.equal(db.queries.some((query) => query.includes("SET status = 'pending'")), false)
})

test('quote creation stores multiple categorized files and returns the opaque token', async () => {
  const db = mockDatabase()
  const defaultFetch = db.fetch
  db.fetch = async (url, options) => {
    const { query, params: values = [] } = JSON.parse(options.body)
    if (query.includes('FROM operations.public_request_attribution_tokens')) {
      return pgResult([{ attribution_type: 'direct_web', agent_link_id: null, agent_id: null }], ['attribution_type', 'agent_link_id', 'agent_id'])
    }
    if (query.includes('FROM operations.service_consultation_types')) {
      return pgResult([{ service_name: 'Importación', amount_cents: 5000, currency: 'USD', payment_required: true, consultation_type_id: '11111111-1111-4111-8111-111111111111', consultation_name: 'Consulta', consultation_description: '' }], ['service_name', 'amount_cents', 'currency', 'payment_required', 'consultation_type_id', 'consultation_name', 'consultation_description'])
    }
    if (query.includes('INSERT INTO operations.requests')) {
      return pgResult([{ id: values[0], reference: 'CRA-20261118-ZZZ111', quote_expires_at: '2026-11-18T23:00:00Z' }], ['id', 'reference', 'quote_expires_at'])
    }
    return defaultFetch(url, options)
  }
  const puts = []
  const form = new FormData()
  form.append('fullName', 'Ana Ríos')
  form.append('legalEntityType', 'natural')
  form.append('email', 'ana@example.com')
  form.append('serviceType', 'importacion')
  form.append('consultationType', 'consulta_basica')
  form.append('productType', 'mercancias')
  form.append('question', 'Necesito orientación para importar mercancías desde otro país.')
  form.append('attributionToken', 'A'.repeat(43))
  form.append('idempotencyKey', '123e4567-e89b-42d3-a456-426614174000')
  for (const file of [
    { name: 'factura.pdf', bytes: pdfBytes('factura'), type: 'application/pdf', category: 'factura_comercial' },
    { name: 'foto.png', bytes: minimalPng(), type: 'image/png', category: 'documento_general' },
  ]) {
    form.append('attachments', new File([file.bytes], file.name, { type: file.type }))
    form.append('attachmentCategory', file.category)
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const response = await handlePublicRequests(new Request('https://example.test/api/public/quotes', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: form,
    }), mockEnv({ GALLERY_IMAGES: { put: async (key) => puts.push(key), delete: async () => {} } }))
    assert.equal(response.status, 201)
    const payload = await response.json()
    assert.match(payload.quoteToken, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(payload.attachments.length, 2)
    assert.equal(payload.status, 'cotizacion')
  } finally { globalThis.fetch = originalFetch }
  assert.equal(puts.length, 2)
  const attachmentInsert = db.queries.findIndex((query) => query.includes('INSERT INTO operations.request_attachments'))
  const attachmentRequestId = db.params[attachmentInsert][1]
  assert.ok(puts.every((key) => key.startsWith(`requests/${attachmentRequestId}/`)))
  assert.ok(puts.some((key) => key.includes('/factura_comercial/')))
  assert.ok(puts.some((key) => key.includes('/documento_general/')))
})

test('quote creation validates attachments before inserting the request', async () => {
  const db = mockDatabase({ requirements: [pngRequirement] })
  const defaultFetch = db.fetch
  db.fetch = async (url, options) => {
    const { query } = JSON.parse(options.body)
    if (query.includes('FROM operations.public_request_attribution_tokens')) {
      return pgResult([{ attribution_type: 'direct_web', agent_link_id: null, agent_id: null }], ['attribution_type', 'agent_link_id', 'agent_id'])
    }
    if (query.includes('FROM operations.service_consultation_types')) {
      return pgResult([{ service_name: 'Importación', amount_cents: 5000, currency: 'USD', payment_required: true, consultation_type_id: '11111111-1111-4111-8111-111111111111', consultation_name: 'Consulta', consultation_description: '' }], ['service_name', 'amount_cents', 'currency', 'payment_required', 'consultation_type_id', 'consultation_name', 'consultation_description'])
    }
    return defaultFetch(url, options)
  }

  const form = new FormData()
  form.append('fullName', 'Ana Ríos')
  form.append('legalEntityType', 'natural')
  form.append('email', 'ana@example.com')
  form.append('serviceType', 'importacion')
  form.append('consultationType', 'consulta_basica')
  form.append('productType', 'mercancias')
  form.append('question', 'Necesito orientación para importar mercancías desde otro país.')
  form.append('attributionToken', 'A'.repeat(43))
  form.append('idempotencyKey', '123e4567-e89b-42d3-a456-426614174000')
  form.append('attachments', new File([minimalPng()], 'foto.png', { type: 'image/png' }))
  form.append('attachmentCategory', 'certificado_origen')

  const queries = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    queries.push(JSON.parse(options.body).query)
    return db.fetch(url, options)
  }
  try {
    const response = await handlePublicRequests(new Request('https://example.test/api/public/quotes', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: form,
    }), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /no está permitida/i)
    assert.equal(queries.some((query) => query.includes('INSERT INTO operations.requests')), false)
  } finally { globalThis.fetch = originalFetch }
})
