<script setup>
import { computed, onMounted, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({
  token: { type: String, required: true },
  user: { type: Object, required: true },
  section: { type: String, default: 'catalog' },
})

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const catalog = ref({ services: [], specialties: [], experts: [] })
const links = ref([])
const linkSearch = ref('')
const linkPagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const newLink = ref({ label: 'Enlace principal' })
const selectedAgentId = ref('')
const editingConsultationId = ref('')
const consultationFormOpen = ref(false)
const consultationForm = ref({ code: '', name: '', description: '', serviceCode: '', amountCents: 0, currency: 'USD', paymentRequired: true, active: true, expertIds: [] })
const createdLink = ref(null)
const linkFormOpen = ref(false)
const canManageCatalog = computed(() => props.user.permissions?.includes('services.manage'))
const canManageLinks = computed(() => props.user.permissions?.includes('agent_links.manage'))
const showCatalog = computed(() => props.section === 'catalog' && canManageCatalog.value)
const showLinks = computed(() => props.section === 'links' && canManageLinks.value)
const origin = window.location.origin
const consultationOptions = computed(() => catalog.value.services.flatMap((service) => (service.consultations || []).map((consultation) => ({ ...consultation, serviceCode: service.code, serviceName: service.name }))))

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
    const tasks = []
    if (showCatalog.value || (showLinks.value && canManageCatalog.value)) tasks.push(request('/api/app/catalog').then((data) => { catalog.value = data }))
    if (showLinks.value) { const params = new URLSearchParams({ page: String(linkPagination.value.page), pageSize: String(linkPagination.value.pageSize), search: linkSearch.value }); tasks.push(request(`/api/app/agent-links?${params}`).then((data) => { links.value = data.items || []; linkPagination.value = data.pagination || linkPagination.value })) }
    await Promise.all(tasks)
  } catch (loadError) {
    error.value = loadError.message
  } finally {
    loading.value = false
  }
}

async function createLink() {
  saving.value = true
  error.value = ''
  notice.value = ''
  createdLink.value = null
  try {
    const data = await request('/api/app/agent-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newLink.value, ...(canManageCatalog.value && selectedAgentId.value ? { agentId: selectedAgentId.value } : {}) }) })
    createdLink.value = data.link
    notice.value = 'Enlace creado. Cópialo y compártelo con tus clientes.'
    linkFormOpen.value = false
    newLink.value = { label: 'Enlace principal' }
    selectedAgentId.value = ''
    await load()
  } catch (saveError) {
    error.value = saveError.message
  } finally {
    saving.value = false
  }
}

function changeLinkPage(page) {
  if (page < 1 || page > linkPagination.value.totalPages || page === linkPagination.value.page) return
  linkPagination.value.page = page
  load()
}

function searchLinks() {
  linkPagination.value.page = 1
  load()
}

async function revokeLink(link) {
  if (!window.confirm(`¿Revocar el enlace ${link.label}? Los clientes ya no podrán usarlo.`)) return
  saving.value = true
  try { await request(`/api/app/agent-links/${link.id}`, { method: 'DELETE' }); notice.value = 'Enlace revocado correctamente.'; await load() } catch (revokeError) { error.value = revokeError.message } finally { saving.value = false }
}

function editConsultation(item) {
  const source = consultationOptions.value.find((candidate) => candidate.id === item.id)
  if (!source) return
  consultationForm.value = { code: source.consultationCode, name: source.consultationName, description: source.consultationDescription || '', serviceCode: source.serviceCode, amountCents: source.amountCents, currency: source.currency, paymentRequired: true, active: source.active, expertIds: catalog.value.experts.filter((expert) => expert.consultationTypeId === source.consultationId).map((expert) => expert.id) }
  editingConsultationId.value = source.consultationId
  consultationFormOpen.value = true
}

function resetConsultation() {
  editingConsultationId.value = ''
  consultationForm.value = { code: '', name: '', description: '', serviceCode: catalog.value.services[0]?.code || '', amountCents: 0, currency: 'USD', paymentRequired: true, active: true, expertIds: [] }
  consultationFormOpen.value = false
}

function openNewConsultation() {
  editingConsultationId.value = ''
  consultationForm.value = { code: '', name: '', description: '', serviceCode: catalog.value.services[0]?.code || '', amountCents: 0, currency: 'USD', paymentRequired: true, active: true, expertIds: [] }
  consultationFormOpen.value = true
}

async function saveConsultation() {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const url = editingConsultationId.value ? `/api/app/catalog/consultation-types/${editingConsultationId.value}` : '/api/app/catalog/consultation-types'
    await request(url, { method: editingConsultationId.value ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(consultationForm.value) })
    notice.value = 'Tipo de consulta guardado correctamente.'
    resetConsultation()
    await load()
  } catch (saveError) {
    error.value = saveError.message
  } finally {
    saving.value = false
  }
}

