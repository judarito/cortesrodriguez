import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import {
  reserveBricksSubmission, cancelUnsubmittedBricks, reconcilePaymentHistory, selectPaymentAttemptCandidate,
  resolveWebhookPaymentCredential, processClientBricksPayment,
} from '../worker/routes/publicRequests.js'
import { shouldKeepBricksAttempt } from '../src/lib/paymentFlow.js'

const requestId = '671b1bfd-c8d3-48ec-b647-a14345db69e4'
const attemptId = '2efcc558-5054-4c68-a49a-77f1a730c6a7'
const email = 'cliente@example.test'
let db
const sql = async (parts, ...params) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
  return (await db.query(query, params)).rows
}
before(async () => {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA operations;
    CREATE TABLE operations.requests (
      id uuid PRIMARY KEY, email text, reference text, status text, payment_required boolean,
      confirmed_payment_attempt_id uuid, public_idempotency_key_hash text,
      public_submission_completed_at timestamptz
    );
    CREATE TABLE operations.request_payments (
      id uuid PRIMARY KEY, request_id uuid, reference text, checkout_mode text, status text,
      usd_amount_cents integer, cop_amount_cents integer, provider_submission_started_at timestamptz,
      mercado_pago_payment_id text, updated_at timestamptz
    );`)
})
after(async () => { await db?.close() })
async function fixture() {
  await db.exec('TRUNCATE operations.request_payments, operations.requests')
  await db.query(`INSERT INTO operations.requests VALUES ($1,$2,'CRA-20261027-A1B2C3','pending',true,NULL,'capability-hash',NOW())`, [requestId, email])
  await db.query(`INSERT INTO operations.request_payments (id,request_id,reference,checkout_mode,status,usd_amount_cents,cop_amount_cents)
    VALUES ($1,$2,'CRA-20261027-A1B2C3','bricks','pending',1000,4000000)`, [attemptId, requestId])
}

for (const status of ['cancelled', 'closed']) {
  test(`PostgreSQL refuses first Brick submission for a ${status} request`, async () => {
    await fixture()
    await db.query('UPDATE operations.requests SET status=$1', [status])
    assert.deepEqual(await reserveBricksSubmission(sql, attemptId, email), [])
    assert.equal((await db.query('SELECT provider_submission_started_at FROM operations.request_payments')).rows[0].provider_submission_started_at, null)
  })
}
test('PostgreSQL reserves first submission once; parallel reservations cannot both win', async () => {
  await fixture()
  const claims = await Promise.all([reserveBricksSubmission(sql, attemptId, email), reserveBricksSubmission(sql, attemptId, email)])
  assert.equal(claims.reduce((count, rows) => count + rows.length, 0), 1)
  assert.ok((await db.query('SELECT provider_submission_started_at FROM operations.request_payments')).rows[0].provider_submission_started_at)
})
test('PostgreSQL refuses another canonical payment, an approved payment, and requests without payment requirement', async () => {
  await fixture()
  await db.query('UPDATE operations.requests SET confirmed_payment_attempt_id=$1', [requestId])
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, email), [])
  await fixture()
  await db.query(`INSERT INTO operations.request_payments (id,request_id,status) VALUES ($1,$2,'approved')`, [requestId, requestId])
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, email), [])
  await fixture()
  await db.exec('UPDATE operations.requests SET payment_required=false')
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, email), [])
})
test('PostgreSQL checks owner or current initial-payment capability at reservation', async () => {
  await fixture()
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, 'other@example.test'), [])
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, null, 'wrong-hash'), [])
  await db.exec("UPDATE operations.requests SET public_submission_completed_at=NOW()-INTERVAL '3 hours'")
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, null, 'capability-hash'), [])
  await db.exec('UPDATE operations.requests SET public_submission_completed_at=NOW()')
  assert.equal((await reserveBricksSubmission(sql, attemptId, null, 'capability-hash')).length, 1)
})
test('rollback cancels only never-submitted Bricks; a stale tab cannot charge the invalidated attempt', async () => {
  await fixture()
  assert.equal((await cancelUnsubmittedBricks(sql, requestId, email)).length, 1)
  assert.equal((await db.query('SELECT status FROM operations.request_payments')).rows[0].status, 'cancelled')
  assert.deepEqual(await reserveBricksSubmission(sql, attemptId, email), [])
  await fixture()
  assert.equal((await reserveBricksSubmission(sql, attemptId, email)).length, 1)
  assert.deepEqual(await cancelUnsubmittedBricks(sql, requestId, email), [])
  assert.equal((await db.query('SELECT status FROM operations.request_payments')).rows[0].status, 'pending')
})
test('rollback cannot invalidate another owner, a Pro checkout or a provider-linked payment', async () => {
  await fixture()
  assert.deepEqual(await cancelUnsubmittedBricks(sql, requestId, 'other@example.test'), [])
  await db.exec("UPDATE operations.request_payments SET checkout_mode='pro'")
  assert.deepEqual(await cancelUnsubmittedBricks(sql, requestId, email), [])
  await db.exec("UPDATE operations.request_payments SET checkout_mode='bricks',mercado_pago_payment_id='123'")
  assert.deepEqual(await cancelUnsubmittedBricks(sql, requestId, email), [])
})
test('processing a cancelled request never calls the charge provider (actual PostgreSQL query path)', async () => {
  await fixture()
  await db.exec("UPDATE operations.requests SET status='cancelled'")
  const originalFetch = globalThis.fetch
  let charges = 0
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.mercadopago.com')) { charges++; throw new Error('Unexpected charge') }
    const { query, params } = JSON.parse(options.body)
    const result = await db.query(query, params)
    return new Response(JSON.stringify({fields:result.fields, rows:result.rows.map(row => result.fields.map(field => {
      const value = row[field.name]
      return value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? (value ? 't' : 'f') : value
    }))}), { headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await processClientBricksPayment(new Request('https://example.test/api/client/pay', {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({attemptId,token:'fake-card-token',payment_method_id:'visa',installments:1,payer:{email}}),
    }), {NEON_DATABASE_URL:'postgres://test:test@ep-test.neon.tech/db',MP_BRICKS_ACCESS_TOKEN:'test-only',LANDING_FLAGS:{getBooleanValue:async()=>true}}, email)
    assert.equal(result.status, 409)
    assert.equal(charges, 0)
  } finally { globalThis.fetch = originalFetch }
})

const candidates = [
  {id:'new', reference:'case', checkout_mode:'pro',mercado_pago_preference_id:'pref-new',mercado_pago_payment_id:'222'},
  {id:'old', reference:'case', checkout_mode:'pro',mercado_pago_preference_id:'pref-old',mercado_pago_payment_id:'111'},
]
test('known provider payment resolves its historical attempt without preference_id', () => {
  assert.equal(selectPaymentAttemptCandidate(candidates,{id:'111'}).id,'old')
  assert.equal(resolveWebhookPaymentCredential([{providerMode:'pro',payment:{id:'111',external_reference:'case'}}],candidates,'111').attempt.id,'old')
})
test('conflicting and ambiguous payment identities are not assigned by date', () => {
  assert.equal(selectPaymentAttemptCandidate(candidates,{id:'111',metadata:{cra_payment_attempt_id:'new'}}),null)
  assert.equal(selectPaymentAttemptCandidate(candidates,{id:'333'}),null)
  assert.equal(selectPaymentAttemptCandidate(candidates,{id:'333',preference_id:'missing'}),null)
  assert.equal(selectPaymentAttemptCandidate(candidates,{id:'333',preference_id:'pref-old'}),null)
  assert.equal(selectPaymentAttemptCandidate([...candidates,{...candidates[0],id:'duplicate',mercado_pago_payment_id:'111'}],{id:'111'}),null)
})
test('new Pro payments bind to metadata while historical unambiguous payments remain supported', () => {
  const fresh = [{id:'one',reference:'case',checkout_mode:'pro'},{id:'two',reference:'case',checkout_mode:'pro'}]
  assert.equal(selectPaymentAttemptCandidate(fresh,{id:'444',metadata:{cra_payment_attempt_id:'two'}}).id,'two')
  assert.equal(resolveWebhookPaymentCredential([{providerMode:'pro',payment:{id:'444',external_reference:'case',metadata:{cra_payment_attempt_id:'two'}}}],fresh,'444').attempt.id,'two')
  assert.equal(selectPaymentAttemptCandidate([fresh[0]],{id:'444'}).id,'one')
})
test('portal keeps unresolved Brick attempts but uses current mode for terminal retries', () => {
  for (const paymentAction of ['pay','retry']) assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction}),false)
  for (const paymentAction of ['resume','checking']) assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction}),true)
  assert.equal(shouldKeepBricksAttempt({checkoutMode:'pro',paymentAction:'resume'}),false)
  assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction:'resume',paymentSubmitted:false},'pro'),false)
  assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction:'resume',paymentSubmitted:true},'pro'),true)
  assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction:'checking',paymentSubmitted:false},'pro'),true)
  assert.equal(shouldKeepBricksAttempt({checkoutMode:'bricks',paymentAction:'resume'},'pro'),true)
})

test('new checkout reconciliation blocks approved, refunded, uncertain and unavailable history', async () => {
  const originalFetch = globalThis.fetch
  let providerUnavailable = false
  globalThis.fetch = async () => new Response(JSON.stringify(providerUnavailable ? {message:'synthetic outage'} : {results:[]}), {
    status:providerUnavailable ? 503 : 200, headers:{'content-type':'application/json'},
  })
  let localStatus = 'rejected'
  const historySql = async (parts) => {
    const query = parts.join('?')
    if (query.includes('SELECT 1 FROM operations.request_payments')) return [{exists:1}]
    if (query.includes('SELECT id, reference FROM operations.requests')) return [{id:requestId,reference:'CRA-20261027-A1B2C3'}]
    if (query.includes('SELECT id, checkout_mode')) return [{id:attemptId,checkout_mode:'pro'}]
    if (query.includes('SELECT status FROM operations.request_payments')) return [{status:localStatus}]
    throw new Error(`Unexpected SQL: ${query}`)
  }
  try {
    for (localStatus of ['approved','refunded','charged_back','creation_uncertain','duplicate_approved']) {
      const blocked = await reconcilePaymentHistory(historySql, requestId, {MP_ACCESS_TOKEN:'test-only'})
      assert.equal(blocked.status,409,localStatus)
    }
    localStatus = 'rejected'
    assert.equal(await reconcilePaymentHistory(historySql,requestId,{MP_ACCESS_TOKEN:'test-only'}),null)
    providerUnavailable = true
    assert.equal((await reconcilePaymentHistory(historySql,requestId,{MP_ACCESS_TOKEN:'test-only'})).status,409)
    assert.equal((await reconcilePaymentHistory(historySql,requestId,{})).status,503)
  } finally { globalThis.fetch = originalFetch }
})
