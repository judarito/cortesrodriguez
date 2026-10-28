<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { shouldKeepBricksAttempt } from '../lib/paymentFlow.js'
import { getInitialLocale, localeTag, persistLocale } from '../lib/locale.js'
import LanguageToggle from '../shared/components/LanguageToggle.vue'
import OperationsShell from './OperationsShell.vue'
import MercadoPagoPaymentBrick from './components/MercadoPagoPaymentBrick.vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const locale = ref(getInitialLocale())
const copy = {
  es: {
    home: 'Página principal', portal: 'Portal de clientes', emailPlaceholder: 'nombre@empresa.com', logout: 'Cerrar sesión', loading: 'Cargando…', access: 'Acceso seguro',
    loginTitle: 'Consulta tus solicitudes', loginIntro: 'Recibe un código temporal en el correo con el que registraste tu solicitud y úsalo para ingresar.',
    email: 'Correo electrónico', sendCode: 'Enviar código al correo', sending: 'Enviando…', verify: 'Verificando…',
    codeHint: 'Ingresa el código de 6 dígitos enviado a', code: 'Código de acceso', enter: 'Ingresar al portal',
    changeEmail: 'Cambiar correo o reenviar código', account: 'Tu cuenta', requests: 'Mis solicitudes',
    signedIn: 'Sesión iniciada como', registeredWith: 'Aquí solo aparecen las solicitudes registradas con este correo.',
    noRequests: 'No encontramos solicitudes asociadas a este correo.', page: 'Página', of: 'de',
    requestsCount: 'solicitudes', previous: 'Anterior', next: 'Siguiente', viewRequest: 'Ver solicitud',
    backRequests: 'Volver a mis solicitudes', tracking: 'Seguimiento de solicitud', paymentStatus: 'Estado del pago',
    careStatus: 'Estado de atención', consultationValue: 'Valor de la consulta',
    paymentEnables: 'El pago habilita el inicio de la atención. La confirmación puede tardar unos minutos.',
    checkingTitle: 'Estamos verificando el intento anterior.', checkingBody: 'Para evitar un cobro duplicado, espera la confirmación antes de iniciar otro pago.',
    resume: 'Tienes un pago pendiente.', retry: 'Puedes volver a intentar el pago.', payPrompt: 'Completa el pago para iniciar la atención.',
    reviewQuote: 'Antes de continuar, revisa el precio en USD, la tasa de cambio y el total que pagarás en COP.',
    trm: 'TRM', total: 'Total a pagar', checkoutInfo: 'El checkout conservará esta solicitud y su código de seguimiento.',
    preparing: 'Preparando…', confirmPay: 'Confirmar y pagar', yourQuestion: 'Tu consulta', attachments: 'Imágenes adjuntas',
    paymentHistory: 'Historial de pagos', reviewedResponse: 'Respuesta revisada', teamResponse: 'Respuesta del equipo',
    noteForYou: 'Nota para ti:', footer: 'Comercio exterior y aduanas',
    paymentLabels: { not_started: 'Pendiente de pago', not_required: 'No requiere pago', pending: 'Pendiente', in_process: 'En proceso', approved: 'Pagado', duplicate_approved: 'Pago duplicado · requiere revisión', rejected: 'Rechazado', cancelled: 'Cancelado', refunded: 'Reembolsado', charged_back: 'En disputa', creation_uncertain: 'Verificando intento', creating: 'Preparando pago', creation_failed: 'No se pudo iniciar' },
    careLabels: { pending: 'Pendiente de revisión', in_review: 'En revisión', in_progress: 'En gestión', closed: 'Cerrada', cancelled: 'Cancelada' },
    paymentActions: { pay: 'Pagar', retry: 'Reintentar pago', resume: 'Continuar pago', checking: 'Verificando pago' },
    bricksUnavailable: 'Este intento se inició con el pago integrado, que ahora está desactivado. No vuelvas a pagar; contacta a soporte para verificarlo.',
    bricksChecking: 'Estamos verificando este pago con Mercado Pago. No vuelvas a pagar ni inicies otro intento.',
    refreshPayment: 'Actualizar estado del pago',
    bricksRecoveryFailed: 'No pudimos confirmar el estado del intento anterior. No vuelvas a pagar; actualiza más tarde o contacta a soporte.',
    bricksIntentFailed: 'No pudimos recuperar el formulario seguro del intento. No inicies otro pago; actualiza el estado o contacta a soporte.',
    service: 'Servicio', requestTitle: 'Solicitud de asesoría',
    checkoutInvalid: 'El enlace de pago no pertenece a Mercado Pago.', amountInvalid: 'No se pudo validar el valor convertido. Inténtalo de nuevo más tarde.',
    genericError: 'No se pudo completar la operación. Inténtalo de nuevo.',
    serverErrors: {
      'No se pudo completar la operación.': 'No se pudo completar la operación. Inténtalo de nuevo.',
      'Inicia sesión para continuar.': 'Inicia sesión para continuar.',
      'Ingresa un correo electrónico válido.': 'Ingresa un correo electrónico válido.',
      'El correo o el código no son válidos.': 'El correo o el código no son válidos.',
      'El código no es válido, venció o superó el límite de intentos.': 'El código no es válido, venció o superó el límite de intentos.',
      'El código no es válido o venció.': 'El código no es válido o venció.'
    },
    loginSuccess: 'Código enviado al correo registrado. Revisa tu bandeja de entrada.'
  },
  en: {
    home: 'Home', portal: 'Client portal', emailPlaceholder: 'name@company.com', logout: 'Sign out', loading: 'Loading…', access: 'Secure access',
    loginTitle: 'View your requests', loginIntro: 'Receive a temporary code at the email address used for your request, then use it to sign in.',
    email: 'Email address', sendCode: 'Send code by email', sending: 'Sending…', verify: 'Verifying…',
    codeHint: 'Enter the 6-digit code sent to', code: 'Access code', enter: 'Sign in to the portal',
    changeEmail: 'Change email or resend code', account: 'Your account', requests: 'My requests',
    signedIn: 'Signed in as', registeredWith: 'Only requests registered with this email are shown here.',
    noRequests: 'We could not find any requests associated with this email.', page: 'Page', of: 'of',
    requestsCount: 'requests', previous: 'Previous', next: 'Next', viewRequest: 'View request',
    backRequests: 'Back to my requests', tracking: 'Request tracking', paymentStatus: 'Payment status',
    careStatus: 'Service status', consultationValue: 'Consultation price',
    paymentEnables: 'Payment is required to begin service. Confirmation may take a few minutes.',
    checkingTitle: 'We are checking the previous payment attempt.', checkingBody: 'To avoid a duplicate charge, wait for confirmation before starting another payment.',
    resume: 'You have a pending payment.', retry: 'You can try the payment again.', payPrompt: 'Complete payment to begin service.',
    reviewQuote: 'Before continuing, review the price in USD, the exchange rate, and the total amount in COP.',
    trm: 'Exchange rate', total: 'Total due', checkoutInfo: 'Checkout will retain this request and its tracking code.',
    preparing: 'Preparing…', confirmPay: 'Confirm and pay', yourQuestion: 'Your question', attachments: 'Attached images',
    paymentHistory: 'Payment history', reviewedResponse: 'Reviewed response', teamResponse: 'Team response',
    noteForYou: 'Note for you:', footer: 'Foreign trade and customs',
    paymentLabels: { not_started: 'Payment not started', not_required: 'Payment not required', pending: 'Pending', in_process: 'Processing', approved: 'Paid', duplicate_approved: 'Duplicate payment · review required', rejected: 'Rejected', cancelled: 'Cancelled', refunded: 'Refunded', charged_back: 'Disputed', creation_uncertain: 'Checking payment attempt', creating: 'Preparing payment', creation_failed: 'Could not start payment' },
    careLabels: { pending: 'Awaiting review', in_review: 'Under review', in_progress: 'In progress', closed: 'Closed', cancelled: 'Cancelled' },
    paymentActions: { pay: 'Pay', retry: 'Retry payment', resume: 'Continue payment', checking: 'Checking payment' },
    bricksUnavailable: 'This attempt was started with integrated checkout, which is now disabled. Do not pay again; contact support to verify it.',
    bricksChecking: 'We are verifying this payment with Mercado Pago. Do not pay again or start another attempt.',
    refreshPayment: 'Refresh payment status',
    bricksRecoveryFailed: 'We could not confirm the previous attempt. Do not pay again; refresh later or contact support.',
    bricksIntentFailed: 'We could not retrieve the secure form for this attempt. Do not start another payment; refresh its status or contact support.',
    service: 'Service', requestTitle: 'Advisory request',
    checkoutInvalid: 'This payment link does not belong to Mercado Pago.', amountInvalid: 'We could not validate the converted amount. Please try again later.',
    genericError: 'We could not complete the request. Please try again.',
    serverErrors: {
      'No se pudo completar la operación.': 'We could not complete the request. Please try again.',
      'Inicia sesión para continuar.': 'Please sign in to continue.',
      'Ingresa un correo electrónico válido.': 'Enter a valid email address.',
      'El correo o el código no son válidos.': 'The email or code is invalid.',
      'El código no es válido, venció o superó el límite de intentos.': 'The code is invalid, expired, or has exceeded the attempt limit.',
      'El código no es válido o venció.': 'The code is invalid or expired.'
    },
    loginSuccess: 'A sign-in code was sent to your registered email. Check your inbox.'
  }
}
const t = computed(() => copy[locale.value])
const clientMenuItems = computed(() => [
  { label: 'requests', displayLabel: t.value.requests, icon: 'SO' },
  { label: 'home', displayLabel: t.value.home, icon: '⌂', href: '/' },
])
watch(locale, (value) => {
  locale.value = persistLocale(value)
  if (typeof document !== 'undefined') document.documentElement.lang = value
})

