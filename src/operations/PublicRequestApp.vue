<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const agentToken = ref('')
const agentContext = ref(null)
const catalog = ref([])
const attachments = ref([])
const turnstileContainer = ref(null)
const turnstileEnabled = ref(false)
const turnstileConfigLoading = ref(true)
const turnstileToken = ref('')
const turnstileError = ref('')
let turnstileWidgetId = null
const form = ref({
  fullName: '',
  legalEntityType: '',
  email: '',
  phone: '',
  whatsapp: '',
  serviceName: 'asesoria_personalizada',
  serviceType: '',
  consultationType: '',
  productType: '',
  question: '',
})
const loading = ref(false)
const error = ref('')
const submitted = ref(false)
const reference = ref('')
const paymentNotice = ref('')
const paymentRequired = ref(false)
const paymentAttemptKey = ref('')
const pendingPayment = ref(null)
const paymentRedirecting = ref(false)
const requestIdempotencyKey = ref('')
const requestPayloadSignature = ref('')
const serviceOptions = computed(() => [...new Map(catalog.value.map((item) => [item.serviceCode, item])).values()])
const consultationOptions = computed(() => catalog.value.filter((item) => item.serviceCode === form.value.serviceType))
const selectedConsultation = computed(() => consultationOptions.value.find((item) => item.consultationCode === form.value.consultationType) || null)
const serviceLabel = computed(() => selectedConsultation.value?.consultationName || 'servicio')
const servicePrice = computed(() => selectedConsultation.value ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: selectedConsultation.value.currency, maximumFractionDigits: 0 }).format(selectedConsultation.value.amountCents / 100) : 'Selecciona un tipo de consulta')
function formatPrice(item) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(item.amountCents / 100) }

onMounted(async () => {
  const query = new URLSearchParams(window.location.search)
  const paymentStatus = query.get('payment')
  if (paymentStatus === 'success') {
    paymentNotice.value = 'Verificando el pago con Mercado Pago…'
    const paymentId = query.get('payment_id') || query.get('collection_id')
    const paymentReference = query.get('external_reference') || query.get('reference')
    if (paymentId && paymentReference) {
      try {
        const verification = await fetch('/api/public/payments/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paymentId, reference: paymentReference }),
        })
        const result = await verification.json().catch(() => ({}))
        if (verification.ok && result.status === 'approved') paymentNotice.value = `Pago aprobado para la solicitud ${result.reference}.`
        else if (verification.ok) paymentNotice.value = 'Pago recibido y pendiente de confirmación. Actualizaremos el estado cuando Mercado Pago lo confirme.'
        else paymentNotice.value = result.error || 'No pudimos confirmar el pago ahora. El estado se actualizará cuando llegue la notificación de Mercado Pago.'
      } catch {
        paymentNotice.value = 'No pudimos confirmar el pago ahora. El estado se actualizará cuando llegue la notificación de Mercado Pago.'
      }
    } else {
      paymentNotice.value = 'Pago recibido. Estamos esperando la confirmación de Mercado Pago.'
    }
  }
  if (paymentStatus === 'pending') paymentNotice.value = 'Pago pendiente de confirmación. Te avisaremos cuando Mercado Pago lo confirme.'
  if (paymentStatus === 'failure') paymentNotice.value = 'El pago no fue aprobado. Puedes intentarlo nuevamente.'
  const turnstileSetup = initializeTurnstile()
  const match = window.location.pathname.match(/^\/solicitud\/agente\/([^/]+)$/)
  if (match) {
    agentToken.value = match[1]
    const agentResponse = await fetch(`/api/public/agent-links/${encodeURIComponent(agentToken.value)}`)
    if (!agentResponse.ok) {
      error.value = 'El enlace de agente es inválido o venció.'
      return
    }
    agentContext.value = await agentResponse.json()
  } else {
    const attributionResponse = await fetch('/api/public/request-attribution-token', { cache: 'no-store' })
    if (!attributionResponse.ok) {
      error.value = 'No fue posible preparar el formulario. Recarga la página e inténtalo de nuevo.'
      return
    }
    agentToken.value = (await attributionResponse.json()).token
  }
  const catalogResponse = await fetch('/api/public/catalog')
  if (catalogResponse.ok) {
    const data = await catalogResponse.json()
    catalog.value = data.items || []
  }
  await turnstileSetup
})

