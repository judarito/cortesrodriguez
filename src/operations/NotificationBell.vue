<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ token: { type: String, required: true } })
const emit = defineEmits(['open', 'request-updated'])
const items = ref([])
const unreadCount = ref(0)
const nextCursor = ref(null)
const open = ref(false)
const loading = ref(false)
const error = ref('')
const socketState = ref('offline')
let socket
let reconnectTimer
let pollTimer
let reconnectAttempt = 0
let disposed = false

const visibleCount = computed(() => unreadCount.value > 99 ? '99+' : unreadCount.value)
function emailStatusLabel(status) {
  return ({ not_sent: 'No aplica', accepted: 'Aceptado por Resend', sent: 'Enviado', delivered: 'Entregado', opened: 'Abierto', failed: 'Fallido', bounced: 'Rebotado', complained: 'Reportado', pending_retry: 'Pendiente de reintento' })[status] || status
}

async function load({ before = null, append = false } = {}) {
  if (!props.token) return
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: '20' })
    if (before) params.set('before', before)
    const response = await fetch(`/api/app/notifications?${params}`, { headers: { Authorization: `Bearer ${props.token}` }, cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las notificaciones.')
    items.value = append
      ? [...items.value, ...(data.items || []).filter((item) => !items.value.some((existing) => existing.id === item.id))]
      : data.items || []
    unreadCount.value = Number(data.unreadCount || 0)
    nextCursor.value = data.nextCursor || null
    error.value = ''
  } catch (loadError) {
    error.value = loadError.message
  } finally {
    loading.value = false
  }
}

function loadMore() {
  if (nextCursor.value && !loading.value) load({ before: nextCursor.value, append: true })
}

async function connect() {
  if (disposed || !props.token) return
  try {
    const ticketResponse = await fetch('/api/app/notifications/realtime-ticket', { method: 'POST', headers: { Authorization: `Bearer ${props.token}` } })
    const ticketData = await ticketResponse.json().catch(() => ({}))
    if (!ticketResponse.ok) throw new Error(ticketData.error || 'Realtime no disponible.')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(`${protocol}//${window.location.host}/api/app/notifications/realtime?ticket=${encodeURIComponent(ticketData.ticket)}`)
    socket.onopen = () => { reconnectAttempt = 0; socketState.value = 'online'; emit('request-updated', { requestId: '', eventCode: 'reconnected' }) }
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'notification') load()
        if (message.type === 'request-updated') emit('request-updated', message)
      } catch { /* Ignore malformed push frames. */ }
    }
    socket.onclose = () => scheduleReconnect()
    socket.onerror = () => { socketState.value = 'offline'; socket?.close() }
  } catch {
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (disposed || reconnectTimer) return
  socketState.value = 'offline'
  reconnectAttempt += 1
  const delay = Math.min(30_000, 1000 * (2 ** Math.min(reconnectAttempt, 5)))
  reconnectTimer = window.setTimeout(() => { reconnectTimer = undefined; connect() }, delay)
}

