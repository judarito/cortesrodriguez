<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  intent: { type: Object, required: true },
  locale: { type: String, default: 'es' },
  payerEmail: { type: String, default: '' },
})

const emit = defineEmits(['submit', 'retry'])

const container = ref(null)
const hasPriceQuote = computed(() => Number.isSafeInteger(props.intent?.usdAmountCents)
  && props.intent.usdAmountCents > 0
  && Number.isFinite(props.intent?.trm)
  && props.intent.trm > 0
  && /^\d{4}-\d{2}-\d{2}$/.test(props.intent?.trmDate || ''))
const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const resultStatus = ref('')
const retryable = ref(false)
let brickController = null
let renderSequence = 0
let currentSubmission = null
let sdkLoadPromise
let brickContainerSequence = 0
const containerId = `mercadopago-payment-brick-${++brickContainerSequence}`

function tr(es, en) { return props.locale === 'en' || props.locale === 'en-US' ? en : es }
function formatNumber(value, options = {}) {
  const locale = props.locale === 'en' || props.locale === 'en-US' ? 'en-US' : 'es-CO'
  return new Intl.NumberFormat(locale, options).format(value)
}
function formatUsd(cents) { return `${formatNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` }
function formatCop(cents) { return `${formatNumber(cents / 100, { maximumFractionDigits: 0 })} COP` }
function formatTrm(rate) { return formatNumber(rate, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) }

function loadMercadoPagoSdk() {
  if (typeof window.MercadoPago === 'function') return Promise.resolve()
  if (sdkLoadPromise) return sdkLoadPromise

  sdkLoadPromise = new Promise((resolve, reject) => {
    const scriptUrl = 'https://sdk.mercadopago.com/js/v2'
    let script = document.querySelector(`script[src="${scriptUrl}"]`)
    const appendScript = !script
    const onLoad = () => {
      cleanup()
      if (typeof window.MercadoPago === 'function') resolve()
      else reject(new Error('sdk_unavailable'))
    }
    const onError = () => { cleanup(); reject(new Error('sdk_load_failed')) }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('sdk_timeout')) }, 20000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }

    if (!script) {
      script = document.createElement('script')
      script.src = scriptUrl
      script.async = true
      script.defer = true
    }
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (appendScript) document.head.appendChild(script)
  }).catch((loadError) => {
    sdkLoadPromise = undefined
    throw loadError
  })

  return sdkLoadPromise
}

function statusMessage(status) {
  if (status === 'approved') return tr('Pago aprobado. Tu solicitud ya quedó registrada como pagada.', 'Payment approved. Your request is recorded as paid.')
  if (status === 'rejected' || status === 'cancelled') return tr('El pago no fue aprobado. Puedes iniciar otro intento.', 'The payment was not approved. You can start another attempt.')
  return tr('Pago recibido y pendiente de confirmación. Actualizaremos el estado cuando Mercado Pago lo confirme.', 'Payment received and awaiting confirmation. We will update the status when Mercado Pago confirms it.')
}

