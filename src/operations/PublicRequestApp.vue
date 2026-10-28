<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getInitialLocale, localeTag, persistLocale } from '../lib/locale.js'
import LanguageToggle from '../shared/components/LanguageToggle.vue'
import MercadoPagoPaymentBrick from './components/MercadoPagoPaymentBrick.vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const locale = ref('es')
function setLocale(value) {
  locale.value = persistLocale(value)
  document.documentElement.lang = localeTag(locale.value)
}
function tr(es, en) { return locale.value === 'en' ? en : es }
function localizedError(message) {
  const known = {
    'El nombre debe tener entre 2 y 120 caracteres y solo puede contener letras, espacios, puntos o guiones.': 'Name must be 2–120 characters and contain only letters, spaces, periods, or hyphens.',
    'El correo electrónico es obligatorio.': 'Email is required.', 'Ingresa un correo electrónico válido.': 'Enter a valid email address.',
    'El teléfono debe tener entre 7 y 15 dígitos.': 'Phone number must contain 7–15 digits.', 'El WhatsApp debe tener entre 7 y 15 dígitos.': 'WhatsApp number must contain 7–15 digits.',
    'La consulta debe tener entre 20 y 3000 caracteres.': 'Your question must be 20–3,000 characters.',
    'Puedes adjuntar máximo 5 imágenes.': 'You can attach up to 5 images.', 'Cada adjunto debe ser PNG, JPG o WEBP y pesar máximo 10 MB.': 'Each attachment must be PNG, JPG, or WEBP and no larger than 10 MB.',
    'Completa la verificación de seguridad.': 'Complete the security check.', 'No fue posible registrar la solicitud.': 'We could not submit your request.',
    'No se pudo iniciar el formulario. Inténtalo de nuevo.': 'Could not start the form. Please try again.',
    'La solicitud quedó registrada, pero no fue posible cotizar el pago.': 'Your request was registered, but we could not prepare the payment quote.',
    'El enlace de pago no pertenece a Mercado Pago.': 'The payment link is not from Mercado Pago.', 'No fue posible abrir el pago.': 'We could not open the payment page.',
    'Abre el formulario desde la página principal.': 'Open the form from the home page.',
    'La base de datos operativa no está configurada.': 'The operations database is not configured.',
    'El servicio no está disponible.': 'The service is unavailable.', 'El pago no está configurado.': 'Payments are not configured.',
    'La solicitud supera el tamaño máximo permitido.': 'The request exceeds the maximum allowed size.',
    'El enlace de origen no es válido. Recarga el formulario e inténtalo de nuevo.': 'The source link is invalid. Reload the form and try again.',
    'La clave de envío no es válida. Recarga el formulario e inténtalo de nuevo.': 'The submission key is invalid. Reload the form and try again.',
    'No se pudo verificar el envío. Actualiza la verificación e inténtalo de nuevo.': 'Could not verify the submission. Refresh the security check and try again.',
    'El enlace de origen es inválido o venció. Recarga el formulario e inténtalo de nuevo.': 'The source link is invalid or expired. Reload the form and try again.',
    'La especialidad seleccionada no está disponible.': 'The selected specialty is unavailable.',
    'Cada adjunto debe ser una imagen de máximo 10 MB.': 'Each attachment must be an image no larger than 10 MB.',
    'El total de las imágenes no puede superar 25 MB.': 'The combined image size cannot exceed 25 MB.',
    'Uno de los adjuntos no es una imagen válida o supera las dimensiones permitidas.': 'One attachment is not a valid image or exceeds the allowed dimensions.',
    'Este envío ya fue procesado con otra información. Recarga el formulario para iniciar uno nuevo.': 'This submission was already processed with different information. Reload the form to start a new one.',
    'La solicitud sigue procesándose. Espera unos segundos y vuelve a enviar el mismo formulario.': 'Your request is still processing. Wait a few seconds and submit the same form again.',
    'El almacenamiento de imágenes no está configurado.': 'Image storage is not configured.',
    'El servicio de solicitudes no está disponible.': 'The request service is unavailable.',
    'Has realizado demasiados intentos. Espera antes de volver a intentarlo.': 'You have made too many attempts. Wait before trying again.',
    'Falta la referencia de la solicitud.': 'The request reference is missing.', 'La clave de intento de pago no es válida.': 'The payment attempt key is invalid.',
    'No se pudo autorizar el pago de esta solicitud.': 'Could not authorize payment for this request.', 'Solicitud no encontrada.': 'Request not found.',
    'La solicitud no tiene un precio USD válido.': 'The request does not have a valid USD price.', 'Esta solicitud no requiere pago.': 'This request does not require payment.',
    'Esta solicitud ya no admite pagos.': 'This request can no longer accept payments.',
    'Esta solicitud ya tuvo un pago confirmado. Contacta a administración para revisar su estado antes de iniciar otro cobro.': 'This request already has a confirmed payment. Contact the administrator to review its status before starting another charge.',
    'Esta solicitud ya tiene un pago confirmado.': 'This request already has a confirmed payment.',
    'Este intento está en verificación y todavía no se puede reemplazar.': 'This attempt is being verified and cannot be replaced yet.',
    'Hay un intento de pago en curso. Espera la confirmación antes de crear otro.': 'A payment attempt is in progress. Wait for confirmation before creating another.',
    'Estamos verificando si Mercado Pago creó el intento anterior. No inicies otro pago todavía.': 'We are checking whether Mercado Pago created the previous attempt. Do not start another payment yet.',
    'No fue posible consultar la TRM. Inténtalo nuevamente en unos minutos.': 'Could not retrieve the exchange rate. Try again in a few minutes.',
    'El precio o la tasa de conversión no son válidos para iniciar el pago.': 'The price or exchange rate is invalid for starting the payment.',
    'Ya se está preparando un intento de pago para esta solicitud. Espera un momento y actualiza el estado.': 'A payment attempt is already being prepared for this request. Wait a moment and refresh the status.',
    'No fue posible iniciar el checkout. Puedes volver a intentarlo.': 'Could not start checkout. You can try again.',
    'Mercado Pago devolvió un intento incompleto; validaremos el estado antes de reintentar.': 'Mercado Pago returned an incomplete attempt. We will verify its status before you retry.',
    'Se creó el intento, pero estamos verificando su registro. Actualiza el estado antes de continuar.': 'The payment attempt was created, but we are verifying it was recorded. Refresh the status before continuing.',
    'No fue posible confirmar el pago. Actualiza el estado en unos minutos.': 'Could not confirm the payment. Refresh the status in a few minutes.',
    'El pago no corresponde a esta solicitud.': 'The payment does not belong to this request.',
    'El pago no coincide con el valor registrado para esta solicitud.': 'The payment amount does not match the amount recorded for this request.',
  }
  return locale.value === 'en' ? (known[message] || 'We could not complete this request. Please try again.') : message
}
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
const originValid = ref(false)
const originLoading = ref(true)
const submitted = ref(false)
const reference = ref('')
const paymentNotice = ref('')
const paymentRequired = ref(false)
const paymentAttemptKey = ref('')
const pendingPayment = ref(null)
const checkoutMode = ref('pro')
const pendingBrickIntent = ref(null)
const paymentRedirecting = ref(false)
const requestIdempotencyKey = ref('')
const requestPayloadSignature = ref('')
const serviceOptions = computed(() => [...new Map(catalog.value.map((item) => [item.serviceCode, item])).values()])
const consultationOptions = computed(() => catalog.value.filter((item) => item.serviceCode === form.value.serviceType))
const selectedConsultation = computed(() => consultationOptions.value.find((item) => item.consultationCode === form.value.consultationType) || null)
const consultationName = (item) => locale.value === 'en' ? ({ consulta_basica: 'Basic consultation', datos_legales: 'Legal data consultation', importacion_casa: 'Household goods import' }[item.consultationCode] || item.consultationName) : item.consultationName
const consultationDescription = (item) => locale.value === 'en' ? ({ consulta_basica: 'Initial guidance on an international trade operation.', datos_legales: 'Review and guidance on legal requirements and information.', importacion_casa: 'Guidance on importing household goods.' }[item.consultationCode] || item.consultationDescription) : item.consultationDescription
const serviceName = (item) => locale.value === 'en' ? ({ asesoria_personalizada: 'Personalized advisory', importacion: 'Import', exportacion: 'Export', agente_carga: 'Freight forwarding' }[item.serviceCode] || item.serviceName) : item.serviceName
const serviceLabel = computed(() => selectedConsultation.value ? consultationName(selectedConsultation.value) : tr('servicio', 'service'))
const servicePrice = computed(() => selectedConsultation.value ? new Intl.NumberFormat(localeTag(locale.value), { style: 'currency', currency: selectedConsultation.value.currency, maximumFractionDigits: 0 }).format(selectedConsultation.value.amountCents / 100) : tr('Selecciona un tipo de consulta', 'Select a consultation type'))
function formatPrice(item) { return new Intl.NumberFormat(localeTag(locale.value), { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(item.amountCents / 100) }

onMounted(async () => {
  setLocale(getInitialLocale())
  try {
    const featureResponse = await fetch('/api/public/features', { cache: 'no-store' })
    if (featureResponse.ok) {
      const features = await featureResponse.json().catch(() => ({}))
      if (features.checkoutMode === 'bricks') checkoutMode.value = 'bricks'
    }
  } catch {
    // Checkout Pro remains the safe default when feature configuration is unavailable.
  }
  const query = new URLSearchParams(window.location.search)
  const paymentStatus = query.get('payment')
  if (paymentStatus === 'success') {
    paymentNotice.value = tr('Verificando el pago con Mercado Pago…', 'Verifying your payment with Mercado Pago…')
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
        if (verification.ok && result.status === 'approved') paymentNotice.value = tr(`Pago aprobado para la solicitud ${result.reference}.`, `Payment approved for request ${result.reference}.`)
        else if (verification.ok) paymentNotice.value = tr('Pago recibido y pendiente de confirmación. Actualizaremos el estado cuando Mercado Pago lo confirme.', 'Payment received and awaiting confirmation. We will update the status when Mercado Pago confirms it.')
        else paymentNotice.value = localizedError(result.error || tr('No pudimos confirmar el pago ahora. El estado se actualizará cuando llegue la notificación de Mercado Pago.', 'We could not confirm the payment yet. The status will update when Mercado Pago sends its notification.'))
      } catch {
        paymentNotice.value = tr('No pudimos confirmar el pago ahora. El estado se actualizará cuando llegue la notificación de Mercado Pago.', 'We could not confirm the payment yet. The status will update when Mercado Pago sends its notification.')
      }
    } else {
      paymentNotice.value = tr('Pago recibido. Estamos esperando la confirmación de Mercado Pago.', 'Payment received. We are waiting for confirmation from Mercado Pago.')
    }
  }
  if (paymentStatus === 'pending') paymentNotice.value = tr('Pago pendiente de confirmación. Te avisaremos cuando Mercado Pago lo confirme.', 'Payment pending confirmation. We will let you know when Mercado Pago confirms it.')
  if (paymentStatus === 'failure') paymentNotice.value = tr('El pago no fue aprobado. Puedes intentarlo nuevamente.', 'Your payment was not approved. You can try again.')
  const match = window.location.pathname.match(/^\/solicitud\/agente\/([^/]+)$/)
  if (match) {
    agentToken.value = match[1]
    window.history.replaceState(window.history.state, '', '/solicitud')
    try {
      const agentResponse = await fetch(`/api/public/agent-links/${encodeURIComponent(agentToken.value)}`)
      if (!agentResponse.ok) throw new Error(tr('El enlace de agente es inválido o venció.', 'This agent link is invalid or has expired.'))
      agentContext.value = await agentResponse.json()
      originValid.value = true
    } catch (agentError) {
      error.value = agentError.message || tr('El enlace de agente es inválido o venció.', 'This agent link is invalid or has expired.')
      originLoading.value = false
      return
    }
    originLoading.value = false
  } else {
    agentToken.value = new URLSearchParams(window.location.hash.slice(1)).get('originToken') || ''
    if (agentToken.value && !/^[A-Za-z0-9_-]{40,60}$/.test(agentToken.value)) {
      error.value = tr('El enlace de origen es inválido o venció. Recarga el formulario e inténtalo de nuevo.', 'The source link is invalid or expired. Reload the form and try again.')
      originLoading.value = false
      return
    }
    if (!agentToken.value) {
      try {
        const startResponse = await fetch('/api/public/request-start', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const startData = await startResponse.json().catch(() => ({}))
        if (!startResponse.ok || !/^[A-Za-z0-9_-]{40,60}$/.test(startData.token || '')) {
          throw new Error(startData.error || tr('No se pudo iniciar el formulario. Inténtalo de nuevo.', 'Could not start the form. Please try again.'))
        }
        agentToken.value = startData.token
      } catch (startError) {
        error.value = localizedError(startError.message || tr('No se pudo iniciar el formulario. Inténtalo de nuevo.', 'Could not start the form. Please try again.'))
        originLoading.value = false
        return
      }
    }
    window.history.replaceState(window.history.state, '', '/solicitud')
    originValid.value = true
    originLoading.value = false
  }
  const turnstileSetup = initializeTurnstile()
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
    const timeout = window.setTimeout(() => finish(new Error(tr('La verificación tardó demasiado en cargar.', 'The security check took too long to load.'))), 15000)
    const finish = (error) => {
      window.clearTimeout(timeout)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onLoad = () => typeof window.turnstile?.render === 'function'
      ? finish()
      : finish(new Error(tr('Cloudflare no inicializó la API de verificación.', 'Cloudflare could not initialize the security check.')))
    const onError = () => finish(new Error(tr('No se pudo cargar la verificación de seguridad.', 'The security check could not be loaded.')))
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
    if (!response.ok) throw new Error(tr('No se pudo consultar la verificación de seguridad.', 'Could not load the security check configuration.'))
    const config = await response.json()
    if (!config.enabled) return
    if (!config.siteKey) throw new Error(tr('Falta configurar la clave pública de Turnstile.', 'The Turnstile site key is not configured.'))
    turnstileEnabled.value = true
    await loadTurnstileScript()
    if (!turnstileContainer.value) throw new Error(tr('No se encontró el espacio para la verificación.', 'The security check area was not found.'))
    turnstileWidgetId = window.turnstile.render(turnstileContainer.value, {
      sitekey: config.siteKey,
      action: 'request_create',
      theme: 'light',
      callback: (token) => { turnstileToken.value = token; turnstileError.value = '' },
      'expired-callback': () => { turnstileToken.value = '' },
      'error-callback': (errorCode) => {
        turnstileToken.value = ''
        turnstileError.value = tr(`Cloudflare no pudo completar la verificación (código ${String(errorCode).slice(0, 12)}). Puedes reintentar.`, `Cloudflare could not complete the security check (code ${String(errorCode).slice(0, 12)}). You can retry.`)
        return true
      },
    })
  } catch {
    turnstileEnabled.value = true
    turnstileError.value = tr('No se pudo cargar la verificación de seguridad. Recarga la página e inténtalo de nuevo.', 'The security check could not be loaded. Refresh the page and try again.')
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
    error.value = tr('Puedes adjuntar máximo 5 imágenes.', 'You can attach up to 5 images.')
    attachments.value = []
    return
  }
  if (selected.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
    error.value = tr('Cada adjunto debe ser PNG, JPG o WEBP y pesar máximo 10 MB.', 'Each attachment must be PNG, JPG, or WEBP and no larger than 10 MB.')
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
    if (turnstileEnabled.value && !turnstileToken.value) throw new Error(turnstileError.value || tr('Completa la verificación de seguridad.', 'Complete the security check.'))
    const payload = new FormData()
    Object.entries(form.value).forEach(([key, value]) => payload.append(key, value))
    if (agentToken.value) payload.append('attributionToken', agentToken.value)
    if (turnstileToken.value) payload.append('turnstileToken', turnstileToken.value)
    payload.append('locale', locale.value)
    attachments.value.forEach((file) => payload.append('attachments', file))
    const payloadSignature = JSON.stringify({ ...form.value, locale: locale.value, agentToken: agentToken.value, attachments: attachments.value.map((file) => [file.name, file.size, file.type, file.lastModified]) })
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
      throw new Error(localizedError(data.error || tr('No fue posible registrar la solicitud.', 'We could not submit your request.')))
    }
    reference.value = data.reference
    paymentRequired.value = Boolean(data.paymentRequired)
    if (paymentRequired.value) await requestPaymentPreference()
    else submitted.value = true
  } catch (submitError) {
    error.value = localizedError(submitError.message)
  } finally {
    loading.value = false
  }
}

async function requestPaymentPreference() {
  if (!paymentAttemptKey.value) paymentAttemptKey.value = crypto.randomUUID()
  loading.value = true
  error.value = ''
  try {
    if (checkoutMode.value === 'bricks') {
      const response = await fetch('/api/public/payments/bricks/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reference: reference.value,
          idempotencyKey: paymentAttemptKey.value,
          submissionToken: requestIdempotencyKey.value,
          locale: locale.value === 'en' ? 'en-US' : 'es-CO',
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(localizedError(data.error || tr('No fue posible iniciar el pago integrado.', 'Could not start the integrated payment.')))
      if (
        typeof data.attemptId !== 'string' || !data.attemptId ||
        typeof data.publicKey !== 'string' || !data.publicKey ||
        !Number.isSafeInteger(data.amountCents) || data.amountCents <= 0 ||
        !Number.isSafeInteger(data.usdAmountCents) || data.usdAmountCents <= 0 ||
        !Number.isFinite(data.trm) || data.trm <= 0 ||
        typeof data.trmDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.trmDate) ||
        data.currency !== 'COP' || !['es-CO', 'en-US'].includes(data.locale)
      ) throw new Error(tr('La configuración del pago integrado no es válida. Contacta a soporte.', 'The integrated payment configuration is invalid. Contact support.'))
      pendingBrickIntent.value = { ...data, processIdempotencyKey: crypto.randomUUID() }
      pendingPayment.value = null
      return
    }

    // Keep the current Checkout Pro request and response contract unchanged.
    const response = await fetch('/api/public/payments/preference', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: reference.value, idempotencyKey: paymentAttemptKey.value, submissionToken: requestIdempotencyKey.value }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.initPoint) throw new Error(localizedError(data.error || tr('La solicitud quedó registrada, pero no fue posible cotizar el pago.', 'Your request was registered, but we could not prepare the payment quote.')))
    pendingPayment.value = data
  } catch (paymentError) {
    error.value = localizedError(paymentError.message)
  } finally {
    loading.value = false
  }
}

