<script setup>
import { computed, onMounted, ref } from 'vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'
import OperationsCatalogPanel from './OperationsCatalogPanel.vue'
import ListView from '../shared/components/ListView.vue'
import NotificationConfigPanel from './NotificationConfigPanel.vue'
import SecurityPanel from './SecurityPanel.vue'
import ExpertRequestsPanel from './ExpertRequestsPanel.vue'
import ResponseReviewPanel from './ResponseReviewPanel.vue'
import SimilarQuestionPanel from './SimilarQuestionPanel.vue'

const token = ref(localStorage.getItem('operationsToken') || '')
const user = ref(JSON.parse(localStorage.getItem('operationsUser') || 'null'))
const form = ref({ email: '', password: '' })
const loading = ref(false)
const sessionChecking = ref(Boolean(token.value))
const error = ref('')
const activeMenu = ref('Inicio')
const mobileMenuOpen = ref(false)
const moduleLoading = ref(false)
const moduleError = ref('')
const clients = ref([])
const requests = ref([])
const requestDetail = ref(null)
const requestDetailLoading = ref(false)
const requestDetailError = ref('')
const assignmentExpertId = ref('')
const assignmentSaving = ref(false)
const requestCount = ref(0)
const clientSearch = ref('')
const requestSearch = ref('')
const requestFiltersOpen = ref(false)
const requestFilters = ref({ status: '', serviceType: '', source: '', agentId: '', dateFrom: '', dateTo: '' })
const requestAgents = ref([])
const agentFormOpen = ref(false)
const agentFormLoading = ref(false)
const agentFormError = ref('')
const agentFormNotice = ref('')
const agentForm = ref({ fullName: '', legalEntityType: '', email: '', phone: '', whatsapp: '', serviceType: '', freightAgent: '', productType: '' })
const clientPagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const requestPagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const dashboardLoading = ref(false)
const dashboardError = ref('')
const securityLoading = ref(false)
const securityError = ref('')
const securityNotice = ref('')
const securityTab = ref('users')
const securityUsers = ref([])
const securityRoles = ref([])
const securityPermissions = ref([])
const securityUserForm = ref({ fullName: '', email: '', password: '', roleName: '' })
const securityRoleForm = ref({ name: '', label: '', permissions: [] })
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationNotice = ref('')
const notificationRecipients = ref([])
const notificationRules = ref([])
const notificationTab = ref('recipients')
const serviceConfig = ref({ name: 'Asesoría personalizada', amount: 0, currency: 'COP' })
const emailSendingId = ref('')
const recipientForm = ref({ name: '', email: '', recipientType: 'to' })
const ruleForm = ref({ name: '', eventCode: 'payment_approved', serviceType: 'all', recipientIds: [] })

const menuItems = [
  { label: 'Inicio', permission: 'dashboard.read', icon: '⌂' },
  { label: 'Clientes', permission: 'clients.read', icon: 'CL' },
  { label: 'Solicitudes', permission: 'requests.read', icon: 'SO' },
  { label: 'Pagos', permission: 'payments.read', icon: '$' },
  { label: 'Documentos', permission: 'documents.read', icon: 'DO' },
  { label: 'Reportes', permission: 'reports.read', icon: 'RE' },
  { label: 'Usuarios y roles', permission: 'users.manage', icon: 'US' },
  { label: 'Configuración', permission: 'settings.manage', icon: '⚙' },
  { label: 'Servicios y consultas', permission: 'services.manage', icon: 'SV' },
  { label: 'Enlaces de agentes', permission: 'agent_links.manage', icon: 'AG' },
  { label: 'Solicitudes asignadas', permission: 'expert_requests.read', icon: 'EX' },
  { label: 'Revisión de respuestas', permission: 'responses.review', icon: 'RV' },
  { label: 'Preguntas similares', permission: 'responses.similarity.review', icon: 'QS' },
]
const visibleMenu = computed(() => menuItems.filter((item) => user.value?.permissions?.includes(item.permission) || (item.label === 'Preguntas similares' && user.value?.roles?.includes('admin'))))
const isAuthenticated = computed(() => Boolean(token.value && user.value))
const isAgent = computed(() => user.value?.roles?.includes('agent'))
const isAdmin = computed(() => user.value?.roles?.includes('admin'))
const isExpert = computed(() => user.value?.roles?.includes('expert') && !user.value?.roles?.includes('admin'))
const currentMenu = computed(() => visibleMenu.value.find((item) => item.label === activeMenu.value) || visibleMenu.value[0])

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function labelValue(value) {
  const labels = {
    natural: 'Persona natural', juridica: 'Persona jurídica',
    importacion: 'Importación', exportacion: 'Exportación', agente_carga: 'Agente de carga',
    vehiculos: 'Vehículos', mercancias: 'Mercancías',
    pending: 'Pendiente', in_review: 'En revisión', in_progress: 'En gestión', closed: 'Cerrada', cancelled: 'Cancelada',
    draft: 'Borrador', pending_admin_review: 'Pendiente de revisión', rejected: 'Devuelta al experto', approved: 'Aprobada', sent: 'Enviada al cliente',
  }
  return labels[value] || value
}

function paymentLabel(status) {
  return { approved: 'Pagado', pending: 'Pendiente', cancelled: 'Cancelado' }[status] || labelValue(status)
}

function sourceLabel(value) {
  return { direct_web: 'Página web', agent_link: 'Agente' }[value] || (value === 'agent' ? 'Agente' : 'Página web')
}

function notificationLabel(status) {
  return { not_sent: 'Sin enviar', accepted: 'Aceptado', sent: 'Enviado', delivered: 'Entregado', opened: 'Abierto', failed: 'Fallido' }[status] || 'Sin enviar'
}

function notificationClass(status) {
  if (status === 'opened' || status === 'delivered') return 'status-green'
  if (status === 'sent' || status === 'accepted') return 'status-blue'
  if (status === 'failed') return 'status-red'
  return 'status-amber'
}

function statusClass(status) {
  if (status === 'closed' || status === 'approved') return 'status-green'
  if (status === 'in_progress') return 'status-blue'
  if (status === 'cancelled') return 'status-red'
  return 'status-amber'
}

function clearSession() {
  token.value = ''
  user.value = null
  localStorage.removeItem('operationsToken')
  localStorage.removeItem('operationsUser')
}

function redirectToLogin() {
  clearSession()
  if (window.location.pathname !== '/app/login') window.location.assign('/app/login')
}

async function appFetch(input, options) {
  const response = await fetch(input, options)
  if (response.status === 401) redirectToLogin()
  return response
}

