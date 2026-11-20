<script setup>
import { onMounted, onUpdated, ref } from 'vue'
import { sharedText } from '../../lib/translations.js'

defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  count: { type: [Number, String], default: null },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  locale: { type: String, default: 'es' },
  loading: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: 'No encontramos registros.' },
  skeletonRows: { type: Number, default: 5 },
  variant: { type: String, default: 'cards' },
})

defineEmits(['previous', 'next'])

const listViewRoot = ref(null)
const columnCount = ref(6)

function syncResponsiveLabels() {
  const root = listViewRoot.value
  if (!root) return
  const headers = [...root.querySelectorAll('.list-view-table thead th')]
  if (headers.length) columnCount.value = headers.length
  root.querySelectorAll('.list-view-table tbody tr').forEach((row) => {
    [...row.children].forEach((cell, index) => {
      if (cell.tagName === 'TD' && headers[index]) cell.dataset.label = headers[index].textContent.trim()
    })
  })
}

onMounted(syncResponsiveLabels)
onUpdated(syncResponsiveLabels)
</script>

<template>
  <section ref="listViewRoot" :class="['list-view panel', `list-view-${variant}`]">
    <header class="list-view-header">
      <div>
        <div v-if="count !== null" class="list-view-summary"><strong>{{ count }}</strong><span>{{ sharedText(locale, 'recordsFound') }}</span></div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="list-view-header-actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.toolbar" class="list-view-toolbar"><slot name="toolbar" /></div>
    <div v-if="loading" class="list-view-skeleton" role="status" aria-busy="true" :aria-label="sharedText(locale, 'loadingList')">
      <div v-for="row in skeletonRows" :key="row" class="list-view-skeleton-row">
        <span v-for="column in columnCount" :key="column" :class="['skeleton-bar', `skeleton-bar-${column % 3}`]"></span>
      </div>
    </div>
    <div v-else class="table-wrap list-view-table">
      <table>
        <thead><tr><slot name="columns" /></tr></thead>
        <tbody>
          <slot name="rows" />
          <tr v-if="empty"><td class="empty-row" :colspan="100">{{ emptyText }}</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="list-view-pagination">
      <span>{{ sharedText(locale, 'page') }} {{ page }} {{ sharedText(locale, 'of') }} {{ totalPages }}</span>
      <div><button type="button" :disabled="page <= 1 || loading" @click="$emit('previous')">{{ sharedText(locale, 'previous') }}</button><button type="button" :disabled="page >= totalPages || loading" @click="$emit('next')">{{ sharedText(locale, 'next') }}</button></div>
    </footer>
  </section>
</template>

<style>
.list-view{width:100%;min-width:0;padding:24px 24px 6px;border:1px solid #e5eaf0;border-radius:10px;background:#fff;box-shadow:0 4px 12px rgba(25,47,70,.025)}.list-view-header{display:flex;align-items:start;justify-content:space-between;gap:15px}.list-view-header h2{margin:0 0 6px;color:#223b53;font-size:18px}.list-view-header p{margin:0;color:#8291a5;font-size:12px;line-height:1.5}.list-view-summary{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;color:#8291a5;font-size:13px}.list-view-summary strong{color:#173a55;font-size:29px;letter-spacing:-.05em}.list-view-header-actions{display:flex;align-items:center;gap:8px}.list-view-toolbar{margin:20px 0}.list-view-table{margin-top:22px}.list-view-table table{font-size:13px}.list-view-table th{padding:0 10px 13px;font-size:11px}.list-view-table td{padding:16px 10px;font-size:13px;line-height:1.4;vertical-align:middle}.list-view-pagination{display:flex;align-items:center;justify-content:space-between;padding:17px 0 13px;color:#8291a5;font-size:12px}.list-view-pagination>div{display:flex;gap:8px}.list-view-pagination button{padding:9px 12px;border:1px solid #dce5ed;border-radius:6px;color:#526174;background:#fff;font-size:12px;cursor:pointer}.list-view-pagination button:disabled{opacity:.45;cursor:not-allowed}.list-view-skeleton{display:grid;gap:10px;margin-top:22px}.list-view-skeleton-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;align-items:center;padding:17px 0;border-top:1px solid #f0f2f5}.skeleton-bar{display:block;height:11px;border-radius:999px;background:linear-gradient(90deg,#edf1f5 25%,#f8fafc 50%,#edf1f5 75%);background-size:200% 100%;animation:skeleton-shimmer 1.3s ease-in-out infinite}.skeleton-bar-0{width:72%}.skeleton-bar-1{width:52%}.skeleton-bar-2{width:86%}.list-view-cards .list-view-table{overflow:visible}.list-view-cards .list-view-table table,.list-view-cards .list-view-table tbody{display:block}.list-view-cards .list-view-table thead{display:none}.list-view-cards .list-view-table tr{display:grid;grid-template-columns:minmax(190px,1.35fr) repeat(4,minmax(125px,1fr));gap:16px;align-items:center;margin-bottom:12px;padding:18px 20px;border:1px solid #e2e9f0;border-radius:10px;background:#fbfcfe;box-shadow:0 3px 10px rgba(25,47,70,.035)}.list-view-cards .list-view-table td{display:flex;flex-direction:column;gap:5px;padding:0;border:0;font-size:14px;color:#40566d}.list-view-cards .list-view-table td::before{content:attr(data-label);color:#8291a5;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.list-view-cards .list-view-table td:first-child .request-link,.list-view-cards .list-view-table td:first-child .client-link{font-size:15px}.list-view-cards .list-view-table .empty-row{display:block;padding:20px;text-align:center}.list-view-cards .list-view-table tr:has(.empty-row){display:block}.list-view-cards .list-view-table tr:last-child{margin-bottom:0}@media(max-width:900px){.list-view-cards .list-view-table tr{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:620px){.list-view{padding:18px 14px 4px}.list-view-cards .list-view-table tr{grid-template-columns:repeat(2,minmax(0,1fr));padding:16px}.list-view-cards .list-view-table td{font-size:13px}.list-view-cards .list-view-table td:first-child{grid-column:1/-1}}@keyframes skeleton-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
</style>
