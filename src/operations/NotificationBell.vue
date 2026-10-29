<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { localeTag } from '../lib/locale.js'

const props = defineProps({ token: { type: String, required: true }, locale: { type: String, default: 'es' } })
const emit = defineEmits(['open', 'request-updated'])
const items = ref([])
const unreadCount = ref(0)
const nextCursor = ref(null)
const open = ref(false)
const loading = ref(false)
const error = ref('')
const socketState = ref('offline')
const toastNotification = ref(null)
let socket
let reconnectTimer
let pollTimer
let toastTimer
let reconnectAttempt = 0
let disposed = false
let connectionGeneration = 0
let notificationsInitialized = false
const knownNotificationIds = new Set()

const isEnglish = computed(() => props.locale === 'en')
const t = (es, en) => isEnglish.value ? en : es
const visibleCount = computed(() => unreadCount.value > 99 ? '99+' : unreadCount.value)
function emailStatusLabel(status) {
  const labels = isEnglish.value
    ? { not_sent: 'Not applicable', accepted: 'Accepted by Resend', sent: 'Sent', delivered: 'Delivered', opened: 'Opened', failed: 'Failed', bounced: 'Bounced', complained: 'Reported', pending_retry: 'Retry pending' }
    : { not_sent: 'No aplica', accepted: 'Aceptado por Resend', sent: 'Enviado', delivered: 'Entregado', opened: 'Abierto', failed: 'Fallido', bounced: 'Rebotado', complained: 'Reportado', pending_retry: 'Pendiente de reintento' }
  return labels[status] || status
}
function formatDate(value) { return new Intl.DateTimeFormat(localeTag(props.locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function localizedError(message, fallback) {
  if (!isEnglish.value) return message || fallback
  const translations = { 'No se pudieron cargar las notificaciones.': 'Could not load notifications.', 'No se pudo actualizar la notificación.': 'Could not update the notification.', 'Realtime no disponible.': 'Realtime is unavailable.' }
  return translations[message] || message || fallback
}

async function load({ before = null, append = false, announce = !before && !append } = {}) {
  if (!props.token) return
  const loadToken = props.token
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: '20' })
    if (before) params.set('before', before)
    const response = await fetch(`/api/app/notifications?${params}`, { headers: { Authorization: `Bearer ${loadToken}` }, cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(localizedError(data.error, t('No se pudieron cargar las notificaciones.', 'Could not load notifications.')))
    if (disposed || loadToken !== props.token) return
    const incoming = data.items || []
    if (!notificationsInitialized) {
      incoming.forEach((item) => knownNotificationIds.add(item.id))
      notificationsInitialized = true
    } else if (announce) {
      const fresh = incoming.filter((item) => !item.readAt && !knownNotificationIds.has(item.id))
      incoming.forEach((item) => knownNotificationIds.add(item.id))
      if (fresh.length) showToast(fresh[0])
    } else {
      incoming.forEach((item) => knownNotificationIds.add(item.id))
    }
    items.value = append
      ? [...items.value, ...incoming.filter((item) => !items.value.some((existing) => existing.id === item.id))]
      : incoming
    unreadCount.value = Number(data.unreadCount || 0)
    nextCursor.value = data.nextCursor || null
    error.value = ''
  } catch (loadError) {
    if (disposed || loadToken !== props.token) return
    error.value = localizedError(loadError.message, t('No se pudieron cargar las notificaciones.', 'Could not load notifications.'))
  } finally {
    loading.value = false
  }
}

function showToast(item) {
  toastNotification.value = item
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastNotification.value = null }, 7000)
}

function dismissToast() {
  toastNotification.value = null
  window.clearTimeout(toastTimer)
}

function openToast() {
  const item = toastNotification.value
  if (item) markRead(item)
  dismissToast()
}

function loadMore() {
  if (nextCursor.value && !loading.value) load({ before: nextCursor.value, append: true })
}

