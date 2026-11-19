import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => new URL(`../worker/db/migrations/${name}`, import.meta.url)

const importRequest = '11111111-1111-4111-8111-111111111111'
const agentRequest = '22222222-2222-4222-8222-222222222222'
const legacyAttachment = '33333333-3333-4333-8333-333333333333'
const checksumA = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)
const checksumC = 'c'.repeat(64)
const checksumD = 'd'.repeat(64)

let db

async function insertAttachment(overrides = {}) {
  const requestId = overrides.request_id ?? importRequest
  const values = {
    id: randomUUID(),
    request_id: requestId,
    storage_key: `requests/${requestId}/${randomUUID()}-documento.pdf`,
    original_name: 'documento.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    status: 'pending',
    category: 'factura_comercial',
    stage: 'cotizacion',
    uploaded_by_kind: 'client',
    checksum_sha256: null,
    ...overrides,
  }
  const columns = Object.keys(values)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
  return db.query(
    `INSERT INTO operations.request_attachments (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    columns.map((column) => values[column]),
  )
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE SCHEMA operations;
    CREATE TABLE operations.requests (id UUID PRIMARY KEY, service_type TEXT NOT NULL);
    CREATE TABLE operations.users (id UUID PRIMARY KEY);
  `)
  await db.exec(await fs.readFile(migration('010_request_attachments.sql'), 'utf8'))
  await db.query(
    `INSERT INTO operations.requests (id, service_type) VALUES ($1, 'importacion'), ($2, 'agente_carga')`,
    [importRequest, agentRequest],
  )
  // Fila previa a la migración: 'available' debe convertirse en 'validated'.
  await db.query(
    `INSERT INTO operations.request_attachments (id, request_id, storage_key, original_name, mime_type, size_bytes, status)
     VALUES ($1, $2, $3, 'legacy.pdf', 'application/pdf', 512, 'available')`,
    [legacyAttachment, importRequest, `requests/${importRequest}/${legacyAttachment}-legacy.pdf`],
  )
  await db.exec(await fs.readFile(migration('049_request_attachment_catalog.sql'), 'utf8'))
})

after(async () => {
  await db?.close()
})

test('migration converts legacy available attachments to validated metadata', async () => {
  const { rows } = await db.query(
    'SELECT status, category, stage, uploaded_by_kind, metadata FROM operations.request_attachments WHERE id = $1',
    [legacyAttachment],
  )
  assert.deepEqual(rows[0], {
    status: 'validated',
    category: 'documento_general',
    stage: 'cotizacion',
    uploaded_by_kind: 'client',
    metadata: {},
  })
})

test('a request accepts multiple attachments from its service categories', async () => {
  await insertAttachment({ category: 'factura_comercial', checksum_sha256: checksumA })
  await insertAttachment({ category: 'packing_list', checksum_sha256: checksumB })
  const { rows } = await db.query(
    `SELECT category, status FROM operations.request_attachments
      WHERE request_id = $1 ORDER BY category`,
    [importRequest],
  )
  assert.deepEqual(rows.map((row) => row.category), ['documento_general', 'factura_comercial', 'packing_list'])
  assert.ok(rows.every((row) => row.status === 'validated' || row.status === 'pending'))
})

test('rejects a category that does not belong to the request service', async () => {
  await assert.rejects(
    insertAttachment({ request_id: importRequest, category: 'instrucciones_embarque' }),
    /no está permitida para el servicio/,
  )
  await assert.rejects(
    insertAttachment({ request_id: agentRequest, category: 'certificado_origen' }),
    /no está permitida para el servicio/,
  )
})

test('rejects storage keys outside the request prefix', async () => {
  await assert.rejects(
    insertAttachment({ storage_key: `requests/${agentRequest}/otro.pdf` }),
    /no corresponde a la solicitud/,
  )
})

test('rejects MIME types and sizes outside the category limits', async () => {
  await assert.rejects(
    insertAttachment({ mime_type: 'image/gif' }),
    /no está permitido para la categoría/,
  )
  await assert.rejects(
    insertAttachment({ size_bytes: 10 * 1024 * 1024 + 1 }),
    /supera el tamaño máximo/,
  )
})

