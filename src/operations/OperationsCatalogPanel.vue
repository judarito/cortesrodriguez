<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  token: { type: String, required: true },
  user: { type: Object, required: true },
})

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const catalog = ref({ services: [], specialties: [], experts: [] })
const links = ref([])
const newLink = ref({ label: 'Enlace principal' })
const selectedAgentId = ref('')
const createdLink = ref(null)
const canManageCatalog = computed(() => props.user.permissions?.includes('services.manage'))
const canManageLinks = computed(() => props.user.permissions?.includes('agent_links.manage'))
const origin = window.location.origin

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
    if (canManageCatalog.value) tasks.push(request('/api/app/catalog').then((data) => { catalog.value = data }))
    if (canManageLinks.value) tasks.push(request('/api/app/agent-links').then((data) => { links.value = data.items || [] }))
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
    newLink.value = { label: 'Enlace principal' }
    selectedAgentId.value = ''
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
    <div class="module-heading"><div><p class="eyebrow">Configuración operativa</p><h1>{{ canManageCatalog ? 'Servicios y enlaces' : 'Mis enlaces' }}</h1><p>{{ canManageCatalog ? 'Define la oferta de asesoría y los canales de tus agentes.' : 'Comparte tu enlace para que tus clientes creen solicitudes.' }}</p></div><button type="button" class="secondary-button compact" @click="load">↻ Actualizar</button></div>
    <p v-if="notice" class="security-notice">{{ notice }}</p><p v-if="error" class="request-error">{{ error }}</p>
    <div v-if="loading" class="module-state panel">Cargando configuración…</div>
    <template v-else>
      <div v-if="canManageCatalog" class="catalog-grid">
        <article class="panel catalog-card"><div class="panel-heading"><div><h2>Servicios disponibles</h2><p>Oferta que verá el cliente en el formulario público.</p></div><span class="metric-icon tone-blue">$</span></div><div v-for="service in catalog.services" :key="service.id" class="catalog-service"><div><strong>{{ service.name }}</strong><span>{{ service.description || 'Sin descripción' }}</span></div><span :class="['security-status', { inactive: !service.active }]">{{ service.active ? 'Activo' : 'Inactivo' }}</span><div v-for="item in service.specialties" :key="item.id" class="catalog-specialty"><span>{{ item.specialtyName }}</span><strong>{{ money(item.amountCents, item.currency) }}</strong></div></div><p v-if="!catalog.services.length" class="empty-row">No hay servicios configurados.</p></article>
        <article class="panel catalog-card"><div class="panel-heading"><div><h2>Especialidades</h2><p>Expertos y áreas disponibles para asignación.</p></div><span class="metric-icon tone-violet">EX</span></div><div v-for="specialty in catalog.specialties" :key="specialty.id" class="catalog-specialty-row"><div><strong>{{ specialty.name }}</strong><span>{{ specialty.description || 'Sin descripción' }}</span></div><span class="count-badge">{{ catalog.experts.filter((expert) => expert.specialtyId === specialty.id).length }} expertos</span></div><p v-if="!catalog.specialties.length" class="empty-row">No hay especialidades configuradas.</p></article>
      </div>
      <article v-if="canManageLinks" class="panel catalog-card links-card"><div class="panel-heading"><div><h2>Enlaces de agentes</h2><p>El enlace identifica el origen del cliente y conserva la atribución al agente.</p></div><span class="metric-icon tone-green">↗</span></div><form class="link-form" @submit.prevent="createLink"><label v-if="canManageCatalog">Agente<select v-model="selectedAgentId" required><option value="" disabled>Selecciona un agente</option><option v-for="agent in catalog.agents" :key="agent.id" :value="agent.id">{{ agent.name }} · {{ agent.email }}</option></select></label><label>Nombre del enlace<input v-model="newLink.label" type="text" maxlength="80" required /></label><button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Creando…' : 'Crear enlace' }} <span>→</span></button></form><div v-if="createdLink" class="created-link"><div><strong>{{ createdLink.label }}</strong><span>{{ origin }}{{ createdLink.path }}</span></div><button type="button" class="secondary-button compact" @click="copyLink">Copiar enlace</button></div><div v-for="link in links" :key="link.id" class="link-row"><div class="avatar avatar-table">AG</div><div><strong>{{ link.label }}</strong><span>{{ link.agentName }} · creado {{ new Date(link.createdAt).toLocaleDateString('es-CO') }}</span></div><span :class="['security-status', { inactive: !link.active }]">{{ link.active ? 'Activo' : 'Inactivo' }}</span></div><p v-if="!links.length" class="empty-row">Aún no hay enlaces creados.</p></article>
    </template>
  </section>
</template>

<style scoped>
.catalog-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.catalog-card{padding:20px}.catalog-card h2{margin:0 0 5px;color:#223b53;font-size:14px}.catalog-card p{margin:0;color:#98a2b3;font-size:10px}.catalog-service{display:grid;grid-template-columns:1fr auto;gap:10px;padding:17px 0;border-top:1px solid #f0f2f5}.catalog-service>div:first-child,.catalog-specialty-row>div{display:grid;gap:4px}.catalog-service strong,.catalog-specialty-row strong,.link-row strong,.created-link strong{color:#344b60;font-size:11px}.catalog-service span,.catalog-specialty-row span,.link-row span,.created-link span{color:#98a2b3;font-size:10px}.catalog-specialty{grid-column:1/-1;display:flex;justify-content:space-between;padding:9px 10px;border-radius:6px;background:#f7fafc;color:#526174;font-size:10px}.catalog-specialty strong{color:#397aa2;font-size:10px}.catalog-specialty-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 0;border-top:1px solid #f0f2f5}.links-card{margin-top:16px}.link-form{display:flex;align-items:end;gap:12px;margin:20px 0 13px}.link-form label{display:grid;flex:1;gap:7px;color:#526174;font-size:10px;font-weight:700}.link-form input{min-height:39px;padding:0 10px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff}.link-form .primary-button{min-height:39px;white-space:nowrap}.created-link{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:10px;padding:12px;border:1px solid #cce9db;border-radius:7px;background:#f0faf5}.created-link>div{display:grid;gap:4px;min-width:0}.created-link span{overflow:hidden;color:#39836d;text-overflow:ellipsis;white-space:nowrap}.link-row{display:flex;align-items:center;gap:10px;padding:13px 0;border-top:1px solid #f0f2f5}.link-row>div:nth-child(2){display:grid;flex:1;gap:3px}.link-row .security-status{margin-left:auto}@media(max-width:800px){.catalog-grid{grid-template-columns:1fr}.link-form{align-items:stretch;flex-direction:column}.created-link{align-items:stretch;flex-direction:column}}
.link-form select{min-height:39px;padding:0 10px;border:1px solid #d8e0ea;border-radius:7px;color:#344b60;background:#fff}
.secondary-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid #d8e5ee;border-radius:7px;color:#315b78;background:#fff;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap}.secondary-button:hover{border-color:#9fc1d4;color:#0e4567;background:#f5fafc}.secondary-button.compact{min-height:33px;padding:0 11px}
</style>
