<script setup>
import { computed, onMounted, ref } from 'vue'
import ListView from '../shared/components/ListView.vue'

const props = defineProps({ token: { type: String, required: true }, locale: { type: String, default: 'es' } })
const isEnglish = computed(() => props.locale === 'en')
const t = (es, en) => isEnglish.value ? en : es
const errorText = (message) => isEnglish.value
  ? 'Could not load customer feedback. Please try again.'
  : (message || 'No se pudo cargar el feedback.')
const loading = ref(true)
const error = ref('')
const items = ref([])
const pagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })

async function load(page = pagination.value.page) {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/app/reviews/feedback?page=${page}&pageSize=${pagination.value.pageSize}`, {
      headers: { Authorization: `Bearer ${props.token}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(errorText(data.error))
    items.value = data.items || []
    pagination.value = data.pagination || pagination.value
  } catch (loadError) {
    error.value = errorText(loadError.message)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="module-view feedback-view">
    <div class="module-heading">
      <div><p class="eyebrow">{{ t('Experiencia del cliente', 'Customer experience') }}</p><h1>{{ t('Feedback de clientes', 'Customer feedback') }}</h1><p>{{ t('Consulta las calificaciones y comentarios asociados a las respuestas enviadas.', 'Review ratings and comments related to submitted responses.') }}</p></div>
      <button type="button" class="secondary-button compact" @click="load">↻ {{ t('Actualizar', 'Refresh') }}</button>
    </div>
    <p v-if="error" class="request-error">{{ error }}</p>
    <ListView :title="t('Feedback recibido', 'Feedback received')" :description="t('Las calificaciones bajas quedan marcadas para seguimiento administrativo.', 'Low ratings are flagged for administrative follow-up.')" :count="pagination.totalItems" :page="pagination.page" :total-pages="pagination.totalPages" :loading="loading" :empty="!items.length && !loading" :empty-text="t('Aún no hay feedback recibido.', 'No feedback has been received yet.')" :locale="locale" @previous="load(pagination.page - 1)" @next="load(pagination.page + 1)">
      <template #columns><th>{{ t('Solicitud', 'Request') }}</th><th>{{ t('Cliente', 'Client') }}</th><th>{{ t('Consulta', 'Consultation') }}</th><th>{{ t('Experto', 'Expert') }}</th><th>{{ t('Calificación', 'Rating') }}</th><th>{{ t('Comentario', 'Comment') }}</th><th>{{ t('Estado', 'Status') }}</th></template>
      <template #rows><tr v-for="item in items" :key="item.id"><td><strong class="request-id">{{ item.reference }}</strong></td><td>{{ item.clientName }}</td><td>{{ item.consultationType || '—' }}</td><td>{{ item.expertName || '—' }}</td><td><span :class="['feedback-rating', { low: item.rating <= 3 }]">{{ item.rating }} / 5</span></td><td class="feedback-comment">{{ item.comment || t('Sin comentario', 'No comment') }}</td><td><span :class="['security-status', { inactive: item.status === 'escalated' }]">{{ item.status === 'escalated' ? t('Requiere atención', 'Needs attention') : t('Recibido', 'Received') }}</span></td></tr></template>
    </ListView>
  </section>
</template>

<style scoped>
.feedback-view .module-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.feedback-view .module-heading h1{margin:0 0 8px;color:#142c43;font-size:28px;letter-spacing:-.045em}.feedback-view .module-heading p:last-child{margin:0;color:#7d8999;font-size:13px}.feedback-rating{display:inline-flex;padding:4px 7px;border-radius:5px;color:#348267;background:#e9f7f0;font-size:10px;font-weight:800}.feedback-rating.low{color:#b54747;background:#fff0f1}.feedback-comment{max-width:260px;white-space:normal!important;line-height:1.4}@media(max-width:720px){.feedback-view .module-heading{display:block}.feedback-view .module-heading .secondary-button{margin-top:16px}}
</style>
