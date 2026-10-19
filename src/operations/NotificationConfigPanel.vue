<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({ token: { type: String, required: true } })
const tab = ref('recipients')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const recipients = ref([])
const rules = ref([])
const recipientPagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const rulePagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const recipient = ref({ name: '', email: '', recipientType: 'to' })
const rule = ref({ name: '', eventCode: 'payment_approved', serviceType: 'all', audiences: ['configured'], recipientIds: [] })

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${props.token}`, ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.')
  return data
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ recipientPage: String(recipientPagination.value.page), rulePage: String(rulePagination.value.page) })
    const data = await request(`/api/app/settings/notifications?${params}`)
    recipients.value = data.recipients || []
    rules.value = data.rules || []
    recipientPagination.value = data.recipientPagination || recipientPagination.value
    rulePagination.value = data.rulePagination || rulePagination.value
  } catch (loadError) { error.value = loadError.message } finally { loading.value = false }
}

async function saveRecipient() {
  saving.value = true; error.value = ''; notice.value = ''
  try { await request('/api/app/settings/notification-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipient.value) }); recipient.value = { name: '', email: '', recipientType: 'to' }; notice.value = 'Destinatario guardado correctamente.'; await load() } catch (saveError) { error.value = saveError.message } finally { saving.value = false }
}

async function saveRule() {
  saving.value = true; error.value = ''; notice.value = ''
  try { await request('/api/app/settings/notification-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule.value) }); rule.value = { name: '', eventCode: 'payment_approved', serviceType: 'all', audiences: ['configured'], recipientIds: [] }; notice.value = 'Regla guardada correctamente.'; await load() } catch (saveError) { error.value = saveError.message } finally { saving.value = false }
}
async function removeRecipient(item) { if (!window.confirm(`¿Eliminar el destinatario ${item.email}?`)) return; try { await request(`/api/app/settings/notification-recipients/${item.id}`, { method: 'DELETE' }); notice.value = 'Destinatario eliminado.'; await load() } catch (removeError) { error.value = removeError.message } }
async function removeRule(item) { if (!window.confirm(`¿Eliminar la regla ${item.name}? Esta acción no se puede deshacer.`)) return; try { await request(`/api/app/settings/notification-rules/${item.id}`, { method: 'DELETE' }); notice.value = 'Regla eliminada.'; await load() } catch (removeError) { error.value = removeError.message } }
function changePage(kind, value) { const target = kind === 'recipients' ? recipientPagination : rulePagination; if (value < 1 || value > target.value.totalPages) return; target.value.page = value; load() }
const audienceLabels = { configured: 'administración', client: 'cliente', agent: 'agente', expert: 'experto', all_involved: 'todos los involucrados' }
function audienceLabel(audiences) { return (audiences || []).map((value) => audienceLabels[value] || value).join(', ') }

onMounted(load)
</script>

<template>
  <section class="module-view security-view notification-config-view">
    <div class="module-heading"><div><p class="eyebrow">Preferencias operativas</p><h1>Configuración</h1><p>Organiza destinatarios y reglas de comunicación sin mezclar formularios.</p></div><button type="button" class="secondary-button compact" @click="load">↻ Actualizar</button></div>
    <div class="security-tabs"><button type="button" :class="{ active: tab === 'recipients' }" @click="tab = 'recipients'">Destinatarios <span>{{ recipientPagination.totalItems }}</span></button><button type="button" :class="{ active: tab === 'rules' }" @click="tab = 'rules'">Reglas <span>{{ rulePagination.totalItems }}</span></button></div><div class="notification-pagination"><span>Página {{ tab === 'recipients' ? recipientPagination.page : rulePagination.page }} de {{ tab === 'recipients' ? recipientPagination.totalPages : rulePagination.totalPages }}</span><div><button type="button" :disabled="(tab === 'recipients' ? recipientPagination.page : rulePagination.page) <= 1" @click="changePage(tab, (tab === 'recipients' ? recipientPagination.page : rulePagination.page) - 1)">Anterior</button><button type="button" :disabled="(tab === 'recipients' ? recipientPagination.page : rulePagination.page) >= (tab === 'recipients' ? recipientPagination.totalPages : rulePagination.totalPages)" @click="changePage(tab, (tab === 'recipients' ? recipientPagination.page : rulePagination.page) + 1)">Siguiente</button></div></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error">{{ error }}</p><div v-if="loading" class="module-state panel">Cargando configuración…</div>
    <div v-else-if="tab === 'recipients'" class="security-grid"><form class="panel security-form" @submit.prevent="saveRecipient"><div class="panel-heading"><div><h2>Agregar destinatario</h2><p>Correo que podrá recibir notificaciones.</p></div><span class="metric-icon tone-blue">@</span></div><label>Nombre<input v-model="recipient.name" type="text" placeholder="Equipo de operaciones" required /></label><label>Correo electrónico<input v-model="recipient.email" type="email" placeholder="operaciones@empresa.com" required /></label><label>Tipo de copia<select v-model="recipient.recipientType"><option value="to">Para</option><option value="cc">Copia (CC)</option><option value="bcc">Copia oculta (CCO)</option></select></label><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Agregar destinatario' }} <span>→</span></button></form><article class="panel security-list"><div class="panel-heading"><div><h2>Destinatarios configurados</h2><p>{{ recipients.length }} correos disponibles.</p></div></div><div v-if="!recipients.length" class="empty-row">Aún no hay destinatarios.</div><div v-for="item in recipients" :key="item.id" class="security-list-item"><div class="avatar avatar-table">@</div><div><strong>{{ item.name }}</strong><span>{{ item.email }}</span></div><div class="security-item-meta"><span class="security-status">{{ item.recipientType.toUpperCase() }}</span><small>{{ item.active ? 'Activo' : 'Inactivo' }}</small><button type="button" class="danger-link" @click="removeRecipient(item)">Eliminar</button></div></div></article></div>
    <div v-else class="notification-rules-layout"><form class="panel security-form rule-form" @submit.prevent="saveRule"><div class="panel-heading"><div><h2>Nueva regla de notificación</h2><p>Relaciona un evento con un tipo de servicio y destinatarios.</p></div><span class="metric-icon tone-violet">↗</span></div><label>Nombre de la regla<input v-model="rule.name" type="text" placeholder="Solicitud creada - Importaciones" required /></label><label>Evento<select v-model="rule.eventCode"><option value="payment_approved">Pago aprobado</option><option value="payment_rejected">Pago rechazado</option><option value="request_created">Solicitud creada</option><option value="status_changed">Cambio de estado</option><option value="expert_response_submitted">Respuesta de experto pendiente</option><option value="feedback_received">Feedback recibido</option><option value="feedback_low">Feedback con baja calificación</option></select></label><label>Tipo de servicio<select v-model="rule.serviceType"><option value="all">Todos</option><option value="importacion">Importación</option><option value="exportacion">Exportación</option><option value="agente_carga">Agente de carga</option></select></label><fieldset class="permission-picker audience-picker"><legend>Enviar también a</legend><label class="permission-option"><input v-model="rule.audiences" type="checkbox" value="configured" /><span><strong>Administración</strong><small>Destinatarios configurados</small></span></label><label class="permission-option"><input v-model="rule.audiences" type="checkbox" value="client" /><span><strong>Cliente</strong><small>Correo de la solicitud</small></span></label><label class="permission-option"><input v-model="rule.audiences" type="checkbox" value="agent" /><span><strong>Agente de origen</strong><small>Solo si la solicitud viene de un agente</small></span></label><label class="permission-option"><input v-model="rule.audiences" type="checkbox" value="expert" /><span><strong>Experto asignado</strong><small>Solo si tiene experto asignado</small></span></label></fieldset><fieldset class="permission-picker recipient-picker"><legend>Destinatarios de administración</legend><label v-for="item in recipients" :key="item.id" class="permission-option"><input v-model="rule.recipientIds" type="checkbox" :value="item.id" /><span><strong>{{ item.name }}</strong><small>{{ item.email }}</small></span></label><small v-if="!recipients.length" class="empty-inline">Agrega destinatarios primero.</small></fieldset><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar regla' }} <span>→</span></button></form><article class="panel security-list"><div class="panel-heading"><div><h2>Reglas activas</h2><p>{{ rules.length }} reglas configuradas.</p></div></div><div v-if="!rules.length" class="empty-row">Aún no hay reglas configuradas.</div><div v-for="item in rules" :key="item.id" class="security-list-item"><div class="metric-icon tone-violet">↗</div><div><strong>{{ item.name }}</strong><span>{{ item.eventCode }} · {{ item.serviceType }} · {{ audienceLabel(item.audiences) }}</span></div><div class="security-item-meta"><span class="security-status">{{ item.active ? 'Activa' : 'Inactiva' }}</span><small>{{ item.recipients.length }} destinatario(s)</small><button type="button" class="danger-link" @click="removeRule(item)">Eliminar</button></div></div></article></div>
  </section>
</template>

<style scoped>
.notification-rules-layout{display:grid;grid-template-columns:minmax(280px,.7fr) minmax(0,1.3fr);gap:16px}.notification-rules-layout .security-form{padding:20px}.notification-rules-layout .security-list{padding:20px}@media(max-width:980px){.notification-rules-layout{grid-template-columns:1fr}}
.notification-pagination{display:flex;justify-content:space-between;align-items:center;margin:12px 0;color:#98a2b3;font-size:10px}.notification-pagination>div{display:flex;gap:7px}.notification-pagination button{padding:7px 10px;border:1px solid #dce5ed;border-radius:6px;color:#526174;background:#fff;font-size:10px}.notification-pagination button:disabled{opacity:.45;cursor:not-allowed}
</style>
