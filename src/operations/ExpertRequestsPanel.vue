<script setup>
import { onMounted, ref, watch } from 'vue'
import ListView from '../shared/components/ListView.vue'
import { localeTag } from '../lib/locale.js'

const props = defineProps({ token: { type: String, required: true }, locale: { type: String, default: 'es' }, openRequestId: { type: String, default: '' }, refreshKey: { type: Number, default: 0 } })
const emit = defineEmits(['request-opened'])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const items = ref([])
const page = ref(1)
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const search = ref('')
const selected = ref(null)
const responseBody = ref('')
const isEnglish = () => props.locale === 'en'
const t = (es, en) => isEnglish() ? en : es
function localizedError(message, fallback) {
  if (!isEnglish()) return message || fallback
  const translations = {
    'No se pudo completar la operación.': 'Could not complete the operation.',
    'No se pudo descargar el adjunto.': 'Could not download the attachment.',
    'No se pudieron cargar las solicitudes.': 'Could not load requests.',
    'Sesión requerida.': 'Sign-in required.',
    'No tienes permisos para consultar solicitudes de experto.': 'You do not have permission to view expert requests.',
    'No tienes permisos para responder solicitudes de experto.': 'You do not have permission to respond to expert requests.',
    'La base de datos operativa no está configurada.': 'The operations database is not configured.',
    'Identificador de solicitud inválido.': 'Invalid request identifier.',
    'La respuesta no puede estar vacía.': 'The response cannot be empty.',
    'La respuesta no puede superar 20.000 caracteres.': 'The response cannot exceed 20,000 characters.',
    'La solicitud no está asignada a este experto.': 'This request is not assigned to this expert.',
    'La solicitud requiere un pago aprobado antes de responder.': 'The request requires an approved payment before you can respond.',
    'La solicitud ya no está habilitada para recibir respuestas.': 'The request can no longer receive responses.',
    'La asignación, el pago o el estado de la solicitud cambió. Actualiza la bandeja e inténtalo de nuevo.': 'The assignment, payment, or request status changed. Refresh the inbox and try again.',
  }
  return translations[message] || message || fallback
}
function formatDate(value) { return new Intl.DateTimeFormat(localeTag(props.locale), { dateStyle: 'medium' }).format(new Date(value)) }

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${props.token}`, ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(localizedError(data.error, t('No se pudo completar la operación.', 'Could not complete the operation.')))
  return data
}

async function load(nextPage = page.value) {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: '10', search: search.value.trim() })
    if (props.openRequestId) params.set('requestId', props.openRequestId)
    const data = await request(`/api/app/expert/requests?${params}`)
    items.value = data.items || []
    pagination.value = data.pagination || pagination.value
    page.value = pagination.value.page
    if (selected.value) selected.value = items.value.find((item) => item.id === selected.value.id) || null
    openRequestedItem()
  } catch (loadError) { error.value = loadError.message } finally { loading.value = false }
}

function open(item) {
  selected.value = item
  responseBody.value = item.responseBody || ''
  error.value = ''
}

function openRequestedItem() {
  if (!props.openRequestId) return
  const item = items.value.find((entry) => entry.id === props.openRequestId)
  if (item) {
    open(item)
    emit('request-opened')
  }
}

function close() { selected.value = null; responseBody.value = '' }

async function downloadAttachment(attachment) {
  error.value = ''
  try {
    const response = await fetch(`/api/app/requests/${selected.value.id}/attachments/${attachment.id}`, {
      headers: { Authorization: `Bearer ${props.token}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(localizedError(data.error, t('No se pudo descargar el adjunto.', 'Could not download the attachment.')))
    }
    const objectUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = attachment.name || 'adjunto'
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch (downloadError) { error.value = localizedError(downloadError.message, t('No se pudo descargar el adjunto.', 'Could not download the attachment.')) }
}

