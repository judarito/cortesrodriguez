<script setup>
import { computed, onMounted, ref } from 'vue'
import { getInitialLocale, persistLocale } from '../lib/locale.js'
import LanguageToggle from '../shared/components/LanguageToggle.vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const locale = ref('es')
function setLocale(value) {
  locale.value = persistLocale(value)
  document.documentElement.lang = localeTag(locale.value)
}
function tr(es, en) { return locale.value === 'en' ? en : es }
const state = ref('checking')
const reference = ref('')
const verificationMessage = ref('')
const pendingPaymentMessage = () => tr(
  'Mercado Pago todavía no confirma el resultado. Si ya ves el cobro, no vuelvas a pagar; guarda tu código de seguimiento y vuelve a consultar en unos minutos.',
  'Mercado Pago has not confirmed the result yet. If you can see the charge, do not pay again; keep your tracking code and check again in a few minutes.',
)

const content = computed(() => ({
  checking: {
    title: tr('Tu solicitud está registrada', 'Your request is recorded'),
    description: tr('Estamos confirmando el pago con Mercado Pago. Si ya ves el cobro, no vuelvas a pagar; conserva tu código de seguimiento mientras actualizamos el estado.', 'We are confirming your payment with Mercado Pago. If you can see the charge, do not pay again; keep your tracking code while we update the status.'),
  },
  approved: {
    title: tr('Pago recibido', 'Payment received'),
    description: tr('Tu solicitud quedó registrada. Nuestro equipo pronto te contactará con información sobre la respuesta.', 'Your request has been recorded. Our team will contact you soon with an update about the response.'),
  },
  pending: {
    title: tr('Tu solicitud sigue registrada', 'Your request is still recorded'),
    description: tr('Mercado Pago aún no termina de confirmar el pago. Si ya ves el cobro, no vuelvas a pagar ni envíes otra solicitud. Conserva este código; actualizaremos el estado cuando llegue la confirmación.', 'Mercado Pago has not finished confirming the payment. If you can see the charge, do not pay again or submit another request. Keep this code; we will update the status when confirmation arrives.'),
  },
  failed: {
    title: tr('No se confirmó el pago', 'Payment was not confirmed'),
    description: tr('No recibimos confirmación de un pago aprobado. Puedes volver a la página principal o iniciar una nueva solicitud.', 'We did not receive confirmation of an approved payment. You can return home or start a new request.'),
  },
})[state.value])

onMounted(async () => {
  setLocale(getInitialLocale())
  const query = new URLSearchParams(window.location.search)
  const paymentStatus = query.get('payment') || ''
  reference.value = query.get('external_reference') || query.get('reference') || ''

  if (paymentStatus === 'success') {
    const paymentId = query.get('payment_id') || query.get('collection_id')
    if (!paymentId || !reference.value) {
      state.value = 'pending'
      return
    }

    const controller = new AbortController()
    let timeoutId
    try {
      const verification = fetch('/api/public/payments/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId, reference: reference.value }),
        signal: controller.signal,
      }).then(async (response) => ({ response, result: await response.json().catch(() => ({})) }))
      const timedOut = new Promise((resolve) => {
        timeoutId = window.setTimeout(() => {
          controller.abort()
          resolve(null)
        }, 8000)
      })
      const verificationResult = await Promise.race([verification, timedOut])
      if (!verificationResult) {
        state.value = 'pending'
        verificationMessage.value = pendingPaymentMessage()
        return
      }
      const { response, result } = verificationResult
      if (response.ok && result.reference) reference.value = result.reference
      if (response.ok && result.status === 'approved') state.value = 'approved'
      else if (response.ok && ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(result.status)) state.value = 'failed'
      else {
        state.value = 'pending'
        verificationMessage.value = pendingPaymentMessage()
      }
    } catch {
      state.value = 'pending'
      verificationMessage.value = tr(
        'La verificación está tardando más de lo esperado. Si ya ves el cobro, no vuelvas a pagar; guarda tu código de seguimiento y vuelve a consultar en unos minutos.',
        'Verification is taking longer than expected. If you can see the charge, do not pay again; keep your tracking code and check again in a few minutes.',
      )
    } finally {
      window.clearTimeout(timeoutId)
    }
    return
  }

  state.value = paymentStatus === 'pending' ? 'pending' : 'failed'
})
</script>