const email = ref('')
const code = ref('')
const codeSent = ref(false)
const user = ref(null)
const requests = ref([])
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const detail = ref(null)
const paymentQuote = ref(null)
const checkoutMode = ref('pro')
const brickIntent = ref(null)
const brickIntentLoading = ref(false)
const brickRecoveryError = ref(false)
const brickRecoveryMessage = ref('')
const loading = ref(true)
const detailLoading = ref(false)
const sending = ref(false)
const error = ref('')
const message = ref('')
const authenticated = computed(() => Boolean(user.value))

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(t.value.serverErrors[data.error] || t.value.genericError)
    error.apiMessage = data.error || ''
    throw error
  }
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
    if (String(loadError.apiMessage || '').includes('Inicia sesión')) user.value = null
  } finally { loading.value = false }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const features = await api('/api/public/features')
    checkoutMode.value = features.checkoutMode === 'bricks' ? 'bricks' : 'pro'
  } catch {
    // Checkout Pro remains the default when public feature configuration is unavailable.
    checkoutMode.value = 'pro'
  }
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
    message.value = t.value.loginSuccess
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
  paymentQuote.value = null
  brickIntent.value = null
  brickRecoveryError.value = false
  brickRecoveryMessage.value = ''
  detailLoading.value = true; error.value = ''
  try {
    const data = await api(`/api/client/requests/${encodeURIComponent(reference)}`)
    const item = data.item
    const attempts = Array.isArray(item.paymentAttempts) ? item.paymentAttempts.map((attempt) => ({ ...attempt })) : []
    const latestIndex = attempts.findIndex((attempt) => attempt.id === item.paymentAttemptId || attempt.attemptId === item.paymentAttemptId)
    const currentIndex = latestIndex >= 0 ? latestIndex : 0
    if (attempts[currentIndex]) {
      attempts[currentIndex] = {
        ...attempts[currentIndex],
        id: attempts[currentIndex].id || item.paymentAttemptId || undefined,
        checkoutMode: attempts[currentIndex].checkoutMode || item.checkoutMode || 'pro',
        paymentSubmitted: attempts[currentIndex].paymentSubmitted ?? item.paymentSubmitted,
      }
    }
    detail.value = { ...item, paymentAttempts: attempts }
    await prepareBrickAttempt()
  } catch (detailError) { error.value = detailError.message }
  finally { detailLoading.value = false }
}

