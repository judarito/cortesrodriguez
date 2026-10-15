<script setup>
import { computed, ref } from 'vue'

const form = ref({
  fullName: '',
  legalEntityType: '',
  email: '',
  phone: '',
  whatsapp: '',
  serviceType: '',
  freightAgent: '',
  productType: '',
})
const loading = ref(false)
const error = ref('')
const submitted = ref(false)
const reference = ref('')
const serviceLabel = computed(() => form.value.serviceType === 'exportacion' ? 'Exportación' : 'Importación')

async function submitRequest() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/public/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No fue posible registrar la solicitud.')
    reference.value = data.reference
    submitted.value = true
  } catch (submitError) {
    error.value = submitError.message
  } finally {
    loading.value = false
  }
}

function goToLanding() {
  window.location.href = '/'
}
</script>

<template>
  <main class="request-page">
    <header class="request-header"><button class="request-brand" type="button" @click="goToLanding"><span>CRA</span><strong>Cortés Rodríguez<br /><small>Asesores</small></strong></button><div class="header-note"><span class="header-dot"></span> Solicitud de asesoría</div></header>
    <section class="request-layout">
      <aside class="request-intro"><p class="request-kicker">Comercio exterior</p><h1>Cuéntanos sobre tu operación.</h1><p>Completa el formulario y nuestro equipo analizará tu requerimiento para acompañarte en el proceso.</p><div class="intro-points"><div><span>01</span><p><strong>Déjanos tus datos</strong><br />Solo te pedimos la información necesaria.</p></div><div><span>02</span><p><strong>Revisamos tu caso</strong><br />Un asesor estudiará los detalles de tu operación.</p></div><div><span>03</span><p><strong>Te contactamos</strong><br />Pronto recibirás noticias de nuestro equipo.</p></div></div><div class="intro-footer">¿Ya tienes una solicitud? <a href="/app/login">Ingresa al panel operativo →</a></div></aside>
      <section class="request-card"><div class="form-heading"><div><p class="form-step">Solicitud nueva <span>•</span> Paso 1 de 1</p><h2>Información de tu operación</h2><p>Los campos marcados con <b>*</b> son obligatorios.</p></div><span class="form-badge">⟡</span></div>
        <form @submit.prevent="submitRequest">
          <fieldset><legend>Datos del cliente</legend><div class="field full-field"><label for="fullName">Nombre completo <b>*</b></label><input id="fullName" v-model="form.fullName" type="text" placeholder="Ej. Juan Pablo Gómez" required /></div><div class="field"><label for="legalEntityType">Constitución legal <b>*</b></label><select id="legalEntityType" v-model="form.legalEntityType" required><option value="" disabled>Selecciona una opción</option><option value="natural">Persona natural</option><option value="juridica">Persona jurídica</option></select></div></fieldset>
          <fieldset><legend>Medios de contacto <span>Ingresa al menos uno</span></legend><div class="field"><label for="email">Correo electrónico</label><input id="email" v-model="form.email" type="email" placeholder="nombre@empresa.com" /></div><div class="field"><label for="phone">Teléfono</label><input id="phone" v-model="form.phone" type="tel" placeholder="+57 300 000 0000" /></div><div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" v-model="form.whatsapp" type="tel" placeholder="+57 300 000 0000" /></div></fieldset>
          <fieldset><legend>Detalles de la operación</legend><div class="field"><label for="serviceType">Tipo de servicio <b>*</b></label><select id="serviceType" v-model="form.serviceType" required><option value="" disabled>Selecciona una opción</option><option value="exportacion">Exportación</option><option value="importacion">Importación</option></select></div><div class="field"><label for="productType">Tipo de producto <b>*</b></label><select id="productType" v-model="form.productType" required><option value="" disabled>Selecciona una opción</option><option value="vehiculos">Vehículos</option><option value="mercancias">Mercancías</option></select></div><div class="field full-field"><label for="freightAgent">Agente de carga <b>*</b></label><input id="freightAgent" v-model="form.freightAgent" type="text" placeholder="Nombre del agente o empresa de carga" required /></div></fieldset>
          <p v-if="error" class="request-error" role="alert">{{ error }}</p><div class="form-actions"><button type="button" class="back-button" @click="goToLanding">Volver a la página principal</button><button type="submit" class="submit-request" :disabled="loading">{{ loading ? 'Registrando solicitud…' : 'Enviar solicitud' }} <span>→</span></button></div>
        </form>
      </section>
    </section>
    <footer class="request-footer">© 2026 Cortés Rodríguez Asesores S.A.S. <span>·</span> Tu información será tratada de forma confidencial.</footer>
    <div v-if="submitted" class="success-backdrop"><section class="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><div class="success-icon">✓</div><p class="request-kicker">Solicitud recibida</p><h2 id="success-title">Gracias por seleccionarnos</h2><p>Recibimos la información de tu {{ serviceLabel.toLowerCase() }}. Pronto se contactará contigo un miembro de nuestro equipo.</p><div class="success-reference">Referencia <strong>{{ reference }}</strong></div><button type="button" class="submit-request" @click="goToLanding">Volver a la página principal <span>→</span></button></section></div>
  </main>
</template>