async function loadModule(module, page = 1) {
  const isClients = module === 'Clientes'
  const search = isClients ? clientSearch.value.trim() : requestSearch.value.trim()
  const pagination = isClients ? clientPagination.value : requestPagination.value
  activeMenu.value = module
  moduleLoading.value = true
  moduleError.value = ''
  try {
    const path = isClients ? '/api/app/clients' : '/api/app/requests'
    const params = new URLSearchParams({ page: String(page), pageSize: String(pagination.pageSize), search })
    if (!isClients) Object.entries(requestFilters.value).forEach(([key, value]) => { if (value) params.set(key, value) })
    const response = await appFetch(`${path}?${params.toString()}`, { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los datos.')
    if (isClients) {
      clients.value = data.items || []
      clientPagination.value = data.pagination || clientPagination.value
    } else {
      requests.value = data.items || []
      requestPagination.value = data.pagination || requestPagination.value
      requestCount.value = Number(requestPagination.value.totalItems || 0)
      requestAgents.value = data.filters?.agents || requestAgents.value
    }
  } catch (loadError) {
    moduleError.value = loadError.message
  } finally {
    moduleLoading.value = false
  }
}

async function selectMenu(item) {
  activeMenu.value = item.label
  mobileMenuOpen.value = false
  if (item.label === 'Inicio') await loadDashboard()
  if (item.label === 'Clientes' || item.label === 'Solicitudes') await loadModule(item.label, 1)
  if (item.label === 'Usuarios y roles') await loadSecurity()
  if (item.label === 'Configuración') await loadNotifications()
}

async function loadNotifications() {
  notificationLoading.value = true
  notificationError.value = ''
  try {
    const response = await appFetch('/api/app/settings/notifications', { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la configuración.')
    notificationRecipients.value = data.recipients || []
    notificationRules.value = data.rules || []
    if (data.service) serviceConfig.value = { name: data.service.name, amount: Number(data.service.amountCents || 0) / 100, currency: data.service.currency || 'COP' }
  } catch (loadError) { notificationError.value = loadError.message } finally { notificationLoading.value = false }
}

async function saveServiceConfig() {
  notificationNotice.value = ''
  notificationError.value = ''
  try {
    const response = await appFetch('/api/app/settings/service', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify({ amountCents: Math.round(Number(serviceConfig.value.amount || 0) * 100), currency: serviceConfig.value.currency }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el valor del servicio.')
    serviceConfig.value = { name: data.service.name, amount: Number(data.service.amountCents || 0) / 100, currency: data.service.currency }
    notificationNotice.value = 'Valor del servicio actualizado correctamente.'
  } catch (saveError) { notificationError.value = saveError.message }
}

async function createNotificationRecipient() {
  notificationNotice.value = ''
  notificationError.value = ''
  try {
    const response = await appFetch('/api/app/settings/notification-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify(recipientForm.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el destinatario.')
    notificationNotice.value = 'Destinatario guardado correctamente.'
    recipientForm.value = { name: '', email: '', recipientType: 'to' }
    await loadNotifications()
  } catch (createError) { notificationError.value = createError.message }
}

async function createNotificationRule() {
  notificationNotice.value = ''
  notificationError.value = ''
  try {
    const response = await appFetch('/api/app/settings/notification-rules', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify(ruleForm.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la regla.')
    notificationNotice.value = 'Regla de notificación guardada correctamente.'
    ruleForm.value = { name: '', eventCode: 'payment_approved', serviceType: 'all', recipientIds: [] }
    await loadNotifications()
  } catch (createError) { notificationError.value = createError.message }
}

async function sendRequestNotification(item) {
  emailSendingId.value = item.id
  try {
    const response = await appFetch(`/api/app/requests/${item.id}/notifications`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify({ eventCode: 'status_changed' }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo enviar el correo.')
    if (!data.sent) throw new Error('No hay una regla activa para este tipo de servicio.')
    item.notificationStatus = 'accepted'
  } catch (sendError) {
    moduleError.value = sendError.message
  } finally {
    emailSendingId.value = ''
  }
}

async function openRequestDetail(item) {
  requestDetail.value = null
  requestDetailError.value = ''
  requestDetailLoading.value = true
  try {
    const response = await appFetch(`/api/app/requests/${item.id}`, { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el detalle de la solicitud.')
    requestDetail.value = data
    assignmentExpertId.value = data.assignment?.expertId || ''
  } catch (detailError) {
    requestDetailError.value = detailError.message
  } finally {
    requestDetailLoading.value = false
  }
}

async function assignRequestExpert() {
  if (!requestDetail.value || !assignmentExpertId.value) return
  assignmentSaving.value = true
  requestDetailError.value = ''
  const requestId = requestDetail.value.request.id
  try {
    const response = await appFetch(`/api/app/requests/${requestId}/assignment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify({ expertId: assignmentExpertId.value }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo asignar el experto.')
    await openRequestDetail({ id: requestId })
    await loadModule('Solicitudes', requestPagination.value.page)
  } catch (assignError) {
    requestDetailError.value = assignError.message
  } finally {
    assignmentSaving.value = false
  }
}

function closeRequestDetail() {
  requestDetail.value = null
  requestDetailError.value = ''
}

async function loadSecurity() {
  securityLoading.value = true
  securityError.value = ''
  try {
    const [usersResponse, rolesResponse] = await Promise.all([
      appFetch('/api/app/security/users', { headers: { Authorization: `Bearer ${token.value}` } }),
      appFetch('/api/app/security/roles', { headers: { Authorization: `Bearer ${token.value}` } }),
    ])
    const usersData = await usersResponse.json().catch(() => ({}))
    const rolesData = await rolesResponse.json().catch(() => ({}))
    if (!usersResponse.ok) throw new Error(usersData.error || 'No se pudieron cargar los usuarios.')
    if (!rolesResponse.ok) throw new Error(rolesData.error || 'No se pudieron cargar los roles.')
    securityUsers.value = usersData.items || []
    securityRoles.value = rolesData.items || []
    securityPermissions.value = rolesData.permissions || []
    if (!securityUserForm.value.roleName && securityRoles.value.length) securityUserForm.value.roleName = securityRoles.value[0].name
  } catch (loadError) { securityError.value = loadError.message } finally { securityLoading.value = false }
}

async function createSecurityUser() {
  securityNotice.value = ''
  securityError.value = ''
  try {
    const response = await appFetch('/api/app/security/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify(securityUserForm.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo crear el usuario.')
    securityNotice.value = 'Usuario creado correctamente.'
    securityUserForm.value = { fullName: '', email: '', password: '', roleName: securityRoles.value[0]?.name || '' }
    await loadSecurity()
  } catch (createError) { securityError.value = createError.message }
}

async function createSecurityRole() {
  securityNotice.value = ''
  securityError.value = ''
  try {
    const response = await appFetch('/api/app/security/roles', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify(securityRoleForm.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo crear el rol.')
    securityNotice.value = 'Rol creado correctamente.'
    securityRoleForm.value = { name: '', label: '', permissions: [] }
    await loadSecurity()
  } catch (createError) { securityError.value = createError.message }
}

async function searchModule(module) {
  if (module === 'Clientes') clientPagination.value.page = 1
  else requestPagination.value.page = 1
  await loadModule(module, 1)
}

async function clearRequestFilters() {
  requestFilters.value = { status: '', serviceType: '', source: '', agentId: '', dateFrom: '', dateTo: '' }
  await searchModule('Solicitudes')
}

async function createAgentRequest() {
  agentFormLoading.value = true
  agentFormError.value = ''
  agentFormNotice.value = ''
  try {
    const response = await appFetch('/api/app/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: JSON.stringify(agentForm.value) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo crear la solicitud.')
    agentFormNotice.value = `Solicitud ${data.reference} creada correctamente. No genera cobro.`
    agentForm.value = { fullName: '', legalEntityType: '', email: '', phone: '', whatsapp: '', serviceType: '', freightAgent: '', productType: '' }
    agentFormOpen.value = false
    await loadModule('Solicitudes', 1)
  } catch (createError) {
    agentFormError.value = createError.message
  } finally {
    agentFormLoading.value = false
  }
}

async function openAgentForm() {
  activeMenu.value = 'Solicitudes'
  agentFormOpen.value = true
  await loadModule('Solicitudes', 1)
}

async function changePage(module, page) {
  const pagination = module === 'Clientes' ? clientPagination.value : requestPagination.value
  if (page < 1 || page > pagination.totalPages || page === pagination.page) return
  await loadModule(module, page)
}

const metrics = ref([
  { label: 'Solicitudes activas', value: '24', trend: '+12.5%', detail: 'vs. mes anterior', icon: 'SO', tone: 'blue' },
  { label: 'Pendientes de pago', value: '07', trend: 'Requieren atención', detail: 'en las próximas 48 h', icon: '$', tone: 'amber' },
  { label: 'En seguimiento', value: '12', trend: '+4 casos', detail: 'actualizados esta semana', icon: '↗', tone: 'violet' },
  { label: 'Cerradas este mes', value: '18', trend: '+8.2%', detail: 'cumplimiento 96%', icon: '✓', tone: 'green' },
])
const pipeline = ref([
  { label: 'Recibidas', value: 8, total: 24, color: 'blue' },
  { label: 'En análisis', value: 6, total: 24, color: 'violet' },
  { label: 'Esperando pago', value: 7, total: 24, color: 'amber' },
  { label: 'En gestión', value: 3, total: 24, color: 'green' },
])
const activity = ref([])
const priorityRequests = ref([])
const defaultActivity = [
  { initials: 'AR', title: 'Solicitud actualizada', description: 'Importación de vehículo · CRA-1048', time: 'Hace 12 min', color: 'blue' },
  { initials: 'JP', title: 'Pago confirmado', description: 'Asesoría exportación · CRA-1045', time: 'Hace 34 min', color: 'green' },
  { initials: 'MR', title: 'Nuevo cliente registrado', description: 'María Fernanda Ruiz', time: 'Hace 1 h', color: 'violet' },
  { initials: 'FC', title: 'Documento cargado', description: 'Factura comercial · CRA-1039', time: 'Hace 2 h', color: 'amber' },
]
const defaultPriorityRequests = [
  { id: 'CRA-1048', client: 'Juan Pablo Gómez', type: 'Importación', status: 'En análisis', statusClass: 'status-blue', date: 'Hoy, 09:42' },
  { id: 'CRA-1045', client: 'María Fernanda Ruiz', type: 'Exportación', status: 'Pago confirmado', statusClass: 'status-green', date: 'Hoy, 08:16' },
  { id: 'CRA-1041', client: 'Transportes del Caribe', type: 'Tránsito aduanero', status: 'Pendiente de pago', statusClass: 'status-amber', date: 'Ayer, 16:28' },
]

async function loadDashboard() {
  dashboardLoading.value = true
  dashboardError.value = ''
  try {
    const response = await appFetch('/api/app/dashboard', { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await response.json().catch(() => ({}))
    if (response.status === 403 && data.error === 'No tienes permisos para consultar este módulo.' && user.value?.permissions?.includes('dashboard.read')) {
      redirectToLogin()
      return
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el dashboard.')
    const totals = data.metrics || {}
    requestCount.value = Number(totals.total || 0)
    metrics.value = [
      { label: 'Solicitudes activas', value: String(totals.active || 0).padStart(2, '0'), trend: `${totals.total || 0} acumuladas`, detail: 'en la operación', icon: 'SO', tone: 'blue' },
      { label: 'Solicitudes pendientes', value: String(totals.pending || 0).padStart(2, '0'), trend: 'Estado actual', detail: 'requieren seguimiento', icon: '$', tone: 'amber' },
      { label: 'En gestión', value: String(totals.inProgress || 0).padStart(2, '0'), trend: 'Estado actual', detail: 'en proceso operativo', icon: '↗', tone: 'violet' },
      { label: 'Cerradas este mes', value: String(totals.closedThisMonth || 0).padStart(2, '0'), trend: 'Mes actual', detail: 'solicitudes finalizadas', icon: '✓', tone: 'green' },
    ]
    if (!isExpert.value) metrics.value.splice(3, 0,
      { label: 'Correos sin enviar', value: String(totals.emailsPending || 0).padStart(2, '0'), trend: 'Resend', detail: 'solicitudes por notificar', icon: '✉', tone: 'amber' },
      { label: 'Correos abiertos', value: String(totals.emailsOpened || 0).padStart(2, '0'), trend: 'Resend', detail: 'al menos un correo abierto', icon: '◉', tone: 'green' },
    )
    const total = Math.max(Number(totals.total || 0), 1)
    pipeline.value = (data.pipeline || []).map((item) => ({ ...item, total }))
    priorityRequests.value = (data.recent || []).slice(0, 5).map((item) => ({
      id: item.reference,
      client: item.clientName,
      type: labelValue(item.serviceType),
      status: labelValue(item.status),
      statusClass: statusClass(item.status),
      date: formatDate(item.createdAt),
    }))
    activity.value = (data.recent || []).map((item, index) => ({
      initials: item.clientName.slice(0, 2).toUpperCase(),
      title: `Solicitud ${labelValue(item.status).toLowerCase()}`,
      description: `${labelValue(item.serviceType)} · ${item.reference}`,
      time: formatDate(item.createdAt),
      color: ['blue', 'green', 'violet', 'amber'][index % 4],
    }))
  } catch (loadError) {
    dashboardError.value = loadError.message
    activity.value = isExpert.value ? [] : defaultActivity
    priorityRequests.value = isExpert.value ? [] : defaultPriorityRequests
  } finally {
    dashboardLoading.value = false
  }
}

async function login() {
  error.value = ''
  loading.value = true
  try {
    const response = await fetch('/api/app/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form.value) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.')
    token.value = data.token
    user.value = data.user
    localStorage.setItem('operationsToken', data.token)
    localStorage.setItem('operationsUser', JSON.stringify(data.user))
    await loadDashboard()
  } catch (loginError) { error.value = loginError.message } finally { loading.value = false }
}
async function logout() {
  await fetch('/api/app/logout', { method: 'POST', headers: { Authorization: `Bearer ${token.value}` } }).catch(() => {})
  clearSession()
  window.location.assign('/app/login')
}

async function restoreSession() {
  if (!token.value) {
    sessionChecking.value = false
    return
  }

  try {
    const response = await fetch('/api/app/session', { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      redirectToLogin()
      return
    }
    user.value = data.user
    localStorage.setItem('operationsUser', JSON.stringify(data.user))
    await loadDashboard()
  } catch {
    redirectToLogin()
  } finally {
    sessionChecking.value = false
  }
}

onMounted(restoreSession)
</script>

<template>
  <main v-if="sessionChecking" class="operations-loading" aria-live="polite">Verificando sesión…</main>
  <main v-else-if="!isAuthenticated" class="operations-login">
    <section class="login-showcase"><div class="showcase-top"><img class="brand-logo" :src="logoUrl" alt="Cortés Rodríguez Asesores" /><span>Plataforma operativa</span></div><div class="showcase-copy"><p class="eyebrow eyebrow-light">Centro de operaciones</p><h1>Todo el control de tus operaciones, en un solo lugar.</h1><p>Gestiona clientes, solicitudes y documentos con la claridad que tu equipo necesita para avanzar.</p></div><div class="showcase-footer"><span class="status-dot"></span> Sistema operativo · Entorno dev</div></section>
    <section class="operations-login-panel"><div class="login-form-wrap"><img class="brand-logo brand-logo-login" :src="logoUrl" alt="Cortés Rodríguez Asesores" /><p class="eyebrow">Acceso seguro</p><h2>Bienvenido de nuevo</h2><p class="login-description">Ingresa con tus credenciales para acceder al espacio de trabajo.</p><form @submit.prevent="login"><label>Correo electrónico<input v-model="form.email" type="email" autocomplete="username" placeholder="nombre@empresa.com" required /></label><label>Contraseña<input v-model="form.password" type="password" autocomplete="current-password" placeholder="••••••••" required /></label><p v-if="error" class="operations-error" role="alert">{{ error }}</p><button class="primary-button" type="submit" :disabled="loading">{{ loading ? 'Ingresando…' : 'Ingresar al panel' }} <span>→</span></button></form><p class="login-help">Si tienes problemas para ingresar, contacta al administrador del sistema.</p></div></section>
  </main>

  <main v-else class="operations-shell">
    <aside class="operations-sidebar"><div class="sidebar-head"><div class="sidebar-brand"><img class="brand-logo" :src="logoUrl" alt="Cortés Rodríguez Asesores" /><span><strong>Cortés Rodríguez</strong><small>Operaciones</small></span></div><button class="mobile-menu-toggle" type="button" :aria-expanded="mobileMenuOpen" aria-controls="operations-navigation" @click="mobileMenuOpen = !mobileMenuOpen"><span>☰</span><span>Menú</span></button></div><div class="sidebar-label">Menú principal</div><nav id="operations-navigation" :class="{ open: mobileMenuOpen }" aria-label="Navegación de operaciones"><button v-for="item in visibleMenu.slice(0, 6)" :key="item.permission" type="button" :class="['operations-menu-item', { active: activeMenu === item.label }]" @click="selectMenu(item)"><span class="menu-icon">{{ item.icon }}</span><span>{{ item.label }}</span><span v-if="item.label === 'Solicitudes'" class="menu-count">{{ requestCount }}</span></button></nav><div v-if="visibleMenu.length > 6" class="sidebar-bottom-menu"><div class="sidebar-label">Administración</div><button v-for="item in visibleMenu.slice(6)" :key="item.permission" type="button" :class="['operations-menu-item', { active: activeMenu === item.label }]" @click="selectMenu(item)"><span class="menu-icon">{{ item.icon }}</span><span>{{ item.label }}</span></button></div><div class="sidebar-profile"><div class="avatar avatar-small">{{ user.name?.slice(0, 2).toUpperCase() }}</div><div><strong>{{ user.name }}</strong><span>{{ user.roles?.[0] || 'Usuario' }}</span></div><button type="button" aria-label="Cerrar sesión" @click="logout">↪</button></div></aside>
    <section class="operations-content"><header class="operations-topbar"><div class="breadcrumb"><span>Operaciones</span><b>/</b><strong>{{ currentMenu?.label }}</strong></div><div class="topbar-actions"><label class="search-box"><span>⌕</span><input placeholder="Buscar en la plataforma..." /></label><button class="icon-button" type="button" aria-label="Notificaciones">♧<i></i></button><div class="avatar">{{ user.name?.slice(0, 2).toUpperCase() }}</div></div></header>
      <div v-if="activeMenu === 'Inicio'" class="dashboard-view"><div class="dashboard-heading"><div><p class="eyebrow">Miércoles, 14 de octubre de 2026</p><h1>Buenos días, {{ user.name?.split(' ')[0] }} <span>✦</span></h1><p>{{ isAgent ? 'Este es el resumen de tus solicitudes.' : isExpert ? 'Este es el resumen de tus solicitudes asignadas.' : 'Este es el resumen de lo que está sucediendo hoy.' }}</p></div><button type="button" class="secondary-button">⌕&nbsp; Ver actividad</button></div>
        <section class="metric-grid" aria-label="Indicadores principales"><article v-for="metric in metrics" :key="metric.label" class="metric-card"><div class="metric-top"><span :class="['metric-icon', `tone-${metric.tone}`]">{{ metric.icon }}</span><span :class="['metric-trend', `trend-${metric.tone}`]">{{ metric.trend }}</span></div><strong>{{ metric.value }}</strong><h3>{{ metric.label }}</h3><p>{{ metric.detail }}</p></article></section>
        <section class="dashboard-grid"><article class="panel pipeline-panel"><div class="panel-heading"><div><h2>Estado de solicitudes</h2><p>{{ isExpert ? 'Distribución de tus asignaciones.' : 'Distribución de tus operaciones activas' }}</p></div><button type="button" class="more-button">Últimos 30 días⌄</button></div><div class="pipeline-list"><div v-for="item in pipeline" :key="item.label" class="pipeline-row"><div class="pipeline-label"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div><div class="progress-track"><span :class="`progress-${item.color}`" :style="{ width: `${(item.value / item.total) * 100}%` }"></span></div></div></div><div class="panel-footer"><span><i class="legend-dot dot-blue"></i> Activas <strong>{{ metrics.find((item) => item.label === 'Solicitudes activas')?.value || '00' }}</strong></span><span><i class="legend-dot dot-gray"></i> Cerradas <strong>{{ metrics.find((item) => item.label === 'Cerradas este mes')?.value || '00' }}</strong></span><a href="#">Ver todas →</a></div></article><article class="panel activity-panel"><div class="panel-heading"><div><h2>Actividad reciente</h2><p>Últimos movimientos {{ isExpert ? 'de tus asignaciones' : 'del equipo' }}</p></div><button type="button" class="more-button">•••</button></div><div class="activity-list"><div v-for="item in activity" :key="item.title + item.time" class="activity-item"><div :class="['avatar avatar-activity', `avatar-${item.color}`]">{{ item.initials }}</div><div class="activity-copy"><strong>{{ item.title }}</strong><span>{{ item.description }}</span></div><time>{{ item.time }}</time></div><p v-if="!activity.length" class="empty-row">No hay actividad reciente.</p></div><div class="panel-footer centered"><a href="#">Ver toda la actividad →</a></div></article></section>
        <section class="panel requests-panel"><div class="panel-heading"><div><h2>{{ isExpert ? 'Solicitudes asignadas' : 'Solicitudes prioritarias' }}</h2><p>{{ isExpert ? 'Casos asignados para revisión y respuesta.' : 'Casos que requieren seguimiento de tu equipo' }}</p></div></div><div class="table-wrap"><table><thead><tr><th>Solicitud</th><th v-if="!isExpert">Cliente</th><th>{{ isExpert ? 'Consulta' : 'Tipo de operación' }}</th><th>Estado</th><th>Actualización</th><th></th></tr></thead><tbody><tr v-for="request in priorityRequests" :key="request.id"><td><strong class="request-id">{{ request.id }}</strong></td><td v-if="!isExpert">{{ request.client }}</td><td>{{ request.type }}</td><td><span :class="['status-pill', request.statusClass]"><i></i>{{ request.status }}</span></td><td>{{ request.date }}</td><td><button class="row-action" type="button">•••</button></td></tr></tbody></table></div></section>
      </div>
      <section v-else-if="activeMenu === 'Clientes'" class="module-view">
        <div class="module-heading"><div><p class="eyebrow">Directorio operativo</p><h1>Clientes</h1><p>Personas y empresas que han registrado solicitudes.</p></div><button type="button" class="secondary-button compact" @click="selectMenu({ label: 'Clientes' })">↻ Actualizar</button></div>
        <form class="module-search" @submit.prevent="searchModule('Clientes')"><span>⌕</span><input v-model="clientSearch" type="search" placeholder="Buscar por nombre..." /><button type="submit">Buscar</button></form>
        <div v-if="moduleLoading" class="module-state panel">Cargando clientes…</div><div v-else-if="moduleError" class="module-state module-state-error panel">{{ moduleError }}</div><ListView v-else title="Clientes registrados" description="Personas y empresas que han registrado solicitudes." :count="clientPagination.totalItems" :page="clientPagination.page" :total-pages="clientPagination.totalPages" :empty="!clients.length" empty-text="No encontramos clientes con ese criterio." @previous="changePage('Clientes', clientPagination.page - 1)" @next="changePage('Clientes', clientPagination.page + 1)"><template #columns><th>Cliente</th><th>Solicitudes</th><th>Registro</th><th>Identificador</th></template><template #rows><tr v-for="client in clients" :key="client.id"><td><div class="table-person"><span class="avatar avatar-table">{{ client.fullName.slice(0, 2).toUpperCase() }}</span><strong>{{ client.fullName }}</strong></div></td><td><span class="count-badge">{{ client.requestCount }}</span></td><td>{{ formatDate(client.createdAt) }}</td><td class="muted-cell">{{ client.id.slice(0, 8) }}…</td></tr></template></ListView>
      </section>
      <section v-else-if="activeMenu === 'Solicitudes'" class="module-view">
        <div class="module-heading"><div><p class="eyebrow">Seguimiento operativo</p><h1>Solicitudes</h1><p>Consulta el estado y los datos de cada requerimiento recibido.</p></div><button type="button" class="secondary-button compact" @click="selectMenu({ label: 'Solicitudes' })">↻ Actualizar</button></div>
        <form class="module-search" @submit.prevent="searchModule('Solicitudes')"><span>⌕</span><input v-model="requestSearch" type="search" placeholder="Buscar por referencia, cliente, servicio o estado..." /><button type="submit">Buscar</button></form><div class="advanced-filter-toolbar"><button type="button" class="secondary-button compact" @click="requestFiltersOpen = !requestFiltersOpen">⚙ Filtros avanzados</button><span v-if="requestFilters.status || requestFilters.serviceType || requestFilters.source || requestFilters.agentId || requestFilters.dateFrom || requestFilters.dateTo" class="filter-active-note">Filtros activos</span></div><div v-if="requestFiltersOpen" class="advanced-filters panel"><label>Estado<select v-model="requestFilters.status"><option value="">Todos</option><option value="pending">Pendiente</option><option value="in_review">En revisión</option><option value="in_progress">En gestión</option><option value="closed">Cerrada</option><option value="cancelled">Cancelada</option></select></label><label>Tipo de servicio<select v-model="requestFilters.serviceType"><option value="">Todos</option><option value="exportacion">Exportación</option><option value="importacion">Importación</option><option value="agente_carga">Agente de carga</option></select></label><label>Fuente<select v-model="requestFilters.source"><option value="">Todas</option><option value="direct_web">Página web</option><option value="agent_link">Agente</option></select></label><label v-if="user.permissions?.includes('users.manage')">Agente<select v-model="requestFilters.agentId"><option value="">Todos</option><option v-for="agent in requestAgents" :key="agent.id" :value="agent.id">{{ agent.name }}</option></select></label><label>Desde<input v-model="requestFilters.dateFrom" type="date" /></label><label>Hasta<input v-model="requestFilters.dateTo" type="date" /></label><div class="advanced-filter-actions"><button type="button" class="secondary-button compact" @click="clearRequestFilters">Limpiar</button><button type="button" class="primary-button compact" @click="searchModule('Solicitudes')">Aplicar filtros</button></div></div>
        <div v-if="agentFormOpen" class="agent-request-card panel"><div class="panel-heading"><div><p class="eyebrow">Solicitud interna</p><h2>Nueva solicitud sin cobro</h2><p>Registra una solicitud de tu cliente y quedará asociada a tu usuario.</p></div><button type="button" class="request-detail-close" @click="agentFormOpen = false">×</button></div><form class="agent-request-form" @submit.prevent="createAgentRequest"><label>Nombre completo<input v-model="agentForm.fullName" required placeholder="Nombre del cliente" /></label><label>Constitución legal<select v-model="agentForm.legalEntityType" required><option value="" disabled>Selecciona una opción</option><option value="natural">Persona natural</option><option value="juridica">Persona jurídica</option></select></label><label>Correo electrónico<input v-model="agentForm.email" type="email" placeholder="nombre@empresa.com" /></label><label>Teléfono<input v-model="agentForm.phone" placeholder="+57 300 000 0000" /></label><label>WhatsApp<input v-model="agentForm.whatsapp" placeholder="+57 300 000 0000" /></label><label>Tipo de servicio<select v-model="agentForm.serviceType" required><option value="" disabled>Selecciona una opción</option><option value="exportacion">Exportación</option><option value="importacion">Importación</option><option value="agente_carga">Agente de carga</option></select></label><label>Tipo de producto<select v-model="agentForm.productType" required><option value="" disabled>Selecciona una opción</option><option value="vehiculos">Vehículos</option><option value="mercancias">Mercancías</option></select></label><p v-if="agentFormError" class="request-error">{{ agentFormError }}</p><div class="form-actions"><button type="button" class="secondary-button compact" @click="agentFormOpen = false">Cancelar</button><button type="submit" class="primary-button" :disabled="agentFormLoading">{{ agentFormLoading ? 'Creando…' : 'Crear solicitud' }} <span>→</span></button></div></form></div><div v-if="moduleLoading" class="module-state panel">Cargando solicitudes…</div><div v-else-if="moduleError" class="module-state module-state-error panel">{{ moduleError }}</div><ListView v-else title="Solicitudes" description="Consulta el estado y los datos de cada requerimiento recibido." :count="requestPagination.totalItems" :page="requestPagination.page" :total-pages="requestPagination.totalPages" :empty="!requests.length" empty-text="No encontramos solicitudes con ese criterio." @previous="changePage('Solicitudes', requestPagination.page - 1)" @next="changePage('Solicitudes', requestPagination.page + 1)"><template #actions><button v-if="isAdmin" type="button" class="primary-button compact" @click="openAgentForm()">+ Crear solicitud</button></template><template #columns><th>Referencia</th><th>Cliente</th><th>Servicio</th><th>Producto</th><th>Estado</th><th>Pago</th><th>Correos</th><th>Fuente</th><th>Agente</th><th>Fecha</th><th></th></template><template #rows><tr v-for="request in requests" :key="request.id"><td><button class="request-link" type="button" @click="openRequestDetail(request)">{{ request.reference }}</button></td><td><button class="client-link" type="button" @click="openRequestDetail(request)">{{ request.clientName }}</button></td><td>{{ labelValue(request.serviceType) }}</td><td>{{ labelValue(request.productType) }}</td><td><span :class="['status-pill', statusClass(request.status)]"><i></i>{{ labelValue(request.status) }}</span></td><td><span :class="['status-pill', request.payment ? statusClass(request.payment.status) : 'status-blue']"><i></i>{{ request.payment ? paymentLabel(request.payment.status) : request.paymentRequired ? 'Sin iniciar' : 'No requerido' }}</span></td><td><span :class="['status-pill', notificationClass(request.notificationStatus)]"><i></i>{{ notificationLabel(request.notificationStatus) }}</span></td><td><span class="source-badge">{{ request.source }}</span></td><td>{{ request.agentName || 'Landingpage' }}</td><td>{{ formatDate(request.createdAt) }}</td><td><button v-if="user.permissions?.includes('requests.update') && !isAgent" class="notification-action" type="button" :disabled="emailSendingId === request.id" @click="sendRequestNotification(request)">{{ emailSendingId === request.id ? 'Enviando…' : 'Enviar correo' }}</button></td></tr></template></ListView>
      </section>
      <SecurityPanel v-else-if="activeMenu === 'Usuarios y roles'" :token="token" />
      <section v-else-if="false && activeMenu === 'Usuarios y roles'" class="module-view security-view">
        <div class="module-heading"><div><p class="eyebrow">Control de acceso</p><h1>Usuarios y roles</h1><p>Administra quién puede entrar y qué módulos puede consultar.</p></div><button type="button" class="secondary-button compact" @click="loadSecurity">↻ Actualizar</button></div>
        <p v-if="securityNotice" class="security-notice">{{ securityNotice }}</p><p v-if="securityError" class="request-error">{{ securityError }}</p><div v-if="securityLoading" class="module-state panel">Cargando configuración de seguridad…</div><template v-else><div class="security-tabs"><button type="button" :class="{ active: securityTab === 'users' }" @click="securityTab = 'users'">Usuarios <span>{{ securityUsers.length }}</span></button><button type="button" :class="{ active: securityTab === 'roles' }" @click="securityTab = 'roles'">Roles <span>{{ securityRoles.length }}</span></button></div>
          <div v-if="securityTab === 'users'" class="security-grid"><form class="panel security-form" @submit.prevent="createSecurityUser"><div class="panel-heading"><div><h2>Crear usuario</h2><p>Asigna acceso al espacio operativo.</p></div><span class="metric-icon tone-blue">US</span></div><label>Nombre completo<input v-model="securityUserForm.fullName" type="text" placeholder="Nombre del usuario" required /></label><label>Correo electrónico<input v-model="securityUserForm.email" type="email" placeholder="usuario@empresa.com" required /></label><label>Contraseña temporal<input v-model="securityUserForm.password" type="password" minlength="10" placeholder="Mínimo 10 caracteres" required /></label><label>Rol inicial<select v-model="securityUserForm.roleName" required><option v-for="role in securityRoles" :key="role.name" :value="role.name">{{ role.label }}</option></select></label><button type="submit" class="primary-button">Crear usuario <span>→</span></button></form><article class="panel security-list"><div class="panel-heading"><div><h2>Usuarios registrados</h2><p>Accesos vigentes en la plataforma.</p></div></div><div v-if="!securityUsers.length" class="empty-row">No hay usuarios registrados.</div><div v-for="item in securityUsers" :key="item.id" class="security-list-item"><div class="avatar avatar-table">{{ item.fullName.slice(0, 2).toUpperCase() }}</div><div><strong>{{ item.fullName }}</strong><span>{{ item.email }}</span></div><div class="security-item-meta"><span :class="['security-status', { inactive: !item.active }]">{{ item.active ? 'Activo' : 'Inactivo' }}</span><small>{{ item.roles.join(' · ') || 'Sin rol' }}</small></div></div></article></div>
          <div v-else class="security-grid"><form class="panel security-form" @submit.prevent="createSecurityRole"><div class="panel-heading"><div><h2>Crear rol</h2><p>Define un perfil con permisos específicos.</p></div><span class="metric-icon tone-violet">RO</span></div><label>Identificador<input v-model="securityRoleForm.name" type="text" placeholder="ej. coordinator" pattern="[a-z][a-z0-9_-]{2,40}" required /></label><label>Nombre visible<input v-model="securityRoleForm.label" type="text" placeholder="Coordinador" required /></label><fieldset class="permission-picker"><legend>Permisos</legend><label v-for="permission in securityPermissions" :key="permission.code" class="permission-option"><input v-model="securityRoleForm.permissions" type="checkbox" :value="permission.code" /><span><strong>{{ permission.label }}</strong><small>{{ permission.module }}</small></span></label></fieldset><button type="submit" class="primary-button">Crear rol <span>→</span></button></form><article class="panel security-list"><div class="panel-heading"><div><h2>Roles disponibles</h2><p>Perfiles que pueden asignarse a los usuarios.</p></div></div><div v-for="role in securityRoles" :key="role.id" class="security-list-item role-item"><div class="metric-icon tone-violet">RO</div><div><strong>{{ role.label }}</strong><span>{{ role.name }}</span></div><div class="security-item-meta"><small>{{ role.permissions.length }} permisos</small></div></div></article></div>
        </template>
      </section>
      <OperationsCatalogPanel v-else-if="activeMenu === 'Servicios y consultas' || activeMenu === 'Enlaces de agentes'" :token="token" :user="user" :section="activeMenu === 'Servicios y consultas' ? 'catalog' : 'links'" />
      <ExpertRequestsPanel v-else-if="activeMenu === 'Solicitudes asignadas'" :token="token" />
      <ResponseReviewPanel v-else-if="activeMenu === 'Revisión de respuestas'" :token="token" />
      <SimilarQuestionPanel v-else-if="activeMenu === 'Preguntas similares'" :token="token" />
      <NotificationConfigPanel v-else-if="activeMenu === 'Configuración'" :token="token" />
      <section v-else-if="activeMenu === 'Configuración'" class="module-view security-view">
        <div class="module-heading"><div><p class="eyebrow">Preferencias operativas</p><h1>Configuración</h1><p>Define quién recibe las comunicaciones de cada evento.</p></div><button type="button" class="secondary-button compact" @click="loadNotifications">↻ Actualizar</button></div>
        <p v-if="notificationNotice" class="security-notice">{{ notificationNotice }}</p><p v-if="notificationError" class="request-error">{{ notificationError }}</p><div v-if="notificationLoading" class="module-state panel">Cargando configuración…</div><template v-else><form class="panel security-form service-config-form" @submit.prevent="saveServiceConfig"><div class="panel-heading"><div><h2>Valor del servicio</h2><p>Este valor se mostrará al cliente antes de enviar la solicitud.</p></div><span class="metric-icon tone-blue">$</span></div><label>Servicio<input :value="serviceConfig.name" type="text" readonly /></label><div class="service-price-fields"><label>Valor a pagar<input v-model.number="serviceConfig.amount" type="number" min="0" step="1" required /></label><label>Moneda<select v-model="serviceConfig.currency"><option value="COP">COP</option><option value="USD">USD</option></select></label></div><button type="submit" class="primary-button">Guardar valor <span>→</span></button></form><div class="notification-info"><span class="metric-icon tone-blue">✉</span><p>El evento <strong>Pago aprobado</strong> utilizará estas reglas cuando conectemos el webhook de Wompi. El remitente y la API de correo seguirán configurándose por entorno.</p></div><div class="security-grid"><form class="panel security-form" @submit.prevent="createNotificationRecipient"><div class="panel-heading"><div><h2>Agregar destinatario</h2><p>Correo que podrá recibir notificaciones.</p></div><span class="metric-icon tone-blue">@</span></div><label>Nombre<input v-model="recipientForm.name" type="text" placeholder="Equipo de operaciones" required /></label><label>Correo electrónico<input v-model="recipientForm.email" type="email" placeholder="operaciones@empresa.com" required /></label><label>Tipo de copia<select v-model="recipientForm.recipientType"><option value="to">Para</option><option value="cc">Copia (CC)</option><option value="bcc">Copia oculta (CCO)</option></select></label><button type="submit" class="primary-button">Guardar destinatario <span>→</span></button></form><article class="panel security-list"><div class="panel-heading"><div><h2>Destinatarios configurados</h2><p>{{ notificationRecipients.length }} correos disponibles.</p></div></div><div v-if="!notificationRecipients.length" class="empty-row">Aún no hay destinatarios.</div><div v-for="recipient in notificationRecipients" :key="recipient.id" class="security-list-item"><div class="avatar avatar-table">@</div><div><strong>{{ recipient.name }}</strong><span>{{ recipient.email }}</span></div><div class="security-item-meta"><span class="security-status">{{ recipient.recipientType.toUpperCase() }}</span><small>{{ recipient.active ? 'Activo' : 'Inactivo' }}</small></div></div></article></div><form class="panel security-form rule-form" @submit.prevent="createNotificationRule"><div class="panel-heading"><div><h2>Nueva regla de notificación</h2><p>Relaciona un evento con un tipo de servicio y sus destinatarios.</p></div><span class="metric-icon tone-violet">↗</span></div><div class="rule-form-fields"><label>Nombre de la regla<input v-model="ruleForm.name" type="text" placeholder="Pago aprobado - Importaciones" required /></label><label>Evento<select v-model="ruleForm.eventCode"><option value="payment_approved">Pago aprobado</option><option value="payment_rejected">Pago rechazado</option><option value="request_created">Solicitud creada</option><option value="status_changed">Cambio de estado</option></select></label><label>Tipo de servicio<select v-model="ruleForm.serviceType"><option value="all">Todos</option><option value="importacion">Importación</option><option value="exportacion">Exportación</option><option value="agente_carga">Agente de carga</option></select></label></div><fieldset class="permission-picker recipient-picker"><legend>Destinatarios de la regla</legend><label v-for="recipient in notificationRecipients" :key="recipient.id" class="permission-option"><input v-model="ruleForm.recipientIds" type="checkbox" :value="recipient.id" /><span><strong>{{ recipient.name }}</strong><small>{{ recipient.email }}</small></span></label><small v-if="!notificationRecipients.length" class="empty-inline">Agrega destinatarios antes de crear una regla.</small></fieldset><button type="submit" class="primary-button">Guardar regla <span>→</span></button></form><article class="panel security-list notification-rules"><div class="panel-heading"><div><h2>Reglas activas</h2><p>Configuración que consultará el flujo de pagos.</p></div></div><div v-if="!notificationRules.length" class="empty-row">Aún no hay reglas configuradas.</div><div v-for="rule in notificationRules" :key="rule.id" class="security-list-item"><div class="metric-icon tone-violet">↗</div><div><strong>{{ rule.name }}</strong><span>{{ rule.eventCode }} · {{ rule.serviceType }}</span></div><div class="security-item-meta"><span class="security-status">{{ rule.active ? 'Activa' : 'Inactiva' }}</span><small>{{ rule.recipients.length }} destinatario(s)</small></div></div></article></template>
      </section>
      <div v-else class="empty-module panel"><span class="metric-icon tone-blue">{{ currentMenu?.icon }}</span><p class="eyebrow">Módulo operativo</p><h1>{{ currentMenu?.label }}</h1><p>Este módulo está habilitado para tu rol y será desarrollado en la siguiente fase.</p><button type="button" class="primary-button" @click="selectMenu({ label: 'Inicio' })">Volver al inicio <span>→</span></button></div>
    </section>
    <aside v-if="requestDetail || requestDetailLoading || requestDetailError" class="request-detail-backdrop" @click.self="closeRequestDetail">
      <section class="request-detail-panel" aria-label="Detalle del cliente y solicitud">
        <button class="request-detail-close" type="button" aria-label="Cerrar detalle" @click="closeRequestDetail">×</button>
        <div v-if="requestDetailLoading" class="module-state">Cargando detalle…</div>
        <div v-else-if="requestDetailError" class="module-state module-state-error">{{ requestDetailError }}</div>
        <template v-else-if="requestDetail">
          <p class="eyebrow">Detalle de la solicitud</p>
          <h2>{{ requestDetail.request.reference }}</h2>
          <span :class="['status-pill', statusClass(requestDetail.request.status)]"><i></i>{{ labelValue(requestDetail.request.status) }}</span>
          <section class="detail-section"><h3>Datos del cliente</h3><dl class="detail-grid"><div><dt>Nombre completo</dt><dd>{{ requestDetail.request.clientName }}</dd></div><div><dt>Constitución legal</dt><dd>{{ labelValue(requestDetail.request.legalEntityType) }}</dd></div><div><dt>Correo</dt><dd>{{ requestDetail.request.email || 'No registrado' }}</dd></div><div><dt>Teléfono</dt><dd>{{ requestDetail.request.phone || 'No registrado' }}</dd></div><div><dt>WhatsApp</dt><dd>{{ requestDetail.request.whatsapp || 'No registrado' }}</dd></div><div><dt>Cliente desde</dt><dd>{{ formatDate(requestDetail.request.clientCreatedAt) }}</dd></div></dl></section>
          <section class="detail-section"><h3>Datos de la operación</h3><dl class="detail-grid"><div><dt>Servicio</dt><dd>{{ requestDetail.request.serviceName }}</dd></div><div><dt>Tipo de servicio</dt><dd>{{ labelValue(requestDetail.request.serviceType) }}</dd></div><div><dt>Producto</dt><dd>{{ labelValue(requestDetail.request.productType) }}</dd></div><div><dt>Agente de carga</dt><dd>{{ requestDetail.request.freightAgent || 'No registrado' }}</dd></div><div><dt>Fuente</dt><dd>{{ requestDetail.request.source }}</dd></div><div><dt>Agente responsable</dt><dd>{{ requestDetail.request.agentName || 'Landingpage' }}</dd></div><div><dt>Creada</dt><dd>{{ formatDate(requestDetail.request.createdAt) }}</dd></div></dl></section>
          <section class="detail-section"><h3>Pago</h3><dl class="detail-grid" v-if="requestDetail.request.payment"><div><dt>Estado</dt><dd><span :class="['status-pill', statusClass(requestDetail.request.payment.status)]"><i></i>{{ paymentLabel(requestDetail.request.payment.status) }}</span></dd></div><div><dt>Referencia Mercado Pago</dt><dd>{{ requestDetail.request.payment.paymentId || 'Pendiente' }}</dd></div><div><dt>Valor USD</dt><dd>{{ (requestDetail.request.payment.usdAmountCents / 100).toFixed(2) }} USD</dd></div><div><dt>Valor COP</dt><dd>{{ requestDetail.request.payment.copAmountCents.toLocaleString('es-CO') }} COP</dd></div><div><dt>TRM</dt><dd>{{ requestDetail.request.payment.trm.toLocaleString('es-CO') }}</dd></div><div><dt>Actualizado</dt><dd>{{ formatDate(requestDetail.request.payment.updatedAt) }}</dd></div></dl><p v-else class="detail-empty">No se ha iniciado un pago para esta solicitud.</p></section>
          <section v-if="isAdmin" class="detail-section"><h3>Asignación del experto</h3><p class="assignment-current">{{ requestDetail.assignment?.expertName ? `Asignada a ${requestDetail.assignment.expertName}` : 'En cola administrativa: todavía no hay experto asignado.' }}</p><div v-if="requestDetail.eligibleExperts?.length" class="assignment-controls"><label>Experto<select v-model="assignmentExpertId"><option value="" disabled>Selecciona un experto</option><option v-for="expert in requestDetail.eligibleExperts" :key="expert.id" :value="expert.id">{{ expert.name }}</option></select></label><button type="button" class="primary-button compact" :disabled="!assignmentExpertId || assignmentSaving || assignmentExpertId === requestDetail.assignment?.expertId" @click="assignRequestExpert">{{ assignmentSaving ? 'Asignando…' : requestDetail.assignment?.expertId ? 'Reasignar' : 'Asignar experto' }}</button></div><p v-else class="detail-empty">No hay expertos activos asociados a este tipo de consulta. La solicitud queda pendiente hasta que se configure uno.</p><ul v-if="requestDetail.assignment?.history?.length" class="assignment-history"><li v-for="item in requestDetail.assignment.history" :key="item.id"><strong>{{ item.expertName || 'Sin asignar' }}</strong><span>{{ item.status === 'failed' ? 'Sin expertos disponibles' : item.status === 'reassigned' ? 'Reasignada' : 'Asignada' }} · {{ formatDate(item.assignedAt) }}</span></li></ul></section>
          <section class="detail-section"><h3>Respuestas del experto</h3><div v-if="!requestDetail.responses?.length" class="detail-empty">Aún no hay respuestas registradas.</div><div v-for="expertResponse in requestDetail.responses" :key="expertResponse.id" class="request-response-item"><div class="request-response-heading"><div><strong>Versión {{ expertResponse.version }}</strong><span>{{ expertResponse.expertName }} · {{ formatDate(expertResponse.createdAt) }}</span></div><span :class="['status-pill', statusClass(expertResponse.status)]"><i></i>{{ labelValue(expertResponse.status) }}</span></div><p v-if="expertResponse.bodyVisible" class="request-response-body">{{ expertResponse.body }}</p><p v-else class="request-response-pending">La respuesta está pendiente de aprobación administrativa.</p><p v-if="expertResponse.adminNote" class="request-response-note"><strong>Nota administrativa:</strong> {{ expertResponse.adminNote }}</p></div></section>
          <section class="detail-section"><h3>Historial del cliente</h3><div class="request-history"><div v-for="historyItem in requestDetail.history" :key="historyItem.id" class="request-history-item"><div><strong>{{ historyItem.reference }}</strong><span>{{ labelValue(historyItem.serviceType) }} · {{ labelValue(historyItem.productType) }}</span></div><span :class="['status-pill', statusClass(historyItem.status)]"><i></i>{{ labelValue(historyItem.status) }}</span></div></div></section>
        </template>
      </section>
    </aside>
  </main>
</template>

<style scoped>
.advanced-filter-toolbar{display:flex;align-items:center;gap:12px;margin:0 0 12px}.filter-active-note{color:#397aa2;font-size:10px;font-weight:700}.advanced-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px;padding:17px}.advanced-filters label{display:grid;gap:6px;color:#526174;font-size:10px;font-weight:700}.advanced-filters select,.advanced-filters input{min-height:36px;padding:0 9px;border:1px solid #d8e0ea;border-radius:6px;color:#344b60;background:#fff;font-size:11px}.advanced-filter-actions{display:flex;align-items:end;justify-content:flex-end;gap:8px;grid-column:1/-1}
.agent-list-action{display:flex;justify-content:flex-end;margin-bottom:12px}.agent-list-action .primary-button{min-height:36px}.requests-panel .primary-button{display:none}
.agent-actions{display:flex;align-items:center;gap:15px;margin:-4px 0 16px}.agent-actions .primary-button{min-height:36px}.agent-request-card{position:relative;margin-bottom:16px;padding:22px}.agent-request-card .panel-heading{margin-bottom:18px}.agent-request-card h2{margin:0 0 6px;color:#223b53;font-size:16px}.agent-request-card .request-detail-close{position:static;flex-shrink:0}.agent-request-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.agent-request-form label{display:grid;gap:6px;color:#526174;font-size:11px;font-weight:700}.agent-request-form input,.agent-request-form select{min-height:39px;padding:0 10px;border:1px solid #d8e0ea;border-radius:7px;color:#1d2939;background:#fff;font-size:11px}.agent-request-form .request-error,.agent-request-form .form-actions{grid-column:1/-1}.agent-request-form .form-actions{margin-top:3px}.agent-request-form .primary-button{min-height:38px}.agent-actions .security-notice{margin:0;padding:8px 10px;font-size:10px}
.operations-loading{display:grid;place-items:center;min-height:100vh;color:#31516c;background:#f7f9fc;font-size:14px;font-weight:700}
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f8fb;color:#1d2939}:global(button),:global(input){font:inherit}
.operations-login{min-height:100vh;display:grid;grid-template-columns:minmax(320px,44%) 1fr;background:#f7f9fc}.login-showcase{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:100vh;padding:46px clamp(32px,7vw,100px);overflow:hidden;color:#e8f2f9;background:radial-gradient(circle at 18% 25%,rgba(51,150,194,.32),transparent 30%),linear-gradient(145deg,#092b46,#0c4365 56%,#0f6d7d)}.login-showcase:after{content:'';position:absolute;right:-120px;bottom:-180px;width:470px;height:470px;border:1px solid rgba(255,255,255,.14);border-radius:50%;box-shadow:0 0 0 58px rgba(255,255,255,.025),0 0 0 116px rgba(255,255,255,.025)}.showcase-top,.sidebar-brand{position:relative;z-index:1;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:700}.showcase-copy{position:relative;z-index:1;max-width:530px;margin:auto 0}.showcase-copy h1{max-width:530px;margin:16px 0 22px;font-size:clamp(36px,4.4vw,62px);line-height:1.02;letter-spacing:-.055em;color:#fff}.showcase-copy>p:not(.eyebrow){max-width:430px;margin:0;color:#bed4e1;font-size:17px;line-height:1.7}.showcase-footer{position:relative;z-index:1;display:flex;align-items:center;gap:9px;color:#a8c8d8;font-size:12px}.status-dot{width:8px;height:8px;border-radius:50%;background:#68d391;box-shadow:0 0 0 5px rgba(104,211,145,.13)}.operations-login-panel{display:grid;place-items:center;padding:40px;background:#fff}.login-form-wrap{width:min(430px,100%)}.brand-mark{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:13px;font-size:12px;font-weight:900;letter-spacing:-.04em}.brand-mark-light{color:#0b3a58;background:#f2fbff}.brand-mark-dark{color:#fff;background:#0d4263;box-shadow:0 8px 18px rgba(13,66,99,.2)}.eyebrow{margin:0 0 9px;color:#397aa2;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow-light{color:#8dd7e2}.login-form-wrap .eyebrow{margin-top:34px}.login-form-wrap h2{margin:0 0 12px;color:#15283c;font-size:32px;letter-spacing:-.04em}.login-description{margin:0;color:#718096;line-height:1.6}form{display:grid;gap:18px;margin-top:32px}label{display:grid;gap:8px;color:#344054;font-size:13px;font-weight:700}input{width:100%;min-height:49px;padding:0 14px;border:1px solid #d8e0ea;border-radius:9px;outline:0;color:#1d2939;background:#fff;transition:border .2s,box-shadow .2s}input:focus{border-color:#3c8eae;box-shadow:0 0 0 4px rgba(60,142,174,.1)}.primary-button,.secondary-button{min-height:45px;display:inline-flex;align-items:center;justify-content:center;gap:14px;border:0;border-radius:8px;padding:0 18px;color:#fff;background:#0e4567;font-weight:800;cursor:pointer;box-shadow:0 8px 16px rgba(14,69,103,.14)}.primary-button:hover{background:#0a3855}.primary-button:disabled{opacity:.6;cursor:wait}.primary-button span{font-size:19px;font-weight:400}.login-help{margin:28px 0 0;color:#98a2b3;font-size:12px;line-height:1.6}.operations-error{margin:-2px 0 0;color:#b54747;font-size:13px}
.operations-shell{min-height:100vh;display:flex;color:#1d2939;background:#f6f8fb}.operations-sidebar{width:252px;display:flex;flex-direction:column;flex-shrink:0;padding:27px 15px 18px;color:#c8d8e4;background:#092d48}.sidebar-brand{margin:0 11px 57px;color:#fff}.sidebar-brand>span:last-child{display:grid;gap:2px;font-size:14px}.sidebar-brand small{color:#88a7ba;font-size:10px;font-weight:500}.sidebar-label{margin:0 12px 10px;color:#7597ad;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}nav,.sidebar-bottom-menu{display:grid;gap:4px}.sidebar-bottom-menu{margin-top:31px}.operations-menu-item{position:relative;display:flex;align-items:center;gap:13px;min-height:43px;padding:0 12px;border:0;border-radius:8px;color:#b8cedb;background:transparent;text-align:left;font-size:13px;cursor:pointer;transition:background .2s,color .2s}.operations-menu-item:hover,.operations-menu-item.active{color:#fff;background:rgba(103,184,203,.16)}.operations-menu-item.active:before{content:'';position:absolute;left:-15px;width:3px;height:23px;border-radius:0 3px 3px 0;background:#69c6cb}.menu-icon{display:grid;place-items:center;width:25px;height:25px;border-radius:7px;color:#8cb4c8;font-size:11px;font-weight:800}.active .menu-icon{color:#82d2d1;background:rgba(115,210,210,.14)}.menu-count{margin-left:auto;padding:3px 7px;border-radius:9px;color:#a9e2e0;background:rgba(109,203,202,.16);font-size:10px}.sidebar-profile{display:flex;align-items:center;gap:10px;margin-top:auto;padding:15px 8px 2px;border-top:1px solid rgba(255,255,255,.1)}.sidebar-profile>div:nth-child(2){display:grid;gap:3px;min-width:0;flex:1}.sidebar-profile strong{overflow:hidden;color:#fff;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.sidebar-profile span{color:#82a3b6;font-size:10px}.sidebar-profile button{border:0;color:#91afbe;background:transparent;cursor:pointer;font-size:18px}.operations-content{flex:1;min-width:0;padding:0 clamp(24px,4vw,58px) 48px}.operations-topbar{display:flex;align-items:center;justify-content:space-between;height:82px;border-bottom:1px solid #e5eaf0}.breadcrumb{display:flex;align-items:center;gap:10px;color:#98a2b3;font-size:12px}.breadcrumb b{color:#c5ccd5;font-weight:400}.breadcrumb strong{color:#344054}.topbar-actions{display:flex;align-items:center;gap:18px}.search-box{display:flex;align-items:center;gap:7px;width:205px;min-height:35px;padding:0 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff}.search-box span{color:#98a2b3;font-size:20px;transform:rotate(-20deg)}.search-box input{min-height:31px;padding:0;border:0;font-size:11px;box-shadow:none}.icon-button{position:relative;width:32px;height:32px;border:0;color:#667085;background:transparent;font-size:19px;cursor:pointer}.icon-button i{position:absolute;top:5px;right:4px;width:5px;height:5px;border-radius:50%;background:#e26868}.avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;color:#fff;background:linear-gradient(145deg,#347b99,#153e60);font-size:11px;font-weight:800}.avatar-small{width:30px;height:30px;flex-shrink:0;font-size:9px}.dashboard-view{padding-top:39px}.dashboard-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:29px}.dashboard-heading h1{margin:0 0 9px;color:#142c43;font-size:28px;letter-spacing:-.045em}.dashboard-heading h1 span{color:#e8ae58;font-size:17px;vertical-align:4px}.dashboard-heading>div>p:last-child{margin:0;color:#7d8999;font-size:13px}.secondary-button{color:#31516c;background:#fff;border:1px solid #dce5ed;box-shadow:0 3px 8px rgba(28,53,77,.04);font-size:12px}.secondary-button:hover{background:#f7fafc}.secondary-button.compact{min-height:36px;padding:0 13px;font-size:11px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}.metric-card{padding:18px 19px 17px;border:1px solid #e5eaf0;border-radius:10px;background:#fff;box-shadow:0 4px 12px rgba(25,47,70,.025)}.metric-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.metric-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;font-size:11px;font-weight:900}.tone-blue{color:#3983b2;background:#e7f3fa}.tone-amber{color:#bd8235;background:#fff4df}.tone-violet{color:#7769bb;background:#efedff}.tone-green{color:#398d73;background:#e5f6ef}.metric-trend{padding:4px 6px;border-radius:5px;font-size:9px;font-weight:800}.trend-blue{color:#4182a6;background:#edf7fb}.trend-amber{color:#b27a30;background:#fff8ea}.trend-violet{color:#7368af;background:#f4f2ff}.trend-green{color:#348267;background:#edf9f4}.metric-card>strong{display:block;margin-bottom:5px;color:#172f47;font-size:27px;letter-spacing:-.05em}.metric-card h3{margin:0 0 5px;color:#526174;font-size:12px;font-weight:700}.metric-card p{margin:0;color:#9aa5b3;font-size:10px}
.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(350px,.92fr);gap:15px;margin-top:18px}.panel{border:1px solid #e5eaf0;border-radius:10px;background:#fff;box-shadow:0 4px 12px rgba(25,47,70,.025)}.pipeline-panel,.activity-panel{min-height:277px;padding:20px}.panel-heading{display:flex;align-items:start;justify-content:space-between;gap:15px}.panel-heading h2{margin:0 0 6px;color:#223b53;font-size:14px;letter-spacing:-.02em}.panel-heading p{margin:0;color:#98a2b3;font-size:10px}.more-button{padding:0;border:0;color:#8a96a5;background:transparent;font-size:10px;cursor:pointer}.pipeline-list{display:grid;gap:20px;margin-top:28px}.pipeline-row{display:grid;gap:8px}.pipeline-label{display:flex;justify-content:space-between;color:#687588;font-size:11px}.pipeline-label strong{color:#243d54}.progress-track{height:7px;overflow:hidden;border-radius:5px;background:#edf1f5}.progress-track span{display:block;height:100%;min-width:12%;border-radius:inherit}.progress-blue{background:#4b9bc0}.progress-violet{background:#8f83d1}.progress-amber{background:#e2ab55}.progress-green{background:#5bb394}.panel-footer{display:flex;align-items:center;gap:18px;margin-top:22px;color:#8995a4;font-size:10px}.panel-footer span{display:inline-flex;align-items:center;gap:5px}.panel-footer strong{color:#526174}.panel-footer a{margin-left:auto;color:#3d84a7;text-decoration:none;font-weight:800}.legend-dot{width:7px;height:7px;border-radius:50%}.dot-blue{background:#4b9bc0}.dot-gray{background:#cbd5df}.activity-list{display:grid;gap:14px;margin-top:21px}.activity-item{display:flex;align-items:center;gap:10px}.avatar-activity{width:29px;height:29px;font-size:9px}.avatar-blue{color:#347da7;background:#e8f4fa}.avatar-green{color:#39836d;background:#e5f5ee}.avatar-violet{color:#7165af;background:#eeecff}.avatar-amber{color:#ac7733;background:#fff3dd}.activity-copy{display:grid;gap:3px;min-width:0;flex:1}.activity-copy strong{color:#46566a;font-size:10px}.activity-copy span,.activity-item time{color:#9aa5b3;font-size:9px}.activity-item time{white-space:nowrap}.centered{justify-content:center}.requests-panel{margin-top:18px;padding:20px 20px 4px}.table-wrap{overflow-x:auto;margin-top:19px}table{width:100%;border-collapse:collapse;min-width:700px}th{padding:0 10px 12px;color:#9aa5b3;font-size:9px;font-weight:700;text-align:left}td{padding:13px 10px;border-top:1px solid #f0f2f5;color:#687588;font-size:10px}td:first-child,th:first-child{padding-left:0}.request-id{color:#3b7e9f;font-size:10px}.status-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:5px;font-size:9px;font-weight:700;white-space:nowrap}.status-pill i{width:5px;height:5px;border-radius:50%}.status-blue{color:#367ca2;background:#eaf5fa}.status-blue i{background:#49a0c3}.status-green{color:#348267;background:#e9f7f0}.status-green i{background:#54b58d}.status-amber{color:#a9752d;background:#fff5e4}.status-amber i{background:#dfaa52}.status-red{color:#b54747;background:#fff0f1}.status-red i{background:#ed1c24}.notification-action{min-height:29px;padding:0 10px;border:1px solid #d8e5ee;border-radius:6px;color:#28627f;background:#f5fafc;font-size:9px;font-weight:800;white-space:nowrap;cursor:pointer}.notification-action:hover{color:#fff;background:#0e4567}.notification-action:disabled{opacity:.55;cursor:wait}.row-action{padding:0 4px;border:0;color:#9ca8b5;background:transparent;cursor:pointer}.module-view{padding-top:39px}.module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:16px}.module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.module-heading>div>p:last-child{margin:0;color:#7d8999;font-size:13px}.module-search{display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:0 8px 0 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.module-search>span{color:#98a2b3;font-size:20px;transform:rotate(-20deg)}.module-search input{min-height:40px;padding:0;border:0;box-shadow:none;font-size:11px}.module-search input:focus{box-shadow:none}.module-search button{min-height:29px;padding:0 12px;border:0;border-radius:6px;color:#fff;background:#0e4567;font-size:10px;font-weight:800;cursor:pointer}.data-panel{padding:20px 20px 4px}.data-summary{display:flex;align-items:baseline;gap:8px;padding-bottom:4px;color:#98a2b3;font-size:11px}.data-summary strong{color:#173a55;font-size:24px;letter-spacing:-.05em}.data-table{min-width:780px}.data-table th{padding-top:10px}.data-table td{font-size:11px}.table-person{display:flex;align-items:center;gap:9px;color:#344b60}.avatar-table{width:27px;height:27px;flex-shrink:0;font-size:8px}.count-badge,.source-badge{display:inline-flex;padding:4px 7px;border-radius:5px;color:#397aa2;background:#eaf5fa;font-size:10px;font-weight:800}.source-badge{color:#667085;background:#f1f3f6;font-weight:600}.muted-cell{color:#a0acb8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px!important}.empty-row{padding:40px 0!important;color:#98a2b3;text-align:center}.pagination-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 0 12px;color:#98a2b3;font-size:10px}.pagination-bar>div{display:flex;gap:7px}.pagination-bar button{padding:7px 10px;border:1px solid #dce5ed;border-radius:6px;color:#526174;background:#fff;font-size:10px;cursor:pointer}.pagination-bar button:disabled{opacity:.45;cursor:not-allowed}.module-state{margin-top:20px;padding:45px 20px;color:#718096;text-align:center}.module-state-error{color:#b54747}.empty-module{display:grid;place-items:start;max-width:600px;margin:60px auto;padding:40px}.empty-module h1{margin:0 0 9px}.empty-module>p:not(.eyebrow){margin:0 0 24px;color:#7d8999}
.request-link,.client-link{padding:0;border:0;color:#3b7e9f;background:transparent;font-size:inherit;font-weight:700;text-align:left;cursor:pointer}.client-link{color:#344b60;font-weight:500}.request-link:hover,.client-link:hover{text-decoration:underline}.request-detail-backdrop{position:fixed;inset:0;z-index:20;display:flex;justify-content:flex-end;background:rgba(9,30,48,.28)}.request-detail-panel{position:relative;width:min(520px,100%);height:100%;overflow-y:auto;padding:42px 34px;background:#fff;box-shadow:-14px 0 35px rgba(16,39,59,.14)}.request-detail-close{position:absolute;top:18px;right:22px;width:32px;height:32px;border:1px solid #dce5ed;border-radius:50%;color:#526174;background:#fff;font-size:22px;line-height:1;cursor:pointer}.request-detail-panel h2{margin:0 0 12px;color:#142c43;font-size:25px;letter-spacing:-.04em}.detail-section{margin-top:30px;padding-top:21px;border-top:1px solid #e5eaf0}.detail-section h3{margin:0 0 15px;color:#223b53;font-size:13px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px 20px;margin:0}.detail-grid div{min-width:0}.detail-grid dt{margin-bottom:5px;color:#98a2b3;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.detail-grid dd{margin:0;overflow-wrap:anywhere;color:#344b60;font-size:12px;line-height:1.45}.request-history{display:grid;gap:10px}.request-history-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #edf1f5;border-radius:8px}.request-history-item>div{display:grid;gap:4px;min-width:0}.request-history-item strong{color:#3b7e9f;font-size:11px}.request-history-item span:not(.status-pill){color:#7d8999;font-size:10px}@media(max-width:980px){.operations-login{grid-template-columns:1fr}.login-showcase{min-height:360px}.showcase-copy h1{font-size:40px}.operations-login-panel{min-height:560px}.operations-sidebar{width:220px}.metric-grid{grid-template-columns:repeat(2,1fr)}.dashboard-grid{grid-template-columns:1fr}}
@media(max-width:720px){.operations-shell{display:block}.operations-sidebar{width:100%;padding:18px 15px}.sidebar-brand{margin-bottom:24px}.sidebar-label,.sidebar-bottom-menu{display:none}.operations-sidebar nav{grid-template-columns:repeat(2,1fr)}.sidebar-profile{margin-top:17px}.operations-content{padding:0 16px 32px}.operations-topbar{height:68px}.search-box{display:none}.dashboard-view{padding-top:28px}.dashboard-heading{display:block}.dashboard-heading .secondary-button{margin-top:18px}.metric-grid{gap:9px}.metric-card{padding:14px}.metric-card>strong{font-size:23px}.metric-trend{display:none}.pipeline-panel,.activity-panel,.requests-panel{padding:16px}.operations-login-panel{padding:30px 22px}}
.security-notice{margin:0 0 14px;padding:11px 13px;border-radius:7px;color:#347b63;background:#e9f7f0;font-size:11px;font-weight:700}.security-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #e5eaf0}.security-tabs button{padding:10px 15px;border:0;border-bottom:2px solid transparent;color:#8995a4;background:transparent;font-size:11px;font-weight:800;cursor:pointer}.security-tabs button.active{color:#0e4567;border-bottom-color:#0e4567}.security-tabs span{display:inline-grid;place-items:center;min-width:20px;margin-left:5px;padding:3px 5px;border-radius:8px;color:#397aa2;background:#eaf5fa;font-size:9px}.security-grid{display:grid;grid-template-columns:minmax(280px,.7fr) minmax(0,1.3fr);gap:16px}.security-form,.security-list{padding:20px}.security-form{display:grid;align-content:start;gap:14px}.security-form .panel-heading{margin-bottom:5px}.security-form h2,.security-list h2{margin:0 0 5px;color:#223b53;font-size:14px}.security-form .panel-heading p,.security-list .panel-heading p{margin:0;color:#98a2b3;font-size:10px}.security-form label{gap:7px;font-size:10px}.security-form input,.security-form select{min-height:40px}.security-form>.primary-button{margin-top:4px}.security-list{min-height:330px}.security-list-item{display:flex;align-items:center;gap:10px;padding:14px 0;border-top:1px solid #f0f2f5}.security-list-item>div:nth-child(2){display:grid;gap:3px;min-width:0;flex:1}.security-list-item strong{overflow:hidden;color:#344b60;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.security-list-item span{overflow:hidden;color:#98a2b3;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.security-item-meta{display:grid;justify-items:end;gap:5px}.security-item-meta small{color:#7e8d9d;font-size:9px}.security-status{padding:4px 7px;border-radius:5px;color:#348267!important;background:#e9f7f0;font-size:9px!important;font-weight:800}.security-status.inactive{color:#b54747!important;background:#fff0f1}.role-item .security-item-meta{margin-left:auto}.permission-picker{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0;padding:10px;border:1px solid #e5eaf0;border-radius:7px}.permission-picker legend{padding:0 0 6px;border:0;font-size:10px}.permission-option{display:flex!important;grid-template-columns:auto 1fr!important;align-items:start;gap:7px!important;padding:5px;border-radius:5px;background:#f8fafc;font-size:9px!important}.permission-option input{width:auto;min-height:auto;margin-top:2px}.permission-option span{display:grid;gap:2px}.permission-option strong{color:#526174;font-size:9px}.permission-option small{color:#9aa5b3;font-size:8px}.service-config-form{margin-bottom:16px}.service-config-form .panel-heading{margin-bottom:4px}.service-price-fields{display:grid;grid-template-columns:1fr 160px;gap:14px}.notification-info{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:12px 14px;border:1px solid #dce7f0;border-radius:8px;color:#687588;background:#eef5fb;font-size:11px}.notification-info p{margin:0;line-height:1.5}.notification-info strong{color:#223b53}.rule-form{margin-top:16px}.rule-form-fields{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:14px}.recipient-picker{grid-template-columns:repeat(3,1fr)}.empty-inline{grid-column:1/-1;color:#98a2b3;font-size:10px}.notification-rules{margin-top:16px}@media(max-width:980px){.security-grid{grid-template-columns:1fr}.rule-form-fields{grid-template-columns:1fr}.recipient-picker{grid-template-columns:1fr 1fr}}@media(max-width:620px){.permission-picker,.recipient-picker{grid-template-columns:1fr}}
.security-view:has(.notification-info) .notification-info{align-items:flex-start;padding:15px 16px;background:linear-gradient(135deg,#eef7fb,#f7fbfd);box-shadow:0 5px 14px rgba(31,82,108,.04)}
.security-view:has(.notification-info) .notification-info:before{content:'Cómo funciona';display:block;flex:0 0 auto;margin:2px 2px 0 0;color:#397aa2;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
.security-view:has(.notification-info) .security-grid{position:relative;margin-top:31px}
.security-view:has(.notification-info) .security-grid:before{content:'1  ·  Agrega los correos';position:absolute;top:-25px;left:0;color:#397aa2;font-size:10px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
.security-view:has(.notification-info) .rule-form{position:relative;margin-top:44px}
.security-view:has(.notification-info) .rule-form:before{content:'2  ·  Define cuándo se envía';position:absolute;top:-28px;left:0;color:#7769bb;font-size:10px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
.security-view:has(.notification-info) .notification-rules{position:relative;margin-top:41px}
.security-view:has(.notification-info) .notification-rules:before{content:'3  ·  Revisa las reglas activas';position:absolute;top:-27px;left:0;color:#398d73;font-size:10px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
.service-config-form{display:none}
.sidebar-head{display:block}.mobile-menu-toggle{display:none}
@media(max-width:720px){.operations-sidebar{padding:12px 14px 10px}.sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.sidebar-brand{margin:0}.mobile-menu-toggle{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(255,255,255,.2);border-radius:7px;color:#d7e8f1;background:rgba(255,255,255,.06);font-size:11px;font-weight:800;cursor:pointer}.mobile-menu-toggle span:first-child{font-size:16px;line-height:1}.operations-sidebar nav{display:none;grid-template-columns:1fr;gap:3px;margin-top:12px}.operations-sidebar nav.open{display:grid}.operations-menu-item{min-height:39px;font-size:12px}.sidebar-profile{margin-top:12px;padding:10px 5px 0}}
</style>

<style scoped>
.detail-empty{padding:14px;border:1px dashed #dce5ed;border-radius:8px;color:#98a2b3;font-size:10px}.request-response-item{display:grid;gap:10px;padding:14px;border:1px solid #e5eaf0;border-radius:8px;background:#fbfcfe}.request-response-item+.request-response-item{margin-top:10px}.request-response-heading{display:flex;align-items:start;justify-content:space-between;gap:10px}.request-response-heading>div{display:grid;gap:4px}.request-response-heading strong{color:#344b60;font-size:11px}.request-response-heading span:not(.status-pill){color:#7d8999;font-size:10px}.request-response-body{margin:0;padding:12px;border-radius:7px;color:#344b60;background:#fff;font-size:11px;line-height:1.6;white-space:pre-wrap}.request-response-pending{margin:0;color:#98a2b3;font-size:10px}.request-response-note{margin:0;padding-top:10px;border-top:1px solid #e5eaf0;color:#526174;font-size:10px;line-height:1.5}.request-response-note strong{color:#344b60}.assignment-controls{display:flex;align-items:end;gap:10px;max-width:520px}.assignment-controls label{display:grid;flex:1;gap:6px;color:#526174;font-size:10px;font-weight:700}.assignment-controls select{min-height:38px;padding:0 10px;border:1px solid #d8e0ea;border-radius:6px;color:#344b60;background:#fff;font-size:11px}.assignment-current{margin:0 0 12px;color:#526174;font-size:11px}.assignment-history{display:grid;gap:8px;margin:14px 0 0;padding:0;list-style:none}.assignment-history li{display:grid;gap:3px;padding:9px 11px;border:1px solid #edf1f5;border-radius:7px}.assignment-history strong{color:#344b60;font-size:10px}.assignment-history span{color:#98a2b3;font-size:9px}@media(max-width:520px){.assignment-controls{align-items:stretch;flex-direction:column}}
.brand-logo{display:block;width:44px;height:44px;flex:0 0 44px;border:1px solid rgba(255,255,255,.26);border-radius:10px;background:#fff;object-fit:contain}.brand-logo-login{width:58px;height:58px;padding:3px;border-color:#e4e9ef;border-radius:12px}
</style>