function latestPaymentAttempt() {
  return detail.value?.paymentAttempts?.[0] || null
}

function currentRequestCheckoutMode() {
  return detail.value?.checkoutMode || latestPaymentAttempt()?.checkoutMode || 'pro'
}

function currentPaymentAttemptId() {
  const attempt = latestPaymentAttempt()
  return detail.value?.paymentAttemptId || attempt?.attemptId || attempt?.id || ''
}

function paymentWasSubmitted() {
  const attempt = latestPaymentAttempt()
  return Boolean(detail.value?.paymentSubmitted ?? attempt?.paymentSubmitted ?? attempt?.providerSubmissionStartedAt)
}

function paymentAttemptStatus() {
  return String(detail.value?.paymentStatus || latestPaymentAttempt()?.status || '').toLowerCase()
}

function isTerminalPaymentStatus(status = paymentAttemptStatus()) {
  return ['approved', 'rejected', 'cancelled', 'refunded', 'charged_back', 'duplicate_approved', 'creation_failed'].includes(status)
}

function hasUnresolvedBrickAttempt() {
  return currentRequestCheckoutMode() === 'bricks' && !['pay', 'retry'].includes(detail.value?.paymentAction) && !isTerminalPaymentStatus()
}

function brickIntentPayload(data, expectedAttemptId = '') {
  if (
    typeof data.attemptId !== 'string' || !data.attemptId ||
    typeof data.publicKey !== 'string' || !data.publicKey ||
    !Number.isSafeInteger(data.amountCents) || data.amountCents <= 0 ||
    data.currency !== 'COP' || !['es-CO', 'en-US'].includes(data.locale)
  ) throw new Error(t.value.bricksIntentFailed)
  if (expectedAttemptId && data.attemptId !== expectedAttemptId) {
    throw new Error(t.value.bricksIntentFailed)
  }
  return { ...data, processIdempotencyKey: crypto.randomUUID() }
}