<template>
  <main class="payment-return-page">
    <header class="payment-return-header">
      <a href="/" :aria-label="tr('Cortés Rodríguez Asesores, página principal', 'Cortés Rodríguez Asesores home page')">
        <img :src="logoUrl" alt="Cortés Rodríguez Asesores" />
      </a>
      <div class="payment-return-header-tools"><span>{{ tr('Estado de tu pago', 'Payment status') }}</span><LanguageToggle v-model="locale" @update:model-value="setLocale" /></div>
    </header>

    <section class="payment-return-card" aria-live="polite">
      <div :class="['payment-return-icon', `is-${state}`]" :aria-label="state === 'checking' ? tr('Confirmando pago', 'Confirming payment') : undefined">
        <span v-if="state === 'checking'" aria-hidden="true">…</span>
        <span v-else-if="state === 'approved'">✓</span>
        <span v-else>!</span>
      </div>
      <p class="payment-return-eyebrow">Cortés Rodríguez Asesores</p>
      <h1>{{ content.title }}</h1>
      <p class="payment-return-description">{{ content.description }}</p>
      <p v-if="verificationMessage" class="payment-return-help">{{ verificationMessage }}</p>

      <div v-if="reference" class="payment-tracking-code">
        <span>{{ tr('Código de seguimiento', 'Tracking code') }}</span>
        <strong>{{ reference }}</strong>
        <small>{{ tr('Guárdalo para consultar tu solicitud o comunicarte con nuestro equipo.', 'Keep it to check your request or contact our team.') }}</small>
      </div>

      <div class="payment-return-actions">
        <a class="payment-return-portal" href="/portal-cliente">{{ tr('Consultar mis solicitudes', 'View my requests') }}</a>
        <a class="payment-return-home" href="/">{{ tr('Ir a la página principal', 'Go to home page') }}</a>
        <a v-if="state === 'failed'" class="payment-return-new-request" href="/api/public/request-start">{{ tr('Iniciar una nueva solicitud', 'Start a new request') }}</a>
      </div>
    </section>
    <footer>© 2026 Cortés Rodríguez Asesores S.A.S.</footer>
  </main>
</template>

<style scoped>
.payment-return-page{min-height:100vh;padding:26px clamp(18px,5vw,72px) 20px;background:#f5f8fb;color:#17334b}.payment-return-header{display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto}.payment-return-header>a{display:inline-flex;align-items:center}.payment-return-header img{display:block;width:190px;height:auto;max-height:65px;object-fit:contain}.payment-return-header>span{color:#73839a;font-size:13px}.payment-return-card{display:grid;justify-items:center;max-width:620px;margin:clamp(55px,10vh,105px) auto 40px;padding:clamp(28px,6vw,54px);border:1px solid #e2e9f0;border-radius:16px;background:#fff;box-shadow:0 14px 45px rgba(28,55,79,.08);text-align:center}.payment-return-icon{display:grid;place-items:center;width:58px;height:58px;margin-bottom:20px;border-radius:50%;font-size:26px;font-weight:800}.is-checking,.is-pending{color:#94651d;background:#fff4df}.is-approved{color:#26805d;background:#e8f7ef}.is-failed{color:#b53d43;background:#fff0f1}.payment-return-spinner{width:25px;height:25px;border:3px solid #e6c881;border-top-color:#a67124;border-radius:50%;animation:payment-spin .8s linear infinite}.payment-return-eyebrow{margin:0 0 8px;color:#3383aa;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.payment-return-card h1{margin:0;color:#172d43;font-size:clamp(25px,5vw,34px);letter-spacing:-.04em}.payment-return-description{max-width:460px;margin:14px 0 0;color:#697a8f;font-size:15px;line-height:1.65}.payment-return-help{margin:12px 0 0;color:#a16d25;font-size:12px}.payment-tracking-code{display:grid;gap:7px;width:100%;margin-top:28px;padding:18px;border:1px solid #dbe7ef;border-radius:10px;background:#f7fafc}.payment-tracking-code>span{color:#78889c;font-size:11px}.payment-tracking-code strong{color:#145276;font-size:clamp(17px,4vw,21px);letter-spacing:.04em;overflow-wrap:anywhere}.payment-tracking-code small{color:#8795a6;font-size:11px;line-height:1.5}.payment-return-actions{display:grid;justify-items:center;gap:12px;margin-top:25px}.payment-return-home{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:7px;background:#104b6d;color:#fff;font-size:13px;font-weight:800;text-decoration:none}.payment-return-home:hover{background:#0b3b57}.payment-return-new-request{color:#286d91;font-size:12px;font-weight:700;text-decoration:none}.payment-return-new-request:hover{text-decoration:underline}.payment-return-page footer{max-width:1120px;margin:0 auto;color:#94a1af;font-size:11px;text-align:center}@keyframes payment-spin{to{transform:rotate(360deg)}}
.payment-return-portal{color:#286d91;font-size:12px;font-weight:800;text-decoration:none}.payment-return-portal:hover{text-decoration:underline}.payment-return-header-tools{display:flex;align-items:center;gap:14px}
</style>