async function connect() {
  if (disposed || !props.token) return
  const generation = ++connectionGeneration
  closeCurrentSocket()
  const connectToken = props.token
  try {
    const ticketResponse = await fetch('/api/app/notifications/realtime-ticket', { method: 'POST', headers: { Authorization: `Bearer ${connectToken}` } })
    const ticketData = await ticketResponse.json().catch(() => ({}))
    if (!ticketResponse.ok) throw new Error(localizedError(ticketData.error, t('Realtime no disponible.', 'Realtime is unavailable.')))
    if (disposed || generation !== connectionGeneration || connectToken !== props.token) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/app/notifications/realtime?ticket=${encodeURIComponent(ticketData.ticket)}`)
    socket = nextSocket
    const isCurrentSocket = () => !disposed && generation === connectionGeneration && socket === nextSocket
    nextSocket.onopen = () => {
      if (!isCurrentSocket()) return
      reconnectAttempt = 0
      socketState.value = 'online'
      load()
      emit('request-updated', { requestId: '', eventCode: 'reconnected' })
    }
    nextSocket.onmessage = (event) => {
      if (!isCurrentSocket()) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'notification') load()
        if (message.type === 'request-updated') emit('request-updated', message)
      } catch { /* Ignore malformed push frames. */ }
    }
    nextSocket.onclose = () => {
      if (!isCurrentSocket()) return
      socket = undefined
      scheduleReconnect()
    }
    nextSocket.onerror = () => {
      if (!isCurrentSocket()) return
      socketState.value = 'offline'
      nextSocket.close()
    }
  } catch {
    if (!disposed && generation === connectionGeneration && connectToken === props.token) scheduleReconnect()
  }
}

function closeCurrentSocket() {
  const previous = socket
  socket = undefined
  if (!previous) return
  previous.onopen = null
  previous.onmessage = null
  previous.onerror = null
  previous.onclose = null
  try { previous.close(1000, 'Session changed') } catch { /* Ignore already closed sockets. */ }
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
      if (!response.ok) throw new Error(localizedError(data.error, t('No se pudo actualizar la notificación.', 'Could not update the notification.')))
      unreadCount.value = Number(data.unreadCount || 0)
      const index = items.value.findIndex((entry) => entry.id === item.id)
      if (index >= 0) items.value[index] = data.item
    } catch (readError) { error.value = localizedError(readError.message, t('No se pudo actualizar la notificación.', 'Could not update the notification.')); return }
  }
  open.value = false
  emit('open', item)
}

function onOutsideClick(event) {
  if (!event.target.closest('.notification-bell')) open.value = false
}

watch(() => props.token, async () => {
  connectionGeneration += 1
  window.clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  closeCurrentSocket()
  socketState.value = 'offline'
  reconnectAttempt = 0
  items.value = []
  unreadCount.value = 0
  nextCursor.value = null
  knownNotificationIds.clear()
  notificationsInitialized = false
  error.value = ''
  if (!props.token) return
  await load()
  await connect()
})
onMounted(() => {
  load()
  connect()
  pollTimer = window.setInterval(() => {
    load()
    // Refresh the active request views even if the socket looks healthy. A push
    // can be lost after publication while the connection itself remains open.
    emit('request-updated', { requestId: '', eventCode: 'poll_fallback' })
  }, 60_000)
  document.addEventListener('click', onOutsideClick)
})
onBeforeUnmount(() => {
  disposed = true
  connectionGeneration += 1
  window.clearTimeout(reconnectTimer)
  window.clearTimeout(toastTimer)
  window.clearInterval(pollTimer)
  document.removeEventListener('click', onOutsideClick)
  closeCurrentSocket()
})
</script>

<template>
  <div class="notification-bell">
    <button class="bell-trigger" type="button" :aria-label="t('Notificaciones', 'Notifications')" :aria-expanded="open" @click="open = !open; open && load()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span v-if="unreadCount" class="bell-count">{{ visibleCount }}</span>
      <span class="connection-dot" :class="socketState" :aria-label="socketState === 'online' ? t('Conectada', 'Connected') : t('Reconectando', 'Reconnecting')" />
    </button>
    <section v-if="open" class="notification-popover" :aria-label="t('Bandeja de notificaciones', 'Notification inbox')">
      <header><div><strong>{{ t('Notificaciones', 'Notifications') }}</strong><small>{{ t(`${unreadCount} sin leer`, `${unreadCount} unread`) }}</small></div><button type="button" @click="load">{{ t('Actualizar', 'Refresh') }}</button></header>
      <p v-if="error" class="notification-error" role="alert">{{ error }}</p>
      <div v-if="loading && !items.length" class="notification-empty">{{ t('Cargando…', 'Loading…') }}</div>
      <div v-else-if="!items.length" class="notification-empty">{{ t('No tienes notificaciones.', 'You have no notifications.') }}</div>
      <button v-for="item in items" :key="item.id" type="button" class="notification-item" :class="{ unread: !item.readAt }" @click="markRead(item)">
        <span class="notification-copy"><strong>{{ item.title }}</strong><span>{{ item.message }}</span><small>{{ formatDate(item.createdAt) }} · {{ t('Correo:', 'Email:') }} {{ emailStatusLabel(item.emailStatus) }}</small></span>
        <i v-if="!item.readAt" :aria-label="t('Sin leer', 'Unread')" />
      </button>
      <button v-if="nextCursor" class="notification-more" type="button" :disabled="loading" @click="loadMore">{{ loading ? t('Cargando…', 'Loading…') : t('Cargar anteriores', 'Load earlier') }}</button>
    </section>
    <Transition name="notification-toast">
      <div v-if="toastNotification" class="notification-toast" role="status" aria-live="polite">
        <span class="notification-toast-icon" aria-hidden="true">♢</span>
        <button class="notification-toast-content" type="button" @click="openToast"><strong>{{ toastNotification.title }}</strong><span>{{ toastNotification.message }}</span><small>{{ t('Ver solicitud', 'View request') }}</small></button>
        <button class="notification-toast-close" type="button" :aria-label="t('Cerrar aviso', 'Dismiss notification')" @click="dismissToast">×</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notification-bell{position:relative}.bell-trigger{position:relative;display:grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:8px;color:#526174;background:transparent;cursor:pointer}.bell-trigger:hover,.bell-trigger[aria-expanded=true]{border-color:#e2e8f0;background:#fff}.bell-trigger svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.bell-count{position:absolute;top:-3px;right:-5px;display:grid;place-items:center;min-width:17px;height:17px;padding:0 4px;border:2px solid #f6f8fb;border-radius:10px;color:#fff;background:#e44d55;font-size:8px;font-weight:800}.connection-dot{position:absolute;right:2px;bottom:2px;width:6px;height:6px;border:1px solid #fff;border-radius:50%;background:#aab3bf}.connection-dot.online{background:#45ad84}.notification-popover{position:absolute;z-index:50;top:44px;right:-54px;width:min(380px,calc(100vw - 28px));max-height:min(520px,calc(100vh - 120px));overflow:auto;border:1px solid #e3e9ef;border-radius:11px;background:#fff;box-shadow:0 14px 40px rgba(20,44,67,.18)}.notification-popover>header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #edf1f5;background:#fff}.notification-popover>header div{display:grid;gap:3px}.notification-popover>header strong{color:#223b53;font-size:13px}.notification-popover>header small,.notification-popover>header button{color:#8693a2;font-size:10px}.notification-popover>header button{padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer}.notification-item{display:flex;width:100%;align-items:start;gap:12px;padding:13px 16px;border:0;border-bottom:1px solid #f0f2f5;color:inherit;background:#fff;text-align:left;cursor:pointer}.notification-item:hover,.notification-item.unread{background:#f6fafc}.notification-copy{display:grid;gap:5px;min-width:0;flex:1}.notification-copy strong{color:#344b60;font-size:11px}.notification-copy>span{color:#637387;font-size:10px;line-height:1.45}.notification-copy small{color:#98a2b3;font-size:9px}.notification-item>i{width:7px;height:7px;flex:0 0 7px;margin-top:4px;border-radius:50%;background:#3c91b4}.notification-empty,.notification-error{padding:24px 16px;color:#8794a3;font-size:11px;text-align:center}.notification-error{color:#a33a3a}
.notification-more{display:block;width:calc(100% - 28px);margin:10px 14px 14px;padding:8px;border:1px solid #e2e8f0;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:700;cursor:pointer}.notification-more:disabled{opacity:.6;cursor:wait}
.notification-toast{position:fixed;z-index:1000;right:24px;bottom:24px;display:flex;width:min(390px,calc(100vw - 32px));align-items:flex-start;gap:12px;padding:15px;border:1px solid #dce7ef;border-radius:12px;background:#fff;box-shadow:0 16px 44px rgba(20,44,67,.2)}.notification-toast-icon{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border-radius:10px;color:#176084;background:#e9f5fa;font-size:22px}.notification-toast-content{display:grid;flex:1;gap:5px;padding:0;border:0;background:transparent;text-align:left;cursor:pointer}.notification-toast-content strong{color:#223b53;font-size:12px}.notification-toast-content span{color:#637387;font-size:11px;line-height:1.45}.notification-toast-content small{margin-top:2px;color:#176084;font-size:10px;font-weight:800}.notification-toast-close{padding:0;border:0;color:#8491a0;background:transparent;font-size:20px;line-height:1;cursor:pointer}.notification-toast-enter-active,.notification-toast-leave-active{transition:opacity .2s ease,transform .2s ease}.notification-toast-enter-from,.notification-toast-leave-to{opacity:0;transform:translateY(10px)}
@media(max-width:600px){.notification-toast{right:12px;bottom:12px}}
</style>
