<script setup>
import { computed, ref } from 'vue'
import LanguageToggle from '../shared/components/LanguageToggle.vue'
import logoUrl from '../assets/logo-cortes-rodriguez.png'

const props = defineProps({
  brandSubtitle: { type: String, default: 'Operaciones' },
  breadcrumbLabel: { type: String, default: 'Operaciones' },
  currentPage: { type: String, default: '' },
  activePage: { type: String, default: '' },
  locale: { type: String, default: 'es' },
  userName: { type: String, default: '' },
  userRole: { type: String, default: '' },
  menuLabel: { type: String, default: 'Menú principal' },
  secondaryMenuLabel: { type: String, default: 'Administración' },
  logoutLabel: { type: String, default: 'Cerrar sesión' },
  searchPlaceholder: { type: String, default: 'Buscar en la plataforma...' },
  menuItems: { type: Array, default: () => [] },
  showSearch: { type: Boolean, default: true },
})
const emit = defineEmits(['select', 'logout', 'update:locale'])
const mobileMenuOpen = ref(false)
const initials = computed(() => {
  const name = props.userName.trim()
  if (name.includes('@')) return name.split('@')[0].slice(0, 2).toUpperCase()
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
})

function select(item) {
  mobileMenuOpen.value = false
  emit('select', item)
}
</script>

<template>
  <main class="operations-shell">
    <aside class="operations-sidebar">
      <div class="sidebar-head">
        <div class="sidebar-brand">
          <img class="brand-logo" :src="logoUrl" alt="Cortés Rodríguez Asesores" />
          <span><strong>Cortés Rodríguez</strong><small>{{ brandSubtitle }}</small></span>
        </div>
        <button class="mobile-menu-toggle" type="button" :aria-expanded="mobileMenuOpen" aria-controls="operations-navigation" @click="mobileMenuOpen = !mobileMenuOpen">
          <span>☰</span><span>{{ menuLabel }}</span>
        </button>
      </div>
      <div class="sidebar-label">{{ menuLabel }}</div>
      <nav id="operations-navigation" :class="{ open: mobileMenuOpen }" :aria-label="menuLabel">
        <template v-for="(item, index) in menuItems" :key="item.permission || item.label">
          <div v-if="index === 6" class="sidebar-label sidebar-secondary-label">{{ secondaryMenuLabel }}</div>
          <a v-if="item.href" :href="item.href" :class="['operations-menu-item', { active: activePage === item.label }]">
            <span class="menu-icon">{{ item.icon }}</span><span>{{ item.displayLabel || item.label }}</span>
          </a>
          <button v-else type="button" :class="['operations-menu-item', { active: activePage === item.label }]" @click="select(item)">
            <span class="menu-icon">{{ item.icon }}</span><span>{{ item.displayLabel || item.label }}</span>
            <span v-if="item.badge" class="menu-count">{{ item.badge }}</span>
          </button>
        </template>
      </nav>
      <div class="sidebar-profile">
        <div class="avatar avatar-small">{{ initials }}</div>
        <div><strong>{{ userName }}</strong><span>{{ userRole }}</span></div>
        <button type="button" :aria-label="logoutLabel" :title="logoutLabel" @click="emit('logout')">↪</button>
      </div>
    </aside>

    <section class="operations-content">
      <header class="operations-topbar">
        <div class="breadcrumb"><span>{{ breadcrumbLabel }}</span><b>/</b><strong>{{ currentPage }}</strong></div>
        <div class="topbar-actions">
          <LanguageToggle :model-value="locale" @update:model-value="emit('update:locale', $event)" />
          <label v-if="showSearch" class="search-box"><span>⌕</span><input :placeholder="searchPlaceholder" /></label>
          <slot name="topbar-actions" />
        </div>
      </header>
      <slot />
    </section>
  </main>
</template>

