<script setup>
import { computed, onMounted, ref } from 'vue'

const email = ref('')
const code = ref('')
const codeSent = ref(false)
const user = ref(null)
const requests = ref([])
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const loading = ref(true)
const sending = ref(false)
const error = ref('')
const message = ref('')
const authenticated = computed(() => Boolean(user.value))

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.')
  return data
}

async function loadRequests(page = 1) {
  loading.value = true
  error.value = ''
  try {
    const data = await api(`/api/client/requests?page=${page}&pageSize=${pagination.value.pageSize}`)
    requests.value = data.items || []
    pagination.value = data.pagination || pagination.value
  } catch (loadError) {
    error.value = loadError.message
    if (loadError.message.includes('Inicia sesión')) user.value = null
  } finally { loading.value = false }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api('/api/client/session')
    user.value = data.user
    await loadRequests()
  } catch {
    user.value = null
    loading.value = false
  }
}

async function requestCode() {
  sending.value = true; error.value = ''; message.value = ''
  try {
    const data = await api('/api/client/access-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value }) })
    message.value = data.message
    codeSent.value = true
  } catch (sendError) { error.value = sendError.message } finally { sending.value = false }
}

async function verifyCode() {
  sending.value = true; error.value = ''; message.value = ''
  try {
    await api('/api/client/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value, code: code.value }) })
    await load()
  } catch (verifyError) { error.value = verifyError.message } finally { sending.value = false }
}

async function logout() {
  await api('/api/client/logout', { method: 'POST' }).catch(() => {})
  user.value = null; requests.value = []; email.value = ''; message.value = ''
}

function serviceLabel(value) { return ({ importacion: 'Importación', exportacion: 'Exportación', agente_carga: 'Agente de carga' })[value] || value || '—' }
function statusLabel(value) { return ({ pending: 'Pendiente', in_review: 'En revisión', in_progress: 'En gestión', closed: 'Cerrada', cancelled: 'Cancelada' })[value] || value }
function dateLabel(value) { return value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : '—' }
onMounted(load)
</script>

<template>
  <main class="client-portal">
    <header class="client-portal-header"><a class="client-brand" href="/"><span>CRA</span><strong>Cortés Rodríguez Asesores<small>Portal de clientes</small></strong></a><button v-if="authenticated" class="client-logout" @click="logout">Cerrar sesión</button></header>
    <section v-if="loading" class="client-panel client-loading" aria-live="polite"><span class="client-skeleton title"></span><span class="client-skeleton"></span><span class="client-skeleton"></span></section>
    <section v-else-if="!authenticated" class="client-panel client-login">
      <p class="client-kicker">Acceso seguro</p><h1>Consulta tus solicitudes</h1><p>Recibe un código temporal en el correo con el que registraste tu solicitud y úsalo como clave para entrar.</p>
      <form v-if="!codeSent" @submit.prevent="requestCode"><label for="client-email">Correo electrónico</label><input id="client-email" v-model="email" type="email" autocomplete="email" maxlength="254" required placeholder="nombre@empresa.com"/><button class="client-primary" :disabled="sending">{{ sending ? 'Enviando…' : 'Enviar código al correo' }} <span>→</span></button></form>
      <form v-else @submit.prevent="verifyCode"><p class="client-code-hint">Ingresa el código de 6 dígitos que enviamos a <strong>{{ email }}</strong>.</p><label for="client-email-code">Código de acceso</label><input id="client-email-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"/><button class="client-primary" :disabled="sending || code.length !== 6">{{ sending ? 'Verificando…' : 'Ingresar al portal' }} <span>→</span></button><button type="button" class="client-back" @click="codeSent = false; code = ''; message = ''; error = ''">Cambiar correo o reenviar código</button></form>
      <p v-if="message" class="client-message" role="status">{{ message }}</p><p v-if="error" class="client-error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="client-panel client-requests">
      <p class="client-kicker">Tu cuenta</p><h1>Mis solicitudes</h1><p>Sesión iniciada como <strong>{{ user.email }}</strong>. Aquí solo aparecen las solicitudes registradas con este correo.</p>
      <p v-if="error" class="client-error" role="alert">{{ error }}</p>
      <div v-if="!requests.length" class="client-empty">No encontramos solicitudes asociadas a este correo.</div>
      <div v-else class="client-request-list"><article v-for="item in requests" :key="item.reference" class="client-request-card"><div><span class="client-reference">{{ item.reference }}</span><h2>{{ item.consultation || 'Solicitud de asesoría' }}</h2><p>{{ serviceLabel(item.service) }} · {{ dateLabel(item.createdAt) }}</p></div><span class="client-status">{{ statusLabel(item.status) }}</span></article></div>
      <footer v-if="pagination.totalPages > 1" class="client-pagination"><span>Página {{ pagination.page }} de {{ pagination.totalPages }}</span><div><button :disabled="pagination.page <= 1" @click="loadRequests(pagination.page - 1)">Anterior</button><button :disabled="pagination.page >= pagination.totalPages" @click="loadRequests(pagination.page + 1)">Siguiente</button></div></footer>
    </section>
    <footer class="client-portal-footer">Cortés Rodríguez Asesores · Comercio exterior y aduanas</footer>
  </main>
</template>

<style scoped>
.client-portal{min-height:100vh;padding:0 24px 32px;background:#f4f7fb;color:#19334d}.client-portal-header{max-width:1080px;min-height:82px;margin:auto;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e1e8ef}.client-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}.client-brand>span{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;color:#fff;background:#0b3652;font-size:12px;font-weight:900}.client-brand strong{font-size:13px}.client-brand small{display:block;margin-top:4px;color:#8392a3;font-size:10px;font-weight:500}.client-logout,.client-pagination button{min-height:34px;padding:0 12px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.client-panel{width:min(850px,100%);margin:42px auto;padding:30px;border:1px solid #e0e8ef;border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(12,44,70,.05)}.client-login{max-width:480px}.client-kicker{margin:0 0 8px;color:#d91f2b;font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.client-panel h1{margin:0;color:#122d47;font-size:27px;letter-spacing:-.04em}.client-panel>p:not(.client-kicker){color:#718197;font-size:12px;line-height:1.6}.client-login form{display:grid;gap:9px;margin-top:25px}.client-login label{color:#536a80;font-size:11px;font-weight:800}.client-login input{min-height:42px;padding:0 12px;border:1px solid #d6e0ea;border-radius:7px;font:inherit;font-size:12px}.client-code-hint{margin:0 0 4px;color:#718197;font-size:11px;line-height:1.6}.client-code-hint strong{color:#315875}.client-primary{display:flex;justify-content:center;gap:12px;align-items:center;min-height:42px;margin-top:7px;border:0;border-radius:7px;color:#fff;background:#0e4567;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.client-primary:disabled{opacity:.6}.client-back{min-height:34px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.client-message,.client-error{padding:11px 13px;border-radius:7px;font-size:11px}.client-message{color:#176247;background:#eaf7f1}.client-error{color:#9d2730;background:#fff0f1}.client-request-list{display:grid;gap:10px;margin-top:22px}.client-request-card{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px;border:1px solid #e5ebf1;border-radius:9px}.client-reference{color:#2677a4;font-size:10px;font-weight:800}.client-request-card h2{margin:6px 0;color:#29445d;font-size:14px}.client-request-card p{margin:0;color:#8290a0;font-size:10px}.client-status{padding:6px 9px;border-radius:20px;color:#a36812;background:#fff4df;font-size:10px;font-weight:800}.client-empty{margin-top:22px;padding:28px;text-align:center;color:#8190a1;background:#f7f9fb;border-radius:8px;font-size:12px}.client-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:18px;color:#8392a3;font-size:10px}.client-pagination div{display:flex;gap:8px}.client-pagination button:disabled{opacity:.45;cursor:not-allowed}.client-portal-footer{margin:30px auto 0;text-align:center;color:#96a2b0;font-size:10px}.client-skeleton{display:block;width:70%;height:14px;margin:12px 0;border-radius:6px;background:linear-gradient(90deg,#edf1f5,#f8fafb,#edf1f5);background-size:200% 100%;animation:shimmer 1.4s infinite}.client-skeleton.title{width:45%;height:25px}@keyframes shimmer{to{background-position:-200% 0}}@media(max-width:600px){.client-portal{padding:0 14px 24px}.client-portal-header{min-height:70px}.client-panel{margin:24px auto;padding:22px 18px}.client-panel h1{font-size:23px}.client-request-card{align-items:flex-start;flex-direction:column}}
</style>