async function markRead(item) {
  if (!item.readAt) {
    try {
      const response = await fetch(`/api/app/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST', headers: { Authorization: `Bearer ${props.token}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la notificación.')
      unreadCount.value = Number(data.unreadCount || 0)
      const index = items.value.findIndex((entry) => entry.id === item.id)
      if (index >= 0) items.value[index] = data.item
    } catch (readError) { error.value = readError.message; return }
  }
  open.value = false
  emit('open', item)
}

function onOutsideClick(event) {
  if (!event.target.closest('.notification-bell')) open.value = false
}

watch(() => props.token, async () => { await load(); await connect() })
onMounted(() => {
  load()
  connect()
  pollTimer = window.setInterval(() => {
    load()
    if (socketState.value !== 'online') emit('request-updated', { requestId: '', eventCode: 'poll_fallback' })
  }, 60_000)
  document.addEventListener('click', onOutsideClick)
})
onBeforeUnmount(() => {
  disposed = true
  window.clearTimeout(reconnectTimer)
  window.clearInterval(pollTimer)
  document.removeEventListener('click', onOutsideClick)
  socket?.close()
})
</script>

<template>
  <div class="notification-bell">
    <button class="bell-trigger" type="button" aria-label="Notificaciones" :aria-expanded="open" @click="open = !open; open && load()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span v-if="unreadCount" class="bell-count">{{ visibleCount }}</span>
      <span class="connection-dot" :class="socketState" :aria-label="socketState === 'online' ? 'Conectada' : 'Reconectando'" />
    </button>
    <section v-if="open" class="notification-popover" aria-label="Bandeja de notificaciones">
      <header><div><strong>Notificaciones</strong><small>{{ unreadCount }} sin leer</small></div><button type="button" @click="load">Actualizar</button></header>
      <p v-if="error" class="notification-error" role="alert">{{ error }}</p>
      <div v-if="loading && !items.length" class="notification-empty">Cargando…</div>
      <div v-else-if="!items.length" class="notification-empty">No tienes notificaciones.</div>
      <button v-for="item in items" :key="item.id" type="button" class="notification-item" :class="{ unread: !item.readAt }" @click="markRead(item)">
        <span class="notification-copy"><strong>{{ item.title }}</strong><span>{{ item.message }}</span><small>{{ new Date(item.createdAt).toLocaleString('es-CO') }} · Correo: {{ emailStatusLabel(item.emailStatus) }}</small></span>
        <i v-if="!item.readAt" aria-label="Sin leer" />
      </button>
      <button v-if="nextCursor" class="notification-more" type="button" :disabled="loading" @click="loadMore">{{ loading ? 'Cargando…' : 'Cargar anteriores' }}</button>
    </section>
  </div>
</template>

<style scoped>
.notification-bell{position:relative}.bell-trigger{position:relative;display:grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:8px;color:#526174;background:transparent;cursor:pointer}.bell-trigger:hover,.bell-trigger[aria-expanded=true]{border-color:#e2e8f0;background:#fff}.bell-trigger svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.bell-count{position:absolute;top:-3px;right:-5px;display:grid;place-items:center;min-width:17px;height:17px;padding:0 4px;border:2px solid #f6f8fb;border-radius:10px;color:#fff;background:#e44d55;font-size:8px;font-weight:800}.connection-dot{position:absolute;right:2px;bottom:2px;width:6px;height:6px;border:1px solid #fff;border-radius:50%;background:#aab3bf}.connection-dot.online{background:#45ad84}.notification-popover{position:absolute;z-index:50;top:44px;right:-54px;width:min(380px,calc(100vw - 28px));max-height:min(520px,calc(100vh - 120px));overflow:auto;border:1px solid #e3e9ef;border-radius:11px;background:#fff;box-shadow:0 14px 40px rgba(20,44,67,.18)}.notification-popover>header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #edf1f5;background:#fff}.notification-popover>header div{display:grid;gap:3px}.notification-popover>header strong{color:#223b53;font-size:13px}.notification-popover>header small,.notification-popover>header button{color:#8693a2;font-size:10px}.notification-popover>header button{padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer}.notification-item{display:flex;width:100%;align-items:start;gap:12px;padding:13px 16px;border:0;border-bottom:1px solid #f0f2f5;color:inherit;background:#fff;text-align:left;cursor:pointer}.notification-item:hover,.notification-item.unread{background:#f6fafc}.notification-copy{display:grid;gap:5px;min-width:0;flex:1}.notification-copy strong{color:#344b60;font-size:11px}.notification-copy>span{color:#637387;font-size:10px;line-height:1.45}.notification-copy small{color:#98a2b3;font-size:9px}.notification-item>i{width:7px;height:7px;flex:0 0 7px;margin-top:4px;border-radius:50%;background:#3c91b4}.notification-empty,.notification-error{padding:24px 16px;color:#8794a3;font-size:11px;text-align:center}.notification-error{color:#a33a3a}
.notification-more{display:block;width:calc(100% - 28px);margin:10px 14px 14px;padding:8px;border:1px solid #e2e8f0;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:700;cursor:pointer}.notification-more:disabled{opacity:.6;cursor:wait}
</style>