async function submitResponse() {
  if (!selected.value || !responseBody.value.trim()) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await request(`/api/app/expert/requests/${selected.value.id}/response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: responseBody.value }) })
    notice.value = t('Respuesta enviada a revisión administrativa.', 'Response submitted for administrative review.')
    close()
    await load()
  } catch (saveError) { error.value = saveError.message } finally { saving.value = false }
}

function responseLabel(status) {
  const labels = isEnglish()
    ? { none: 'No response', draft: 'Draft', pending_admin_review: 'Under review', rejected: 'Returned', approved: 'Approved', sent: 'Sent' }
    : { none: 'Sin respuesta', draft: 'Borrador', pending_admin_review: 'En revisión', rejected: 'Devuelta', approved: 'Aprobada', sent: 'Enviada' }
  return labels[status] || status
}

watch(() => props.openRequestId, (requestId) => {
  if (!requestId) return
  if (items.value.some((item) => item.id === requestId)) openRequestedItem()
  else load(1)
})
watch(() => props.refreshKey, () => load())
onMounted(load)
</script>

<template>
  <section class="module-view expert-requests-view">
    <div class="module-heading"><div><p class="eyebrow">{{ t('Bandeja de experto', 'Expert inbox') }}</p><h1>{{ t('Solicitudes asignadas', 'Assigned requests') }}</h1><p>{{ t('Responde únicamente las preguntas de tu especialidad. Los datos del cliente están protegidos.', 'Answer only questions in your area of expertise. Client data is protected.') }}</p></div><button type="button" class="secondary-button compact" @click="load">↻ {{ t('Actualizar', 'Refresh') }}</button></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error">{{ error }}</p>
    <ListView :locale="locale" :title="t('Mis solicitudes', 'My requests')" :description="t('Casos asignados para revisión y respuesta.', 'Cases assigned for review and response.')" :count="pagination.totalItems" :page="pagination.page" :total-pages="pagination.totalPages" :loading="loading" :empty="!items.length && !loading" :empty-text="t('No tienes solicitudes asignadas.', 'You have no assigned requests.')" @previous="load(page - 1)" @next="load(page + 1)"><template #toolbar><form class="expert-search" @submit.prevent="load(1)"><span>⌕</span><input v-model="search" type="search" :placeholder="t('Buscar por referencia o pregunta...', 'Search by reference or question...')" /><button type="submit">{{ t('Buscar', 'Search') }}</button></form></template><template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Consulta', 'Consultation') }}</th><th>{{ t('Pregunta', 'Question') }}</th><th>{{ t('Adjuntos', 'Attachments') }}</th><th>{{ t('Respuesta', 'Response') }}</th><th>{{ t('Acción', 'Action') }}</th></template><template #rows><tr v-for="item in items" :key="item.id"><td><strong class="request-id">{{ item.reference }}</strong><br /><span class="muted-cell">{{ formatDate(item.createdAt) }}</span></td><td><strong>{{ item.consultationType || t('Consulta', 'Consultation') }}</strong><br /><span class="muted-cell">{{ item.serviceName || item.serviceType }}</span></td><td class="question-cell">{{ item.question }}</td><td><span class="count-badge">{{ item.attachmentCount }}</span></td><td><span class="security-status" :class="{ inactive: item.responseStatus === 'rejected' }">{{ responseLabel(item.responseStatus) }}</span></td><td><button type="button" class="secondary-button compact" @click="open(item)">{{ t('Responder', 'Respond') }}</button></td></tr></template></ListView>
    <div v-if="selected" class="expert-response-backdrop" @click.self="close"><form class="expert-response-panel" @submit.prevent="submitResponse"><div class="panel-heading"><div><p class="eyebrow">{{ selected.reference }}</p><h2>{{ selected.consultationType || t('Solicitud de asesoría', 'Consultation request') }}</h2><p>{{ selected.serviceName }}</p></div><button type="button" class="secondary-button compact" @click="close">{{ t('Cerrar', 'Close') }}</button></div><div class="question-box"><strong>{{ t('Pregunta del cliente', 'Client question') }}</strong><p>{{ selected.question }}</p><div v-if="selected.attachments?.length" class="attachment-actions"><strong>{{ t('Imágenes adjuntas', 'Attached images') }}</strong><button v-for="attachment in selected.attachments" :key="attachment.id" type="button" class="secondary-button compact" @click="downloadAttachment(attachment)">{{ t('Descargar', 'Download') }} {{ attachment.name }}</button></div></div><label>{{ t('Respuesta para revisión administrativa', 'Response for administrative review') }}<textarea v-model="responseBody" rows="9" maxlength="20000" :placeholder="t('Redacta la orientación técnica para que administración la revise...', 'Write the technical guidance for the administration team to review...')" required></textarea></label><div class="form-actions"><button type="button" class="secondary-button compact" @click="close">{{ t('Cancelar', 'Cancel') }}</button><button type="submit" class="primary-button" :disabled="saving">{{ saving ? t('Enviando…', 'Sending…') : t('Enviar a revisión', 'Submit for review') }} <span>→</span></button></div></form></div>
  </section>
</template>

<style scoped>
.expert-requests-view .secondary-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid #d8e5ee;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap}.expert-requests-view .secondary-button:hover{background:#f7fafc;border-color:#c6d9e5}.expert-requests-view .secondary-button:disabled{opacity:.55;cursor:not-allowed}
.expert-requests-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.expert-requests-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.expert-requests-view .module-heading p:last-child{margin:0;color:#7d8999;font-size:13px}.expert-search{display:flex;align-items:center;gap:8px;margin:0;padding:0 8px 0 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.expert-search input{flex:1;min-height:40px;padding:0;border:0;outline:0;box-shadow:none;font-size:11px}.expert-search button{min-height:30px;padding:0 12px;border:0;border-radius:6px;color:#fff;background:#0e4567;font-size:10px;font-weight:800;cursor:pointer}.question-cell{max-width:320px;white-space:normal!important;line-height:1.45}.expert-response-backdrop{position:fixed;inset:0;z-index:30;display:flex;justify-content:flex-end;background:rgba(9,30,48,.28)}.expert-response-panel{width:min(640px,100%);height:100%;overflow:auto;display:grid;align-content:start;gap:18px;margin:0;padding:36px;background:#fff;box-shadow:-14px 0 35px rgba(16,39,59,.14)}.expert-response-panel h2{margin:0 0 5px;color:#223b53;font-size:20px}.expert-response-panel .panel-heading p:last-child{margin:0;color:#98a2b3;font-size:10px}.question-box{padding:16px;border:1px solid #dce7f0;border-radius:8px;background:#f6fafc}.question-box strong{color:#223b53;font-size:11px}.question-box p{margin:9px 0 0;color:#526174;font-size:12px;line-height:1.6}.question-box small{display:block;margin-top:11px;color:#397aa2;font-size:10px}.expert-response-panel label{display:grid;gap:8px;color:#526174;font-size:10px;font-weight:800}.expert-response-panel textarea{width:100%;padding:12px;border:1px solid #d8e0ea;border-radius:7px;outline:0;color:#344b60;background:#fff;font:inherit;font-size:12px;line-height:1.5;resize:vertical}.form-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:720px){.expert-requests-view .module-heading{display:block}.expert-requests-view .module-heading .secondary-button{margin-top:16px}.expert-response-panel{padding:24px 18px}}
.attachment-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}.attachment-actions>strong{width:100%}
</style>
