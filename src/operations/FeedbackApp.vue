<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import LanguageToggle from '../shared/components/LanguageToggle.vue'
import { getInitialLocale, localeTag } from '../lib/locale.js'

const locale = ref(getInitialLocale())
const token = new URLSearchParams(window.location.search).get('token') || ''
const loading = ref(true)
const submitting = ref(false)
const errorKey = ref('')
const submitted = ref(false)
const reference = ref('')
const consultationType = ref('')
const rating = ref(0)
const comment = ref('')

const messages = {
  es: {
    language: 'Idioma', title: '¿Cómo fue tu experiencia?', description: 'Tu opinión nos ayuda a mejorar la orientación que recibes.',
    loading: 'Cargando…', invalidLink: 'El enlace de feedback no es válido o ya no está disponible.',
    loadError: 'No se pudo cargar el feedback. Inténtalo de nuevo más tarde.', submitError: 'No se pudo registrar el feedback. Inténtalo de nuevo.',
    alreadySubmitted: 'Ya registramos el feedback para esta respuesta.', thanks: 'Gracias por tu opinión',
    recorded: 'Registramos tu feedback para la solicitud', request: 'Solicitud', rating: 'Calificación', stars: 'estrellas',
    comment: 'Comentario (opcional)', placeholder: 'Cuéntanos cómo podemos mejorar...', sending: 'Enviando…', send: 'Enviar feedback',
    networkError: 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.',
  },
  en: {
    language: 'Language', title: 'How was your experience?', description: 'Your feedback helps us improve the guidance you receive.',
    loading: 'Loading…', invalidLink: 'This feedback link is invalid or is no longer available.',
    loadError: 'We couldn’t load the feedback form. Please try again later.', submitError: 'We couldn’t submit your feedback. Please try again.',
    alreadySubmitted: 'We have already recorded feedback for this response.', thanks: 'Thank you for your feedback',
    recorded: 'Your feedback has been recorded for request', request: 'Request', rating: 'Rating', stars: 'stars',
    comment: 'Comment (optional)', placeholder: 'Tell us how we can improve...', sending: 'Submitting…', send: 'Submit feedback',
    networkError: 'Could not connect. Check your connection and try again.',
  },
}
const t = computed(() => messages[locale.value] || messages.es)
const error = computed(() => errorKey.value ? t.value[errorKey.value] : '')

watch(locale, (value) => {
  document.documentElement.lang = localeTag(value)
})

function localizedApiError(message, fallback) {
  if (!message) return fallback
  const normalized = String(message).toLocaleLowerCase()
  if (normalized.includes('ya registramos') || normalized.includes('already recorded')) return 'alreadySubmitted'
  if (normalized.includes('enlace de feedback') || normalized.includes('feedback link')) return 'invalidLink'
  return fallback
}

async function load() {
  if (!token) {
    errorKey.value = 'invalidLink'
    loading.value = false
    return
  }
  try {
    const response = await fetch(`/api/public/feedback?token=${encodeURIComponent(token)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '')
    reference.value = data.reference
    consultationType.value = data.consultationType
    submitted.value = data.submitted
  } catch (loadError) {
    errorKey.value = localizedApiError(loadError.message, 'loadError')
  } finally {
    loading.value = false
  }
}

async function submit() {
  submitting.value = true
  errorKey.value = ''
  try {
    const response = await fetch(`/api/public/feedback?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: rating.value, comment: comment.value }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '')
    submitted.value = true
  } catch (submitError) {
    errorKey.value = localizedApiError(submitError.message, submitError instanceof TypeError ? 'networkError' : 'submitError')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  document.documentElement.lang = localeTag(locale.value)
  load()
})
</script>

