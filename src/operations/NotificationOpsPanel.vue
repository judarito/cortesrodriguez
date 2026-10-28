<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({
  token: { type: String, required: true },
  locale: { type: String, default: 'es' },
})

const isEnglish = computed(() => props.locale === 'en')
const t = (es, en) => isEnglish.value ? en : es
const activeTab = ref('emails')
const emailItems = ref([])
const dlqItems = ref([])
const emailPage = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const dlqPage = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const loading = ref(false)
const busyKey = ref('')
const error = ref('')
const notice = ref('')
const dialog = ref(null)
const reason = ref('')
const resendEmailId = ref('')
const confirmed = ref(false)

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat(isEnglish.value ? 'en-US' : 'es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function eventLabel(code) {
  const labels = isEnglish.value
    ? { payment_approved: 'Payment approved', payment_rejected: 'Payment rejected', request_created: 'Request created', status_changed: 'Request updated', expert_assigned: 'Expert assigned', assignment_failed: 'Expert assignment failed', similar_question_review: 'Similar question review', expert_response_submitted: 'Expert response submitted' }
    : { payment_approved: 'Pago aprobado', payment_rejected: 'Pago rechazado', request_created: 'Solicitud creada', status_changed: 'Solicitud actualizada', expert_assigned: 'Experto asignado', assignment_failed: 'Asignación fallida', similar_question_review: 'Revisión de pregunta similar', expert_response_submitted: 'Respuesta del experto enviada' }
  return labels[code] || code || t('Evento desconocido', 'Unknown event')
}

function errorMessage(status, payload) {
  if (payload?.error) return payload.error
  if (status === 401) return t('La sesión venció. Inicia sesión nuevamente.', 'Your session expired. Please sign in again.')
  if (status === 403) return t('Esta operación está disponible solo para administradores.', 'This operation is available to administrators only.')
  return t('No se pudo completar la operación. Inténtalo de nuevo.', 'The operation could not be completed. Please try again.')
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${props.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(errorMessage(response.status, payload))
  return payload
}

async function loadEmails(page = emailPage.value.page) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(emailPage.value.pageSize) })
  const data = await api(`/api/app/notification-ops/email-effects?${params}`)
  emailItems.value = data.items || []
  emailPage.value = data.pagination || emailPage.value
}

async function loadDlq(page = dlqPage.value.page) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(dlqPage.value.pageSize) })
  const data = await api(`/api/app/notification-ops/dlq?${params}`)
  dlqItems.value = data.items || []
  dlqPage.value = data.pagination || dlqPage.value
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadEmails(), loadDlq()])
  } catch (loadError) {
    error.value = loadError.message
  } finally {
    loading.value = false
  }
}

function changePage(kind, page) {
  const pagination = kind === 'emails' ? emailPage.value : dlqPage.value
  if (page < 1 || page > pagination.totalPages || loading.value) return
  void loadKind(kind, page)
}

async function loadKind(kind, page) {
  loading.value = true
  error.value = ''
  try {
    if (kind === 'emails') await loadEmails(page)
    else await loadDlq(page)
  } catch (loadError) {
    error.value = loadError.message
  } finally {
    loading.value = false
  }
}

function beginAction(action, item) {
  dialog.value = { action, item }
  reason.value = ''
  resendEmailId.value = ''
  confirmed.value = false
  error.value = ''
}

function closeDialog() {
  if (busyKey.value) return
  dialog.value = null
}

const actionTitle = computed(() => {
  if (!dialog.value) return ''
  const labels = {
    accepted: t('Conciliar como aceptado', 'Reconcile as accepted'),
    not_sent: t('Confirmar que no fue enviado y reintentar', 'Confirm not sent and retry'),
    redrive: t('Reencolar mensaje DLQ', 'Redrive dead-letter message'),
    ignore: t('Descartar mensaje DLQ', 'Ignore dead-letter message'),
  }
  return labels[dialog.value.action]
})

const actionReady = computed(() => {
  if (!dialog.value || busyKey.value || reason.value.trim().length < 20 || reason.value.trim().length > 1000 || !confirmed.value) return false
  return dialog.value.action !== 'accepted' || /^re_[A-Za-z0-9_-]{8,200}$/.test(resendEmailId.value.trim())
})