function makePayload(submission) {
  const data = submission?.formData && typeof submission.formData === 'object'
    ? submission.formData
    : submission || {}
  const paymentMethodId = data.payment_method_id || data.paymentMethodId
  const token = data.token
  const email = data.payer?.email || props.payerEmail
  const installments = Number(data.installments)
  return {
    ...(typeof token === 'string' && token ? { token } : {}),
    ...(typeof paymentMethodId === 'string' && paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
    ...(Number.isInteger(installments) && installments > 0 ? { installments } : {}),
    ...(typeof email === 'string' && email ? { payer: { email } } : {}),
  }
}

function onBrickSubmit(brickSubmission) {
  if (submitting.value || resultStatus.value === 'approved' || resultStatus.value === 'pending') {
    return Promise.reject(new Error('payment_in_progress'))
  }

  const payload = makePayload(brickSubmission)
  if (!payload.token || !payload.payment_method_id || !payload.installments || !payload.payer?.email) {
    error.value = tr('No se recibieron todos los datos requeridos para el pago con tarjeta. Revisa el formulario e inténtalo de nuevo.', 'Required card payment details were not received. Review the form and try again.')
    return Promise.reject(new Error('payment_data_missing'))
  }

  submitting.value = true
  retryable.value = false
  resultStatus.value = ''
  error.value = ''

  return new Promise((resolve, reject) => {
    currentSubmission = { resolve, reject }
    emit('submit', {
      attemptId: props.intent.attemptId,
      idempotencyKey: props.intent.processIdempotencyKey,
      payload,
      complete(result) {
        if (!currentSubmission) return
        const status = String(result?.status || '').toLowerCase()
        if (status === 'rejected' || status === 'cancelled') {
          resultStatus.value = 'rejected'
          retryable.value = true
          submitting.value = false
          currentSubmission.reject(new Error('payment_rejected'))
        } else {
          resultStatus.value = status === 'approved' ? 'approved' : 'pending'
          submitting.value = false
          currentSubmission.resolve()
        }
        currentSubmission = null
      },
      fail(message) {
        if (!currentSubmission) return
        error.value = message || tr('No fue posible procesar el pago. Puedes volver a intentarlo.', 'Could not process the payment. You can try again.')
        submitting.value = false
        currentSubmission.reject(new Error('payment_processing_failed'))
        currentSubmission = null
      },
    })
  })
}

async function renderBrick() {
  const sequence = ++renderSequence
  loading.value = true
  error.value = ''
  resultStatus.value = ''
  retryable.value = false
  brickController?.unmount?.()
  brickController = null

  const { attemptId, publicKey, amountCents, currency } = props.intent || {}
  if (!attemptId || !publicKey || !Number.isSafeInteger(amountCents) || amountCents <= 0 || currency !== 'COP') {
    loading.value = false
    error.value = tr('La configuración del pago no es válida. Contacta a soporte.', 'The payment configuration is invalid. Contact support.')
    return
  }

  try {
    await loadMercadoPagoSdk()
    if (sequence !== renderSequence || !container.value) return
    const sdkLocale = ['es-CO', 'en-US'].includes(props.locale)
      ? props.locale
      : (['es-CO', 'en-US'].includes(props.intent.locale) ? props.intent.locale : 'es-CO')
    const mercadoPago = new window.MercadoPago(publicKey, { locale: sdkLocale })
    const bricksBuilder = mercadoPago.bricks()
    brickController = await bricksBuilder.create('payment', containerId, {
      initialization: {
        amount: amountCents / 100,
        payer: props.payerEmail ? { email: props.payerEmail } : undefined,
      },
      customization: {
        paymentMethods: {
          creditCard: 'all',
          debitCard: 'all',
          prepaidCard: 'all',
        },
      },
      locale: sdkLocale,
      callbacks: {
        onReady: () => { if (sequence === renderSequence) loading.value = false },
        onSubmit: onBrickSubmit,
        onError: () => {
          if (!submitting.value && sequence === renderSequence) {
            error.value = tr('Mercado Pago no pudo cargar o validar el formulario de pago. Inténtalo nuevamente.', 'Mercado Pago could not load or validate the payment form. Please try again.')
          }
        },
      },
    })
    if (sequence === renderSequence) loading.value = false
  } catch {
    if (sequence !== renderSequence) return
    loading.value = false
    error.value = tr('No se pudo cargar el formulario seguro de Mercado Pago. Recarga la página e inténtalo de nuevo.', 'The secure Mercado Pago form could not be loaded. Refresh the page and try again.')
  }
}

watch(() => [props.intent?.attemptId, props.intent?.publicKey, props.intent?.amountCents], renderBrick)
watch(() => [props.locale, props.payerEmail], () => {
  if (!submitting.value && !resultStatus.value) renderBrick()
})
onMounted(renderBrick)
onBeforeUnmount(() => {
  renderSequence += 1
  if (currentSubmission) {
    currentSubmission.reject(new Error('payment_component_unmounted'))
    currentSubmission = null
  }
  brickController?.unmount?.()
  brickController = null
})
</script>

<template>
  <section class="brick-checkout" :aria-busy="loading || submitting">
    <aside v-if="hasPriceQuote" class="brick-price-quote" :aria-label="tr('Valor y conversión del pago', 'Payment amount and currency conversion')">
      <p class="brick-price-title">{{ tr('Precio y conversión', 'Price and conversion') }}</p>
      <dl>
        <div><dt>{{ tr('Precio del servicio', 'Service price') }}</dt><dd>{{ formatUsd(intent.usdAmountCents) }}</dd></div>
        <div><dt>{{ tr('Tasa TRM', 'TRM exchange rate') }} · {{ intent.trmDate }}</dt><dd>1 USD = {{ formatTrm(intent.trm) }} COP</dd></div>
        <div class="brick-price-total"><dt>{{ tr('Total que pagarás', 'Total you will pay') }}</dt><dd>{{ formatCop(intent.amountCents) }}</dd></div>
      </dl>
      <p class="brick-price-explanation">{{ tr('El servicio tiene precio en dólares (USD), pero Mercado Pago y tu entidad financiera procesarán el cobro en pesos colombianos (COP).', 'The service is priced in US dollars (USD), but Mercado Pago and your financial institution will process the charge in Colombian pesos (COP).') }}</p>
    </aside>
    <p v-if="loading" class="brick-state" role="status">{{ tr('Cargando el formulario seguro de pago…', 'Loading the secure payment form…') }}</p>
    <p v-if="submitting" class="brick-state" role="status">{{ tr('Procesando el pago de forma segura…', 'Securely processing your payment…') }}</p>
    <p v-if="error" class="brick-error" role="alert">{{ error }}</p>
    <p v-if="resultStatus" class="brick-result" :class="`brick-result-${resultStatus}`" role="status">{{ statusMessage(resultStatus) }}</p>
    <div v-show="!resultStatus" :id="containerId" ref="container" class="brick-container"></div>
    <button v-if="retryable" type="button" class="submit-request brick-retry" @click="emit('retry')">
      {{ tr('Intentar otro pago', 'Try another payment') }} <span>→</span>
    </button>
  </section>
</template>

<style scoped>
.brick-checkout{display:grid;gap:12px;width:100%;min-width:0}.brick-container{width:100%;min-width:0;min-height:100px}.brick-price-quote{padding:13px 14px;border:1px solid #dbe7ef;border-radius:8px;background:#f7fafc}.brick-price-title{margin:0 0 8px;color:#173b58;font-size:12px;font-weight:800}.brick-price-quote dl{display:grid;gap:0;margin:0}.brick-price-quote dl>div{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid #e5edf3;font-size:11px}.brick-price-quote dt{color:#586780}.brick-price-quote dd{margin:0;color:#173b58;font-weight:700;text-align:right}.brick-price-quote .brick-price-total{border-bottom:0;font-size:13px;font-weight:800}.brick-price-total dd{color:#08754e}.brick-price-explanation{margin:8px 0 0;color:#52677c;font-size:10px;line-height:1.5}.brick-state,.brick-error,.brick-result{margin:0;padding:11px 13px;border-radius:7px;font-size:11px;line-height:1.5}.brick-state{color:#586780;background:#f5f8fc}.brick-error,.brick-result-rejected{color:#7a1116;background:#fff0f1}.brick-result-approved{color:#28694f;background:#edf9f3}.brick-result-pending{color:#805514;background:#fff7e8}.brick-retry{justify-self:end}
@media(max-width:620px){.brick-retry{width:100%}}
</style>
