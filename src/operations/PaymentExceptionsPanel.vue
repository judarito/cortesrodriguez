<script setup>
import { computed, onMounted, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({ token: { type: String, required: true }, locale: { type: String, default: 'es' } })
const en = computed(() => props.locale === 'en')
const t = (es, english) => en.value ? english : es
const cases = ref([])
const page = ref(1)
const totalPages = ref(1)
const totalItems = ref(0)
const status = ref('open')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref(null)
const actions = ref([])
const actionType = ref('')
const reason = ref('')
const externalReference = ref('')
const saving = ref(false)
const detailLoading = ref(false)

const statuses = [
  { value: 'open', es: 'Abiertos', en: 'Open' },
  { value: 'pending_external', es: 'Pendiente externo', en: 'Pending external action' },
  { value: 'resolved', es: 'Resueltos', en: 'Resolved' },
  { value: 'all', es: 'Todos', en: 'All' },
]

const actionOptions = computed(() => {
  if (!selected.value) return []
  const { exceptionType, resolutionStatus } = selected.value
  const later = resolutionStatus === 'pending_external'
  let options
  if (exceptionType === 'duplicate_approved') options = later
    ? [{ value: 'refund_confirmed', es: 'Confirmar reembolso', en: 'Confirm refund' }, { value: 'retain_approved_payment', es: 'Conservar el pago válido', en: 'Keep the valid payment' }]
    : [{ value: 'refund_requested', es: 'Registrar solicitud de reembolso', en: 'Record refund request' }, { value: 'refund_confirmed', es: 'Confirmar reembolso', en: 'Confirm refund' }, { value: 'retain_approved_payment', es: 'Conservar el pago válido', en: 'Keep the valid payment' }]
  else if (exceptionType === 'refunded') options = [{ value: 'refund_verified', es: 'Confirmar reembolso verificado', en: 'Confirm verified refund' }]
  else options = later
    ? [{ value: 'chargeback_disputed', es: 'Registrar disputa', en: 'Record dispute' }, { value: 'chargeback_closed', es: 'Registrar cierre del contracargo', en: 'Record chargeback closure' }]
    : [{ value: 'chargeback_acknowledged', es: 'Reconocer y gestionar', en: 'Acknowledge and handle' }, { value: 'chargeback_disputed', es: 'Registrar disputa', en: 'Record dispute' }, { value: 'chargeback_closed', es: 'Registrar cierre del contracargo', en: 'Record chargeback closure' }]
  return options.filter((option) => !actions.value.some((action) => action.actionType === option.value))
})

function statusLabel(value) { return statuses.find((item) => item.value === value)?.[en.value ? 'en' : 'es'] || value }
function typeLabel(value) { return ({ duplicate_approved: t('Pago duplicado', 'Duplicate payment'), refunded: t('Reembolso', 'Refund'), chargeback: t('Contracargo', 'Chargeback') })[value] || value }
function resolutionLabel(value) { return ({ open: t('Abierto', 'Open'), pending_external: t('Gestión externa', 'External action'), resolved: t('Resuelto', 'Resolved') })[value] || value }
function actionLabel(value) {
  const labels = {
    refund_requested: ['Reembolso solicitado', 'Refund requested'], refund_confirmed: ['Reembolso confirmado', 'Refund confirmed'],
    retain_approved_payment: ['Pago válido conservado', 'Valid payment retained'], refund_verified: ['Reembolso verificado', 'Refund verified'],
    chargeback_acknowledged: ['Contracargo reconocido', 'Chargeback acknowledged'], chargeback_disputed: ['Contracargo disputado', 'Chargeback disputed'],
    chargeback_closed: ['Contracargo cerrado', 'Chargeback closed'],
  }
  return labels[value] ? t(...labels[value]) : value
}
function formatMoney(cents, currency) { return new Intl.NumberFormat(en.value ? 'en-US' : 'es-CO', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(Number(cents || 0) / 100) }
function formatDate(value) { return value ? new Intl.DateTimeFormat(en.value ? 'en-US' : 'es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${props.token}`, ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || t('No se pudo completar la operación.', 'Could not complete the operation.'))
  return data
}

async function load(nextPage = 1) {
  loading.value = true; error.value = ''; notice.value = ''
  try {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: '10', status: status.value })
    const data = await api(`/api/app/payment-exceptions?${params}`)
    cases.value = data.items || []; page.value = data.pagination?.page || nextPage
    totalPages.value = data.pagination?.pageCount || 1; totalItems.value = Number(data.pagination?.total || 0)
  } catch (loadError) { error.value = loadError.message; cases.value = [] }
  finally { loading.value = false }
}

async function openCase(item) {
  selected.value = item; actions.value = []; error.value = ''; actionType.value = ''; reason.value = ''; externalReference.value = ''; detailLoading.value = true
  try {
    const data = await api(`/api/app/payment-exceptions/${item.id}`)
    selected.value = data.case; actions.value = data.actions || []
    actionType.value = actionOptions.value[0]?.value || ''
  } catch (detailError) { error.value = detailError.message }
  finally { detailLoading.value = false }
}

async function submitAction() {
  if (!selected.value || !actionType.value || reason.value.trim().length < 10) return
  saving.value = true; error.value = ''; notice.value = ''
  try {
    await api(`/api/app/payment-exceptions/${selected.value.id}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: actionType.value, reason: reason.value.trim(), externalReference: externalReference.value.trim(), idempotencyKey: crypto.randomUUID() }),
    })
    const successMessage = t('La gestión quedó registrada en la auditoría. El estado del pago sigue sincronizado con Mercado Pago.', 'The action was recorded in the audit log. Payment status remains synchronized with Mercado Pago.')
    reason.value = ''; externalReference.value = ''
    await load(page.value)
    if (selected.value) await openCase(selected.value)
    notice.value = successMessage
  } catch (saveError) { error.value = saveError.message }
  finally { saving.value = false }
}

function requiresExternalReference(action) { return ['refund_confirmed', 'chargeback_disputed', 'chargeback_closed'].includes(action) }
onMounted(() => load())
</script>

<template>
  <section class="payment-exceptions">
    <header class="exception-heading"><div><p class="eyebrow">{{ t('Seguimiento financiero', 'Financial follow-up') }}</p><h2>{{ t('Excepciones de pago', 'Payment exceptions') }}</h2><p>{{ t('Registra la revisión de pagos duplicados, reembolsos y contracargos. Este panel no inicia reembolsos ni cambia estados de Mercado Pago.', 'Track reviews for duplicate payments, refunds, and chargebacks. This panel does not issue refunds or alter Mercado Pago statuses.') }}</p></div><div class="exception-controls"><label><span class="sr-only">{{ t('Filtrar por estado', 'Filter by status') }}</span><select v-model="status" @change="load(1)"><option v-for="item in statuses" :key="item.value" :value="item.value">{{ item[en ? 'en' : 'es'] }}</option></select></label><button type="button" class="secondary-button compact" :disabled="loading" @click="load(page)">{{ t('Actualizar', 'Refresh') }}</button></div></header>
    <p v-if="notice" class="security-notice" role="status">{{ notice }}</p><p v-if="error" class="request-error" role="alert">{{ error }}</p>
    <ListView :locale="props.locale" :title="t('Casos financieros', 'Financial cases')" :description="t('Cada caso conserva el estado del proveedor y su historial administrativo.', 'Each case preserves provider status and administrative history.')" :count="totalItems" :page="page" :total-pages="totalPages" :loading="loading" :empty="!cases.length && !loading" :empty-text="t('No hay excepciones con este filtro.', 'No exceptions match this filter.')" @previous="load(page - 1)" @next="load(page + 1)">
      <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Tipo', 'Type') }}</th><th>{{ t('Pago proveedor', 'Provider payment') }}</th><th>{{ t('Estado del caso', 'Case status') }}</th><th>{{ t('Valor', 'Amount') }}</th><th>{{ t('Creado', 'Created') }}</th><th>{{ t('Acción', 'Action') }}</th></template>
      <template #rows><tr v-for="item in cases" :key="item.id"><td><strong>{{ item.requestReference }}</strong></td><td>{{ typeLabel(item.exceptionType) }}</td><td>{{ item.providerPaymentStatus }}<small v-if="item.providerPaymentId" class="exception-provider-id">MP {{ item.providerPaymentId }}</small></td><td><span :class="['exception-status', `exception-${item.resolutionStatus}`]">{{ resolutionLabel(item.resolutionStatus) }}</span></td><td>{{ formatMoney(item.usdAmountCents, 'USD') }}<small class="exception-provider-id">{{ formatMoney(item.copAmountCents, 'COP') }}</small></td><td>{{ formatDate(item.createdAt) }}</td><td><button type="button" class="secondary-button compact" @click="openCase(item)">{{ t('Gestionar', 'Manage') }}</button></td></tr></template>
    </ListView>
    <section v-if="selected" class="exception-case-panel panel"><header class="exception-case-heading"><div><p class="eyebrow">{{ typeLabel(selected.exceptionType) }} · {{ resolutionLabel(selected.resolutionStatus) }}</p><h3>{{ selected.requestReference }}</h3><p>{{ t('Estado sincronizado con el proveedor', 'Provider-synchronized status') }}: <strong>{{ selected.providerPaymentStatus }}</strong> · {{ selected.paymentReference }}</p></div><button type="button" class="secondary-button compact" @click="selected = null">{{ t('Cerrar', 'Close') }}</button></header>
      <div v-if="detailLoading" class="module-state">{{ t('Cargando historial…', 'Loading history…') }}</div>
      <template v-else><div class="exception-history"><h4>{{ t('Historial de gestión', 'Action history') }}</h4><p v-if="!actions.length" class="activity-empty">{{ t('No hay acciones registradas.', 'No actions recorded.') }}</p><article v-for="action in actions" :key="action.id"><strong>{{ actionLabel(action.actionType) }}</strong><span>{{ action.actorName || t('Administración', 'Administration') }} · {{ formatDate(action.createdAt) }}</span><p>{{ action.reason }}</p><small v-if="action.externalReference">{{ t('Referencia externa', 'External reference') }}: {{ action.externalReference }}</small></article></div>
        <form v-if="selected.resolutionStatus !== 'resolved' && actionOptions.length" class="exception-action-form" @submit.prevent="submitAction"><h4>{{ t('Registrar gestión', 'Record action') }}</h4><label>{{ t('Acción', 'Action') }}<select v-model="actionType"><option v-for="option in actionOptions" :key="option.value" :value="option.value">{{ option[en ? 'en' : 'es'] }}</option></select></label><label>{{ t('Motivo y resultado (mínimo 10 caracteres)', 'Reason and outcome (minimum 10 characters)') }}<textarea v-model="reason" maxlength="1000" minlength="10" required rows="3"/></label><label v-if="requiresExternalReference(actionType)">{{ t('Referencia externa de la operación', 'External operation reference') }}<input v-model="externalReference" maxlength="160" required /></label><button type="submit" class="primary-button compact" :disabled="saving || reason.trim().length < 10 || (requiresExternalReference(actionType) && !externalReference.trim())">{{ saving ? t('Guardando…', 'Saving…') : t('Guardar gestión auditada', 'Save audited action') }}</button></form>
      </template>
    </section>
  </section>
</template>

<style scoped>
.payment-exceptions{display:grid;gap:14px;margin:0 0 24px}.exception-heading,.exception-case-heading{display:flex;align-items:start;justify-content:space-between;gap:18px}.exception-heading h2,.exception-case-heading h3{margin:0 0 6px;color:#223b53;font-size:18px}.exception-heading p:last-child,.exception-case-heading p:last-child{max-width:700px;margin:0;color:#8290a0;font-size:11px;line-height:1.5}.exception-controls{display:flex;gap:8px}.exception-controls select,.exception-action-form select,.exception-action-form input,.exception-action-form textarea{min-height:36px;padding:0 10px;border:1px solid #dce5ed;border-radius:7px;color:#344b60;background:#fff;font:inherit;font-size:11px}.exception-case-panel{padding:18px}.exception-case-heading h3{font-size:16px}.exception-case-heading .eyebrow{margin:0 0 6px;color:#347da7;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.exception-history{display:grid;gap:9px;margin-top:16px}.exception-history h4,.exception-action-form h4{margin:0;color:#344b60;font-size:12px}.exception-history article{display:grid;gap:4px;padding:10px;border:1px solid #edf1f5;border-radius:7px}.exception-history article strong{color:#344b60;font-size:11px}.exception-history article span,.exception-history article small{color:#8290a0;font-size:10px}.exception-history article p{margin:3px 0 0;color:#526174;font-size:11px;white-space:pre-wrap}.exception-action-form{display:grid;gap:10px;margin-top:16px;padding-top:15px;border-top:1px solid #e8edf2}.exception-action-form label{display:grid;gap:5px;color:#526174;font-size:10px;font-weight:700}.exception-action-form textarea{padding:9px;resize:vertical}.exception-status{display:inline-flex;padding:5px 8px;border-radius:5px;color:#a9752d;background:#fff5e4;font-size:10px;font-weight:800}.exception-pending_external{color:#397aa2;background:#eaf5fa}.exception-resolved{color:#348267;background:#e9f7f0}.exception-provider-id{display:block;margin-top:4px;color:#98a2b3;font-size:9px}.activity-empty{color:#98a2b3;font-size:11px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:720px){.exception-heading,.exception-case-heading{align-items:stretch;flex-direction:column}.exception-controls{justify-content:space-between}.exception-controls>*{flex:1}}
</style>
