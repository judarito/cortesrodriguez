<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({
  token: { type: String, required: true },
  locale: { type: String, default: 'es' },
})

const isEnglish = computed(() => props.locale === 'en')
const t = (es, en) => isEnglish.value ? en : es
const localeTag = computed(() => isEnglish.value ? 'en-US' : 'es-CO')
const loading = ref(false)
const error = ref('')
const report = ref(null)
const dateRangeError = ref('')
const filters = reactive(defaultDateRange())
const pageSize = 10
const pages = reactive({ agent: 1, expert: 1, client: 1 })
const paymentPage = ref(1)
const paymentPageSize = 10

function localIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { dateFrom: localIsoDate(from), dateTo: localIsoDate(to) }
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validateRange() {
  dateRangeError.value = ''
  if (!validIsoDate(filters.dateFrom) || !validIsoDate(filters.dateTo)) {
    dateRangeError.value = t('Selecciona fechas válidas.', 'Choose valid dates.')
    return false
  }
  const days = (Date.parse(`${filters.dateTo}T00:00:00Z`) - Date.parse(`${filters.dateFrom}T00:00:00Z`)) / 86400000 + 1
  if (days < 1) {
    dateRangeError.value = t('La fecha inicial no puede ser posterior a la final.', 'The start date must not be after the end date.')
    return false
  }
  if (days > 366) {
    dateRangeError.value = t('El rango máximo es de 366 días.', 'The maximum range is 366 days.')
    return false
  }
  return true
}