<template>
  <main class="feedback-page">
    <section class="feedback-card">
      <div class="feedback-topline">
        <div class="feedback-mark">CRA</div>
        <LanguageToggle v-model="locale" :aria-label="t.language" />
      </div>
      <p class="feedback-kicker">Cortés Rodríguez Asesores</p>
      <h1>{{ t.title }}</h1>
      <p class="feedback-description">{{ t.description }}</p>
      <div v-if="loading" class="feedback-state" role="status">{{ t.loading }}</div>
      <div v-else-if="error && !reference" class="feedback-error" role="alert">{{ error }}</div>
      <div v-else-if="submitted" class="feedback-success">
        <span>✓</span>
        <h2>{{ t.thanks }}</h2>
        <p>{{ t.recorded }} <strong>{{ reference }}</strong>.</p>
      </div>
      <form v-else @submit.prevent="submit">
        <p class="feedback-reference">{{ t.request }} <strong>{{ reference }}</strong><span v-if="consultationType"> · {{ consultationType }}</span></p>
        <fieldset>
          <legend>{{ t.rating }}</legend>
          <div class="rating-options">
            <button v-for="value in 5" :key="value" type="button" :class="{ selected: rating === value }" :aria-label="`${value} ${t.stars}`" :aria-pressed="rating === value" @click="rating = value">★</button>
          </div>
        </fieldset>
        <label>{{ t.comment }}
          <textarea v-model="comment" rows="5" maxlength="5000" :placeholder="t.placeholder"></textarea>
        </label>
        <p v-if="error" class="feedback-error" role="alert">{{ error }}</p>
        <button class="feedback-submit" type="submit" :disabled="!rating || submitting">
          {{ submitting ? t.sending : t.send }} <span>→</span>
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.feedback-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#f5f8fc,#fff 55%,#fdf5f5)}.feedback-card{width:min(520px,100%);padding:42px 38px;border:1px solid #dfe6ef;border-radius:16px;background:#fff;box-shadow:0 18px 48px rgba(6,38,83,.12)}.feedback-topline{display:flex;align-items:center;justify-content:space-between;gap:16px}.feedback-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;color:#fff;background:#062653;font-size:11px;font-weight:900}.feedback-kicker{margin:24px 0 10px;color:#ed1c24;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.feedback-card h1{margin:0 0 10px;color:#062653;font-size:29px;letter-spacing:-.05em}.feedback-description{margin:0;color:#586780;font-size:13px;line-height:1.6}.feedback-reference{margin:25px 0 20px;padding:11px;border-radius:7px;color:#586780;background:#f5f8fc;font-size:10px}.feedback-reference strong{color:#0c3c78}.feedback-reference span{color:#586780}.feedback-card fieldset{margin:0 0 20px;padding:0;border:0}.feedback-card legend{padding:0 0 8px;border:0;color:#526174;font-size:11px;font-weight:800}.rating-options{display:flex;gap:8px}.rating-options button{width:40px;height:40px;border:1px solid #d8e0ea;border-radius:8px;color:#c4ccd6;background:#fff;font-size:23px;cursor:pointer}.rating-options button:hover,.rating-options button.selected{border-color:#e5ae54;color:#d89125;background:#fff8e9}.feedback-card label{display:grid;gap:8px;color:#526174;font-size:11px;font-weight:800}.feedback-card textarea{width:100%;padding:11px;border:1px solid #d8e0ea;border-radius:7px;outline:0;color:#344b60;background:#fff;font:inherit;font-size:12px;resize:vertical}.feedback-submit{display:inline-flex;align-items:center;justify-content:center;gap:15px;width:100%;min-height:44px;margin-top:20px;border:0;border-radius:7px;color:#fff;background:#ed1c24;font-size:11px;font-weight:800;cursor:pointer}.feedback-submit:disabled{opacity:.55;cursor:not-allowed}.feedback-submit span{font-size:17px;font-weight:400}.feedback-state,.feedback-error{margin-top:24px;color:#7d8999;font-size:12px;line-height:1.6}.feedback-error{padding:10px 12px;border-radius:7px;color:#7a1116;background:#fff0f1}.feedback-success{margin-top:28px;text-align:center}.feedback-success>span{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 16px;border-radius:50%;color:#fff;background:#53ad88;font-size:26px}.feedback-success h2{margin:0 0 8px;color:#062653;font-size:22px}.feedback-success p{margin:0;color:#586780;font-size:12px;line-height:1.6}.feedback-success strong{color:#0c3c78}@media(max-width:520px){.feedback-card{padding:30px 22px}}
</style>
