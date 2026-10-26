const SESSION_CHECK_INTERVAL_MS = 60_000

export class NotificationHub {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/connect' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const userId = request.headers.get('x-notification-user-id')
      const sessionTokenHash = request.headers.get('x-notification-session-hash')
      const permissionsHash = request.headers.get('x-notification-permissions-hash')
      if (!userId || !sessionTokenHash || !/^[A-Za-z0-9_-]{43}$/.test(permissionsHash || '')) {
        return new Response('Unauthorized', { status: 401 })
      }
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server)
      server.serializeAttachment({ userId, sessionTokenHash, permissionsHash })
      await this.scheduleSessionCheck()
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      let message
      if (body.type === 'request-updated' && /^[0-9a-f-]{36}$/i.test(String(body.requestId || '')) && /^[a-z_]{1,50}$/.test(String(body.eventCode || ''))) {
        message = JSON.stringify({ type: 'request-updated', requestId: String(body.requestId), eventCode: String(body.eventCode) })
      } else if (body.notificationId) {
        message = JSON.stringify({ type: 'notification', id: String(body.notificationId) })
      } else {
        return new Response('Bad request', { status: 400 })
      }
      for (const socket of this.state.getWebSockets()) {
        if (!await this.isSessionActive(socket)) {
          closeSocket(socket)
          continue
        }
        try { socket.send(message) } catch { /* Closed connections are removed by the runtime. */ }
      }
      await this.scheduleSessionCheck()
      return new Response(null, { status: 204 })
    }

    return new Response('Not found', { status: 404 })
  }

  async alarm() {
    for (const socket of this.state.getWebSockets()) {
      if (!await this.isSessionActive(socket)) closeSocket(socket)
    }
    await this.scheduleSessionCheck()
  }

  async isSessionActive(socket) {
    const attachment = socket.deserializeAttachment()
    if (!attachment?.userId || !attachment?.sessionTokenHash || !attachment?.permissionsHash || !this.env?.NEON_DATABASE_URL) return false
    try {
      const { neon } = await import('@neondatabase/serverless')
      const sql = neon(this.env.NEON_DATABASE_URL)
      return await validateSessionAttachment(sql, attachment)
    } catch {
      // Fail closed when the session or its current permissions cannot be verified.
      return false
    }
  }

  async scheduleSessionCheck() {
    if (!this.state.getWebSockets().length) {
      await this.state.storage?.deleteAlarm()
      return
    }
    const scheduled = await this.state.storage?.getAlarm()
    if (scheduled === null || scheduled === undefined) {
      await this.state.storage?.setAlarm(Date.now() + SESSION_CHECK_INTERVAL_MS)
    }
  }

  async webSocketMessage(socket) {
    // This channel is server-to-client only.
    closeSocket(socket)
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason) } catch { /* Already closed. */ }
  }

  async webSocketError(socket) {
    closeSocket(socket)
  }
}

export async function validateSessionAttachment(sql, attachment) {
  const sessions = await sql`
    SELECT 1
    FROM operations.sessions s
    JOIN operations.users u ON u.id = s.user_id
    WHERE s.user_id = ${attachment.userId} AND s.token_hash = ${attachment.sessionTokenHash}
      AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.active = TRUE
    LIMIT 1
  `
  if (!sessions.length) return false
  const permissions = await sql`
    SELECT DISTINCT p.code
    FROM operations.user_roles ur
    JOIN operations.role_permissions rp ON rp.role_id = ur.role_id
    JOIN operations.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${attachment.userId}
    ORDER BY p.code
  `
  const current = permissions.map((row) => String(row.code))
  return await sha256(JSON.stringify(current)) === attachment.permissionsHash
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''; digest.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function closeSocket(socket) {
  try { socket.close(1008, 'Session is no longer active') } catch { /* Ignore a disconnected socket. */ }
}