<style>
.operations-shell{min-height:100vh;display:flex;color:#1d2939;background:#f6f8fb}.operations-sidebar{width:252px;display:flex;flex-direction:column;flex-shrink:0;padding:27px 15px 18px;color:#c8d8e4;background:#092d48}.sidebar-head{display:block}.sidebar-brand{display:flex;align-items:center;gap:10px;margin:0 11px 57px;color:#fff;text-decoration:none}.sidebar-brand>span:last-child{display:grid;gap:2px;font-size:14px}.sidebar-brand small{color:#88a7ba;font-size:10px;font-weight:500}.brand-logo{display:block;width:44px;height:44px;flex:0 0 44px;border:1px solid rgba(255,255,255,.26);border-radius:10px;background:#fff;object-fit:contain}.sidebar-label{margin:0 12px 10px;color:#7597ad;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.operations-sidebar nav{display:grid;gap:4px}.sidebar-secondary-label{margin-top:26px}.operations-menu-item{position:relative;display:flex;align-items:center;gap:13px;min-height:43px;padding:0 12px;border:0;border-radius:8px;color:#b8cedb;background:transparent;text-align:left;font:inherit;font-size:13px;text-decoration:none;cursor:pointer;transition:background .2s,color .2s}.operations-menu-item:hover,.operations-menu-item.active{color:#fff;background:rgba(103,184,203,.16)}.operations-menu-item.active:before{content:'';position:absolute;left:-15px;width:3px;height:23px;border-radius:0 3px 3px 0;background:#69c6cb}.menu-icon{display:grid;place-items:center;width:25px;height:25px;flex:0 0 25px;border-radius:7px;color:#8cb4c8;font-size:11px;font-weight:800}.operations-menu-item.active .menu-icon{color:#82d2d1;background:rgba(115,210,210,.14)}.menu-count{margin-left:auto;padding:3px 7px;border-radius:9px;color:#a9e2e0;background:rgba(109,203,202,.16);font-size:10px}.sidebar-profile{display:flex;align-items:center;gap:10px;margin-top:auto;padding:15px 8px 2px;border-top:1px solid rgba(255,255,255,.1)}.sidebar-profile>div:nth-child(2){display:grid;gap:3px;min-width:0;flex:1}.sidebar-profile strong{overflow:hidden;color:#fff;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.sidebar-profile span{color:#82a3b6;font-size:10px}.sidebar-profile button{border:0;color:#91afbe;background:transparent;font-size:18px;cursor:pointer}.operations-content{flex:1;min-width:0;padding:0 clamp(24px,4vw,58px) 48px}.operations-topbar{display:flex;align-items:center;justify-content:space-between;height:82px;border-bottom:1px solid #e5eaf0}.breadcrumb{display:flex;align-items:center;gap:10px;color:#98a2b3;font-size:12px}.breadcrumb b{color:#c5ccd5;font-weight:400}.breadcrumb strong{color:#344054}.topbar-actions{display:flex;align-items:center;gap:18px}.search-box{display:flex;align-items:center;gap:7px;width:205px;min-height:35px;padding:0 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff}.search-box span{color:#98a2b3;font-size:20px;transform:rotate(-20deg)}.search-box input{min-height:31px;padding:0;border:0;font-size:11px;box-shadow:none}.avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;color:#fff;background:linear-gradient(145deg,#347b99,#153e60);font-size:11px;font-weight:800}.avatar-small{width:30px;height:30px;flex-shrink:0;font-size:9px}.mobile-menu-toggle{display:none}
@media(max-width:980px){.operations-sidebar{width:220px}}
@media(max-width:720px){.operations-shell{display:block}.operations-sidebar{width:100%;padding:12px 14px 10px}.sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.sidebar-brand{margin:0}.sidebar-label{display:none}.mobile-menu-toggle{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(255,255,255,.2);border-radius:7px;color:#d7e8f1;background:rgba(255,255,255,.06);font-size:11px;font-weight:800;cursor:pointer}.mobile-menu-toggle span:first-child{font-size:16px;line-height:1}.operations-sidebar nav{display:none;grid-template-columns:1fr;gap:3px;margin-top:12px}.operations-sidebar nav.open{display:grid}.sidebar-secondary-label{display:none}.operations-menu-item{min-height:39px;font-size:12px}.sidebar-profile{margin-top:12px;padding:10px 5px 0}.operations-content{padding:0 16px 32px}.operations-topbar{height:68px}.search-box{display:none}}
</style>
