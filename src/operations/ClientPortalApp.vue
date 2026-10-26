<script setup>
import { computed, onMounted, ref } from 'vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const email = ref('')
const code = ref('')
const codeSent = ref(false)
const user = ref(null)
const requests = ref([])
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const detail = ref(null)
const loading = ref(true)
const detailLoading = ref(false)
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

async function openRequest(reference) {
  detailLoading.value = true; error.value = ''
  try {
    const data = await api(`/api/client/requests/${encodeURIComponent(reference)}`)
    detail.value = data.item
  } catch (detailError) { error.value = detailError.message }
  finally { detailLoading.value = false }
}

async function startPayment() {
  if (!detail.value || sending.value) return
  sending.value = true; error.value = ''
  try {
    const data = await api(`/api/client/requests/${encodeURIComponent(detail.value.reference)}/payment-preference`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })
    const checkoutUrl = new URL(data.initPoint)
    if (checkoutUrl.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.co)?$/i.test(checkoutUrl.hostname)) throw new Error('El enlace de pago no pertenece a Mercado Pago.')
    window.location.assign(checkoutUrl.toString())
  } catch (paymentError) {
    error.value = paymentError.message
    await openRequest(detail.value.reference)
  } finally { sending.value = false }
}

async function logout() {
  await api('/api/client/logout', { method: 'POST' }).catch(() => {})
  user.value = null; requests.value = []; detail.value = null; email.value = ''; message.value = ''
}
function closeDetail() { detail.value = null }

