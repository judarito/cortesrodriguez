<script setup>
defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  count: { type: [Number, String], default: null },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  loading: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: 'No encontramos registros.' },
})

defineEmits(['previous', 'next'])
</script>

<template>
  <section class="list-view panel">
    <header class="list-view-header">
      <div>
        <div v-if="count !== null" class="list-view-summary"><strong>{{ count }}</strong><span>registros encontrados</span></div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="list-view-header-actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.toolbar" class="list-view-toolbar"><slot name="toolbar" /></div>
    <div v-if="loading" class="list-view-state">Cargando…</div>
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
.list-view{padding:20px 20px 4px}.list-view-header{display:flex;align-items:start;justify-content:space-between;gap:15px}.list-view-header h2{margin:0 0 5px;color:#223b53;font-size:14px}.list-view-header p{margin:0;color:#98a2b3;font-size:10px}.list-view-summary{display:flex;align-items:baseline;gap:8px;margin-bottom:5px;color:#98a2b3;font-size:11px}.list-view-summary strong{color:#173a55;font-size:24px;letter-spacing:-.05em}.list-view-header-actions{display:flex;align-items:center;gap:8px}.list-view-toolbar{margin:16px 0}.list-view-table{margin-top:19px}.list-view-pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 0 12px;color:#98a2b3;font-size:10px}.list-view-pagination>div{display:flex;gap:7px}.list-view-pagination button{padding:7px 10px;border:1px solid #dce5ed;border-radius:6px;color:#526174;background:#fff;font-size:10px;cursor:pointer}.list-view-pagination button:disabled{opacity:.45;cursor:not-allowed}.list-view-state{padding:45px 20px;color:#718096;text-align:center}
</style>
