import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => new URL(`../worker/db/migrations/${name}`, import.meta.url)

const importRequest = '11111111-1111-4111-8111-111111111111'
const exportRequest = '22222222-2222-4222-8222-222222222222'
const agentRequest = '33333333-3333-4333-8333-333333333333'

let db

const matrixSql = () => fs.readFile(migration('051_request_attachment_matrix.sql'), 'utf8')

before(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE SCHEMA operations;
    CREATE TABLE operations.requests (id UUID PRIMARY KEY, service_type TEXT NOT NULL);
    CREATE TABLE operations.users (id UUID PRIMARY KEY);
  `)
  await db.exec(await fs.readFile(migration('010_request_attachments.sql'), 'utf8'))
  await db.query(
    `INSERT INTO operations.requests (id, service_type) VALUES ($1, 'importacion'), ($2, 'exportacion'), ($3, 'agente_carga')`,
    [importRequest, exportRequest, agentRequest],
  )
  await db.exec(await fs.readFile(migration('049_request_attachment_catalog.sql'), 'utf8'))
  await db.exec(await matrixSql())
})

after(async () => {
  await db?.close()
})

async function requirementsFor(serviceType) {
  const { rows } = await db.query(
    `SELECT category, stage, min_files, max_files, sort_order, description_es
       FROM operations.request_attachment_requirements
      WHERE service_type = $1 AND active = TRUE
      ORDER BY sort_order, category`,
    [serviceType],
  )
  return rows
}

async function complete(requestId, stage) {
  const { rows } = await db.query(
    'SELECT operations.request_attachments_complete($1, $2) AS complete',
    [requestId, stage],
  )
  return rows[0].complete
}

async function insertValidated(requestId, category) {
  const id = randomUUID()
  await db.query(
    `INSERT INTO operations.request_attachments
       (id, request_id, storage_key, original_name, mime_type, size_bytes, status, category, stage, uploaded_by_kind)
     VALUES ($1, $2, $3, 'documento.pdf', 'application/pdf', 1024, 'validated', $4, 'reserva', 'client')`,
    [id, requestId, `requests/${requestId}/${id}-documento.pdf`, category],
  )
}

test('import and export shares a conservative staged matrix', async () => {
  for (const serviceType of ['importacion', 'exportacion']) {
    const rows = await requirementsFor(serviceType)
    assert.deepEqual(
      rows.map((row) => [row.category, row.stage]),
      [
        ['documento_general', 'any'],
        ['factura_comercial', 'any'],
        ['packing_list', 'reserva'],
        ['documento_transporte', 'reserva'],
        ['certificado_origen', 'reserva'],
      ],
    )
    assert.ok(rows.every((row) => row.min_files === 0), 'la matriz inicial no bloquea por defecto')
    assert.ok(rows.every((row) => row.description_es), 'cada categoría documenta su propósito')
  }
})

test('freight agent exposes shipping-specific categories at reservation', async () => {
  const rows = await requirementsFor('agente_carga')
  assert.deepEqual(
    rows.map((row) => [row.category, row.stage]),
    [
      ['documento_general', 'any'],
      ['instrucciones_embarque', 'any'],
      ['packing_list', 'reserva'],
      ['documento_transporte', 'reserva'],
    ],
  )
  assert.ok(rows.every((row) => row.min_files === 0))
})

test('quote and reservation stages are complete while the matrix stays conservative', async () => {
  assert.equal(await complete(importRequest, 'cotizacion'), true)
  assert.equal(await complete(importRequest, 'reserva'), true)
  assert.equal(await complete(agentRequest, 'reserva'), true)
})

test('raising min_files turns a reservation category into a real requirement', async () => {
  await db.query(
    `UPDATE operations.request_attachment_requirements
        SET min_files = 1
      WHERE service_type = 'exportacion' AND category = 'certificado_origen'`,
  )

  assert.equal(await complete(exportRequest, 'cotizacion'), true, 'la cotización no exige documentos operativos')
  assert.equal(await complete(exportRequest, 'reserva'), false)

  const gaps = await db.query(
    `SELECT category, min_files, validated_count
       FROM operations.request_attachment_gaps
      WHERE request_id = $1 AND stage IN ('any', 'reserva')
      ORDER BY category`,
    [exportRequest],
  )
  assert.deepEqual(gaps.rows, [{ category: 'certificado_origen', min_files: 1, validated_count: 0 }])

  await insertValidated(exportRequest, 'certificado_origen')
  assert.equal(await complete(exportRequest, 'reserva'), true)

  await db.query(
    `UPDATE operations.request_attachment_requirements
        SET min_files = 0
      WHERE service_type = 'exportacion' AND category = 'certificado_origen'`,
  )
})

test('re-running the migration is idempotent and preserves operator adjustments', async () => {
  await db.query(
    `UPDATE operations.request_attachment_requirements
        SET min_files = 2, max_files = 3, updated_at = NOW()
      WHERE service_type = 'importacion' AND category = 'factura_comercial'`,
  )
  const before = await requirementsFor('importacion')

  await db.exec(await matrixSql())
  await db.exec(await matrixSql())

  const after = await requirementsFor('importacion')
  assert.deepEqual(after, before)
  assert.equal(after.find((row) => row.category === 'factura_comercial').min_files, 2)

  const counts = await db.query(
    `SELECT service_type, category, COUNT(*)::INTEGER AS total
       FROM operations.request_attachment_requirements
      GROUP BY service_type, category
     HAVING COUNT(*) > 1`,
  )
  assert.deepEqual(counts.rows, [])
})

test('migration adds the staged category set when only the 049 seed exists', async () => {
  const fresh = new PGlite()
  try {
    await fresh.exec(`
      CREATE SCHEMA operations;
      CREATE TABLE operations.requests (id UUID PRIMARY KEY, service_type TEXT NOT NULL);
      CREATE TABLE operations.users (id UUID PRIMARY KEY);
    `)
    await fresh.exec(await fs.readFile(migration('010_request_attachments.sql'), 'utf8'))
    await fresh.exec(await fs.readFile(migration('049_request_attachment_catalog.sql'), 'utf8'))
    await fresh.exec(await matrixSql())
    const { rows } = await fresh.query(
      `SELECT COUNT(*)::INTEGER AS total,
              COUNT(*) FILTER (WHERE stage = 'reserva')::INTEGER AS reservation_rows,
              COUNT(*) FILTER (WHERE stage = 'any')::INTEGER AS any_rows,
              COALESCE(SUM(min_files), 0)::INTEGER AS required_total
         FROM operations.request_attachment_requirements`,
    )
    assert.deepEqual(rows[0], { total: 14, reservation_rows: 8, any_rows: 6, required_total: 0 })
  } finally {
    await fresh.close()
  }
})