async function loadTurnstileScript() {
  if (typeof window.turnstile?.render === 'function') return
  const staleScript = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]')
  staleScript?.remove()
  await new Promise((resolve, reject) => {
    const source = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => finish(new Error('La verificación tardó demasiado en cargar.')), 15000)
    const finish = (error) => {
      window.clearTimeout(timeout)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onLoad = () => typeof window.turnstile?.render === 'function'
      ? finish()
      : finish(new Error('Cloudflare no inicializó la API de verificación.'))
    const onError = () => finish(new Error('No se pudo cargar la verificación de seguridad.'))
    script.src = source
    script.async = true
    script.defer = true
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    document.head.appendChild(script)
  })
}

async function initializeTurnstile() {
  try {
    const response = await fetch('/api/public/turnstile-config', { cache: 'no-store' })
    if (!response.ok) throw new Error('No se pudo consultar la verificación de seguridad.')
    const config = await response.json()
    if (!config.enabled) return
    if (!config.siteKey) throw new Error('Falta configurar la clave pública de Turnstile.')
    turnstileEnabled.value = true
    await loadTurnstileScript()
    if (!turnstileContainer.value) throw new Error('No se encontró el espacio para la verificación.')
    turnstileWidgetId = window.turnstile.render(turnstileContainer.value, {
      sitekey: config.siteKey,
      action: 'request_create',
      theme: 'light',
      callback: (token) => { turnstileToken.value = token; turnstileError.value = '' },
      'expired-callback': () => { turnstileToken.value = '' },
      'error-callback': (errorCode) => {
        turnstileToken.value = ''
        turnstileError.value = `Cloudflare no pudo completar la verificación (código ${String(errorCode).slice(0, 12)}). Puedes reintentar.`
        return true
      },
    })
  } catch {
    turnstileEnabled.value = true
    turnstileError.value = 'No se pudo cargar la verificación de seguridad. Recarga la página e inténtalo de nuevo.'
  } finally {
    turnstileConfigLoading.value = false
  }
}

async function retryTurnstile() {
  if (turnstileWidgetId !== null && typeof window.turnstile?.remove === 'function') {
    window.turnstile.remove(turnstileWidgetId)
    turnstileWidgetId = null
  }
  turnstileToken.value = ''
  turnstileError.value = ''
  turnstileConfigLoading.value = true
  await initializeTurnstile()
}

onUnmounted(() => {
  if (turnstileWidgetId !== null && window.turnstile) window.turnstile.remove(turnstileWidgetId)
})

function resetTurnstile() {
  turnstileToken.value = ''
  if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId)
}

function changeService() {
  form.value.consultationType = ''
}

function selectAttachments(event) {
  const selected = Array.from(event.target.files || [])
  if (selected.length > 5) {
    error.value = 'Puedes adjuntar máximo 5 imágenes.'
    attachments.value = []
    return
  }
  if (selected.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
    error.value = 'Cada adjunto debe ser PNG, JPG o WEBP y pesar máximo 10 MB.'
    attachments.value = []
    return
  }
  error.value = ''
  attachments.value = selected
}

function normalizePhone(value) {
  return String(value || '').replace(/[\s().-]/g, '')
}

function validateForm() {
  const fullName = form.value.fullName.trim()
  const email = form.value.email.trim().toLowerCase()
  const phone = normalizePhone(form.value.phone)
  const whatsapp = normalizePhone(form.value.whatsapp)
  const question = form.value.question.trim()
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(fullName)) return 'El nombre debe tener entre 2 y 120 caracteres y solo puede contener letras, espacios, puntos o guiones.'
  if (!email) return 'El correo electrónico es obligatorio.'
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Ingresa un correo electrónico válido.'
  if (phone && !/^\+?\d{7,15}$/.test(phone)) return 'El teléfono debe tener entre 7 y 15 dígitos.'
  if (whatsapp && !/^\+?\d{7,15}$/.test(whatsapp)) return 'El WhatsApp debe tener entre 7 y 15 dígitos.'
  if (question.length < 20 || question.length > 3000) return 'La consulta debe tener entre 20 y 3000 caracteres.'
  return ''
}