async function requestBrickIntent(existingAttempt = false) {
  if (!detail.value || brickIntentLoading.value) return
  brickIntentLoading.value = true
  brickRecoveryError.value = false
  brickRecoveryMessage.value = ''
  try {
    const body = { idempotencyKey: crypto.randomUUID() }
    const data = await api(`/api/client/requests/${encodeURIComponent(detail.value.reference)}/payment-bricks-intent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    brickIntent.value = brickIntentPayload(data, existingAttempt ? currentPaymentAttemptId() : '')
    detail.value.paymentAttemptId = data.attemptId
    detail.value.checkoutMode = 'bricks'
    detail.value.paymentStatus = detail.value.paymentStatus === 'not_started' ? 'pending' : detail.value.paymentStatus
    detail.value.paymentAction = 'resume'
    detail.value.paymentSubmitted = false
  } catch (intentError) {
    brickRecoveryError.value = true
    brickRecoveryMessage.value = intentError.message || t.value.bricksIntentFailed
  } finally { brickIntentLoading.value = false }
}

async function recoverBrickAttempt() {
  const attemptId = currentPaymentAttemptId()
  if (!attemptId) {
    brickRecoveryError.value = true
    brickRecoveryMessage.value = t.value.bricksRecoveryFailed
    return
  }
  brickRecoveryError.value = false
  brickRecoveryMessage.value = t.value.bricksChecking
  try {
    const result = await api(`/api/client/requests/${encodeURIComponent(detail.value.reference)}/payment-bricks-recover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: detail.value.reference, attemptId }),
    })
    const status = String(result.status || '').toLowerCase()
    if (result.confirmed === true || status === 'approved') {
      detail.value.paymentApproved = true
      detail.value.paymentStatus = 'approved'
      detail.value.paymentAction = 'none'
      brickRecoveryMessage.value = ''
      await loadRequests(pagination.value.page)
      return
    }
    if (['rejected', 'cancelled'].includes(status)) {
      detail.value.paymentStatus = status
      detail.value.paymentAction = 'retry'
      detail.value.paymentSubmitted = false
      brickRecoveryMessage.value = ''
      return
    }
    brickRecoveryMessage.value = t.value.bricksChecking
  } catch {
    brickRecoveryError.value = true
    brickRecoveryMessage.value = t.value.bricksRecoveryFailed
  }
}

async function prepareBrickAttempt() {
  if (currentRequestCheckoutMode() !== 'bricks' || ['pay', 'retry'].includes(detail.value?.paymentAction) || isTerminalPaymentStatus()) return
  if (paymentWasSubmitted()) {
    await recoverBrickAttempt()
    return
  }
  if (checkoutMode.value !== 'bricks') {
    brickRecoveryMessage.value = t.value.bricksUnavailable
    return
  }
  if (currentPaymentAttemptId()) await requestBrickIntent(true)
}

async function startPayment() {
  if (!detail.value || sending.value) return
  if (shouldKeepBricksAttempt(detail.value, checkoutMode.value)) {
    if (checkoutMode.value !== 'bricks') {
      brickRecoveryMessage.value = t.value.bricksUnavailable
      return
    }
    if (hasUnresolvedBrickAttempt()) {
      if (paymentWasSubmitted()) {
        await recoverBrickAttempt()
        return
      }
      if (!brickIntent.value && currentPaymentAttemptId()) await requestBrickIntent(true)
      else if (!brickIntent.value) brickRecoveryMessage.value = t.value.bricksIntentFailed
      return
    }
    await requestBrickIntent(false)
    return
  }
  if (paymentQuote.value) {
    window.location.assign(paymentQuote.value.initPoint)
    return
  }
  sending.value = true; error.value = ''
  try {
    if (checkoutMode.value === 'bricks' && detail.value.paymentAction !== 'resume') {
      await requestBrickIntent(false)
      return
    }
    const data = await api(`/api/client/requests/${encodeURIComponent(detail.value.reference)}/payment-preference`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })
    const checkoutUrl = new URL(data.initPoint)
    if (checkoutUrl.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.co)?$/i.test(checkoutUrl.hostname)) throw new Error(t.value.checkoutInvalid)
    if (!Number.isFinite(Number(data.usdAmountCents)) || !Number.isFinite(Number(data.copAmountCents)) || !Number.isFinite(Number(data.trm))) throw new Error(t.value.amountInvalid)
    paymentQuote.value = { initPoint: checkoutUrl.toString(), usdAmountCents: Number(data.usdAmountCents), copAmountCents: Number(data.copAmountCents), trm: Number(data.trm), trmDate: String(data.trmDate || '') }
  } catch (paymentError) {
    error.value = paymentError.message
    await openRequest(detail.value.reference)
  } finally { sending.value = false }
}

async function logout() {
  await api('/api/client/logout', { method: 'POST' }).catch(() => {})
  user.value = null; requests.value = []; detail.value = null; email.value = ''; message.value = ''
}
function closeDetail() { detail.value = null; paymentQuote.value = null; brickIntent.value = null; brickRecoveryMessage.value = ''; brickRecoveryError.value = false }
function selectClientMenu(item) { if (item.label === 'requests') closeDetail() }

