<script setup>
import { onMounted, onUpdated, ref } from 'vue'

defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  count: { type: [Number, String], default: null },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  loading: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: 'No encontramos registros.' },
  skeletonRows: { type: Number, default: 5 },
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
  <section ref="listViewRoot" class="list-view panel">
    <header class="list-view-header">
      <div>
        <div v-if="count !== null" class="list-view-summary"><strong>{{ count }}</strong><span>registros encontrados</span></div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="list-view-header-actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.toolbar" class="list-view-toolbar"><slot name="toolbar" /></div>
    <div v-if="loading" class="list-view-skeleton" aria-busy="true" aria-label="Cargando listado">
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
      <span>Página {{ page }} de {{ totalPages }}</span>
      <div><button type="button" :disabled="page <= 1 || loading" @click="$emit('previous')">Anterior</button><button type="button" :disabled="page >= totalPages || loading" @click="$emit('next')">Siguiente</button></div>
    </footer>
  </section>
</template>

<style scoped>
.list-view{width:100%;min-width:0;padding:20px 20px 4px;border:1px solid #e5eaf0;border-radius:10px;background:#fff;box-shadow:0 4px 12px rgba(25,47,70,.025)}.list-view-header{display:flex;align-items:start;justify-content:space-between;gap:15px}.list-view-header h2{margin:0 0 5px;color:#223b53;font-size:14px}.list-view-header p{margin:0;color:#98a2b3;font-size:10px}.list-view-summary{display:flex;align-items:baseline;gap:8px;margin-bottom:5px;color:#98a2b3;font-size:11px}.list-view-summary strong{color:#173a55;font-size:24px;letter-spacing:-.05em}.list-view-header-actions{display:flex;align-items:center;gap:8px}.list-view-toolbar{margin:16px 0}.list-view-table{margin-top:19px}.list-view-pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 0 12px;color:#98a2b3;font-size:10px}.list-view-pagination>div{display:flex;gap:7px}.list-view-pagination button{padding:7px 10px;border:1px solid #dce5ed;border-radius:6px;color:#526174;background:#fff;font-size:10px;cursor:pointer}.list-view-pagination button:disabled{opacity:.45;cursor:not-allowed}.list-view-skeleton{display:grid;gap:10px;margin-top:19px}.list-view-skeleton-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;align-items:center;padding:15px 0;border-top:1px solid #f0f2f5}.skeleton-bar{display:block;height:10px;border-radius:999px;background:linear-gradient(90deg,#edf1f5 25%,#f8fafc 50%,#edf1f5 75%);background-size:200% 100%;animation:skeleton-shimmer 1.3s ease-in-out infinite}.skeleton-bar-0{width:72%}.skeleton-bar-1{width:52%}.skeleton-bar-2{width:86%}@keyframes skeleton-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
</style>