async function submitRequest() {
  loading.value = true
  error.value = ''
  try {
    const validationError = validateForm()
    if (validationError) throw new Error(validationError)
    if (turnstileEnabled.value && !turnstileToken.value) throw new Error(turnstileError.value || 'Completa la verificación de seguridad.')
    const payload = new FormData()
    Object.entries(form.value).forEach(([key, value]) => payload.append(key, value))
    if (agentToken.value) payload.append('attributionToken', agentToken.value)
    if (turnstileToken.value) payload.append('turnstileToken', turnstileToken.value)
    attachments.value.forEach((file) => payload.append('attachments', file))
    const payloadSignature = JSON.stringify({ ...form.value, agentToken: agentToken.value, attachments: attachments.value.map((file) => [file.name, file.size, file.type, file.lastModified]) })
    if (!requestIdempotencyKey.value || requestPayloadSignature.value !== payloadSignature) {
      requestIdempotencyKey.value = crypto.randomUUID()
      requestPayloadSignature.value = payloadSignature
    }
    payload.append('idempotencyKey', requestIdempotencyKey.value)
    const response = await fetch('/api/public/requests', {
      method: 'POST',
      body: payload,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      resetTurnstile()
      throw new Error(data.error || 'No fue posible registrar la solicitud.')
    }
    reference.value = data.reference
    paymentRequired.value = Boolean(data.paymentRequired)
    if (paymentRequired.value) await requestPaymentPreference()
    else submitted.value = true
  } catch (submitError) {
    error.value = submitError.message
  } finally {
    loading.value = false
  }
}

async function requestPaymentPreference() {
  if (!paymentAttemptKey.value) paymentAttemptKey.value = crypto.randomUUID()
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/public/payments/preference', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: reference.value, idempotencyKey: paymentAttemptKey.value }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.initPoint) throw new Error(data.error || 'La solicitud quedó registrada, pero no fue posible cotizar el pago.')
    pendingPayment.value = data
  } catch (paymentError) {
    error.value = paymentError.message
  } finally {
    loading.value = false
  }
}

function continueToPayment() {
  if (paymentRedirecting.value || !pendingPayment.value?.initPoint) return
  paymentRedirecting.value = true
  try {
    const checkoutUrl = new URL(pendingPayment.value.initPoint)
    if (checkoutUrl.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.co)?$/i.test(checkoutUrl.hostname)) {
      throw new Error('El enlace de pago no pertenece a Mercado Pago.')
    }
    window.location.assign(checkoutUrl.toString())
  } catch (navigationError) {
    paymentRedirecting.value = false
    error.value = navigationError.message || 'No fue posible abrir el pago.'
  }
}

function goToLanding() {
  window.location.href = '/'
}
</script>

