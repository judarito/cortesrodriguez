<script setup>
import { onMounted, ref, watch } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({ token: { type: String, required: true }, openRequestId: { type: String, default: '' }, refreshKey: { type: Number, default: 0 } })
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

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${props.token}`, ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.')
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

async function submitResponse() {
  if (!selected.value || !responseBody.value.trim()) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await request(`/api/app/expert/requests/${selected.value.id}/response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: responseBody.value }) })
    notice.value = 'Respuesta enviada a revisión administrativa.'
    close()
    await load()
  } catch (saveError) { error.value = saveError.message } finally { saving.value = false }
}

function responseLabel(status) {
  return { none: 'Sin respuesta', draft: 'Borrador', pending_admin_review: 'En revisión', rejected: 'Devuelta', approved: 'Aprobada', sent: 'Enviada' }[status] || status
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
    <div class="module-heading"><div><p class="eyebrow">Bandeja de experto</p><h1>Solicitudes asignadas</h1><p>Responde únicamente las preguntas de tu especialidad. Los datos del cliente están protegidos.</p></div><button type="button" class="secondary-button compact" @click="load">↻ Actualizar</button></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error">{{ error }}</p>
    <ListView title="Mis solicitudes" description="Casos asignados para revisión y respuesta." :count="pagination.totalItems" :page="pagination.page" :total-pages="pagination.totalPages" :loading="loading" :empty="!items.length && !loading" empty-text="No tienes solicitudes asignadas." @previous="load(page - 1)" @next="load(page + 1)"><template #toolbar><form class="expert-search" @submit.prevent="load(1)"><span>⌕</span><input v-model="search" type="search" placeholder="Buscar por referencia o pregunta..." /><button type="submit">Buscar</button></form></template><template #columns><th>Solicitud</th><th>Consulta</th><th>Pregunta</th><th>Adjuntos</th><th>Respuesta</th><th>Acción</th></template><template #rows><tr v-for="item in items" :key="item.id"><td><strong class="request-id">{{ item.reference }}</strong><br /><span class="muted-cell">{{ new Date(item.createdAt).toLocaleDateString('es-CO') }}</span></td><td><strong>{{ item.consultationType || 'Consulta' }}</strong><br /><span class="muted-cell">{{ item.serviceName || item.serviceType }}</span></td><td class="question-cell">{{ item.question }}</td><td><span class="count-badge">{{ item.attachmentCount }}</span></td><td><span class="security-status" :class="{ inactive: item.responseStatus === 'rejected' }">{{ responseLabel(item.responseStatus) }}</span></td><td><button type="button" class="secondary-button compact" @click="open(item)">Responder</button></td></tr></template></ListView>
    <div v-if="selected" class="expert-response-backdrop" @click.self="close"><form class="expert-response-panel" @submit.prevent="submitResponse"><div class="panel-heading"><div><p class="eyebrow">{{ selected.reference }}</p><h2>{{ selected.consultationType || 'Solicitud de asesoría' }}</h2><p>{{ selected.serviceName }}</p></div><button type="button" class="secondary-button compact" @click="close">Cerrar</button></div><div class="question-box"><strong>Pregunta del cliente</strong><p>{{ selected.question }}</p><small v-if="selected.attachmentCount">{{ selected.attachmentCount }} imagen(es) adjunta(s) disponibles según autorización.</small></div><label>Respuesta para revisión administrativa<textarea v-model="responseBody" rows="9" maxlength="20000" placeholder="Redacta la orientación técnica para que administración la revise..." required></textarea></label><div class="form-actions"><button type="button" class="secondary-button compact" @click="close">Cancelar</button><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Enviando…' : 'Enviar a revisión' }} <span>→</span></button></div></form></div>
  </section>
</template>

<style scoped>
.expert-requests-view .secondary-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid #d8e5ee;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap}.expert-requests-view .secondary-button:hover{background:#f7fafc;border-color:#c6d9e5}.expert-requests-view .secondary-button:disabled{opacity:.55;cursor:not-allowed}
.expert-requests-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.expert-requests-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.expert-requests-view .module-heading p:last-child{margin:0;color:#7d8999;font-size:13px}.expert-search{display:flex;align-items:center;gap:8px;margin:0;padding:0 8px 0 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.expert-search input{flex:1;min-height:40px;padding:0;border:0;outline:0;box-shadow:none;font-size:11px}.expert-search button{min-height:30px;padding:0 12px;border:0;border-radius:6px;color:#fff;background:#0e4567;font-size:10px;font-weight:800;cursor:pointer}.question-cell{max-width:320px;white-space:normal!important;line-height:1.45}.expert-response-backdrop{position:fixed;inset:0;z-index:30;display:flex;justify-content:flex-end;background:rgba(9,30,48,.28)}.expert-response-panel{width:min(640px,100%);height:100%;overflow:auto;display:grid;align-content:start;gap:18px;margin:0;padding:36px;background:#fff;box-shadow:-14px 0 35px rgba(16,39,59,.14)}.expert-response-panel h2{margin:0 0 5px;color:#223b53;font-size:20px}.expert-response-panel .panel-heading p:last-child{margin:0;color:#98a2b3;font-size:10px}.question-box{padding:16px;border:1px solid #dce7f0;border-radius:8px;background:#f6fafc}.question-box strong{color:#223b53;font-size:11px}.question-box p{margin:9px 0 0;color:#526174;font-size:12px;line-height:1.6}.question-box small{display:block;margin-top:11px;color:#397aa2;font-size:10px}.expert-response-panel label{display:grid;gap:8px;color:#526174;font-size:10px;font-weight:800}.expert-response-panel textarea{width:100%;padding:12px;border:1px solid #d8e0ea;border-radius:7px;outline:0;color:#344b60;background:#fff;font:inherit;font-size:12px;line-height:1.5;resize:vertical}.form-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:720px){.expert-requests-view .module-heading{display:block}.expert-requests-view .module-heading .secondary-button{margin-top:16px}.expert-response-panel{padding:24px 18px}}
</style>