test('enforces per-category file count limit', async () => {
  await db.query(
    `UPDATE operations.request_attachment_requirements SET max_files = 1
      WHERE service_type = 'importacion' AND category = 'documento_transporte'`,
  )
  await insertAttachment({ category: 'documento_transporte', checksum_sha256: checksumC })
  await assert.rejects(
    insertAttachment({ category: 'documento_transporte' }),
    /admite máximo 1 archivos/,
  )
})

test('blocks duplicate checksums only while an attachment is active', async () => {
  const first = await insertAttachment({ category: 'certificado_origen', checksum_sha256: checksumD })
  await assert.rejects(
    insertAttachment({ category: 'certificado_origen', checksum_sha256: checksumD }),
    /duplicate key|unique/i,
  )
  await db.query(`UPDATE operations.request_attachments SET status = 'deleted' WHERE id = $1`, [first.rows[0].id])
  await insertAttachment({ category: 'certificado_origen', checksum_sha256: checksumD })
})

test('accepts only the pending/validated/rejected/deleted lifecycle', async () => {
  for (const status of ['pending', 'validated', 'rejected', 'deleted']) {
    const { rows } = await insertAttachment({ status })
    assert.equal(rows[0].status, status)
  }
  await assert.rejects(
    insertAttachment({ status: 'available' }),
    /request_attachments_status_check/,
  )
})

test('completeness ignores pending, rejected and deleted attachments', async () => {
  await db.query(
    `UPDATE operations.request_attachment_requirements SET min_files = 2, max_files = 5
      WHERE service_type = 'agente_carga' AND category = 'packing_list'`,
  )
  const complete = async () =>
    (await db.query('SELECT operations.request_attachments_complete($1, $2) AS complete', [agentRequest, 'reserva'])).rows[0].complete

  assert.equal(await complete(), false)

  await insertAttachment({ request_id: agentRequest, category: 'packing_list', status: 'pending' })
  assert.equal(await complete(), false)

  const rejected = await insertAttachment({ request_id: agentRequest, category: 'packing_list', status: 'rejected' })
  const firstValidated = await insertAttachment({ request_id: agentRequest, category: 'packing_list', status: 'validated' })
  assert.equal(await complete(), false)

  await insertAttachment({ request_id: agentRequest, category: 'packing_list', status: 'validated' })
  assert.equal(await complete(), true)

  await db.query(
    `UPDATE operations.request_attachments SET status = 'deleted' WHERE id IN ($1, $2)`,
    [rejected.rows[0].id, firstValidated.rows[0].id],
  )
  assert.equal(await complete(), false)

  await insertAttachment({ request_id: agentRequest, category: 'packing_list', status: 'validated' })
  assert.equal(await complete(), true)
})

test('completeness is false for unknown requests and invalid stages', async () => {
  const unknown = await db.query('SELECT operations.request_attachments_complete($1) AS complete', [randomUUID()])
  assert.equal(unknown.rows[0].complete, false)
  await assert.rejects(
    db.query('SELECT operations.request_attachments_complete($1, $2)', [agentRequest, 'pago']),
    /Etapa de adjuntos inválida/,
  )
})

test('gap view lists missing required categories only', async () => {
  await db.query(
    `UPDATE operations.request_attachment_requirements SET min_files = 1
      WHERE service_type = 'agente_carga' AND category = 'documento_transporte'`,
  )
  const before = await db.query(
    `SELECT category, validated_count FROM operations.request_attachment_gaps WHERE request_id = $1`,
    [agentRequest],
  )
  assert.deepEqual(before.rows.map((row) => row.category), ['documento_transporte'])

  await insertAttachment({ request_id: agentRequest, category: 'documento_transporte', status: 'validated' })
  const afterRows = await db.query(
    `SELECT category FROM operations.request_attachment_gaps WHERE request_id = $1`,
    [agentRequest],
  )
  assert.equal(afterRows.rows.length, 0)
})