async function processBrickPayment(submission) {
  if (detail.value) {
    detail.value.paymentAttemptId = submission.attemptId
    detail.value.checkoutMode = 'bricks'
    detail.value.paymentSubmitted = true
  }
  try {
    const result = await api(`/api/client/requests/${encodeURIComponent(detail.value.reference)}/payment-bricks-process`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId: submission.attemptId, ...submission.payload }),
    })
    if (typeof result.status !== 'string') throw new Error(t.value.genericError)
    submission.complete(result)
    const status = String(result.status).toLowerCase()
    if (result.confirmed === true || status === 'approved') {
      detail.value.paymentApproved = true
      detail.value.paymentStatus = 'approved'
      detail.value.paymentAction = 'none'
      brickIntent.value = null
      await loadRequests(pagination.value.page)
    } else if (['pending', 'in_process', 'in_mediation'].includes(status)) {
      detail.value.paymentStatus = status
      detail.value.paymentAction = 'checking'
      detail.value.paymentSubmitted = true
      brickRecoveryMessage.value = t.value.bricksChecking
    } else if (['rejected', 'cancelled'].includes(status)) {
      detail.value.paymentStatus = status
      detail.value.paymentAction = 'retry'
      detail.value.paymentSubmitted = false
    }
  } catch (processError) {
    submission.fail(processError.message || t.value.genericError)
  }
}

async function retryBrickPayment() {
  brickIntent.value = null
  brickRecoveryMessage.value = ''
  brickRecoveryError.value = false
  if (detail.value) {
    detail.value.paymentStatus = 'rejected'
    detail.value.paymentAction = 'retry'
    detail.value.paymentSubmitted = false
  }
  await startPayment()
}