function paymentLabel(value) {
  return ({ not_started: 'Pendiente de pago', not_required: 'No requiere pago', pending: 'Pendiente', in_process: 'En proceso', approved: 'Pagado', duplicate_approved: 'Pago duplicado · requiere revisión', rejected: 'Rechazado', cancelled: 'Cancelado', refunded: 'Reembolsado', charged_back: 'En disputa', creation_uncertain: 'Verificando intento', creating: 'Preparando pago', creation_failed: 'No se pudo iniciar' })[value] || value || 'Sin información'
}
function careLabel(value) { return ({ pending: 'Pendiente de revisión', in_review: 'En revisión', in_progress: 'En gestión', closed: 'Cerrada', cancelled: 'Cancelada' })[value] || value || '—' }
function paymentActionLabel(value) { return ({ pay: 'Pagar', retry: 'Reintentar pago', resume: 'Continuar pago', checking: 'Verificando pago' })[value] || '' }
function dateLabel(value) { return value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function money(cents, currency = 'USD') { return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format((Number(cents) || 0) / 100) }
onMounted(load)
</script>

<template>
  <main class="client-portal">
    <header class="client-portal-header">
      <a class="client-brand" href="/"><img :src="logoUrl" alt="Cortés Rodríguez Asesores" /><strong>Cortés Rodríguez Asesores<small>Portal de clientes</small></strong></a>
      <div class="header-actions"><a href="/" class="client-home">Página principal</a><button v-if="authenticated" class="client-logout" @click="logout">Cerrar sesión</button></div>
    </header>
    <section v-if="loading" class="client-panel client-loading" aria-live="polite"><span class="client-skeleton title"></span><span class="client-skeleton"></span><span class="client-skeleton"></span></section>
    <section v-else-if="!authenticated" class="client-panel client-login">
      <p class="client-kicker">Acceso seguro</p><h1>Consulta tus solicitudes</h1><p>Recibe un código temporal en el correo con el que registraste tu solicitud y úsalo para ingresar.</p>
      <form v-if="!codeSent" @submit.prevent="requestCode"><label for="client-email">Correo electrónico</label><input id="client-email" v-model="email" type="email" autocomplete="email" maxlength="254" required placeholder="nombre@empresa.com"/><button class="client-primary" :disabled="sending">{{ sending ? 'Enviando…' : 'Enviar código al correo' }} <span>→</span></button></form>
      <form v-else @submit.prevent="verifyCode"><p class="client-code-hint">Ingresa el código de 6 dígitos enviado a <strong>{{ email }}</strong>.</p><label for="client-email-code">Código de acceso</label><input id="client-email-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"/><button class="client-primary" :disabled="sending || code.length !== 6">{{ sending ? 'Verificando…' : 'Ingresar al portal' }} <span>→</span></button><button type="button" class="client-back" @click="codeSent = false; code = ''; message = ''; error = ''">Cambiar correo o reenviar código</button></form>
      <p v-if="message" class="client-message" role="status">{{ message }}</p><p v-if="error" class="client-error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="client-panel client-requests">
      <template v-if="!detail">
        <p class="client-kicker">Tu cuenta</p><h1>Mis solicitudes</h1><p>Sesión iniciada como <strong>{{ user.email }}</strong>. Aquí solo aparecen las solicitudes registradas con este correo.</p>
        <p v-if="error" class="client-error" role="alert">{{ error }}</p>
        <div v-if="!requests.length" class="client-empty">No encontramos solicitudes asociadas a este correo.</div>
        <div v-else class="client-request-list">
          <article v-for="item in requests" :key="item.reference" class="client-request-card">
            <div class="request-summary"><span class="client-reference">{{ item.reference }}</span><h2>{{ item.consultation || 'Solicitud de asesoría' }}</h2><p>{{ item.service || 'Servicio' }} · {{ dateLabel(item.createdAt) }}</p><strong class="client-amount">{{ money(item.amountCents, item.currency) }}</strong></div>
            <div class="request-states"><span class="client-status" :class="{ paid: item.paymentApproved }">Pago: {{ paymentLabel(item.paymentStatus) }}</span><span class="care-status">Atención: {{ careLabel(item.status) }}</span></div>
            <button class="client-secondary" type="button" @click="openRequest(item.reference)">Ver solicitud</button>
          </article>
        </div>
        <footer v-if="pagination.totalPages > 1" class="client-pagination"><span>Página {{ pagination.page }} de {{ pagination.totalPages }} · {{ pagination.totalItems }} solicitudes</span><div><button :disabled="pagination.page <= 1" @click="loadRequests(pagination.page - 1)">Anterior</button><button :disabled="pagination.page >= pagination.totalPages" @click="loadRequests(pagination.page + 1)">Siguiente</button></div></footer>
      </template>
      <template v-else>
        <button class="client-back-link" type="button" @click="closeDetail">← Volver a mis solicitudes</button>
        <div v-if="detailLoading" class="detail-loading"><span class="client-skeleton title"></span><span class="client-skeleton"></span></div>
        <div v-else>
          <p class="client-kicker">Seguimiento de solicitud</p><h1>{{ detail.reference }}</h1><p>{{ detail.consultation || detail.service }} · {{ dateLabel(detail.createdAt) }}</p>
          <div v-if="error" class="client-error" role="alert">{{ error }}</div>
          <div class="status-grid"><section><span>Estado del pago</span><strong :class="{ 'paid-text': detail.paymentApproved }">{{ paymentLabel(detail.paymentStatus) }}</strong></section><section><span>Estado de atención</span><strong>{{ careLabel(detail.status) }}</strong></section></div>
          <section class="detail-section"><h2>Valor de la consulta</h2><strong class="detail-price">{{ money(detail.amountCents, detail.currency) }}</strong><p v-if="detail.paymentRequired && !detail.paymentApproved">El pago habilita el inicio de la atención. La confirmación puede tardar unos minutos.</p></section>
          <section v-if="detail.paymentAction !== 'none'" class="payment-action-box"><template v-if="detail.paymentAction === 'checking'"><strong>Estamos verificando el intento anterior.</strong><p>Para evitar un cobro duplicado, espera la confirmación antes de iniciar otro pago.</p></template><template v-else><strong>{{ detail.paymentAction === 'resume' ? 'Tienes un pago pendiente.' : detail.paymentAction === 'retry' ? 'Puedes volver a intentar el pago.' : 'Completa el pago para iniciar la atención.' }}</strong><p>El checkout conservará esta solicitud y su código de seguimiento.</p><button class="client-primary" :disabled="sending" @click="startPayment">{{ sending ? 'Preparando…' : paymentActionLabel(detail.paymentAction) }} <span>→</span></button></template></section>
          <section v-if="detail.question" class="detail-section"><h2>Tu consulta</h2><p class="question-text">{{ detail.question }}</p></section>
          <section v-if="detail.attachments.length" class="detail-section"><h2>Imágenes adjuntas</h2><div class="client-attachments"><a v-for="file in detail.attachments" :key="file.id" :href="file.url" target="_blank" rel="noreferrer"><img :src="file.url" :alt="file.name"/><span>{{ file.name }}</span></a></div></section>
          <section v-if="detail.paymentAttempts.length" class="detail-section"><h2>Historial de pagos</h2><div class="attempt-row" v-for="(attempt, index) in detail.paymentAttempts" :key="`${attempt.createdAt}-${index}`"><div><strong>{{ paymentLabel(attempt.status) }}</strong><small>{{ dateLabel(attempt.createdAt) }}</small></div><div><strong>{{ money(attempt.usdAmountCents, 'USD') }}</strong><small>{{ money(attempt.copAmountCents, 'COP') }} · TRM {{ Number(attempt.trm).toLocaleString('es-CO') }}</small></div></div></section>
          <section v-if="detail.response" class="response-box"><p class="client-kicker">Respuesta revisada</p><h2>Respuesta del equipo</h2><p class="question-text">{{ detail.response.body }}</p><p v-if="detail.response.note" class="response-note"><strong>Nota para ti:</strong> {{ detail.response.note }}</p></section>
        </div>
      </template>
    </section>
    <footer class="client-portal-footer">Cortés Rodríguez Asesores · Comercio exterior y aduanas</footer>
  </main>
</template>

<style scoped>
.client-portal{min-height:100vh;padding:0 24px 32px;background:#f4f7fb;color:#19334d}.client-portal-header{max-width:1080px;min-height:82px;margin:auto;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e1e8ef}.client-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}.client-brand img{display:block;width:48px;height:48px;object-fit:contain}.client-brand strong{font-size:13px}.client-brand small{display:block;margin-top:4px;color:#8392a3;font-size:10px;font-weight:500}.header-actions{display:flex;align-items:center;gap:10px}.client-home,.client-logout,.client-secondary,.client-pagination button,.client-back-link{min-height:36px;padding:0 13px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:11px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.client-panel{width:min(900px,100%);margin:36px auto;padding:30px;border:1px solid #e0e8ef;border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(12,44,70,.05)}.client-login{max-width:480px}.client-kicker{margin:0 0 8px;color:#d91f2b;font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.client-panel h1{margin:0;color:#122d47;font-size:27px;letter-spacing:-.04em}.client-panel>p:not(.client-kicker){color:#718197;font-size:12px;line-height:1.6}.client-login form{display:grid;gap:9px;margin-top:25px}.client-login label{color:#536a80;font-size:11px;font-weight:800}.client-login input{min-height:42px;padding:0 12px;border:1px solid #d6e0ea;border-radius:7px;font:inherit;font-size:12px}.client-code-hint{margin:0 0 4px;color:#718197;font-size:11px;line-height:1.6}.client-code-hint strong{color:#315875}.client-primary{display:inline-flex;justify-content:center;gap:12px;align-items:center;min-height:42px;padding:0 18px;margin-top:7px;border:0;border-radius:7px;color:#fff;background:#0e4567;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.client-primary:disabled{opacity:.6;cursor:wait}.client-back{min-height:34px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.client-message,.client-error{padding:11px 13px;border-radius:7px;font-size:11px}.client-message{color:#176247;background:#eaf7f1}.client-error{color:#9d2730;background:#fff0f1}.client-request-list{display:grid;gap:10px;margin-top:22px}.client-request-card{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:16px;align-items:center;padding:16px;border:1px solid #e5ebf1;border-radius:9px}.client-reference{color:#2677a4;font-size:10px;font-weight:800}.client-request-card h2{margin:6px 0;color:#29445d;font-size:14px}.client-request-card p{margin:0;color:#8290a0;font-size:10px}.client-amount{display:block;margin-top:9px;color:#244661;font-size:12px}.request-states{display:grid;gap:7px}.client-status,.care-status{display:block;padding:6px 9px;border-radius:20px;color:#a36812;background:#fff4df;font-size:10px;font-weight:800;white-space:nowrap}.client-status.paid{color:#18704f;background:#eaf7f1}.care-status{color:#53697e;background:#f0f3f6}.client-empty{margin-top:22px;padding:28px;text-align:center;color:#8190a1;background:#f7f9fb;border-radius:8px;font-size:12px}.client-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:18px;color:#8392a3;font-size:10px}.client-pagination div{display:flex;gap:8px}.client-pagination button:disabled{opacity:.45;cursor:not-allowed}.client-back-link{margin-bottom:22px}.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}.status-grid section,.detail-section,.payment-action-box,.response-box{padding:17px;border:1px solid #e3eaf0;border-radius:9px;background:#fff}.status-grid span{display:block;margin-bottom:7px;color:#8290a0;font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:.05em}.status-grid strong{font-size:13px;color:#a36812}.status-grid .paid-text{color:#18704f}.detail-section{margin-top:12px}.detail-section h2,.response-box h2{margin:0 0 11px;color:#29445d;font-size:14px}.detail-section>p{margin:8px 0 0;color:#718197;font-size:11px;line-height:1.6}.detail-price{color:#17334b;font-size:19px}.question-text{white-space:pre-wrap;overflow-wrap:anywhere;color:#3d566e;font-size:12px;line-height:1.7}.payment-action-box{margin-top:12px;background:#f7fafc}.payment-action-box strong{color:#29445d;font-size:13px}.payment-action-box p{margin:7px 0;color:#718197;font-size:11px;line-height:1.55}.payment-action-box .client-primary{margin-top:4px}.client-attachments{display:flex;flex-wrap:wrap;gap:12px}.client-attachments a{width:120px;color:#315875;text-decoration:none;font-size:10px}.client-attachments img{display:block;width:120px;height:90px;object-fit:cover;border-radius:7px;background:#f0f3f6}.client-attachments span{display:block;margin-top:5px;overflow-wrap:anywhere}.attempt-row{display:flex;justify-content:space-between;gap:15px;padding:11px 0;border-top:1px solid #edf1f4}.attempt-row>div{display:grid;gap:4px}.attempt-row>div:last-child{text-align:right}.attempt-row strong{color:#36536d;font-size:11px}.attempt-row small{color:#8b98a6;font-size:10px}.response-box{margin-top:12px;background:#f7fafc}.response-note{padding:11px;border-radius:7px;background:#fff;color:#53697e;font-size:11px;line-height:1.6}.detail-loading{padding:14px}.client-pagination button:disabled{opacity:.5}.client-portal-footer{margin:28px auto 0;text-align:center;color:#96a2b0;font-size:10px}.client-skeleton{display:block;width:70%;height:14px;margin:12px 0;border-radius:6px;background:linear-gradient(90deg,#edf1f5,#f8fafb,#edf1f5);background-size:200% 100%;animation:shimmer 1.4s infinite}.client-skeleton.title{width:45%;height:25px}@keyframes shimmer{to{background-position:-200% 0}}@media(max-width:720px){.client-portal{padding:0 14px 24px}.client-portal-header{min-height:70px}.client-panel{margin:24px auto;padding:22px 18px}.client-panel h1{font-size:23px}.client-request-card{grid-template-columns:1fr;align-items:start}.request-states{display:flex;flex-wrap:wrap}.status-grid{grid-template-columns:1fr}.client-secondary{justify-self:start}.client-home{display:none}}@media(max-width:420px){.client-portal-header{min-height:66px}.client-brand img{width:40px;height:40px}.client-brand strong{font-size:11px}.client-logout{padding:0 9px;font-size:10px}.attempt-row{align-items:flex-start}.attempt-row strong{font-size:10px}}
</style>
