<script setup>
import { persistLocale } from '../../lib/locale.js'
import { sharedText } from '../../lib/translations.js'

defineProps({ modelValue: { type: String, default: 'es' } })
const emit = defineEmits(['update:modelValue'])

function select(locale) {
  emit('update:modelValue', persistLocale(locale))
}
</script>

<template>
  <div class="language-toggle" role="group" :aria-label="sharedText(modelValue, 'language')">
    <button type="button" :aria-label="sharedText(modelValue, 'spanish')" :aria-pressed="modelValue === 'es'" :class="{ active: modelValue === 'es' }" @click="select('es')">ES</button>
    <button type="button" :aria-label="sharedText(modelValue, 'english')" :aria-pressed="modelValue === 'en'" :class="{ active: modelValue === 'en' }" @click="select('en')">EN</button>
  </div>
</template>

<style scoped>
.language-toggle{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid #d7e2ec;border-radius:7px;background:#fff}.language-toggle button{min-width:34px;min-height:28px;padding:0 7px;border:0;border-radius:5px;background:transparent;color:#62788d;font:inherit;font-size:10px;font-weight:800;cursor:pointer}.language-toggle button.active{background:#0e4567;color:#fff}.language-toggle button:focus-visible{outline:2px solid #309bc0;outline-offset:2px}
</style>