function paymentLabel(value) { return t.value.paymentLabels[value] || value || '—' }
function careLabel(value) { return t.value.careLabels[value] || value || '—' }
function paymentActionLabel(value) { return t.value.paymentActions[value] || '' }
function dateLabel(value) {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T12:00:00` : value)
  return new Intl.DateTimeFormat(localeTag(locale.value), dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
function money(cents, currency = 'USD') { return new Intl.NumberFormat(localeTag(locale.value), { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format((Number(cents) || 0) / 100) }
function decimal(value, maximumFractionDigits = 4) { return Number(value).toLocaleString(localeTag(locale.value), { maximumFractionDigits }) }
onMounted(() => { document.documentElement.lang = locale.value; load() })
</script>

<template>
  <template v-if="loading || !authenticated">
  <main class="client-portal">
    <header class="client-portal-header">
      <a class="client-brand" href="/"><img :src="logoUrl" alt="Cortés Rodríguez Asesores" /><strong>Cortés Rodríguez Asesores<small>{{ t.portal }}</small></strong></a>
      <div class="header-actions"><LanguageToggle v-model="locale"/><a href="/" class="client-home">{{ t.home }}</a><button v-if="authenticated" class="client-logout" @click="logout">{{ t.logout }}</button></div>
    </header>
    <section v-if="loading" class="client-panel client-loading" aria-live="polite"><span class="sr-only">{{ t.loading }}</span><span class="client-skeleton title"></span><span class="client-skeleton"></span><span class="client-skeleton"></span></section>
    <section v-else class="client-panel client-login">
      <p class="client-kicker">{{ t.access }}</p><h1>{{ t.loginTitle }}</h1><p>{{ t.loginIntro }}</p>
      <form v-if="!codeSent" @submit.prevent="requestCode"><label for="client-email">{{ t.email }}</label><input id="client-email" v-model="email" type="email" autocomplete="email" maxlength="254" required :placeholder="t.emailPlaceholder"/><button class="client-primary" :disabled="sending">{{ sending ? t.sending : t.sendCode }} <span>→</span></button></form>
      <form v-else @submit.prevent="verifyCode"><p class="client-code-hint">{{ t.codeHint }} <strong>{{ email }}</strong>.</p><label for="client-email-code">{{ t.code }}</label><input id="client-email-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"/><button class="client-primary" :disabled="sending || code.length !== 6">{{ sending ? t.verify : t.enter }} <span>→</span></button><button type="button" class="client-back" @click="codeSent = false; code = ''; message = ''; error = ''">{{ t.changeEmail }}</button></form>
      <p v-if="message" class="client-message" role="status">{{ message }}</p><p v-if="error" class="client-error" role="alert">{{ error }}</p>
    </section>
    </main>
</template>
<OperationsShell v-else :menu-items="clientMenuItems" active-page="requests" :current-page="detail ? t.tracking : t.requests" :locale="locale" :user-name="user?.email || email" :user-role="t.portal" :brand-subtitle="t.portal" :breadcrumb-label="t.portal" :menu-label="locale === 'en' ? 'Main menu' : 'Menú principal'" :logout-label="t.logout" :show-search="false" @select="selectClientMenu" @logout="logout" @update:locale="locale = $event">
    <template #topbar-actions><a href="/" class="secondary-button compact">{{ t.home }}</a></template>
    <section class="module-view client-panel client-requests">
      <template v-if="!detail">
        <p class="client-kicker">{{ t.account }}</p><h1>{{ t.requests }}</h1><p>{{ t.signedIn }} <strong>{{ user.email }}</strong>. {{ t.registeredWith }}</p>
        <p v-if="error" class="client-error" role="alert">{{ error }}</p>
        <div v-if="!requests.length" class="client-empty">{{ t.noRequests }}</div>
        <div v-else class="client-request-list">
          <article v-for="item in requests" :key="item.reference" class="client-request-card">
            <div class="request-summary"><span class="client-reference">{{ item.reference }}</span><h2>{{ item.consultation || t.requestTitle }}</h2><p>{{ item.service || t.service }} · {{ dateLabel(item.createdAt) }}</p><strong class="client-amount">{{ money(item.amountCents, item.currency) }}</strong></div>
            <div class="request-states"><span class="client-status" :class="{ paid: item.paymentApproved }">{{ t.paymentStatus }}: {{ paymentLabel(item.paymentStatus) }}</span><span class="care-status">{{ t.careStatus }}: {{ careLabel(item.status) }}</span></div>
            <button class="client-secondary" type="button" @click="openRequest(item.reference)">{{ t.viewRequest }}</button>
          </article>
        </div>
        <footer v-if="pagination.totalPages > 1" class="client-pagination"><span>{{ t.page }} {{ pagination.page }} {{ t.of }} {{ pagination.totalPages }} · {{ pagination.totalItems }} {{ t.requestsCount }}</span><div><button :disabled="pagination.page <= 1" @click="loadRequests(pagination.page - 1)">{{ t.previous }}</button><button :disabled="pagination.page >= pagination.totalPages" @click="loadRequests(pagination.page + 1)">{{ t.next }}</button></div></footer>
      </template>
      <template v-else>
        <button class="client-back-link" type="button" @click="closeDetail">← {{ t.backRequests }}</button>
        <div v-if="detailLoading" class="detail-loading" aria-live="polite"><span class="sr-only">{{ t.loading }}</span><span class="client-skeleton title"></span><span class="client-skeleton"></span></div>
        <div v-else>
          <p class="client-kicker">{{ t.tracking }}</p><h1>{{ detail.reference }}</h1><p>{{ detail.consultation || detail.service }} · {{ dateLabel(detail.createdAt) }}</p>
          <div v-if="error" class="client-error" role="alert">{{ error }}</div>
          <div class="status-grid"><section><span>{{ t.paymentStatus }}</span><strong :class="{ 'paid-text': detail.paymentApproved }">{{ paymentLabel(detail.paymentStatus) }}</strong></section><section><span>{{ t.careStatus }}</span><strong>{{ careLabel(detail.status) }}</strong></section></div>
          <section class="detail-section"><h2>{{ t.consultationValue }}</h2><strong class="detail-price">{{ money(detail.amountCents, detail.currency) }}</strong><p v-if="detail.paymentRequired && !detail.paymentApproved">{{ t.paymentEnables }}</p></section>
          <section v-if="detail.paymentAction !== 'none' || (currentRequestCheckoutMode() === 'bricks' && !detail.paymentApproved)" class="payment-action-box">
            <template v-if="currentRequestCheckoutMode() === 'bricks' && paymentWasSubmitted() && !isTerminalPaymentStatus()">
              <strong>{{ t.checkingTitle }}</strong><p>{{ brickRecoveryMessage || t.bricksChecking }}</p>
              <button class="client-secondary" type="button" :disabled="detailLoading" @click="openRequest(detail.reference)">{{ t.refreshPayment }}</button>
            </template>
            <template v-else-if="shouldKeepBricksAttempt(detail, checkoutMode) && checkoutMode !== 'bricks'">
              <strong>{{ t.bricksUnavailable }}</strong><p>{{ t.bricksChecking }}</p>
            </template>
            <template v-else-if="brickRecoveryError">
              <strong>{{ t.bricksRecoveryFailed }}</strong><p>{{ brickRecoveryMessage || t.bricksRecoveryFailed }}</p>
            </template>
            <template v-else-if="brickIntent">
              <strong>{{ t.payPrompt }}</strong><p>{{ t.checkoutInfo }}</p>
              <MercadoPagoPaymentBrick :intent="brickIntent" :locale="locale === 'en' ? 'en-US' : 'es-CO'" :payer-email="user?.email || ''" @submit="processBrickPayment" @retry="retryBrickPayment" />
            </template>
            <template v-else-if="shouldKeepBricksAttempt(detail, checkoutMode) && brickRecoveryMessage">
              <strong>{{ t.bricksChecking }}</strong><p>{{ brickRecoveryMessage }}</p>
            </template>
            <template v-else-if="detail.paymentAction === 'checking'">
              <strong>{{ t.checkingTitle }}</strong><p>{{ t.checkingBody }}</p>
            </template>
            <template v-else>
              <strong>{{ detail.paymentAction === 'resume' ? t.resume : detail.paymentAction === 'retry' ? t.retry : t.payPrompt }}</strong>
              <p v-if="!paymentQuote">{{ t.reviewQuote }}</p>
              <div v-if="paymentQuote" class="payment-quote" aria-live="polite"><div><span>{{ t.consultationValue }}</span><strong>{{ money(paymentQuote.usdAmountCents, 'USD') }}</strong></div><div><span>{{ t.trm }}{{ paymentQuote.trmDate ? ` · ${dateLabel(paymentQuote.trmDate)}` : '' }}</span><strong>{{ decimal(paymentQuote.trm) }} COP/USD</strong></div><div class="payment-quote-total"><span>{{ t.total }}</span><strong>{{ money(paymentQuote.copAmountCents, 'COP') }}</strong></div></div>
              <p>{{ t.checkoutInfo }}</p><p v-if="brickIntentLoading" role="status">{{ t.preparing }}</p>
              <button class="client-primary" :disabled="sending || brickIntentLoading" @click="startPayment">{{ sending || brickIntentLoading ? t.preparing : paymentQuote ? t.confirmPay : paymentActionLabel(detail.paymentAction) }} <span>→</span></button>
            </template>
          </section>
          <section v-if="detail.question" class="detail-section"><h2>{{ t.yourQuestion }}</h2><p class="question-text">{{ detail.question }}</p></section>
          <section v-if="detail.attachments.length" class="detail-section"><h2>{{ t.attachments }}</h2><div class="client-attachments"><a v-for="file in detail.attachments" :key="file.id" :href="file.url" target="_blank" rel="noreferrer"><img :src="file.url" :alt="file.name"/><span>{{ file.name }}</span></a></div></section>
          <section v-if="detail.paymentAttempts.length" class="detail-section"><h2>{{ t.paymentHistory }}</h2><div class="attempt-row" v-for="(attempt, index) in detail.paymentAttempts" :key="`${attempt.createdAt}-${index}`"><div><strong>{{ paymentLabel(attempt.status) }}</strong><small>{{ dateLabel(attempt.createdAt) }}</small></div><div><strong>{{ money(attempt.usdAmountCents, 'USD') }}</strong><small>{{ money(attempt.copAmountCents, 'COP') }} · {{ t.trm }} {{ decimal(attempt.trm) }}</small></div></div></section>
          <section v-if="detail.response" class="response-box"><p class="client-kicker">{{ t.reviewedResponse }}</p><h2>{{ t.teamResponse }}</h2><p class="question-text">{{ detail.response.body }}</p><p v-if="detail.response.note" class="response-note"><strong>{{ t.noteForYou }}</strong> {{ detail.response.note }}</p></section>
        </div>
      </template>
    </section>
  </OperationsShell>
</template>

<style scoped>
.client-requests.client-panel{width:100%;max-width:none;margin:30px auto 0;padding:0;border:0;background:transparent;box-shadow:none}.client-requests.client-panel>p:not(.client-kicker){font-size:12px}
.client-portal{min-height:100vh;padding:0 24px 32px;background:#f4f7fb;color:#19334d}.client-portal-header{max-width:1080px;min-height:82px;margin:auto;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e1e8ef}.client-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}.client-brand img{display:block;width:48px;height:48px;object-fit:contain}.client-brand strong{font-size:13px}.client-brand small{display:block;margin-top:4px;color:#8392a3;font-size:10px;font-weight:500}.header-actions{display:flex;align-items:center;gap:10px}.client-home,.client-logout,.client-secondary,.client-pagination button,.client-back-link{min-height:36px;padding:0 13px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:11px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.client-panel{width:min(900px,100%);margin:36px auto;padding:30px;border:1px solid #e0e8ef;border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(12,44,70,.05)}.client-login{max-width:480px}.client-kicker{margin:0 0 8px;color:#d91f2b;font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.client-panel h1{margin:0;color:#122d47;font-size:27px;letter-spacing:-.04em}.client-panel>p:not(.client-kicker){color:#718197;font-size:12px;line-height:1.6}.client-login form{display:grid;gap:9px;margin-top:25px}.client-login label{color:#536a80;font-size:11px;font-weight:800}.client-login input{min-height:42px;padding:0 12px;border:1px solid #d6e0ea;border-radius:7px;font:inherit;font-size:12px}.client-code-hint{margin:0 0 4px;color:#718197;font-size:11px;line-height:1.6}.client-code-hint strong{color:#315875}.client-primary{display:inline-flex;justify-content:center;gap:12px;align-items:center;min-height:42px;padding:0 18px;margin-top:7px;border:0;border-radius:7px;color:#fff;background:#0e4567;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.client-primary:disabled{opacity:.6;cursor:wait}.client-back{min-height:34px;border:1px solid #d7e2ec;border-radius:7px;color:#315875;background:#fff;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.client-message,.client-error{padding:11px 13px;border-radius:7px;font-size:11px}.client-message{color:#176247;background:#eaf7f1}.client-error{color:#9d2730;background:#fff0f1}.client-request-list{display:grid;gap:10px;margin-top:22px}.client-request-card{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:16px;align-items:center;padding:16px;border:1px solid #e5ebf1;border-radius:9px}.client-reference{color:#2677a4;font-size:10px;font-weight:800}.client-request-card h2{margin:6px 0;color:#29445d;font-size:14px}.client-request-card p{margin:0;color:#8290a0;font-size:10px}.client-amount{display:block;margin-top:9px;color:#244661;font-size:12px}.request-states{display:grid;gap:7px}.client-status,.care-status{display:block;padding:6px 9px;border-radius:20px;color:#a36812;background:#fff4df;font-size:10px;font-weight:800;white-space:nowrap}.client-status.paid{color:#18704f;background:#eaf7f1}.care-status{color:#53697e;background:#f0f3f6}.client-empty{margin-top:22px;padding:28px;text-align:center;color:#8190a1;background:#f7f9fb;border-radius:8px;font-size:12px}.client-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:18px;color:#8392a3;font-size:10px}.client-pagination div{display:flex;gap:8px}.client-pagination button:disabled{opacity:.45;cursor:not-allowed}.client-back-link{margin-bottom:22px}.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}.status-grid section,.detail-section,.payment-action-box,.response-box{padding:17px;border:1px solid #e3eaf0;border-radius:9px;background:#fff}.status-grid span{display:block;margin-bottom:7px;color:#8290a0;font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:.05em}.status-grid strong{font-size:13px;color:#a36812}.status-grid .paid-text{color:#18704f}.detail-section{margin-top:12px}.detail-section h2,.response-box h2{margin:0 0 11px;color:#29445d;font-size:14px}.detail-section>p{margin:8px 0 0;color:#718197;font-size:11px;line-height:1.6}.detail-price{color:#17334b;font-size:19px}.question-text{white-space:pre-wrap;overflow-wrap:anywhere;color:#3d566e;font-size:12px;line-height:1.7}.payment-action-box{margin-top:12px;background:#f7fafc}.payment-action-box strong{color:#29445d;font-size:13px}.payment-action-box p{margin:7px 0;color:#718197;font-size:11px;line-height:1.55}.payment-action-box .client-primary{margin-top:4px}.client-attachments{display:flex;flex-wrap:wrap;gap:12px}.client-attachments a{width:120px;color:#315875;text-decoration:none;font-size:10px}.client-attachments img{display:block;width:120px;height:90px;object-fit:cover;border-radius:7px;background:#f0f3f6}.client-attachments span{display:block;margin-top:5px;overflow-wrap:anywhere}.attempt-row{display:flex;justify-content:space-between;gap:15px;padding:11px 0;border-top:1px solid #edf1f4}.attempt-row>div{display:grid;gap:4px}.attempt-row>div:last-child{text-align:right}.attempt-row strong{color:#36536d;font-size:11px}.attempt-row small{color:#8b98a6;font-size:10px}.response-box{margin-top:12px;background:#f7fafc}.response-note{padding:11px;border-radius:7px;background:#fff;color:#53697e;font-size:11px;line-height:1.6}.detail-loading{padding:14px}.client-pagination button:disabled{opacity:.5}.client-portal-footer{margin:28px auto 0;text-align:center;color:#96a2b0;font-size:10px}.client-skeleton{display:block;width:70%;height:14px;margin:12px 0;border-radius:6px;background:linear-gradient(90deg,#edf1f5,#f8fafb,#edf1f5);background-size:200% 100%;animation:shimmer 1.4s infinite}.client-skeleton.title{width:45%;height:25px}@keyframes shimmer{to{background-position:-200% 0}}@media(max-width:720px){.client-portal{padding:0 14px 24px}.client-portal-header{min-height:70px}.client-panel{margin:24px auto;padding:22px 18px}.client-panel h1{font-size:23px}.client-request-card{grid-template-columns:1fr;align-items:start}.request-states{display:flex;flex-wrap:wrap}.status-grid{grid-template-columns:1fr}.client-secondary{justify-self:start}.client-home{display:none}}@media(max-width:420px){.client-portal-header{min-height:66px}.client-brand img{width:40px;height:40px}.client-brand strong{font-size:11px}.client-logout{padding:0 9px;font-size:10px}.attempt-row{align-items:flex-start}.attempt-row strong{font-size:10px}}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.payment-quote{display:grid;gap:10px;margin:14px 0;padding:14px;border:1px solid #dbe6ef;border-radius:8px;background:#fff}.payment-quote>div{display:flex;justify-content:space-between;gap:12px;color:#718197;font-size:11px}.payment-quote strong{color:#29445d;font-size:12px;text-align:right}.payment-quote .payment-quote-total{padding-top:10px;border-top:1px solid #e8edf2;color:#29445d;font-weight:800}.payment-quote .payment-quote-total strong{color:#146b52;font-size:15px}
</style>
