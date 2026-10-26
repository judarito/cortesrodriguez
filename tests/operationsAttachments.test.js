import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { getImage } from '../worker/index.js'
import { handleOperationsAttachments } from '../worker/routes/operationsAttachments.js'

const secret = 'attachment-access-test-secret'
const userId = '80199877-a6f9-46fc-8f87-6117846d8eef'
const requestId = '90199877-a6f9-46fc-8f87-6117846d8eef'
const attachmentId = 'a0199877-a6f9-46fc-8f87-6117846d8eef'

function token() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ sub: userId, scope: 'operations', exp: Math.floor(Date.now() / 1000) + 3600 })
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function pgResult(rows, columns) {
  return new Response(JSON.stringify({
    fields: columns.map((name) => ({ name, dataTypeID: 25 })),
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  }), { headers: { 'content-type': 'application/json' } })
}

function mockDb({ permissions = ['attachments.read'], roles = ['expert'], attachment = true } = {}) {
  const queries = []
  return {
    queries,
    fetch: async (_url, options) => {
      const { query } = JSON.parse(options.body)
      queries.push(query)
      if (query.includes('FROM operations.sessions s')) return pgResult([{ id: userId, email: 'expert@example.test', full_name: 'Experto' }], ['id', 'email', 'full_name'])
      if (query.includes('FROM operations.user_roles ur JOIN operations.roles')) return pgResult(roles.map((name) => ({ name })), ['name'])
      if (query.includes('JOIN operations.role_permissions rp')) return pgResult(permissions.map((code) => ({ code })), ['code'])
      if (query.includes('FROM operations.request_attachments a')) return pgResult(attachment ? [{ storage_key: `requests/${requestId}/${attachmentId}.png`, mime_type: 'image/png', original_name: 'document.png' }] : [], ['storage_key', 'mime_type', 'original_name'])
      throw new Error(`Unexpected SQL: ${query}`)
    },
  }
}

test('private request attachment download requires an active expert assignment and permission', async () => {
  const db = mockDb()
  const requestedKeys = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request(`https://app.example.test/api/app/requests/${requestId}/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token()}` },
    })
    const result = await handleOperationsAttachments(request, {
      NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: secret,
      GALLERY_IMAGES: { get: async (key) => { requestedKeys.push(key); return { body: new Blob(['image']) } } },
    })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'private, no-store, max-age=0')
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(requestedKeys, [`requests/${requestId}/${attachmentId}.png`])
    const query = db.queries.find((item) => item.includes('FROM operations.request_attachments a'))
    assert.match(query, /r\.assigned_expert_id =/)
    assert.match(query, /r\.payment_required = FALSE OR EXISTS/)
    assert.match(query, /a\.storage_key LIKE/)
  } finally { globalThis.fetch = originalFetch }
})

test('non-expert role without attachment permission cannot query private attachment metadata', async () => {
  const db = mockDb({ permissions: [], roles: ['viewer'] })
  const originalFetch = globalThis.fetch
  globalThis.fetch = db.fetch
  try {
    const request = new Request(`https://app.example.test/api/app/requests/${requestId}/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token()}` },
    })
    const result = await handleOperationsAttachments(request, { NEON_DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/db', OPERATIONS_JWT_SECRET: secret })
    assert.equal(result.status, 403)
    assert.equal(db.queries.some((query) => query.includes('FROM operations.request_attachments a')), false)
  } finally { globalThis.fetch = originalFetch }
})

test('public image endpoint refuses request-storage keys without reading R2', async () => {
  let reads = 0
  const request = new Request(`https://app.example.test/images/requests/${requestId}/${attachmentId}.png`)
  const result = await getImage(request, { GALLERY_IMAGES: { get: async () => { reads += 1; return null } } })
  assert.equal(result.status, 404)
  assert.equal(reads, 0)
})