<template>
  <main class="request-page">
    <header class="request-header"><button class="request-brand" type="button" aria-label="Volver al inicio de Cortés Rodríguez Asesores" @click="goToLanding"><img :src="logoUrl" alt="Logo Cortés Rodríguez Asesores" /><strong>Cortés Rodríguez<br /><small>Asesores</small></strong></button><div class="header-note"><span class="header-dot"></span> Solicitud de asesoría</div></header>
    <section class="request-layout">
      <aside class="request-intro"><p class="request-kicker">Comercio exterior</p><h1>Cuéntanos sobre tu operación.</h1><p>Completa el formulario y nuestro equipo analizará tu requerimiento para acompañarte en el proceso.</p><div class="intro-points"><div><span>01</span><p><strong>Déjanos tus datos</strong><br />Solo te pedimos la información necesaria.</p></div><div><span>02</span><p><strong>Revisamos tu caso</strong><br />Un asesor estudiará los detalles de tu operación.</p></div><div><span>03</span><p><strong>Te contactamos</strong><br />Pronto recibirás noticias de nuestro equipo.</p></div></div><div class="intro-footer">¿Ya tienes una solicitud? <a href="/portal-cliente">Consultar mis solicitudes →</a><a href="/app/login">Ingresar al panel operativo →</a></div></aside>
      <section class="request-card"><div class="form-heading"><div><p class="form-step">Solicitud nueva <span>•</span> Paso 1 de 1</p><h2>Información de tu operación</h2><p>Los campos marcados con <b>*</b> son obligatorios.</p><p v-if="agentContext" class="agent-context">{{ agentContext.displayLabel }}</p></div><span class="form-badge">⟡</span></div>
        <p v-if="paymentNotice" class="payment-notice" role="status">{{ paymentNotice }}</p>
        <section v-if="reference && paymentRequired" class="payment-review" aria-live="polite">
          <p class="form-step">Solicitud registrada</p><h2>Revisa el valor antes de pagar</h2>
          <dl v-if="pendingPayment" class="payment-summary"><div><dt>Solicitud</dt><dd>{{ reference }}</dd></div><div><dt>Valor del servicio</dt><dd>{{ (pendingPayment.usdAmountCents / 100).toFixed(2) }} USD</dd></div><div><dt>Tasa de conversión (TRM)</dt><dd>{{ Number(pendingPayment.trm).toLocaleString('es-CO', { maximumFractionDigits: 4 }) }} COP/USD · {{ pendingPayment.trmDate }}</dd></div><div class="payment-total"><dt>Total en Mercado Pago</dt><dd>{{ (pendingPayment.copAmountCents / 100).toLocaleString('es-CO') }} COP</dd></div></dl>
          <p v-else-if="loading" class="field-help">Calculando el valor en pesos colombianos…</p>
          <p v-else class="field-help">La solicitud ya está registrada. Puedes volver a intentar calcular el pago.</p>
          <p v-if="error" class="request-error" role="alert">{{ error }}</p>
          <div class="form-actions"><button v-if="!pendingPayment" type="button" class="back-button" :disabled="loading" @click="requestPaymentPreference">{{ loading ? 'Consultando…' : 'Reintentar cálculo' }}</button><button v-else type="button" class="submit-request" :disabled="loading || paymentRedirecting" @click="continueToPayment">{{ paymentRedirecting ? 'Abriendo pago…' : 'Pagar' }} <span>→</span></button></div>
          <a class="portal-link" href="/portal-cliente">¿Quieres continuar después? Consulta aquí tus solicitudes.</a>
        </section>
        <form v-else-if="!submitted" @submit.prevent="submitRequest">
          <fieldset><legend>Datos del cliente</legend><div class="field full-field"><label for="fullName">Nombre completo <b>*</b></label><input id="fullName" v-model="form.fullName" type="text" minlength="2" maxlength="120" autocomplete="name" placeholder="Ej. Juan Pablo Gómez" required /></div><div class="field"><label for="legalEntityType">Constitución legal <b>*</b></label><select id="legalEntityType" v-model="form.legalEntityType" required><option value="" disabled>Selecciona una opción</option><option value="natural">Persona natural</option><option value="juridica">Persona jurídica</option></select></div></fieldset>
          <fieldset><legend>Medios de contacto <span>Correo obligatorio; teléfono y WhatsApp opcionales</span></legend><div class="field"><label for="email">Correo electrónico <b>*</b></label><input id="email" v-model="form.email" type="email" maxlength="254" autocomplete="email" placeholder="nombre@empresa.com" required /></div><div class="field"><label for="phone">Teléfono</label><input id="phone" v-model="form.phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" pattern="[+0-9 ()-]{7,20}" placeholder="+57 300 000 0000" /></div><div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" v-model="form.whatsapp" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" pattern="[+0-9 ()-]{7,20}" placeholder="+57 300 000 0000" /></div></fieldset>
          <fieldset><legend>Detalles de la operación</legend><div class="field"><label for="serviceType">Servicio general <b>*</b></label><select id="serviceType" v-model="form.serviceType" required @change="changeService"><option value="" disabled>Selecciona un servicio</option><option v-for="item in serviceOptions" :key="item.serviceCode" :value="item.serviceCode">{{ item.serviceName }}</option></select></div><div class="field"><label for="consultationType">Tipo de consulta <b>*</b></label><select id="consultationType" v-model="form.consultationType" required :disabled="!form.serviceType"><option value="" disabled>Selecciona una consulta</option><option v-for="item in consultationOptions" :key="item.consultationCode" :value="item.consultationCode">{{ item.consultationName }} · {{ formatPrice(item) }}</option></select><small v-if="selectedConsultation" class="field-help">{{ selectedConsultation.consultationDescription }}</small></div><div class="field full-field"><label>Valor de la asesoría</label><div class="static-field"><span>{{ selectedConsultation?.consultationName || 'Selecciona un tipo de consulta' }}</span><strong>{{ servicePrice }}</strong></div></div><div class="field"><label for="productType">Tipo de producto <b>*</b></label><select id="productType" v-model="form.productType" required><option value="" disabled>Selecciona una opción</option><option value="vehiculos">Vehículos</option><option value="mercancias">Mercancías</option></select></div><div class="field full-field"><label for="question">¿Qué necesitas consultar? <b>*</b></label><textarea id="question" v-model="form.question" rows="5" minlength="20" maxlength="3000" placeholder="Describe tu operación o la pregunta que deseas resolver." required></textarea><small class="field-help">Mínimo 20 caracteres.</small></div><div class="field full-field"><label for="attachments">Imágenes de apoyo</label><input id="attachments" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="selectAttachments" /><small class="field-help">Puedes adjuntar hasta 5 imágenes, máximo 10 MB cada una.</small><small v-if="attachments.length" class="field-help">{{ attachments.length }} imagen(es) seleccionada(s).</small></div><div v-if="turnstileEnabled" class="field full-field"><label>Verificación de seguridad <b>*</b></label><div ref="turnstileContainer" class="turnstile-container"></div><small v-if="turnstileError" class="field-help request-error" role="alert">{{ turnstileError }}</small></div></fieldset>
          <button v-if="turnstileEnabled && turnstileError" type="button" class="retry-turnstile" :disabled="turnstileConfigLoading" @click="retryTurnstile">{{ turnstileConfigLoading ? 'Reintentando…' : 'Reintentar verificación' }}</button><p v-if="error" class="request-error" role="alert">{{ error }}</p><div class="form-actions"><button type="button" class="back-button" @click="goToLanding">Volver a la página principal</button><button type="submit" class="submit-request" :disabled="loading || turnstileConfigLoading || (turnstileEnabled && !turnstileToken)">{{ loading ? 'Registrando solicitud…' : 'Enviar solicitud' }} <span>→</span></button></div>
        </form>
      </section>
    </section>
    <footer class="request-footer">© 2026 Cortés Rodríguez Asesores S.A.S. <span>·</span> Tu información será tratada de forma confidencial.</footer>
    <div v-if="submitted" class="success-backdrop"><section class="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><div class="success-icon">✓</div><p class="request-kicker">Solicitud recibida</p><h2 id="success-title">Gracias por seleccionarnos</h2><p>Recibimos la información de tu {{ serviceLabel.toLowerCase() }}. Pronto se contactará contigo un miembro de nuestro equipo.</p><div class="success-reference">Referencia <strong>{{ reference }}</strong></div><a class="portal-link" href="/portal-cliente">Consultar mis solicitudes →</a><button type="button" class="submit-request" @click="goToLanding">Volver a la página principal <span>→</span></button></section></div>
  </main>
