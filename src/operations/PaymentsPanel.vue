<script setup>
import { onMounted, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({
  token: { type: String, required: true },
  canOpenRequests: { type: Boolean, default: false },
})
const emit = defineEmits(['open-request'])
const items = ref([])
const loading = ref(true)
const error = ref('')
const searchInput = ref('')
const filters = ref({ search: '', status: '', dateFrom: '', dateTo: '' })
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })

const paymentStatuses = [
  { value: 'approved', label: 'Pagado' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_process', label: 'En proceso' },
  { value: 'rejected', label: 'Rechazado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'refunded', label: 'Reembolsado' },
  { value: 'charged_back', label: 'Contracargo' },
]

function statusLabel(status) {
  return paymentStatuses.find((item) => item.value === status)?.label || status || 'Desconocido'
}

function statusClass(status) {
  if (status === 'approved') return 'payment-status-paid'
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(status)) return 'payment-status-error'
  if (status === 'in_process') return 'payment-status-progress'
  return 'payment-status-pending'
}

function formatMoney(cents, currency) {
  const amount = Number(cents || 0) / 100
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency, minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(amount)
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function load(page = 1) {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pagination.value.pageSize) })
    Object.entries(filters.value).forEach(([key, value]) => { if (value) params.set(key, value) })
    const response = await fetch(`/api/app/payments?${params}`, {
      headers: { Authorization: `Bearer ${props.token}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el listado de pagos.')
    items.value = data.items || []
    pagination.value = data.pagination || pagination.value
  } catch (loadError) {
    error.value = loadError.message
    items.value = []
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  filters.value.search = searchInput.value.trim()
  load(1)
}

onMounted(() => load())
</script>

<template>
  <section class="module-view payments-view">
    <div class="module-heading">
      <div><p class="eyebrow">Control financiero</p><h1>Pagos</h1><p>Consulta los intentos de pago, su estado y la solicitud asociada. Los estados se actualizan automáticamente.</p></div>
      <button type="button" class="secondary-button compact" :disabled="loading" @click="load(pagination.page)">↻ Actualizar</button>
    </div>
    <p v-if="error" class="request-error" role="alert">{{ error }}</p>
    <ListView
      title="Historial de pagos"
      description="Cada fila corresponde a un intento de pago registrado en Mercado Pago."
      :count="pagination.totalItems"
      :page="pagination.page"
      :total-pages="pagination.totalPages"
      :loading="loading"
      :empty="!items.length && !loading"
      empty-text="No hay pagos que coincidan con estos filtros."
      @previous="load(pagination.page - 1)"
      @next="load(pagination.page + 1)"
    >
      <template #toolbar>
        <form class="payments-filters" @submit.prevent="applyFilters">
          <label class="payments-search"><span aria-hidden="true">⌕</span><input v-model="searchInput" type="search" placeholder="Buscar pago, solicitud o cliente…" aria-label="Buscar pagos" /></label>
          <label><span class="sr-only">Estado del pago</span><select v-model="filters.status"><option value="">Todos los estados</option><option v-for="status in paymentStatuses" :key="status.value" :value="status.value">{{ status.label }}</option></select></label>
          <label><span class="sr-only">Desde</span><input v-model="filters.dateFrom" type="date" aria-label="Fecha desde" /></label>
          <label><span class="sr-only">Hasta</span><input v-model="filters.dateTo" type="date" aria-label="Fecha hasta" /></label>
          <button class="primary-button compact" type="submit">Buscar</button>
        </form>
      </template>
      <template #columns><th>Solicitud</th><th>Cliente</th><th>Servicio</th><th>Estado del pago</th><th>Valor USD</th><th>Valor COP</th><th>Referencia de pago</th><th>Fecha</th></template>
      <template #rows>
        <tr v-for="payment in items" :key="payment.id">
          <td><button v-if="canOpenRequests" type="button" class="payment-request-link" @click="emit('open-request', { id: payment.requestId })">{{ payment.requestReference }}</button><strong v-else>{{ payment.requestReference }}</strong></td>
          <td>{{ payment.clientName }}</td>
          <td>{{ payment.serviceName }}</td>
          <td><span :class="['payment-status', statusClass(payment.status)]"><i></i>{{ statusLabel(payment.status) }}</span></td>
          <td>{{ formatMoney(payment.usdAmountCents, 'USD') }}</td>
          <td>{{ formatMoney(payment.copAmountCents, 'COP') }}</td>
          <td class="payment-reference" :title="payment.paymentId || payment.preferenceId || payment.paymentReference">{{ payment.paymentId || payment.preferenceId || payment.paymentReference }}</td>
          <td>{{ formatDate(payment.createdAt) }}</td>
        </tr>
      </template>
    </ListView>
  </section>
</template>

<style scoped>
.payments-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:20px}.payments-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.payments-view .module-heading p:last-child{max-width:720px;margin:0;color:#7d8999;font-size:13px;line-height:1.5}.payments-filters{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.payments-filters label{display:flex;min-width:140px}.payments-filters input,.payments-filters select{width:100%;min-height:38px;padding:0 10px;border:1px solid #dce5ed;border-radius:7px;color:#344b60;background:#fff;font:inherit;font-size:11px}.payments-search{flex:1;min-width:220px!important;align-items:center;gap:8px;padding-left:10px;border:1px solid #dce5ed;border-radius:7px;background:#fff}.payments-search span{color:#8391a2;font-size:19px}.payments-search input{min-width:0;border:0;outline:0}.payment-status{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:5px;font-size:10px;font-weight:700;white-space:nowrap}.payment-status i{width:6px;height:6px;border-radius:50%;background:currentColor}.payment-status-paid{color:#348267;background:#e9f7f0}.payment-status-pending{color:#a9752d;background:#fff5e4}.payment-status-progress{color:#367ca2;background:#eaf5fa}.payment-status-error{color:#b54747;background:#fff0f1}.payment-request-link{padding:0;border:0;color:#347da7;background:transparent;font:inherit;font-weight:800;cursor:pointer}.payment-request-link:hover{text-decoration:underline}.payment-reference{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px!important}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:720px){.payments-view .module-heading{align-items:start;flex-direction:column}.payments-filters{align-items:stretch}.payments-filters>*{flex:1 1 145px}}
</style>