async function copyLink() {
  if (!createdLink.value) return
  await navigator.clipboard.writeText(`${origin}${createdLink.value.path}`)
  notice.value = 'Enlace copiado al portapapeles.'
}

function money(amountCents, currency) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amountCents || 0) / 100)
}

onMounted(load)
</script>

<template>
  <section class="module-view catalog-view">
    <div class="module-heading"><div><p class="eyebrow">Configuración operativa</p><h1>{{ showCatalog ? 'Servicios y consultas' : 'Enlaces de agentes' }}</h1><p>{{ showCatalog ? 'Configura la oferta, los precios y los expertos que responden cada consulta.' : 'Crea y comparte enlaces para identificar las solicitudes de cada agente.' }}</p></div><div class="module-heading-actions"><button v-if="showCatalog" type="button" class="primary-button compact" @click="openNewConsultation">+ Nueva consulta</button><button type="button" class="secondary-button compact" @click="load">↻ Actualizar</button></div></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error">{{ error }}</p>
    <div v-if="loading" class="module-state panel">Cargando configuración…</div>
    <template v-else>
      <div v-if="showCatalog" class="catalog-grid">
        <article class="panel catalog-card consultation-editor"><div class="panel-heading"><div><h2>{{ editingConsultationId ? 'Editar tipo de consulta' : 'Nuevo tipo de consulta' }}</h2><p>Define precio y expertos disponibles para responder.</p></div><span class="metric-icon tone-violet">CO</span></div><form class="consultation-form" @submit.prevent="saveConsultation"><label>Código<input v-model="consultationForm.code" :disabled="Boolean(editingConsultationId)" pattern="[a-z][a-z0-9_-]{2,50}" placeholder="consulta_basica" required /></label><label>Servicio general<select v-model="consultationForm.serviceCode" required><option value="" disabled>Selecciona un servicio</option><option v-for="service in catalog.services" :key="service.id" :value="service.code">{{ service.name }}</option></select></label><label>Nombre<input v-model="consultationForm.name" required placeholder="Consulta básica" /></label><label>Precio<input v-model.number="consultationForm.amountCents" type="number" min="0" step="1" required /></label><label>Moneda<select v-model="consultationForm.currency"><option value="USD">USD</option><option value="COP">COP</option></select></label><label class="full-label">Descripción<textarea v-model="consultationForm.description" rows="3" required placeholder="Describe qué incluye la consulta."></textarea></label><fieldset class="expert-picker"><legend>Expertos asociados</legend><label v-for="expert in catalog.allExperts" :key="expert.id" class="expert-option"><input v-model="consultationForm.expertIds" type="checkbox" :value="expert.id" /><span>{{ expert.name }}<small>{{ expert.email }}</small></span></label><small v-if="!catalog.allExperts?.length" class="empty-inline">Primero crea usuarios con rol Experto.</small></fieldset><div class="consultation-actions"><button type="button" class="secondary-button compact" @click="resetConsultation">Limpiar</button><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar consulta' }} <span>→</span></button></div></form></article>
        <article class="panel catalog-card"><div class="panel-heading"><div><h2>Servicios generales</h2><p>Clasificación principal de la operación aduanera.</p></div><span class="metric-icon tone-blue">$</span></div><div v-for="service in catalog.services" :key="service.id" class="catalog-service"><div><strong>{{ service.name }}</strong><span>{{ service.description || 'Sin descripción' }}</span></div><span :class="['security-status', { inactive: !service.active }]">{{ service.active ? 'Activo' : 'Inactivo' }}</span><div v-for="item in service.consultations" :key="item.id" class="catalog-specialty"><span>{{ item.consultationName }}</span><strong>{{ money(item.amountCents, item.currency) }}</strong></div></div><p v-if="!catalog.services.length" class="empty-row">No hay servicios configurados.</p></article>
        <article class="panel catalog-card"><div class="panel-heading"><div><h2>Tipos de consulta</h2><p>Haz clic en una consulta para editar su precio y expertos.</p></div><span class="metric-icon tone-violet">EX</span></div><button v-for="consultation in catalog.consultationTypes" :key="consultation.id" type="button" class="catalog-specialty-row catalog-specialty-button" @click="editConsultation(consultation)"><span><strong>{{ consultation.name }}</strong><small>{{ consultation.description || 'Sin descripción' }}</small></span><span class="count-badge">{{ catalog.experts.filter((expert) => expert.consultationTypeId === consultation.id).length }} expertos</span></button><p v-if="!catalog.consultationTypes?.length" class="empty-row">No hay tipos de consulta configurados.</p></article>
      </div>
      <ListView v-if="showLinks" title="Enlaces de agentes" description="Cada enlace identifica el origen del cliente y conserva la atribución al agente." :count="linkPagination.totalItems" :page="linkPagination.page" :total-pages="linkPagination.totalPages" :empty="!links.length" empty-text="Aún no hay enlaces creados." @previous="changeLinkPage(linkPagination.page - 1)" @next="changeLinkPage(linkPagination.page + 1)"><template #actions><button type="button" class="primary-button compact" @click="linkFormOpen = !linkFormOpen">+ Crear enlace</button></template><template #toolbar><form v-if="linkFormOpen" class="link-form" @submit.prevent="createLink"><label v-if="canManageCatalog">Agente<select v-model="selectedAgentId" required><option value="" disabled>Selecciona un agente</option><option v-for="agent in catalog.agents" :key="agent.id" :value="agent.id">{{ agent.name }} · {{ agent.email }}</option></select></label><label>Nombre del enlace<input v-model="newLink.label" type="text" maxlength="80" required /></label><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Creando…' : 'Guardar enlace' }} <span>→</span></button></form><form class="module-search" @submit.prevent="searchLinks"><span>⌕</span><input v-model="linkSearch" type="search" placeholder="Buscar por enlace o agente..." /><button type="submit">Buscar</button></form><div v-if="createdLink" class="created-link"><div><strong>{{ createdLink.label }}</strong><span>{{ origin }}{{ createdLink.path }}</span></div><button type="button" class="secondary-button compact" @click="copyLink">Copiar enlace</button></div></template><template #columns><th>Enlace</th><th>Agente</th><th>Estado</th><th>Creado</th><th>Acciones</th></template><template #rows><tr v-for="link in links" :key="link.id"><td><strong>{{ link.label }}</strong></td><td>{{ link.agentName }}<br /><span class="muted-cell">{{ link.agentEmail }}</span></td><td><span :class="['security-status', { inactive: !link.active }]">{{ link.active ? 'Activo' : 'Revocado' }}</span></td><td>{{ new Date(link.createdAt).toLocaleDateString('es-CO') }}</td><td><button v-if="link.active" type="button" class="danger-link" @click="revokeLink(link)">Revocar</button></td></tr></template></ListView>
    </template>
  </section>