async function submitAction() {
  if (!dialog.value || !actionReady.value) return
  const { action, item } = dialog.value
  const key = `${action}:${item.id}`
  busyKey.value = key
  error.value = ''
  notice.value = ''
  try {
    if (action === 'accepted' || action === 'not_sent') {
      await api(`/api/app/notification-ops/email-effects/${encodeURIComponent(item.id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify(action === 'accepted'
          ? { resolution: 'accepted', resendEmailId: resendEmailId.value.trim(), note: reason.value.trim() }
          : { resolution: 'not_sent', confirmedNotSent: true, note: reason.value.trim() }),
      })
    } else {
      await api(`/api/app/notification-ops/dlq/${encodeURIComponent(item.id)}/${action}`, {
        method: 'POST', body: JSON.stringify({ reason: reason.value.trim() }),
      })
    }
    notice.value = action === 'accepted'
      ? t('Correo conciliado como aceptado.', 'Email reconciled as accepted.')
      : action === 'not_sent'
        ? t('Reintento solicitado. El evento conserva su clave idempotente.', 'Retry requested. The event keeps its idempotency key.')
        : action === 'redrive'
          ? t('Mensaje reencolado para procesamiento.', 'Message queued for processing.')
          : t('Mensaje marcado como descartado.', 'Message marked as ignored.')
    dialog.value = null
    await loadKind(activeTab.value, activeTab.value === 'emails' ? emailPage.value.page : dlqPage.value.page)
  } catch (actionError) {
    error.value = actionError.message
  } finally {
    busyKey.value = ''
  }
}

watch(() => props.token, () => { void loadAll() })
onMounted(loadAll)
</script>

<template>
  <section class="module-view notification-ops-view">
    <div class="module-heading">
      <div>
        <p class="eyebrow">{{ t('Operación administrativa', 'Administrative operations') }}</p>
        <h1>{{ t('Excepciones de notificaciones', 'Notification exceptions') }}</h1>
        <p>{{ t('Revisa correos inciertos y mensajes fallidos. Las acciones quedan auditadas.', 'Review uncertain emails and failed messages. Actions are audited.') }}</p>
      </div>
      <button type="button" class="secondary-button compact" :disabled="loading" @click="loadAll">↻ {{ t('Actualizar', 'Refresh') }}</button>
    </div>

    <p v-if="notice" class="security-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="request-error" role="alert">{{ error }}</p>

    <div class="ops-tabs" role="tablist" :aria-label="t('Tipo de excepción', 'Exception type')">
      <button type="button" role="tab" :aria-selected="activeTab === 'emails'" :class="{ active: activeTab === 'emails' }" @click="activeTab = 'emails'">
        {{ t('Correos inciertos', 'Uncertain emails') }} <span>{{ emailPage.totalItems }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="activeTab === 'dlq'" :class="{ active: activeTab === 'dlq' }" @click="activeTab = 'dlq'">
        {{ t('Fallos de cola / DLQ', 'Queue failures / DLQ') }} <span>{{ dlqPage.totalItems }}</span>
      </button>
    </div>

    <ListView
      v-if="activeTab === 'emails'"
      :locale="locale"
      :title="t('Entregas de correo pendientes de conciliación', 'Email deliveries needing reconciliation')"
      :description="t('Antes de reintentar, verifica en Resend si aceptó el correo para evitar duplicados.', 'Before retrying, check Resend to see whether it accepted the email and avoid duplicates.')"
      :count="emailPage.totalItems"
      :page="emailPage.page"
      :total-pages="emailPage.totalPages"
      :loading="loading"
      :empty="!emailItems.length && !loading"
      :empty-text="t('No hay correos inciertos por conciliar.', 'There are no uncertain emails to reconcile.')"
      @previous="changePage('emails', emailPage.page - 1)"
      @next="changePage('emails', emailPage.page + 1)"
    >
      <template #actions><button type="button" class="secondary-button compact" :disabled="loading" @click="loadKind('emails', emailPage.page)">{{ t('Actualizar lista', 'Refresh list') }}</button></template>
      <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Evento', 'Event') }}</th><th>{{ t('Destinatario', 'Recipient') }}</th><th>{{ t('Último error', 'Last error') }}</th><th>{{ t('Intentos', 'Attempts') }}</th><th>{{ t('Actualizado', 'Updated') }}</th><th>{{ t('Acciones', 'Actions') }}</th></template>
      <template #rows>
        <tr v-for="item in emailItems" :key="item.id">
          <td><strong>{{ item.requestReference || item.requestId }}</strong></td>
          <td>{{ eventLabel(item.eventCode) }}</td>
          <td class="ops-recipient">{{ item.recipient }}</td>
          <td><code>{{ item.lastErrorCode || '—' }}</code></td>
          <td>{{ item.attempts }}</td>
          <td>{{ formatDate(item.updatedAt) }}</td>
          <td><div class="ops-row-actions"><button type="button" class="secondary-button compact" :disabled="Boolean(busyKey)" @click="beginAction('accepted', item)">{{ t('Ya aceptado', 'Accepted') }}</button><button type="button" class="primary-button compact" :disabled="Boolean(busyKey)" @click="beginAction('not_sent', item)">{{ t('No enviado · reintentar', 'Not sent · retry') }}</button></div></td>
        </tr>
      </template>
    </ListView>

    <ListView
      v-else
      :locale="locale"
      :title="t('Mensajes fallidos de la cola', 'Failed queue messages')"
      :description="t('Reencola solo mensajes DLQ válidos o descarta un fallo con una justificación registrada.', 'Redrive valid DLQ messages or ignore a failure with a recorded reason.')"
      :count="dlqPage.totalItems"
      :page="dlqPage.page"
      :total-pages="dlqPage.totalPages"
      :loading="loading"
      :empty="!dlqItems.length && !loading"
      :empty-text="t('No hay fallos de cola pendientes.', 'There are no pending queue failures.')"
      @previous="changePage('dlq', dlqPage.page - 1)"
      @next="changePage('dlq', dlqPage.page + 1)"
    >
      <template #actions><button type="button" class="secondary-button compact" :disabled="loading" @click="loadKind('dlq', dlqPage.page)">{{ t('Actualizar lista', 'Refresh list') }}</button></template>
      <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Cola', 'Queue') }}</th><th>{{ t('Tipo', 'Type') }}</th><th>{{ t('Evento', 'Event') }}</th><th>{{ t('Estado del evento', 'Event status') }}</th><th>{{ t('Código de error', 'Error code') }}</th><th>{{ t('Intentos', 'Attempts') }}</th><th>{{ t('Acciones', 'Actions') }}</th></template>
      <template #rows>
        <tr v-for="item in dlqItems" :key="item.id">
          <td><strong>{{ item.requestReference || '—' }}</strong></td>
          <td>{{ item.queue }}</td>
          <td>{{ item.messageKind === 'dead_letter' ? 'DLQ' : t('Mensaje inválido', 'Invalid message') }}</td>
          <td>{{ eventLabel(item.eventCode) }}</td>
          <td>{{ item.outboxStatus || '—' }}</td>
          <td><code>{{ item.errorCode || item.messageKind }}</code></td>
          <td>{{ item.attempts }}</td>
          <td><div class="ops-row-actions"><button v-if="item.messageKind === 'dead_letter' && item.eventId" type="button" class="primary-button compact" :disabled="Boolean(busyKey)" @click="beginAction('redrive', item)">{{ t('Reencolar', 'Redrive') }}</button><button type="button" class="danger-button compact" :disabled="Boolean(busyKey)" @click="beginAction('ignore', item)">{{ t('Descartar', 'Ignore') }}</button></div></td>
        </tr>
      </template>
    </ListView>

    <div v-if="dialog" class="ops-dialog-backdrop" @click.self="closeDialog">
      <section class="ops-dialog panel" role="dialog" aria-modal="true" :aria-label="actionTitle">
        <header class="panel-heading"><div><p class="eyebrow">{{ t('Acción auditada', 'Audited action') }}</p><h2>{{ actionTitle }}</h2><p>{{ dialog.item.requestReference || dialog.item.recipient || dialog.item.id }}</p></div><button type="button" class="secondary-button compact" :disabled="Boolean(busyKey)" @click="closeDialog">{{ t('Cancelar', 'Cancel') }}</button></header>
        <p v-if="dialog.action === 'accepted'" class="ops-guidance">{{ t('Confirma que Resend muestra este mensaje como aceptado y copia su ID re_…', 'Confirm Resend shows this message as accepted and enter its re_… ID.') }}</p>
        <p v-else-if="dialog.action === 'not_sent'" class="ops-guidance ops-warning">{{ t('Un reintento puede enviar un duplicado si Resend sí aceptó el correo. Verifica primero el panel de Resend.', 'Retrying may send a duplicate if Resend accepted the email. Check Resend first.') }}</p>
        <p v-else class="ops-guidance">{{ dialog.action === 'redrive' ? t('El mensaje se volverá a procesar con sus claves idempotentes.', 'The message will be processed again with its idempotency keys.') : t('El mensaje quedará ignorado y no se procesará de nuevo.', 'The message will be ignored and will not be processed again.') }}</p>
        <label v-if="dialog.action === 'accepted'" class="ops-field">{{ t('ID de correo de Resend', 'Resend email ID') }}<input v-model="resendEmailId" type="text" maxlength="203" placeholder="re_…" autocomplete="off" /></label>
        <label class="ops-field">{{ t('Justificación (20–1.000 caracteres)', 'Reason (20–1,000 characters)') }}<textarea v-model="reason" rows="4" minlength="20" maxlength="1000" required :placeholder="t('Describe lo que verificaste y por qué corresponde esta acción.', 'Describe what you verified and why this action is appropriate.')"></textarea><small>{{ reason.trim().length }}/1000</small></label>
        <label class="ops-confirm"><input v-model="confirmed" type="checkbox" /><span>{{ dialog.action === 'accepted' ? t('Verifiqué en Resend que el correo fue aceptado.', 'I verified in Resend that the email was accepted.') : dialog.action === 'not_sent' ? t('Verifiqué que Resend no aceptó el correo; autorizo el reintento.', 'I verified Resend did not accept the email; I authorize a retry.') : dialog.action === 'redrive' ? t('Confirmo que quiero volver a encolar este mensaje DLQ.', 'I confirm I want to redrive this DLQ message.') : t('Confirmo que quiero descartar este fallo de cola.', 'I confirm I want to ignore this queue failure.') }}</span></label>
        <p v-if="error" class="request-error" role="alert">{{ error }}</p>
        <footer class="ops-dialog-actions"><button type="button" class="secondary-button" :disabled="Boolean(busyKey)" @click="closeDialog">{{ t('Cancelar', 'Cancel') }}</button><button type="button" :class="['primary-button', { 'danger-button': dialog.action === 'ignore' }]" :disabled="!actionReady" @click="submitAction">{{ busyKey ? t('Procesando…', 'Processing…') : actionTitle }}</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.notification-ops-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:18px}.notification-ops-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.notification-ops-view .module-heading p:last-child{max-width:760px;margin:0;color:#7d8999;font-size:13px;line-height:1.5}.ops-tabs{display:flex;gap:6px;margin:0 0 14px;padding:0 5px;border-bottom:1px solid #e2e8ef}.ops-tabs button{display:inline-flex;align-items:center;gap:8px;padding:12px 14px;border:0;border-bottom:2px solid transparent;color:#718096;background:transparent;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.ops-tabs button.active{border-bottom-color:#145073;color:#145073}.ops-tabs button span{display:inline-grid;min-width:20px;height:20px;place-items:center;border-radius:999px;color:#317ba3;background:#eaf4f9;font-size:10px}.ops-row-actions{display:flex;flex-wrap:wrap;gap:6px;min-width:210px}.ops-row-actions button{white-space:nowrap}.ops-recipient{overflow-wrap:anywhere}code{padding:3px 5px;border-radius:4px;color:#596b7d;background:#f3f6f9;font-size:10px;overflow-wrap:anywhere}.ops-dialog-backdrop{position:fixed;z-index:1200;inset:0;display:grid;place-items:center;padding:18px;background:rgba(9,31,49,.48)}.ops-dialog{width:min(100%,560px);max-height:min(90vh,760px);overflow:auto;padding:22px;border:1px solid #dfe7ef;border-radius:12px;background:#fff;box-shadow:0 20px 60px rgba(12,34,54,.25)}.ops-dialog .panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.ops-dialog .panel-heading h2{margin:0 0 5px;color:#173a55;font-size:19px}.ops-dialog .panel-heading p:not(.eyebrow){margin:0;color:#7d8999;font-size:12px;overflow-wrap:anywhere}.ops-guidance{margin:17px 0;padding:12px 14px;border-radius:8px;color:#36546b;background:#f1f6fa;font-size:12px;line-height:1.5}.ops-guidance.ops-warning{color:#875f24;background:#fff6e7}.ops-field{display:grid;gap:6px;margin:15px 0;color:#435b70;font-size:11px;font-weight:700}.ops-field input,.ops-field textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d7e1ea;border-radius:7px;color:#20394e;background:#fff;font:inherit;font-weight:400;font-size:12px}.ops-field textarea{resize:vertical}.ops-field small{text-align:right;color:#8b98a7;font-weight:400}.ops-confirm{display:flex;align-items:flex-start;gap:9px;margin:15px 0;color:#435b70;font-size:11px;line-height:1.5}.ops-confirm input{margin-top:2px;accent-color:#145073}.ops-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.ops-dialog-actions button:disabled{opacity:.55;cursor:not-allowed}.danger-button{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border:1px solid #f1c6c6;border-radius:7px;color:#a83d3d;background:#fff5f5;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.danger-button:hover:not(:disabled){background:#ffebeb}.danger-button.compact{min-height:30px}.ops-dialog-actions .danger-button{min-height:38px;padding:0 14px}@media(max-width:760px){.notification-ops-view .module-heading{align-items:flex-start;flex-direction:column}.ops-tabs{overflow-x:auto}.ops-tabs button{white-space:nowrap}.ops-row-actions{min-width:0;flex-direction:column}.ops-dialog{padding:17px}}
</style>