function handleBrickProcessed(result) {
  const status = String(result?.status || '').toLowerCase()
  if (status === 'approved') {
    paymentNotice.value = tr('Pago aprobado para la solicitud', 'Payment approved for request') + ` ${reference.value}.`
  } else if (status === 'pending' || status === 'in_process' || status === 'in_mediation') {
    paymentNotice.value = tr('Pago recibido y pendiente de confirmación. Actualizaremos el estado cuando Mercado Pago lo confirme.', 'Payment received and awaiting confirmation. We will update the status when Mercado Pago confirms it.')
  }
}

async function processBrickPayment(submission) {
  try {
    const response = await fetch('/api/public/payments/bricks/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: submission.attemptId,
        submissionToken: requestIdempotencyKey.value,
        idempotencyKey: submission.idempotencyKey,
        ...submission.payload,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || typeof data.status !== 'string') {
      throw new Error(localizedError(data.error || tr('No fue posible procesar el pago. Puedes volver a intentarlo.', 'Could not process the payment. You can try again.')))
    }
    submission.complete(data)
    handleBrickProcessed(data)
  } catch (paymentError) {
    submission.fail(localizedError(paymentError.message || tr('No fue posible procesar el pago. Puedes volver a intentarlo.', 'Could not process the payment. You can try again.')))
  }
}