<style scoped>
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#071c3f;background:#f5f8fc}:global(button),:global(input),:global(select){font:inherit}.request-page{min-height:100vh;background:linear-gradient(135deg,#f5f8fc,#fff 55%,#fdf5f5)}.request-header{height:82px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(22px,6vw,92px);border-bottom:1px solid #dfe6ef;background:rgba(255,255,255,.92)}.request-brand{display:flex;align-items:center;gap:11px;padding:0;border:0;color:#062653;background:transparent;text-align:left;cursor:pointer}.request-brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;color:#fff;background:#062653;font-size:11px;font-weight:900}.request-brand strong{font-size:13px;line-height:1.05}.request-brand small{color:#586780;font-size:9px;font-weight:500}.header-note{display:flex;align-items:center;gap:8px;color:#586780;font-size:11px;font-weight:700}.header-dot{width:7px;height:7px;border-radius:50%;background:#53ad88;box-shadow:0 0 0 4px #e1f4eb}.request-layout{display:grid;grid-template-columns:minmax(280px,.75fr) minmax(620px,1.25fr);gap:clamp(35px,6vw,105px);max-width:1280px;margin:0 auto;padding:65px clamp(22px,6vw,92px) 42px}.request-intro{display:flex;flex-direction:column;justify-content:center;padding-bottom:25px}.request-kicker,.form-step{margin:0 0 13px;color:#ed1c24;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.request-intro h1{max-width:420px;margin:0 0 20px;color:#062653;font-size:clamp(36px,4.5vw,61px);line-height:1.04;letter-spacing:-.06em}.request-intro>p:not(.request-kicker){max-width:390px;margin:0;color:#586780;font-size:15px;line-height:1.7}.intro-points{display:grid;gap:17px;margin-top:48px}.intro-points>div{display:flex;gap:13px;align-items:start}.intro-points span{display:grid;place-items:center;width:29px;height:29px;border:1px solid #dfe6ef;border-radius:9px;color:#0c3c78;font-size:9px;font-weight:900}.intro-points p{margin:0;color:#586780;font-size:11px;line-height:1.45}.intro-points strong{color:#062653;font-size:12px}.intro-footer{margin-top:60px;color:#586780;font-size:11px}.intro-footer a{display:block;margin-top:7px;color:#0c3c78;font-weight:800;text-decoration:none}.request-card{padding:35px 38px 29px;border:1px solid #dfe6ef;border-radius:15px;background:rgba(255,255,255,.97);box-shadow:0 18px 48px rgba(6,38,83,.12)}.form-heading{display:flex;justify-content:space-between;gap:20px;margin-bottom:29px}.form-step{margin-bottom:9px;color:#ed1c24;font-size:10px}.form-step span{margin:0 5px;color:#586780}.form-heading h2{margin:0 0 7px;color:#062653;font-size:24px;letter-spacing:-.04em}.form-heading>div>p:last-child{margin:0;color:#586780;font-size:11px}.form-heading b,label b{color:#ed1c24}.form-badge{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;color:#ed1c24;background:#fff0f1;font-size:20px}form{display:grid;gap:25px}fieldset{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px 14px;margin:0;padding:0;border:0}legend{grid-column:1/-1;display:flex;align-items:center;gap:9px;width:100%;padding:0 0 10px;border-bottom:1px solid #dfe6ef;color:#062653;font-size:12px;font-weight:800}legend span{color:#586780;font-size:10px;font-weight:500}.field{display:grid;gap:7px}.full-field{grid-column:1/-1}.field label{color:#586780;font-size:10px;font-weight:800}.field input,.field select{width:100%;min-height:43px;padding:0 12px;border:1px solid #dfe6ef;border-radius:7px;outline:0;color:#071c3f;background:#fff;font-size:12px;transition:border .2s,box-shadow .2s}.field input::placeholder{color:#98a2b3}.field input:focus,.field select:focus{border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.1)}.request-error{margin:0;padding:10px 12px;border-radius:7px;color:#7a1116;background:#fff0f1;font-size:11px}.form-actions{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-top:5px}.back-button{padding:0;border:0;color:#586780;background:transparent;font-size:11px;cursor:pointer}.submit-request{display:inline-flex;align-items:center;justify-content:center;gap:17px;min-height:44px;padding:0 17px;border:0;border-radius:7px;color:#fff;background:#ed1c24;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 7px 14px rgba(237,28,36,.16)}.submit-request:hover{background:#c9141b}.submit-request:disabled{opacity:.6;cursor:wait}.submit-request span{font-size:17px;font-weight:400}.request-footer{padding:0 20px 27px;text-align:center;color:#586780;font-size:10px}.request-footer span{margin:0 5px}.success-backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(3,25,56,.7);backdrop-filter:blur(5px)}.success-modal{width:min(445px,100%);padding:42px 38px 35px;border-radius:17px;background:#fff;text-align:center;box-shadow:0 25px 70px rgba(6,38,83,.25)}.success-icon{display:grid;place-items:center;width:57px;height:57px;margin:0 auto 22px;border-radius:50%;color:#fff;background:#ed1c24;font-size:28px;font-weight:500;box-shadow:0 0 0 8px #fff0f1}.success-modal h2{margin:0 0 12px;color:#062653;font-size:27px;letter-spacing:-.05em}.success-modal>p:not(.request-kicker){margin:0;color:#586780;font-size:13px;line-height:1.65}.success-reference{margin:22px 0 25px;padding:11px;border-radius:7px;color:#586780;background:#f5f8fc;font-size:10px}.success-reference strong{display:block;margin-top:4px;color:#0c3c78;font-size:12px;letter-spacing:.06em}@media(max-width:980px){.request-layout{grid-template-columns:1fr;max-width:740px}.request-intro{display:block}.request-intro h1{font-size:45px}.intro-points{grid-template-columns:repeat(3,1fr);margin-top:30px}.intro-footer{margin-top:25px}}@media(max-width:620px){.request-header{height:70px}.header-note{display:none}.request-layout{padding-top:36px}.request-intro h1{font-size:39px}.intro-points{grid-template-columns:1fr}.request-card{padding:25px 18px}.form-heading h2{font-size:21px}fieldset{grid-template-columns:1fr}.full-field{grid-column:auto}.form-actions{display:grid;justify-content:stretch}.submit-request,.back-button{width:100%}}
</style>
