import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSessionAttachment } from '../worker/NotificationHub.js'

function sessionSql({ active = true, permissions = ['notifications.read'] } = {}) {
  const calls = []
  const sql = async (parts, ...values) => {
    const query = parts.join('?')
    calls.push({ query, values })
    if (query.includes('FROM operations.sessions')) return active ? [{ session: 1 }] : []
    return [...permissions].sort().map((code) => ({ code }))
  }
  return { sql, calls }
}

async function permissionsHash(permissions) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([...permissions].sort()))))
  let binary = ''; digest.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

test('notification socket remains valid only for its active database session', async () => {
  const { sql, calls } = sessionSql()
  const valid = await validateSessionAttachment(sql, {
    userId: 'user-1', sessionTokenHash: 'hashed-session-token', permissionsHash: await permissionsHash(['notifications.read']),
  })
  assert.equal(valid, true)
  assert.equal(calls.length, 2)
  assert.ok(calls[0].query.includes('s.revoked_at IS NULL'))
  assert.ok(calls[0].query.includes('s.expires_at > NOW()'))
  assert.ok(calls[0].query.includes('u.active = TRUE'))
  assert.deepEqual(calls[0].values, ['user-1', 'hashed-session-token'])
})

test('notification socket is invalid after session revoke, expiry, or user deactivation', async () => {
  const { sql } = sessionSql({ active: false })
  assert.equal(await validateSessionAttachment(sql, {
    userId: 'user-1', sessionTokenHash: 'hashed-session-token', permissionsHash: await permissionsHash(['notifications.read']),
  }), false)
})

test('notification socket is invalid when its current permissions change', async () => {
  const { sql } = sessionSql({ permissions: ['notifications.read', 'users.manage'] })
  assert.equal(await validateSessionAttachment(sql, {
    userId: 'user-1', sessionTokenHash: 'hashed-session-token', permissionsHash: await permissionsHash(['notifications.read']),
  }), false)
})

test('notification socket permission snapshot comparison is order stable', async () => {
  const { sql } = sessionSql({ permissions: ['requests.read', 'notifications.read'] })
  assert.equal(await validateSessionAttachment(sql, {
    userId: 'user-1', sessionTokenHash: 'hashed-session-token', permissionsHash: await permissionsHash(['notifications.read', 'requests.read']),
  }), true)
})