async function retryBrickPayment() {
  pendingBrickIntent.value = null
  paymentAttemptKey.value = crypto.randomUUID()
  await requestPaymentPreference()
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
    error.value = localizedError(navigationError.message || tr('No fue posible abrir el pago.', 'We could not open the payment page.'))
  }
}

function goToLanding() {
  window.location.href = '/'
}
</script>

<template>
  <main class="request-page">
    <header class="request-header"><button class="request-brand" type="button" :aria-label="tr('Volver al inicio de Cortés Rodríguez Asesores', 'Back to the Cortés Rodríguez Asesores home page')" @click="goToLanding"><img :src="logoUrl" :alt="tr('Logo Cortés Rodríguez Asesores', 'Cortés Rodríguez Asesores logo')" /><strong>Cortés Rodríguez<br /><small>Asesores</small></strong></button><div class="header-tools"><div class="header-note"><span class="header-dot"></span> {{ tr('Solicitud de asesoría', 'Advisory request') }}</div><LanguageToggle v-model="locale" @update:model-value="setLocale" /></div></header>
    <section class="request-layout">
      <aside class="request-intro"><p class="request-kicker">{{ tr('Comercio exterior', 'International trade') }}</p><h1>{{ tr('Cuéntanos sobre tu operación.', 'Tell us about your operation.') }}</h1><p>{{ tr('Completa el formulario y nuestro equipo analizará tu requerimiento para acompañarte en el proceso.', 'Fill out the form and our team will review your needs and guide you through the process.') }}</p><div class="intro-points"><div><span>01</span><p><strong>{{ tr('Déjanos tus datos', 'Share your details') }}</strong><br />{{ tr('Solo te pedimos la información necesaria.', 'We only ask for the information we need.') }}</p></div><div><span>02</span><p><strong>{{ tr('Revisamos tu caso', 'We review your case') }}</strong><br />{{ tr('Un asesor estudiará los detalles de tu operación.', 'An advisor will review the details of your operation.') }}</p></div><div><span>03</span><p><strong>{{ tr('Te contactamos', 'We will contact you') }}</strong><br />{{ tr('Pronto recibirás noticias de nuestro equipo.', 'You will hear from our team soon.') }}</p></div></div><div class="intro-footer">{{ tr('¿Ya tienes una solicitud?', 'Already have a request?') }} <a href="/portal-cliente">{{ tr('Consultar mis solicitudes →', 'View my requests →') }}</a><a href="/app/login">{{ tr('Ingresar al panel operativo →', 'Sign in to the operations portal →') }}</a></div></aside>
      <section class="request-card"><div class="form-heading"><div><p class="form-step">{{ tr('Solicitud nueva', 'New request') }} <span>•</span> {{ tr('Paso 1 de 1', 'Step 1 of 1') }}</p><h2>{{ tr('Información de tu operación', 'Your operation details') }}</h2><p>{{ tr('Los campos marcados con', 'Fields marked with') }} <b>*</b> {{ tr('son obligatorios.', 'are required.') }}</p><p v-if="agentContext" class="agent-context">{{ agentContext.displayLabel }}</p></div><span class="form-badge">⟡</span></div>
        <p v-if="paymentNotice" class="payment-notice" role="status">{{ paymentNotice }}</p>
        <section v-if="reference && paymentRequired" class="payment-review" aria-live="polite">
          <p class="form-step">{{ tr('Solicitud registrada', 'Request submitted') }}</p><h2>{{ tr('Revisa el valor antes de pagar', 'Review the amount before paying') }}</h2>
          <dl v-if="pendingPayment" class="payment-summary"><div><dt>{{ tr('Solicitud', 'Request') }}</dt><dd>{{ reference }}</dd></div><div><dt>{{ tr('Valor del servicio', 'Service amount') }}</dt><dd>{{ (pendingPayment.usdAmountCents / 100).toFixed(2) }} USD</dd></div><div><dt>{{ tr('Tasa de conversión (TRM)', 'Exchange rate') }}</dt><dd>{{ Number(pendingPayment.trm).toLocaleString(localeTag(locale), { maximumFractionDigits: 4 }) }} COP/USD · {{ pendingPayment.trmDate }}</dd></div><div class="payment-total"><dt>{{ tr('Total en Mercado Pago', 'Total in Mercado Pago') }}</dt><dd>{{ (pendingPayment.copAmountCents / 100).toLocaleString(localeTag(locale)) }} COP</dd></div></dl>
          <dl v-else-if="pendingBrickIntent" class="payment-summary"><div><dt>{{ tr('Solicitud', 'Request') }}</dt><dd>{{ reference }}</dd></div><div><dt>{{ tr('Precio del servicio', 'Service price') }}</dt><dd>{{ (pendingBrickIntent.usdAmountCents / 100).toLocaleString(localeTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }} USD</dd></div><div><dt>{{ tr('Tasa de conversión (TRM)', 'Exchange rate') }}</dt><dd>{{ Number(pendingBrickIntent.trm).toLocaleString(localeTag(locale), { maximumFractionDigits: 4 }) }} COP/USD · {{ pendingBrickIntent.trmDate }}</dd></div><div class="payment-total"><dt>{{ tr('Total a pagar en Mercado Pago', 'Total due in Mercado Pago') }}</dt><dd>{{ (pendingBrickIntent.amountCents / 100).toLocaleString(localeTag(locale)) }} COP</dd></div></dl>
          <p v-if="pendingBrickIntent" class="payment-currency-note">{{ tr('El precio del servicio está en dólares (USD). Mercado Pago y tu entidad financiera procesarán el cobro en pesos colombianos (COP), con la conversión indicada arriba.', 'The service price is in US dollars (USD). Mercado Pago and your financial institution will process the charge in Colombian pesos (COP), using the conversion shown above.') }}</p>
          <p v-else-if="loading" class="field-help">{{ tr('Calculando el valor en pesos colombianos…', 'Calculating the amount in Colombian pesos…') }}</p>
          <p v-else class="field-help">{{ tr('La solicitud ya está registrada. Puedes volver a intentar calcular el pago.', 'Your request is registered. You can try calculating the payment again.') }}</p>
          <p v-if="error" class="request-error" role="alert">{{ error }}</p>
          <div v-if="checkoutMode === 'pro'" class="form-actions"><button v-if="!pendingPayment" type="button" class="back-button" :disabled="loading" @click="requestPaymentPreference">{{ loading ? tr('Consultando…', 'Loading…') : tr('Reintentar cálculo', 'Retry quote') }}</button><button v-else type="button" class="submit-request" :disabled="loading || paymentRedirecting" @click="continueToPayment">{{ paymentRedirecting ? tr('Abriendo pago…', 'Opening payment…') : tr('Pagar', 'Pay') }} <span>→</span></button></div>
          <MercadoPagoPaymentBrick v-if="checkoutMode === 'bricks' && pendingBrickIntent" :intent="pendingBrickIntent" :locale="locale === 'en' ? 'en-US' : 'es-CO'" :payer-email="form.email" @submit="processBrickPayment" @retry="retryBrickPayment" />
          <button v-else-if="checkoutMode === 'bricks' && !loading && !pendingBrickIntent" type="button" class="submit-request" :disabled="loading" @click="requestPaymentPreference">{{ tr('Reintentar iniciar el pago', 'Retry payment setup') }} <span>→</span></button>
          <a class="portal-link" href="/portal-cliente">{{ tr('¿Quieres continuar después? Consulta aquí tus solicitudes.', 'Would you like to continue later? View your requests here.') }}</a>
        </section>
        <div v-else-if="originLoading" class="request-origin-error" role="status"><p>{{ tr('Preparando el formulario…', 'Preparing your form…') }}</p></div>
        <div v-else-if="!originValid && !submitted" class="request-origin-error" role="alert"><p>{{ error || tr('Abre el formulario desde el botón de solicitudes de la página principal.', 'Open this form using the request button on the home page.') }}</p><a href="/">{{ tr('Volver a la página principal', 'Back to home page') }}</a></div>
        <form v-else-if="!submitted" @submit.prevent="submitRequest">
          <fieldset><legend>{{ tr('Datos del cliente', 'Customer details') }}</legend><div class="field full-field"><label for="fullName">{{ tr('Nombre completo', 'Full name') }} <b>*</b></label><input id="fullName" v-model="form.fullName" type="text" minlength="2" maxlength="120" autocomplete="name" :placeholder="tr('Ej. Juan Pablo Gómez', 'e.g. Juan Pablo Gomez')" required /></div><div class="field"><label for="legalEntityType">{{ tr('Constitución legal', 'Legal entity type') }} <b>*</b></label><select id="legalEntityType" v-model="form.legalEntityType" required><option value="" disabled>{{ tr('Selecciona una opción', 'Select an option') }}</option><option value="natural">{{ tr('Persona natural', 'Individual') }}</option><option value="juridica">{{ tr('Persona jurídica', 'Legal entity') }}</option></select></div></fieldset>
          <fieldset><legend>{{ tr('Medios de contacto', 'Contact details') }} <span>{{ tr('Correo obligatorio; teléfono y WhatsApp opcionales', 'Email required; phone and WhatsApp optional') }}</span></legend><div class="field"><label for="email">{{ tr('Correo electrónico', 'Email address') }} <b>*</b></label><input id="email" v-model="form.email" type="email" maxlength="254" autocomplete="email" placeholder="name@company.com" required /></div><div class="field"><label for="phone">{{ tr('Teléfono', 'Phone') }}</label><input id="phone" v-model="form.phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" pattern="[+0-9 ()-]{7,20}" placeholder="+57 300 000 0000" /></div><div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" v-model="form.whatsapp" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" pattern="[+0-9 ()-]{7,20}" placeholder="+57 300 000 0000" /></div></fieldset>
          <fieldset><legend>{{ tr('Detalles de la operación', 'Operation details') }}</legend><div class="field"><label for="serviceType">{{ tr('Servicio general', 'General service') }} <b>*</b></label><select id="serviceType" v-model="form.serviceType" required @change="changeService"><option value="" disabled>{{ tr('Selecciona un servicio', 'Select a service') }}</option><option v-for="item in serviceOptions" :key="item.serviceCode" :value="item.serviceCode">{{ serviceName(item) }}</option></select></div><div class="field"><label for="consultationType">{{ tr('Tipo de consulta', 'Consultation type') }} <b>*</b></label><select id="consultationType" v-model="form.consultationType" required :disabled="!form.serviceType"><option value="" disabled>{{ tr('Selecciona una consulta', 'Select a consultation') }}</option><option v-for="item in consultationOptions" :key="item.consultationCode" :value="item.consultationCode">{{ consultationName(item) }} · {{ formatPrice(item) }}</option></select><small v-if="selectedConsultation" class="field-help">{{ consultationDescription(selectedConsultation) }}</small></div><div class="field full-field"><label>{{ tr('Valor de la asesoría', 'Consultation fee') }}</label><div class="static-field"><span>{{ selectedConsultation ? consultationName(selectedConsultation) : tr('Selecciona un tipo de consulta', 'Select a consultation type') }}</span><strong>{{ servicePrice }}</strong></div></div><div class="field"><label for="productType">{{ tr('Tipo de producto', 'Product type') }} <b>*</b></label><select id="productType" v-model="form.productType" required><option value="" disabled>{{ tr('Selecciona una opción', 'Select an option') }}</option><option value="vehiculos">{{ tr('Vehículos', 'Vehicles') }}</option><option value="mercancias">{{ tr('Mercancías', 'Goods') }}</option></select></div><div class="field full-field"><label for="question">{{ tr('¿Qué necesitas consultar?', 'What would you like to ask?') }} <b>*</b></label><textarea id="question" v-model="form.question" rows="5" minlength="20" maxlength="3000" :placeholder="tr('Describe tu operación o la pregunta que deseas resolver.', 'Describe your operation or the question you need answered.')" required></textarea><small class="field-help">{{ tr('Mínimo 20 caracteres.', 'At least 20 characters.') }}</small></div><div class="field full-field"><label for="attachments">{{ tr('Imágenes de apoyo', 'Supporting images') }}</label><input id="attachments" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="selectAttachments" /><small class="field-help">{{ tr('Puedes adjuntar hasta 5 imágenes, máximo 10 MB cada una.', 'Attach up to 5 images, maximum 10 MB each.') }}</small><small v-if="attachments.length" class="field-help">{{ tr(`${attachments.length} imagen(es) seleccionada(s).`, `${attachments.length} image(s) selected.`) }}</small></div><div v-if="turnstileEnabled" class="field full-field"><label>{{ tr('Verificación de seguridad', 'Security check') }} <b>*</b></label><div ref="turnstileContainer" class="turnstile-container"></div><small v-if="turnstileError" class="field-help request-error" role="alert">{{ turnstileError }}</small></div></fieldset>
          <button v-if="turnstileEnabled && turnstileError" type="button" class="retry-turnstile" :disabled="turnstileConfigLoading" @click="retryTurnstile">{{ turnstileConfigLoading ? tr('Reintentando…', 'Retrying…') : tr('Reintentar verificación', 'Retry security check') }}</button><p v-if="error" class="request-error" role="alert">{{ error }}</p><div class="form-actions"><button type="button" class="back-button" @click="goToLanding">{{ tr('Volver a la página principal', 'Back to home page') }}</button><button type="submit" class="submit-request" :disabled="loading || turnstileConfigLoading || (turnstileEnabled && !turnstileToken)">{{ loading ? tr('Registrando solicitud…', 'Submitting request…') : tr('Enviar solicitud', 'Submit request') }} <span>→</span></button></div>
        </form>
      </section>
    </section>
    <footer class="request-footer">© 2026 Cortés Rodríguez Asesores S.A.S. <span>·</span> {{ tr('Tu información será tratada de forma confidencial.', 'Your information will be handled confidentially.') }}</footer>
    <div v-if="submitted" class="success-backdrop"><section class="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><div class="success-icon">✓</div><p class="request-kicker">{{ tr('Solicitud recibida', 'Request received') }}</p><h2 id="success-title">{{ tr('Gracias por seleccionarnos', 'Thank you for choosing us') }}</h2><p>{{ tr(`Recibimos la información de tu ${serviceLabel.toLowerCase()}. Pronto se contactará contigo un miembro de nuestro equipo.`, `We received your ${serviceLabel.toLowerCase()} details. A member of our team will contact you soon.`) }}</p><div class="success-reference">{{ tr('Referencia', 'Reference') }} <strong>{{ reference }}</strong></div><a class="portal-link" href="/portal-cliente">{{ tr('Consultar mis solicitudes →', 'View my requests →') }}</a><button type="button" class="submit-request" @click="goToLanding">{{ tr('Volver a la página principal', 'Back to home page') }} <span>→</span></button></section></div>
  </main>
</template>

<style scoped>
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#071c3f;background:#f5f8fc}:global(button),:global(input),:global(select){font:inherit}.request-page{min-height:100vh;background:linear-gradient(135deg,#f5f8fc,#fff 55%,#fdf5f5)}.request-header{height:82px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(22px,6vw,92px);border-bottom:1px solid #dfe6ef;background:rgba(255,255,255,.92)}.request-brand{display:flex;align-items:center;gap:11px;padding:0;border:0;color:#062653;background:transparent;text-align:left;cursor:pointer}.request-brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;color:#fff;background:#062653;font-size:11px;font-weight:900}.request-brand strong{font-size:13px;line-height:1.05}.request-brand small{color:#586780;font-size:9px;font-weight:500}.header-note{display:flex;align-items:center;gap:8px;color:#586780;font-size:11px;font-weight:700}.header-dot{width:7px;height:7px;border-radius:50%;background:#53ad88;box-shadow:0 0 0 4px #e1f4eb}.request-layout{display:grid;grid-template-columns:minmax(280px,.75fr) minmax(620px,1.25fr);gap:clamp(35px,6vw,105px);max-width:1280px;margin:0 auto;padding:65px clamp(22px,6vw,92px) 42px}.request-intro{display:flex;flex-direction:column;justify-content:center;padding-bottom:25px}.request-kicker,.form-step{margin:0 0 13px;color:#ed1c24;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.request-intro h1{max-width:420px;margin:0 0 20px;color:#062653;font-size:clamp(36px,4.5vw,61px);line-height:1.04;letter-spacing:-.06em}.request-intro>p:not(.request-kicker){max-width:390px;margin:0;color:#586780;font-size:15px;line-height:1.7}.intro-points{display:grid;gap:17px;margin-top:48px}.intro-points>div{display:flex;gap:13px;align-items:start}.intro-points span{display:grid;place-items:center;width:29px;height:29px;border:1px solid #dfe6ef;border-radius:9px;color:#0c3c78;font-size:9px;font-weight:900}.intro-points p{margin:0;color:#586780;font-size:11px;line-height:1.45}.intro-points strong{color:#062653;font-size:12px}.intro-footer{margin-top:60px;color:#586780;font-size:11px}.intro-footer a{display:block;margin-top:7px;color:#0c3c78;font-weight:800;text-decoration:none}.request-card{padding:35px 38px 29px;border:1px solid #dfe6ef;border-radius:15px;background:rgba(255,255,255,.97);box-shadow:0 18px 48px rgba(6,38,83,.12)}.form-heading{display:flex;justify-content:space-between;gap:20px;margin-bottom:29px}.form-step{margin-bottom:9px;color:#ed1c24;font-size:10px}.form-step span{margin:0 5px;color:#586780}.form-heading h2{margin:0 0 7px;color:#062653;font-size:24px;letter-spacing:-.04em}.form-heading>div>p:last-child{margin:0;color:#586780;font-size:11px}.form-heading b,label b{color:#ed1c24}.form-badge{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;color:#ed1c24;background:#fff0f1;font-size:20px}form{display:grid;gap:25px}fieldset{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 14px;margin:0;padding:0;border:0}legend{grid-column:1/-1;display:flex;align-items:center;gap:9px;width:100%;padding:0 0 12px;border-bottom:1px solid #dfe6ef;color:#062653;font-size:12px;font-weight:800}legend span{color:#586780;font-size:10px;font-weight:500}.field{display:grid;gap:7px;padding-top:8px}.full-field{grid-column:1/-1}.field label{color:#586780;font-size:10px;font-weight:800}.field input,.field select,.static-field{width:100%;min-height:43px;padding:0 12px;border:1px solid #dfe6ef;border-radius:7px;outline:0;color:#071c3f;background:#fff;font-size:12px;transition:border .2s,box-shadow .2s}.static-field{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#0c3c78;background:#f5f8fc;font-weight:700}.field input::placeholder{color:#98a2b3}.field input:focus,.field select:focus{border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.1)}.request-error{margin:0;padding:10px 12px;border-radius:7px;color:#7a1116;background:#fff0f1;font-size:11px}.form-actions{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-top:5px}.back-button{padding:0;border:0;color:#586780;background:transparent;font-size:11px;cursor:pointer}.submit-request{display:inline-flex;align-items:center;justify-content:center;gap:17px;min-height:44px;padding:0 17px;border:0;border-radius:7px;color:#fff;background:#ed1c24;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 7px 14px rgba(237,28,36,.16)}.submit-request:hover{background:#c9141b}.submit-request:disabled{opacity:.6;cursor:wait}.submit-request span{font-size:17px;font-weight:400}.request-footer{padding:0 20px 27px;text-align:center;color:#586780;font-size:10px}.request-footer span{margin:0 5px}.success-backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(3,25,56,.7);backdrop-filter:blur(5px)}.success-modal{width:min(445px,100%);padding:42px 38px 35px;border-radius:17px;background:#fff;text-align:center;box-shadow:0 25px 70px rgba(6,38,83,.25)}.success-icon{display:grid;place-items:center;width:57px;height:57px;margin:0 auto 22px;border-radius:50%;color:#fff;background:#ed1c24;font-size:28px;font-weight:500;box-shadow:0 0 0 8px #fff0f1}.success-modal h2{margin:0 0 12px;color:#062653;font-size:27px;letter-spacing:-.05em}.success-modal>p:not(.request-kicker){margin:0;color:#586780;font-size:13px;line-height:1.65}.success-reference{margin:22px 0 25px;padding:11px;border-radius:7px;color:#586780;background:#f5f8fc;font-size:10px}.success-reference strong{display:block;margin-top:4px;color:#0c3c78;font-size:12px;letter-spacing:.06em}@media(max-width:980px){.request-layout{grid-template-columns:1fr;max-width:740px}.request-intro{display:block}.request-intro h1{font-size:45px}.intro-points{grid-template-columns:repeat(3,1fr);margin-top:30px}.intro-footer{margin-top:25px}}@media(max-width:620px){.request-header{height:70px}.header-note{display:none}.request-layout{padding-top:36px}.request-intro h1{font-size:39px}.intro-points{grid-template-columns:1fr}.request-card{padding:25px 18px}.form-heading h2{font-size:21px}fieldset{grid-template-columns:1fr}.full-field{grid-column:auto}.form-actions{display:grid;justify-content:stretch}.submit-request,.back-button{width:100%}}
.field textarea{width:100%;padding:11px 12px;border:1px solid #dfe6ef;border-radius:7px;outline:0;resize:vertical;color:#071c3f;background:#fff;font-size:12px;line-height:1.5}.field textarea:focus{border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.1)}.field-help{color:#98a2b3;font-size:10px;line-height:1.4}.agent-context{margin:9px 0 0!important;color:#39836d!important;font-size:10px!important;font-weight:700}
.turnstile-container{min-height:65px}
.retry-turnstile{justify-self:start;padding:8px 12px;border:1px solid #dfe6ef;border-radius:7px;color:#0c3c78;background:#fff;font-size:11px;font-weight:700;cursor:pointer}.retry-turnstile:disabled{opacity:.6;cursor:wait}
.payment-notice{margin:0 0 18px;padding:11px 13px;border:1px solid #cfe6db;border-radius:7px;color:#28694f;background:#edf9f3;font-size:11px;font-weight:700}
.request-origin-error{display:grid;gap:12px;padding:18px;border:1px solid #f0c9cc;border-radius:8px;color:#8d2e36;background:#fff5f5;font-size:13px;line-height:1.5}.request-origin-error p{margin:0}.request-origin-error a{color:#164f70;font-weight:700;text-decoration:none}
.payment-review{display:grid;gap:12px;padding:20px;border:1px solid #dfe6ef;border-radius:10px;background:#fff}.payment-review h2{margin:0;color:#062653;font-size:20px}.payment-summary{display:grid;gap:0;margin:0;border:1px solid #dfe6ef;border-radius:8px;overflow:hidden}.payment-summary>div{display:flex;justify-content:space-between;gap:18px;padding:12px 14px;border-bottom:1px solid #e9eef4;font-size:12px}.payment-summary>div:last-child{border-bottom:0}.payment-summary dt{color:#586780}.payment-summary dd{margin:0;color:#173b58;font-weight:700;text-align:right}.payment-summary .payment-total{background:#f5f8fc;font-size:14px;font-weight:800}.payment-summary .payment-total dd{color:#0c6c4c}.payment-currency-note{margin:0;padding:11px 13px;border-radius:7px;background:#f3f8fc;color:#52677c;font-size:11px;line-height:1.55}.payment-review .form-actions{justify-content:flex-end}
.request-intro{justify-content:flex-start}
.header-tools{display:flex;align-items:center;gap:16px}
.request-brand>img{display:block;width:48px;height:48px;padding:2px;border:1px solid #dfe6ef;border-radius:9px;background:#fff;object-fit:contain}
 .portal-link{display:block;margin:0 0 16px;color:#0c3c78;font-size:12px;font-weight:800;text-decoration:none}.portal-link:hover{text-decoration:underline}
</style>