</template>

<style scoped>
.catalog-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.catalog-card{padding:20px}.catalog-card h2{margin:0 0 5px;color:#223b53;font-size:14px}.catalog-card p{margin:0;color:#98a2b3;font-size:10px}.catalog-service{display:grid;grid-template-columns:1fr auto;gap:10px;padding:17px 0;border-top:1px solid #f0f2f5}.catalog-service>div:first-child,.catalog-specialty-row>div{display:grid;gap:4px}.catalog-service strong,.catalog-specialty-row strong,.link-row strong,.created-link strong{color:#344b60;font-size:11px}.catalog-service span,.catalog-specialty-row span,.link-row span,.created-link span{color:#98a2b3;font-size:10px}.catalog-specialty{grid-column:1/-1;display:flex;justify-content:space-between;padding:9px 10px;border-radius:6px;background:#f7fafc;color:#526174;font-size:10px}.catalog-specialty strong{color:#397aa2;font-size:10px}.catalog-specialty-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 0;border-top:1px solid #f0f2f5}.links-card{margin-top:16px}.link-form{display:flex;align-items:end;gap:12px;margin:20px 0 13px}.link-form label{display:grid;flex:1;gap:7px;color:#526174;font-size:10px;font-weight:700}.link-form input{min-height:39px;padding:0 10px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff}.link-form .primary-button{min-height:39px;white-space:nowrap}.created-link{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:10px;padding:12px;border:1px solid #cce9db;border-radius:7px;background:#f0faf5}.created-link>div{display:grid;gap:4px;min-width:0}.created-link span{overflow:hidden;color:#39836d;text-overflow:ellipsis;white-space:nowrap}.link-row{display:flex;align-items:center;gap:10px;padding:13px 0;border-top:1px solid #f0f2f5}.link-row>div:nth-child(2){display:grid;flex:1;gap:3px}.link-row .security-status{margin-left:auto}@media(max-width:800px){.catalog-grid{grid-template-columns:1fr}.link-form{align-items:stretch;flex-direction:column}.created-link{align-items:stretch;flex-direction:column}}
.link-form select{min-height:39px;padding:0 10px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff}
.secondary-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid #d8e5ee;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap}.secondary-button:hover{border-color:#9fc1d4;color:#0e4567;background:#f5fafc}.secondary-button.compact{min-height:33px;padding:0 11px}
.consultation-editor{grid-column:1/-1}.consultation-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.consultation-form label{display:grid;gap:6px;color:#526174;font-size:10px;font-weight:700}.consultation-form input,.consultation-form select,.consultation-form textarea{min-height:38px;padding:8px 10px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff;font-size:11px}.consultation-form textarea{resize:vertical}.full-label{grid-column:1/-1}.expert-picker{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:0;padding:10px;border:1px solid #e5eaf0;border-radius:7px}.expert-picker legend{grid-column:1/-1;padding:0 0 6px;border:0;font-size:10px}.expert-option{display:flex!important;grid-template-columns:auto 1fr!important;gap:7px!important;padding:7px;border-radius:5px;background:#f8fafc}.expert-option input{min-height:auto}.expert-option span{display:grid;gap:2px}.expert-option small{color:#98a2b3;font-size:9px;font-weight:400}.consultation-actions{display:flex;justify-content:flex-end;gap:8px;grid-column:1/-1}.catalog-specialty-button{width:100%;border:0;text-align:left;background:transparent;cursor:pointer}.catalog-specialty-button:hover{background:#eef6fa}.catalog-specialty-button>span:first-child{display:grid;gap:4px}.catalog-specialty-button small{color:#98a2b3;font-size:10px}@media(max-width:800px){.consultation-form{grid-template-columns:1fr}.expert-picker{grid-template-columns:1fr}}
.consultation-editor{grid-row:3}
.module-heading-actions{display:flex;align-items:center;gap:8px}
</style>
