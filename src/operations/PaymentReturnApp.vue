<script setup>
import { computed, onMounted, ref } from 'vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const state = ref('checking')
const reference = ref('')
const verificationMessage = ref('')

const content = computed(() => ({
  checking: {
    title: 'Estamos verificando tu pago',
    description: 'Espera un momento mientras confirmamos el resultado con Mercado Pago.',
  },
  approved: {
    title: 'Pago recibido',
    description: 'Tu solicitud quedó registrada. Nuestro equipo pronto te contactará con información sobre la respuesta.',
  },
  pending: {
    title: 'Pago pendiente de confirmación',
    description: 'Mercado Pago aún no confirma el pago. Si ya pagaste, no necesitas enviar otra solicitud; actualizaremos el estado al recibir la confirmación.',
  },
  failed: {
    title: 'No se confirmó el pago',
    description: 'No recibimos confirmación de un pago aprobado. Puedes volver a la página principal o iniciar una nueva solicitud.',
  },
})[state.value])

onMounted(async () => {
  const query = new URLSearchParams(window.location.search)
  const paymentStatus = query.get('payment') || ''
  reference.value = query.get('external_reference') || query.get('reference') || ''

  if (paymentStatus === 'success') {
    const paymentId = query.get('payment_id') || query.get('collection_id')
    if (!paymentId || !reference.value) {
      state.value = 'pending'
      return
    }

    try {
      const response = await fetch('/api/public/payments/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId, reference: reference.value }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.reference) reference.value = result.reference
      if (response.ok && result.status === 'approved') state.value = 'approved'
      else if (response.ok && ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(result.status)) state.value = 'failed'
      else state.value = 'pending'
      if (!response.ok) verificationMessage.value = result.error || 'La confirmación puede tardar unos minutos.'
    } catch {
      state.value = 'pending'
      verificationMessage.value = 'La confirmación puede tardar unos minutos.'
    }
    return
  }

  state.value = paymentStatus === 'pending' ? 'pending' : 'failed'
})
</script>

<template>
  <main class="payment-return-page">
    <header class="payment-return-header">
      <a href="/" aria-label="Cortés Rodríguez Asesores, página principal">
        <img :src="logoUrl" alt="Cortés Rodríguez Asesores" />
      </a>
      <span>Estado de tu pago</span>
    </header>

    <section class="payment-return-card" aria-live="polite">
      <div :class="['payment-return-icon', `is-${state}`]">
        <span v-if="state === 'checking'" class="payment-return-spinner"></span>
        <span v-else-if="state === 'approved'">✓</span>
        <span v-else>!</span>
      </div>
      <p class="payment-return-eyebrow">Cortés Rodríguez Asesores</p>
      <h1>{{ content.title }}</h1>
      <p class="payment-return-description">{{ content.description }}</p>
      <p v-if="verificationMessage" class="payment-return-help">{{ verificationMessage }}</p>

      <div v-if="reference" class="payment-tracking-code">
        <span>Código de seguimiento</span>
        <strong>{{ reference }}</strong>
        <small>Guárdalo para consultar tu solicitud o comunicarte con nuestro equipo.</small>
      </div>

      <div class="payment-return-actions">
        <a class="payment-return-portal" href="/portal-cliente">Consultar mis solicitudes</a>
        <a class="payment-return-home" href="/">Ir a la página principal</a>
        <a v-if="state === 'failed'" class="payment-return-new-request" href="/solicitud">Iniciar una nueva solicitud</a>
      </div>
    </section>
    <footer>© 2026 Cortés Rodríguez Asesores S.A.S.</footer>
  </main>
</template>

<style scoped>
.payment-return-page{min-height:100vh;padding:26px clamp(18px,5vw,72px) 20px;background:#f5f8fb;color:#17334b}.payment-return-header{display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto}.payment-return-header>a{display:inline-flex;align-items:center}.payment-return-header img{display:block;width:190px;height:auto;max-height:65px;object-fit:contain}.payment-return-header>span{color:#73839a;font-size:13px}.payment-return-card{display:grid;justify-items:center;max-width:620px;margin:clamp(55px,10vh,105px) auto 40px;padding:clamp(28px,6vw,54px);border:1px solid #e2e9f0;border-radius:16px;background:#fff;box-shadow:0 14px 45px rgba(28,55,79,.08);text-align:center}.payment-return-icon{display:grid;place-items:center;width:58px;height:58px;margin-bottom:20px;border-radius:50%;font-size:26px;font-weight:800}.is-checking,.is-pending{color:#94651d;background:#fff4df}.is-approved{color:#26805d;background:#e8f7ef}.is-failed{color:#b53d43;background:#fff0f1}.payment-return-spinner{width:25px;height:25px;border:3px solid #e6c881;border-top-color:#a67124;border-radius:50%;animation:payment-spin .8s linear infinite}.payment-return-eyebrow{margin:0 0 8px;color:#3383aa;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.payment-return-card h1{margin:0;color:#172d43;font-size:clamp(25px,5vw,34px);letter-spacing:-.04em}.payment-return-description{max-width:460px;margin:14px 0 0;color:#697a8f;font-size:15px;line-height:1.65}.payment-return-help{margin:12px 0 0;color:#a16d25;font-size:12px}.payment-tracking-code{display:grid;gap:7px;width:100%;margin-top:28px;padding:18px;border:1px solid #dbe7ef;border-radius:10px;background:#f7fafc}.payment-tracking-code>span{color:#78889c;font-size:11px}.payment-tracking-code strong{color:#145276;font-size:clamp(17px,4vw,21px);letter-spacing:.04em;overflow-wrap:anywhere}.payment-tracking-code small{color:#8795a6;font-size:11px;line-height:1.5}.payment-return-actions{display:grid;justify-items:center;gap:12px;margin-top:25px}.payment-return-home{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:7px;background:#104b6d;color:#fff;font-size:13px;font-weight:800;text-decoration:none}.payment-return-home:hover{background:#0b3b57}.payment-return-new-request{color:#286d91;font-size:12px;font-weight:700;text-decoration:none}.payment-return-new-request:hover{text-decoration:underline}.payment-return-page footer{max-width:1120px;margin:0 auto;color:#94a1af;font-size:11px;text-align:center}@keyframes payment-spin{to{transform:rotate(360deg)}}
.payment-return-portal{color:#286d91;font-size:12px;font-weight:800;text-decoration:none}.payment-return-portal:hover{text-decoration:underline}
</style>
