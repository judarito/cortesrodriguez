import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => new URL(`../worker/db/migrations/${name}`, import.meta.url)

const legacyActions = ['token', 'request', 'payment_preference', 'payment_bricks_intent', 'payment_bricks_process']
const quoteActions = ['quote', 'quote_convert', 'quote_attachment_upload', 'quote_attachment_delete']

let db

async function insertBucket(action) {
  return db.query(
    `INSERT INTO operations.public_request_rate_limits (ip_hash, action, window_started_at, request_count)
     VALUES ($1, $2, NOW(), 1) RETURNING action`,
    [`hash-${randomUUID()}`, action],
  )
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE SCHEMA operations;
    CREATE TABLE operations.public_request_attribution_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attribution_type TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
  `)
  await db.exec(await fs.readFile(migration('035_public_request_rate_limits.sql'), 'utf8'))
  await db.exec(await fs.readFile(migration('044_bricks_rate_limit_actions.sql'), 'utf8'))
  await db.exec(await fs.readFile(migration('050_quote_rate_limit_actions.sql'), 'utf8'))
})

after(async () => {
  await db?.close()
})

test('migration accepts the quote lifecycle rate-limit buckets', async () => {
  for (const action of quoteActions) {
    const { rows } = await insertBucket(action)
    assert.equal(rows[0].action, action)
  }
})

test('migration keeps the previously allowed action buckets', async () => {
  for (const action of legacyActions) {
    const { rows } = await insertBucket(action)
    assert.equal(rows[0].action, action)
  }
})

test('migration still rejects actions outside the whitelist', async () => {
  await assert.rejects(
    insertBucket('quote_unknown'),
    /public_request_rate_limits_action_check/,
  )
})

test('migration can be re-applied without losing the whitelist', async () => {
  await db.exec(await fs.readFile(migration('050_quote_rate_limit_actions.sql'), 'utf8'))
  const { rows } = await insertBucket('quote_attachment_upload')
  assert.equal(rows[0].action, 'quote_attachment_upload')
})
