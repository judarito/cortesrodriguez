export class NotificationHub {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/connect' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const userId = request.headers.get('x-notification-user-id')
      if (!userId) return new Response('Unauthorized', { status: 401 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server)
      server.serializeAttachment({ userId })
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
        try { socket.send(message) } catch { /* Closed connections are removed by the runtime. */ }
      }
      return new Response(null, { status: 204 })
    }

    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(socket) {
    // This channel is server-to-client only.
    try { socket.close(1008, 'Read-only notification channel') } catch { /* Ignore a disconnected socket. */ }
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason) } catch { /* Already closed. */ }
  }
}
