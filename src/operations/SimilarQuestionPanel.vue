<script setup>
import { computed, onMounted, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'
import { localeTag } from '../lib/locale.js'

const props = defineProps({ token: { type: String, required: true }, locale: { type: String, default: 'es' } })
const items = ref([])
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref(null)
const selectedResponseId = ref('')
const answer = ref('')
const adminNote = ref('')
const isEnglish = () => props.locale === 'en'
const t = (es, en) => isEnglish() ? en : es
function localizedError(message) {
  if (!isEnglish()) return message
  const translations = {
    'No se pudo completar la operación.': 'Could not complete the operation.',
    'No tienes permisos para revisar respuestas.': 'You do not have permission to review responses.',
    'La base de datos operativa no está configurada.': 'The operations database is not configured.',
    'Solo administración puede validar preguntas similares.': 'Only administrators can review similar questions.',
    'La revisión de similitud no existe.': 'The similarity review was not found.',
    'Esta pregunta ya fue resuelta.': 'This question has already been resolved.',
    'No hay expertos activos asociados a esta consulta.': 'There are no active experts assigned to this consultation.',
    'Esta pregunta ya fue resuelta o su asignación cambió.': 'This question has already been resolved or its assignment changed.',
    'Selecciona reutilizar una respuesta o derivar a experto.': 'Choose whether to reuse a response or forward it to an expert.',
    'Selecciona una respuesta candidata.': 'Select a candidate response.',
    'El texto supera la longitud permitida.': 'The text exceeds the allowed length.',
    'La respuesta elegida no es una coincidencia candidata válida.': 'The selected response is not a valid match candidate.',
    'El cliente no tiene un correo registrado.': 'The client does not have an email address on file.',
    'El cliente no tiene un correo registrado': 'The client does not have an email address on file.',
    'La respuesta ya fue reutilizada y enviada.': 'This response has already been reused and sent.',
    'No hay respuestas candidatas disponibles; deriva la solicitud a un experto.': 'No candidate responses are available; forward the request to an expert.',
  }
  return translations[message] || message
}
function formatDate(value) { return new Intl.DateTimeFormat(localeTag(props.locale), { dateStyle: 'medium' }).format(new Date(value)) }
const selectedCandidate = computed(() => selected.value?.candidates?.find((candidate) => candidate.responseId === selectedResponseId.value) || null)

async function request(url, options = {}) {
  const result = await fetch(url, { ...options, headers: { Authorization: `Bearer ${props.token}`, ...(options.headers || {}) } })
  const data = await result.json().catch(() => ({}))
  if (!result.ok) throw new Error(localizedError(data.error || t('No se pudo completar la operación.', 'Could not complete the operation.')))
  return data
}

async function load(page = pagination.value.page) {
  loading.value = true
  error.value = ''
  try {
    const data = await request(`/api/app/reviews/similar-questions?page=${page}&pageSize=10`)
    items.value = data.items || []
    pagination.value = data.pagination || pagination.value
  } catch (loadError) { error.value = loadError.message } finally { loading.value = false }
}

function open(item) {
  selected.value = item
  selectedResponseId.value = item.candidates?.[0]?.responseId || ''
  answer.value = item.candidates?.[0]?.responseBody || ''
  adminNote.value = ''
}

function chooseCandidate(candidate) {
  selectedResponseId.value = candidate.responseId
  answer.value = candidate.responseBody
}

function close() { selected.value = null; selectedResponseId.value = ''; answer.value = ''; adminNote.value = '' }

async function resolve(action) {
  if (!selected.value || saving.value) return
  if (action === 'reuse' && !window.confirm(t('Se enviará al cliente la respuesta seleccionada, revisada por administración. ¿Continuar?', 'The selected response, reviewed by an administrator, will be sent to the client. Continue?'))) return
  saving.value = true
  error.value = ''
  try {
    const data = await request(`/api/app/reviews/similar-questions/${selected.value.requestId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, responseId: selectedResponseId.value, answer, adminNote }),
    })
    notice.value = action === 'reuse' ? t('Respuesta aprobada; el correo quedó en la cola de envío.', 'Response approved; the email was queued for delivery.') : t(`La solicitud fue asignada a ${data.expertName}.`, `The request was assigned to ${data.expertName}.`)
    close()
    await load()
  } catch (resolveError) { error.value = resolveError.message } finally { saving.value = false }
}

function percent(score) { return `${Math.round(score * 100)}%` }
function channelLabel(value) { return value === 'agent_link' ? t('Enlace de agente', 'Agent link') : t('Página web', 'Website') }
onMounted(() => load(1))
</script>

<template>
  <section class="module-view similar-view">
    <div class="module-heading"><div><p class="eyebrow">{{ t('Validación administrativa', 'Administrative review') }}</p><h1>{{ t('Preguntas similares', 'Similar questions') }}</h1><p>{{ t('Las coincidencias son sugerencias léxicas; revisa el contexto antes de reutilizar una respuesta.', 'Matches are lexical suggestions; review the context before reusing a response.') }}</p></div><button type="button" class="secondary-button compact" @click="load()">↻ {{ t('Actualizar', 'Refresh') }}</button></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error" role="alert">{{ error }}</p>
    <ListView :locale="locale" :title="t('Pendientes de validación', 'Awaiting review')" :description="t('Solo se comparan respuestas aprobadas y enviadas para el mismo tipo de consulta.', 'Only approved and sent responses for the same consultation type are compared.')" :count="pagination.totalItems" :page="pagination.page" :total-pages="pagination.totalPages" :loading="loading" :empty="!items.length && !loading" :empty-text="t('No hay preguntas pendientes de validación.', 'There are no questions awaiting review.')" @previous="load(pagination.page - 1)" @next="load(pagination.page + 1)">
      <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Pregunta nueva', 'New question') }}</th><th>{{ t('Coincidencias', 'Matches') }}</th><th>{{ t('Origen', 'Source') }}</th><th>{{ t('Creada', 'Created') }}</th><th>{{ t('Acción', 'Action') }}</th></template>
      <template #rows><tr v-for="item in items" :key="item.requestId"><td><strong class="request-id">{{ item.reference }}</strong><br /><span class="muted-cell">{{ item.consultationType }}</span></td><td class="similar-question-cell">{{ item.question }}</td><td><span class="count-badge">{{ t(`${item.candidates.length} sugerencia(s)`, `${item.candidates.length} suggestion(s)`) }}</span><br /><small v-if="item.candidates[0]" class="muted-cell">{{ t('Máxima', 'Top score') }} {{ percent(item.candidates[0].score) }}</small></td><td>{{ channelLabel(item.sourceChannel) }}<small v-if="item.agentName" class="muted-cell">{{ item.agentName }}</small></td><td>{{ formatDate(item.createdAt) }}</td><td><button type="button" class="secondary-button compact" @click="open(item)">{{ t('Validar', 'Review') }}</button></td></tr></template>
    </ListView>

    <div v-if="selected" class="similar-backdrop" @click.self="close"><section class="similar-panel" :aria-label="t('Validar pregunta similar', 'Review similar question')">
      <div class="panel-heading"><div><p class="eyebrow">{{ selected.reference }} · {{ selected.consultationType }}</p><h2>{{ t('Validar coincidencia', 'Review match') }}</h2><p>{{ t('Una puntuación alta no garantiza que la respuesta aplique a este caso.', 'A high score does not guarantee that the response applies to this case.') }}</p></div><button type="button" class="secondary-button compact" @click="close">{{ t('Cerrar', 'Close') }}</button></div>
      <article class="similar-new-question"><span>{{ t('Pregunta nueva', 'New question') }}</span><p>{{ selected.question }}</p></article>
      <p class="request-error">{{ t('Confirma que la respuesta aplica al caso nuevo y no contiene datos ni documentos del cliente anterior.', 'Confirm that the response applies to the new case and contains no data or documents from the previous client.') }}</p>
      <div class="similar-candidates"><h3>{{ t('Respuestas anteriores', 'Previous responses') }}</h3><p v-if="!selected.candidates.length" class="empty-row">{{ t('No hay respuestas candidatas disponibles; deriva la solicitud a un experto.', 'No candidate responses are available; forward the request to an expert.') }}</p>
        <button v-for="candidate in selected.candidates" :key="candidate.responseId" type="button" :class="['similar-candidate', { active: candidate.responseId === selectedResponseId }]" @click="chooseCandidate(candidate)">
          <span class="similar-candidate-heading"><strong>{{ candidate.sourceReference }} · {{ candidate.matchLevel === 'high' ? t('Coincidencia alta', 'Strong match') : t('Coincidencia posible', 'Possible match') }} · {{ percent(candidate.score) }}</strong><small>{{ t('Coincide:', 'Shared terms:') }} {{ candidate.sharedTerms.join(', ') }}</small></span>
          <span class="similar-source-question">{{ candidate.sourceQuestion }}</span><span class="similar-source-answer">{{ candidate.responseBody }}</span>
        </button>
      </div>
      <label v-if="selectedCandidate" class="similar-edit-answer">{{ t('Respuesta que se enviará (puedes editarla)', 'Response to send (you can edit it)') }}<textarea v-model="answer" rows="6" maxlength="15000" required></textarea></label>
      <label v-if="selectedCandidate" class="similar-edit-answer">{{ t('Nota para el cliente (opcional)', 'Note for the client (optional)') }}<textarea v-model="adminNote" rows="3" maxlength="5000"></textarea></label>
      <div class="similar-actions"><button type="button" class="secondary-button" :disabled="saving" @click="resolve('forward')">{{ t('No aplica: asignar a experto', 'Not applicable: assign to an expert') }}</button><button v-if="selectedCandidate" type="button" class="primary-button" :disabled="saving || !answer.trim()" @click="resolve('reuse')">{{ saving ? t('Enviando…', 'Sending…') : t('Validar y enviar respuesta', 'Approve and send response') }}</button></div>
    </section></div>
  </section>
</template>

<style scoped>
.similar-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.similar-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.similar-view .module-heading p:last-child{margin:0;color:#7d8999;font-size:13px}.similar-question-cell{max-width:360px;white-space:normal!important;line-height:1.45}.muted-cell{display:inline-block;margin-top:4px;color:#98a2b3;font-size:10px}.similar-backdrop{position:fixed;inset:0;z-index:35;display:flex;justify-content:flex-end;background:rgba(9,30,48,.3)}.similar-panel{width:min(700px,100%);height:100%;overflow:auto;display:grid;align-content:start;gap:17px;padding:30px;background:#fff;box-shadow:-14px 0 35px rgba(16,39,59,.14)}.similar-panel h2{margin:0 0 5px;color:#223b53;font-size:20px}.similar-panel .panel-heading p:last-child{margin:0;color:#7d8999;font-size:11px}.similar-new-question{padding:14px;border:1px solid #dce7f0;border-radius:8px;background:#f5f9fc}.similar-new-question>span,.similar-candidates h3{color:#397aa2;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.similar-new-question p{margin:8px 0 0;color:#223b53;font-size:13px;line-height:1.55;white-space:pre-wrap}.similar-candidates{display:grid;gap:9px}.similar-candidates h3{margin:0}.similar-candidate{display:grid;gap:9px;padding:13px;border:1px solid #e1e8ef;border-radius:8px;color:#344b60;background:#fff;text-align:left;cursor:pointer}.similar-candidate.active{border-color:#397aa2;box-shadow:0 0 0 2px rgba(57,122,162,.1)}.similar-candidate-heading{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.similar-candidate-heading strong{font-size:11px}.similar-candidate-heading small{color:#718196;font-size:10px}.similar-source-question{color:#718196;font-size:11px;line-height:1.45}.similar-source-answer{padding-top:8px;border-top:1px solid #edf1f5;font-size:12px;line-height:1.55;white-space:pre-wrap}.similar-edit-answer{display:grid;gap:7px;color:#526174;font-size:10px;font-weight:800}.similar-edit-answer textarea{width:100%;padding:11px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff;font:inherit;font-size:12px;line-height:1.5;resize:vertical}.similar-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}.similar-actions .primary-button{min-height:38px;padding:0 14px;border:0;border-radius:7px;color:#fff;background:#0e4567;font-size:11px;font-weight:800;cursor:pointer}.similar-actions button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:700px){.similar-view .module-heading{display:block}.similar-panel{padding:24px 17px}.similar-actions{display:grid}.similar-actions button{width:100%}}
</style>