async function load(page = 1) {
  if (!validateRange()) return
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo, page: String(page), pageSize: String(paymentPageSize) })
    const response = await fetch(`/api/app/reports?${params}`, {
      headers: { Authorization: `Bearer ${props.token}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const serverMessage = typeof data.error === 'string' ? data.error : ''
      throw new Error(isEnglish.value
        ? 'Could not load reports. Check your access and try again.'
        : serverMessage || 'No se pudieron cargar los reportes. Verifica tu acceso e inténtalo de nuevo.')
    }
    report.value = data
    paymentPage.value = data.payments?.pagination?.page || page
    Object.assign(pages, { agent: 1, expert: 1, client: 1 })
  } catch (loadError) {
    error.value = loadError?.message || t('No se pudieron cargar los reportes.', 'Could not load reports.')
    report.value = null
  } finally {
    loading.value = false
  }
}

function amount(cents, currency) {
  return new Intl.NumberFormat(localeTag.value, {
    style: 'currency', currency,
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format((Number(cents) || 0) / 100)
}

function dateLabel(value) {
  if (!value || !validIsoDate(value)) return value || '—'
  return new Intl.DateTimeFormat(localeTag.value, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}

function stateLabel(status) {
  const labels = {
    pending: ['Pendiente', 'Pending'],
    in_review: ['En revisión', 'In review'],
    in_progress: ['En gestión', 'In progress'],
    closed: ['Cerrada', 'Closed'],
    cancelled: ['Cancelada', 'Cancelled'],
  }
  return labels[status]?.[isEnglish.value ? 1 : 0] || status
}

function paymentStatusLabel(status) {
  const labels = {
    approved: ['Pagado', 'Paid'], pending: ['Pendiente', 'Pending'], in_process: ['En proceso', 'In process'],
    rejected: ['Rechazado', 'Rejected'], cancelled: ['Cancelado', 'Cancelled'], refunded: ['Reembolsado', 'Refunded'],
    charged_back: ['Contracargo', 'Chargeback'], duplicate_approved: ['Pago duplicado · revisar', 'Duplicate payment · review'],
    creation_uncertain: ['Creación incierta', 'Creation uncertain'],
  }
  return labels[status]?.[isEnglish.value ? 1 : 0] || status
}

const summaryCards = computed(() => {
  const summary = report.value?.summary || {}
  const payments = summary.payments || {}
  return [
    { label: t('Solicitudes', 'Requests'), value: summary.requestCount ?? 0, detail: t('Creadas en el período', 'Created in period'), tone: 'blue' },
    { label: t('Pagos aprobados', 'Approved payments'), value: payments.approved?.requestCount ?? 0, detail: `${amount(payments.approved?.usdCents, 'USD')} · ${amount(payments.approved?.copCents, 'COP')}`, tone: 'green' },
    { label: t('Reembolsos actuales', 'Current refunds'), value: payments.refunded?.requestCount ?? 0, detail: `${amount(payments.refunded?.usdCents, 'USD')} · ${amount(payments.refunded?.copCents, 'COP')}`, tone: 'amber' },
    { label: t('Contracargos actuales', 'Current chargebacks'), value: payments.chargedBack?.requestCount ?? 0, detail: `${amount(payments.chargedBack?.usdCents, 'USD')} · ${amount(payments.chargedBack?.copCents, 'COP')}`, tone: 'red' },
    { label: t('Pagos duplicados por revisar', 'Duplicate payments to review'), value: payments.duplicateApproved?.attemptCount ?? 0, detail: `${payments.duplicateApproved?.requestCount ?? 0} ${t('solicitudes afectadas', 'affected requests')}`, tone: 'amber' },
  ]
})

const attentionRows = computed(() => report.value?.summary?.attentionByStatus || [])
const agentRows = computed(() => report.value?.byAgent || [])
const expertRows = computed(() => report.value?.byExpert || [])
const clientRows = computed(() => report.value?.byClient || [])
const paymentRows = computed(() => report.value?.payments?.items || [])
const paymentsPagination = computed(() => report.value?.payments?.pagination || { page: 1, totalPages: 1, totalItems: 0 })

function visibleRows(rows, key) {
  const start = (pages[key] - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

function totalPages(rows) { return Math.max(Math.ceil(rows.length / pageSize), 1) }
function setPage(key, nextPage) { pages[key] = Math.min(Math.max(nextPage, 1), totalPages({ agent: agentRows.value, expert: expertRows.value, client: clientRows.value }[key])) }

onMounted(load)
</script>

<template>
  <section class="module-view reports-view">
    <div class="module-heading">
      <div>
        <p class="eyebrow">{{ t('Análisis operativo', 'Operations analytics') }}</p>
        <h1>{{ t('Reportes', 'Reports') }}</h1>
        <p>{{ t('Resumen de solicitudes, pagos registrados y actividad por agente, experto y cliente.', 'Summary of requests, recorded payments, and activity by agent, expert, and client.') }}</p>
      </div>
      <button type="button" class="secondary-button compact" :disabled="loading" @click="load(paymentPage)">↻ {{ t('Actualizar', 'Refresh') }}</button>
    </div>

    <form class="reports-filters panel" @submit.prevent="load(1)">
      <label>{{ t('Desde', 'From') }}<input v-model="filters.dateFrom" type="date" required /></label>
      <label>{{ t('Hasta', 'To') }}<input v-model="filters.dateTo" type="date" required /></label>
      <button type="submit" class="primary-button compact" :disabled="loading">{{ loading ? t('Cargando…', 'Loading…') : t('Aplicar período', 'Apply period') }}</button>
      <span class="reports-period" v-if="report?.period">{{ dateLabel(report.period.dateFrom) }} – {{ dateLabel(report.period.dateTo) }}</span>
    </form>

    <p v-if="dateRangeError" class="request-error" role="alert">{{ dateRangeError }}</p>
    <p v-if="error" class="request-error" role="alert">{{ error }}</p>

    <div v-if="loading && !report" class="reports-skeleton panel" aria-busy="true" :aria-label="t('Cargando reportes', 'Loading reports')">
      <span v-for="item in 4" :key="item"></span>
    </div>
    <template v-else-if="report">
      <div class="reports-summary-grid">
        <article v-for="card in summaryCards" :key="card.label" class="reports-summary-card panel">
          <span :class="['reports-summary-icon', `tone-${card.tone}`]">{{ card.tone === 'blue' ? 'SO' : card.tone === 'green' ? '$' : card.tone === 'amber' ? '↩' : '!' }}</span>
          <span class="reports-summary-label">{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.detail }}</small>
        </article>
      </div>

      <p class="reports-caveat">{{ t('Los pagos, reembolsos y contracargos reflejan el estado actual registrado para las solicitudes creadas en el período. Los importes son estimaciones basadas en esos registros; no representan liquidación bancaria, comisiones, flujo histórico ni utilidad.', 'Payments, refunds, and chargebacks reflect the current recorded state for requests created in this period. Amounts are estimates based on those records; they are not bank settlements, fees, historical cash flow, or profit.') }}</p>

      <ListView :locale="locale" :title="t('Intentos de pago', 'Payment attempts')" :description="t('Cada fila es un intento individual. Los pagos duplicados se muestran para conciliación y no se suman al total canónico.', 'Each row is an individual attempt. Duplicate payments are shown for reconciliation and excluded from canonical totals.')" :count="paymentsPagination.totalItems" :page="paymentsPagination.page" :total-pages="paymentsPagination.totalPages" :loading="loading" :empty="!paymentRows.length" :empty-text="t('No hay intentos de pago en este período.', 'There are no payment attempts in this period.')" @previous="load(paymentPage - 1)" @next="load(paymentPage + 1)">
        <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Cliente', 'Client') }}</th><th>{{ t('Estado', 'Status') }}</th><th>{{ t('Valor USD', 'Amount USD') }}</th><th>{{ t('Valor COP', 'Amount COP') }}</th><th>{{ t('Referencia', 'Reference') }}</th><th>{{ t('Fecha', 'Date') }}</th></template>
        <template #rows><tr v-for="item in paymentRows" :key="item.paymentId"><td><strong>{{ item.requestReference }}</strong></td><td>{{ item.clientName }}</td><td>{{ paymentStatusLabel(item.status) }}</td><td>{{ amount(item.usdCents, 'USD') }}</td><td>{{ amount(item.copCents, 'COP') }}</td><td>{{ item.providerPaymentId || item.preferenceId || item.paymentReference }}</td><td>{{ item.createdAt ? new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)) : '—' }}</td></tr></template>
      </ListView>

      <ListView :locale="locale" :title="t('Solicitudes por estado', 'Requests by status')" :description="t('Estado operativo actual de las solicitudes del período.', 'Current operational status of requests in this period.')" :count="attentionRows.reduce((sum, item) => sum + Number(item.requestCount || 0), 0)" :loading="loading" :empty="!attentionRows.length" :empty-text="t('No hay solicitudes para este período.', 'There are no requests for this period.')">
        <template #columns><th>{{ t('Estado actual', 'Current status') }}</th><th>{{ t('Solicitudes', 'Requests') }}</th></template>
        <template #rows><tr v-for="item in attentionRows" :key="item.status"><td>{{ stateLabel(item.status) }}</td><td>{{ item.requestCount }}</td></tr></template>
      </ListView>

      <ListView :locale="locale" :title="t('Por agente', 'By agent')" :description="t('Atribución del agente registrada actualmente; las solicitudes directas aparecen como “Sin agente”.', 'Currently recorded agent attribution; direct requests appear as “No agent”.')" :count="agentRows.length" :page="pages.agent" :total-pages="totalPages(agentRows)" :loading="loading" :empty="!agentRows.length" :empty-text="t('No hay datos de agentes para este período.', 'There is no agent data for this period.')" @previous="setPage('agent', pages.agent - 1)" @next="setPage('agent', pages.agent + 1)">
        <template #columns><th>{{ t('Agente', 'Agent') }}</th><th>{{ t('Solicitudes', 'Requests') }}</th><th>{{ t('Pagos aprobados USD', 'Approved payments USD') }}</th><th>{{ t('Pagos aprobados COP', 'Approved payments COP') }}</th></template>
        <template #rows><tr v-for="item in visibleRows(agentRows, 'agent')" :key="item.agentId || 'no-agent'"><td>{{ item.agentName || t('Sin agente', 'No agent') }}</td><td>{{ item.requestCount }}</td><td>{{ amount(item.approvedUsdCents, 'USD') }}</td><td>{{ amount(item.approvedCopCents, 'COP') }}</td></tr></template>
      </ListView>

      <ListView :locale="locale" :title="t('Por experto', 'By expert')" :description="t('Para solicitudes creadas en el período, muestra asignaciones actuales e históricas. Una solicitud reasignada puede aparecer para varios expertos, pero no duplica los totales financieros.', 'For requests created in the period, this shows current and historical assignments. A reassigned request may appear for multiple experts, but it never duplicates financial totals.')" :count="expertRows.length" :page="pages.expert" :total-pages="totalPages(expertRows)" :loading="loading" :empty="!expertRows.length" :empty-text="t('No hay datos de expertos para este período.', 'There is no expert data for this period.')" @previous="setPage('expert', pages.expert - 1)" @next="setPage('expert', pages.expert + 1)">
        <template #columns><th>{{ t('Experto', 'Expert') }}</th><th>{{ t('Asignadas actualmente', 'Currently assigned') }}</th><th>{{ t('Con asignación histórica', 'Historically assigned') }}</th><th>{{ t('En revisión', 'Pending review') }}</th><th>{{ t('Aprobadas', 'Approved') }}</th><th>{{ t('Enviadas', 'Sent') }}</th></template>
        <template #rows><tr v-for="item in visibleRows(expertRows, 'expert')" :key="item.expertId"><td>{{ item.expertName }}</td><td>{{ item.currentAssignedRequestCount }}</td><td>{{ item.historicallyAssignedRequestCount }}</td><td>{{ item.responsesByStatus?.pending_admin_review || 0 }}</td><td>{{ item.responsesByStatus?.approved || 0 }}</td><td>{{ item.responsesByStatus?.sent || 0 }}</td></tr></template>
      </ListView>

      <ListView :locale="locale" :title="t('Por cliente', 'By client')" :description="t('Solicitudes y pagos aprobados asociados al cliente.', 'Requests and approved payments associated with each client.')" :count="clientRows.length" :page="pages.client" :total-pages="totalPages(clientRows)" :loading="loading" :empty="!clientRows.length" :empty-text="t('No hay datos de clientes para este período.', 'There is no client data for this period.')" @previous="setPage('client', pages.client - 1)" @next="setPage('client', pages.client + 1)">
        <template #columns><th>{{ t('Cliente', 'Client') }}</th><th>{{ t('Correo', 'Email') }}</th><th>{{ t('Solicitudes', 'Requests') }}</th><th>{{ t('Pagos aprobados USD', 'Approved payments USD') }}</th><th>{{ t('Pagos aprobados COP', 'Approved payments COP') }}</th></template>
        <template #rows><tr v-for="item in visibleRows(clientRows, 'client')" :key="item.clientId"><td>{{ item.clientName }}</td><td>{{ item.clientEmail || '—' }}</td><td>{{ item.requestCount }}</td><td>{{ amount(item.approvedUsdCents, 'USD') }}</td><td>{{ amount(item.approvedCopCents, 'COP') }}</td></tr></template>
      </ListView>
    </template>
  </section>
</template>

<style scoped>
.reports-view{display:grid;gap:18px}.reports-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px}.reports-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.reports-view .module-heading p:last-child{max-width:760px;margin:0;color:#7d8999;font-size:13px;line-height:1.5}.reports-filters{display:flex;align-items:end;gap:12px;padding:15px;flex-wrap:wrap}.reports-filters label{display:grid;gap:6px;min-width:170px;color:#526174;font-size:10px;font-weight:800}.reports-filters input{min-height:38px;padding:0 10px;border:1px solid #dce5ed;border-radius:7px;color:#344b60;background:#fff;font:inherit;font-size:11px}.reports-period{margin:0 0 10px auto;color:#8794a5;font-size:11px}.reports-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:13px}.reports-summary-card{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:10px;row-gap:3px;padding:16px}.reports-summary-icon{grid-row:span 3;display:grid;place-items:center;width:34px;height:34px;border-radius:8px;font-size:11px;font-weight:900}.tone-blue{color:#397da3;background:#e8f4fa}.tone-green{color:#348267;background:#e9f7f0}.tone-amber{color:#a9752d;background:#fff5e4}.tone-red{color:#b54747;background:#fff0f1}.reports-summary-label{color:#78879a;font-size:10px;font-weight:700}.reports-summary-card strong{color:#173a55;font-size:22px;letter-spacing:-.04em}.reports-summary-card small{color:#8794a5;font-size:10px}.reports-caveat{margin:0;padding:12px 14px;border:1px solid #eadfc9;border-radius:8px;color:#806b48;background:#fffaf0;font-size:11px;line-height:1.55}.reports-skeleton{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:16px}.reports-skeleton span{height:94px;border-radius:8px;background:linear-gradient(90deg,#edf1f5 25%,#f8fafc 50%,#edf1f5 75%);background-size:200% 100%;animation:reports-shimmer 1.3s ease-in-out infinite}@keyframes reports-shimmer{to{background-position:-200% 0}}@media(max-width:850px){.reports-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.reports-view .module-heading{align-items:start;flex-direction:column}.reports-filters label{flex:1 1 140px}.reports-filters .primary-button{flex:1 1 100%}.reports-period{width:100%;margin:0}.reports-summary-grid{grid-template-columns:1fr}.reports-skeleton{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