</template>

<style scoped>
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#071c3f;background:#f5f8fc}:global(button),:global(input),:global(select){font:inherit}.request-page{min-height:100vh;background:linear-gradient(135deg,#f5f8fc,#fff 55%,#fdf5f5)}.request-header{height:82px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(22px,6vw,92px);border-bottom:1px solid #dfe6ef;background:rgba(255,255,255,.92)}.request-brand{display:flex;align-items:center;gap:11px;padding:0;border:0;color:#062653;background:transparent;text-align:left;cursor:pointer}.request-brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;color:#fff;background:#062653;font-size:11px;font-weight:900}.request-brand strong{font-size:13px;line-height:1.05}.request-brand small{color:#586780;font-size:9px;font-weight:500}.header-note{display:flex;align-items:center;gap:8px;color:#586780;font-size:11px;font-weight:700}.header-dot{width:7px;height:7px;border-radius:50%;background:#53ad88;box-shadow:0 0 0 4px #e1f4eb}.request-layout{display:grid;grid-template-columns:minmax(280px,.75fr) minmax(620px,1.25fr);gap:clamp(35px,6vw,105px);max-width:1280px;margin:0 auto;padding:65px clamp(22px,6vw,92px) 42px}.request-intro{display:flex;flex-direction:column;justify-content:center;padding-bottom:25px}.request-kicker,.form-step{margin:0 0 13px;color:#ed1c24;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.request-intro h1{max-width:420px;margin:0 0 20px;color:#062653;font-size:clamp(36px,4.5vw,61px);line-height:1.04;letter-spacing:-.06em}.request-intro>p:not(.request-kicker){max-width:390px;margin:0;color:#586780;font-size:15px;line-height:1.7}.intro-points{display:grid;gap:17px;margin-top:48px}.intro-points>div{display:flex;gap:13px;align-items:start}.intro-points span{display:grid;place-items:center;width:29px;height:29px;border:1px solid #dfe6ef;border-radius:9px;color:#0c3c78;font-size:9px;font-weight:900}.intro-points p{margin:0;color:#586780;font-size:11px;line-height:1.45}.intro-points strong{color:#062653;font-size:12px}.intro-footer{margin-top:60px;color:#586780;font-size:11px}.intro-footer a{display:block;margin-top:7px;color:#0c3c78;font-weight:800;text-decoration:none}.request-card{padding:35px 38px 29px;border:1px solid #dfe6ef;border-radius:15px;background:rgba(255,255,255,.97);box-shadow:0 18px 48px rgba(6,38,83,.12)}.form-heading{display:flex;justify-content:space-between;gap:20px;margin-bottom:29px}.form-step{margin-bottom:9px;color:#ed1c24;font-size:10px}.form-step span{margin:0 5px;color:#586780}.form-heading h2{margin:0 0 7px;color:#062653;font-size:24px;letter-spacing:-.04em}.form-heading>div>p:last-child{margin:0;color:#586780;font-size:11px}.form-heading b,label b{color:#ed1c24}.form-badge{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;color:#ed1c24;background:#fff0f1;font-size:20px}form{display:grid;gap:25px}fieldset{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 14px;margin:0;padding:0;border:0}legend{grid-column:1/-1;display:flex;align-items:center;gap:9px;width:100%;padding:0 0 12px;border-bottom:1px solid #dfe6ef;color:#062653;font-size:12px;font-weight:800}legend span{color:#586780;font-size:10px;font-weight:500}.field{display:grid;gap:7px;padding-top:8px}.full-field{grid-column:1/-1}.field label{color:#586780;font-size:10px;font-weight:800}.field input,.field select,.static-field{width:100%;min-height:43px;padding:0 12px;border:1px solid #dfe6ef;border-radius:7px;outline:0;color:#071c3f;background:#fff;font-size:12px;transition:border .2s,box-shadow .2s}.static-field{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#0c3c78;background:#f5f8fc;font-weight:700}.field input::placeholder{color:#98a2b3}.field input:focus,.field select:focus{border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.1)}.request-error{margin:0;padding:10px 12px;border-radius:7px;color:#7a1116;background:#fff0f1;font-size:11px}.form-actions{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-top:5px}.back-button{padding:0;border:0;color:#586780;background:transparent;font-size:11px;cursor:pointer}.submit-request{display:inline-flex;align-items:center;justify-content:center;gap:17px;min-height:44px;padding:0 17px;border:0;border-radius:7px;color:#fff;background:#ed1c24;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 7px 14px rgba(237,28,36,.16)}.submit-request:hover{background:#c9141b}.submit-request:disabled{opacity:.6;cursor:wait}.submit-request span{font-size:17px;font-weight:400}.request-footer{padding:0 20px 27px;text-align:center;color:#586780;font-size:10px}.request-footer span{margin:0 5px}.success-backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(3,25,56,.7);backdrop-filter:blur(5px)}.success-modal{width:min(445px,100%);padding:42px 38px 35px;border-radius:17px;background:#fff;text-align:center;box-shadow:0 25px 70px rgba(6,38,83,.25)}.success-icon{display:grid;place-items:center;width:57px;height:57px;margin:0 auto 22px;border-radius:50%;color:#fff;background:#ed1c24;font-size:28px;font-weight:500;box-shadow:0 0 0 8px #fff0f1}.success-modal h2{margin:0 0 12px;color:#062653;font-size:27px;letter-spacing:-.05em}.success-modal>p:not(.request-kicker){margin:0;color:#586780;font-size:13px;line-height:1.65}.success-reference{margin:22px 0 25px;padding:11px;border-radius:7px;color:#586780;background:#f5f8fc;font-size:10px}.success-reference strong{display:block;margin-top:4px;color:#0c3c78;font-size:12px;letter-spacing:.06em}@media(max-width:980px){.request-layout{grid-template-columns:1fr;max-width:740px}.request-intro{display:block}.request-intro h1{font-size:45px}.intro-points{grid-template-columns:repeat(3,1fr);margin-top:30px}.intro-footer{margin-top:25px}}@media(max-width:620px){.request-header{height:70px}.header-note{display:none}.request-layout{padding-top:36px}.request-intro h1{font-size:39px}.intro-points{grid-template-columns:1fr}.request-card{padding:25px 18px}.form-heading h2{font-size:21px}fieldset{grid-template-columns:1fr}.full-field{grid-column:auto}.form-actions{display:grid;justify-content:stretch}.submit-request,.back-button{width:100%}}
.field textarea{width:100%;padding:11px 12px;border:1px solid #dfe6ef;border-radius:7px;outline:0;resize:vertical;color:#071c3f;background:#fff;font-size:12px;line-height:1.5}.field textarea:focus{border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.1)}.field-help{color:#98a2b3;font-size:10px;line-height:1.4}.agent-context{margin:9px 0 0!important;color:#39836d!important;font-size:10px!important;font-weight:700}
.turnstile-container{min-height:65px}
.retry-turnstile{justify-self:start;padding:8px 12px;border:1px solid #dfe6ef;border-radius:7px;color:#0c3c78;background:#fff;font-size:11px;font-weight:700;cursor:pointer}.retry-turnstile:disabled{opacity:.6;cursor:wait}
.payment-notice{margin:0 0 18px;padding:11px 13px;border:1px solid #cfe6db;border-radius:7px;color:#28694f;background:#edf9f3;font-size:11px;font-weight:700}
.payment-review{display:grid;gap:12px;padding:20px;border:1px solid #dfe6ef;border-radius:10px;background:#fff}.payment-review h2{margin:0;color:#062653;font-size:20px}.payment-summary{display:grid;gap:0;margin:0;border:1px solid #dfe6ef;border-radius:8px;overflow:hidden}.payment-summary>div{display:flex;justify-content:space-between;gap:18px;padding:12px 14px;border-bottom:1px solid #e9eef4;font-size:12px}.payment-summary>div:last-child{border-bottom:0}.payment-summary dt{color:#586780}.payment-summary dd{margin:0;color:#173b58;font-weight:700;text-align:right}.payment-summary .payment-total{background:#f5f8fc;font-size:14px;font-weight:800}.payment-summary .payment-total dd{color:#0c6c4c}.payment-review .form-actions{justify-content:flex-end}
.request-intro{justify-content:flex-start}
.request-brand>img{display:block;width:48px;height:48px;padding:2px;border:1px solid #dfe6ef;border-radius:9px;background:#fff;object-fit:contain}
 .portal-link{display:block;margin:0 0 16px;color:#0c3c78;font-size:12px;font-weight:800;text-decoration:none}.portal-link:hover{text-decoration:underline}
</style>
