<script setup>
import {
  ArrowRight,
  ArrowUp,
  Award,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Container,
  Facebook,
  FileCheck2,
  FolderKanban,
  Globe2,
  Import,
  Instagram,
  Linkedin,
  LogIn,
  Mail,
  MapPin,
  Menu,
  Phone,
  Plus,
  Quote,
  Route,
  Save,
  Settings,
  ShieldCheck,
  Ship,
  Trash2,
  Truck,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { cloneDefaultContent } from './contentDefaults'
import { fetchContent, loginAdmin, saveContent } from './lib/contentApi'
import logoUrl from './assets/logo-cortes-rodriguez.png'
import heroBgUrl from './assets/hero-logistica-aduanera.png'

const iconMap = {
  Award,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Container,
  Facebook,
  FileCheck2,
  FolderKanban,
  Globe2,
  Import,
  Instagram,
  Linkedin,
  Mail,
  Route,
  ShieldCheck,
  Ship,
  Truck,
  UserRoundCheck,
  UsersRound,
}

const iconOptions = Object.keys(iconMap)
const menuOpen = ref(false)
const routePath = ref(window.location.pathname)
const isAdmin = computed(() => routePath.value === '/admin')
const isLogin = computed(() => routePath.value === '/login')
const content = ref(cloneDefaultContent())
const draft = ref(cloneDefaultContent())
const activeLocale = ref(getInitialLocale())
const adminLocale = ref('es')
const adminJwt = ref(localStorage.getItem('adminJwt') || '')
const loginForm = ref({ email: '', password: '' })
const adminStatus = ref('')
const loading = ref(true)

function getInitialLocale() {
  const savedLocale = localStorage.getItem('locale')
  if (savedLocale === 'es' || savedLocale === 'en') return savedLocale

  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  const preferredLanguage = browserLanguages.find((language) => language?.toLowerCase().startsWith('en') || language?.toLowerCase().startsWith('es'))

  return preferredLanguage?.toLowerCase().startsWith('en') ? 'en' : 'es'
}

const site = computed(() => content.value.locales?.[activeLocale.value] || content.value.locales?.es || cloneDefaultContent().locales.es)
const draftLocale = computed(() => draft.value.locales?.[adminLocale.value] || draft.value.locales.es)
const navItems = computed(() => site.value.navItems || [])
const services = computed(() => site.value.services || [])
const clients = computed(() => site.value.clients || [])
const testimonials = computed(() => site.value.testimonials || [])
const reasons = computed(() => site.value.reasons || [])
const stats = computed(() => site.value.stats || [])
const steps = computed(() => site.value.steps || [])
const socialLinks = computed(() => site.value.socialLinks || [])
const testimonialIndex = ref(0)
const visibleTestimonials = computed(() => {
  const items = testimonials.value
  if (!items.length) return []
  return [0, 1, 2].map((offset) => items[(testimonialIndex.value + offset) % items.length]).slice(0, Math.min(3, items.length))
})
const navText = computed({
  get: () => (draftLocale.value.navItems || []).join(', '),
  set: (value) => {
    draftLocale.value.navItems = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  },
})

function sectionId(item) {
  return item.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function navHref(index, item) {
  const ids = ['inicio', 'servicios', 'nosotros', 'clientes', 'recursos', 'contacto']
  return `#${ids[index] || sectionId(item)}`
}

function titleParts(title, highlight) {
  if (!highlight || !title?.includes(highlight)) return [title, '']
  return [title.replace(highlight, '').trim(), highlight]
}

function icon(name) {
  return iconMap[name] || Globe2
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function addItem(collection, item) {
  collection.push(clone(item))
}

function removeItem(collection, index) {
  collection.splice(index, 1)
}

function nextTestimonial() {
  if (!testimonials.value.length) return
  testimonialIndex.value = (testimonialIndex.value + 1) % testimonials.value.length
}

function previousTestimonial() {
  if (!testimonials.value.length) return
  testimonialIndex.value = (testimonialIndex.value - 1 + testimonials.value.length) % testimonials.value.length
}

function goToTestimonial(index) {
  testimonialIndex.value = index
}

async function loadContent() {
  loading.value = true
  content.value = await fetchContent()
  draft.value = clone(content.value)
  loading.value = false
}

function switchLocale(locale) {
  activeLocale.value = locale
  localStorage.setItem('locale', locale)
}

async function login() {
  adminStatus.value = 'Iniciando sesión...'
  try {
    const { token } = await loginAdmin(loginForm.value)
    adminJwt.value = token
    localStorage.setItem('adminJwt', token)
    adminStatus.value = 'Sesión iniciada.'
    window.history.pushState({}, '', '/admin')
    routePath.value = '/admin'
  } catch (error) {
    adminStatus.value = error.message
  }
}

function logout() {
  adminJwt.value = ''
  localStorage.removeItem('adminJwt')
  adminStatus.value = 'Sesión cerrada.'
  window.history.pushState({}, '', '/login')
  routePath.value = '/login'
}

async function persistContent() {
  adminStatus.value = 'Guardando...'
  try {
    await saveContent(draft.value, adminJwt.value)
    content.value = clone(draft.value)
    adminStatus.value = 'Cambios guardados.'
  } catch (error) {
    adminStatus.value = error.message
  }
}

onMounted(loadContent)
</script>

<template>
  <div class="site-shell">
    <main v-if="isLogin" class="login-page">
      <form class="login-card" @submit.prevent="login">
        <img :src="logoUrl" alt="" />
        <h1>Acceso administrativo</h1>
        <p>Ingresa tus credenciales para gestionar el contenido de la landing.</p>
        <label>
          Correo
          <input v-model="loginForm.email" type="email" autocomplete="username" />
        </label>
        <label>
          Contraseña
          <input v-model="loginForm.password" type="password" autocomplete="current-password" />
        </label>
        <button class="admin-save" type="submit"><LogIn :size="18" /> Entrar</button>
        <a class="admin-link" href="/">Volver a la landing</a>
        <span class="admin-status">{{ adminStatus }}</span>
      </form>
    </main>

    <main v-else-if="isAdmin && !adminJwt" class="login-page">
      <div class="login-card">
        <img :src="logoUrl" alt="" />
        <h1>Sesión requerida</h1>
        <p>Inicia sesión para entrar al administrador.</p>
        <a class="admin-save" href="/login"><LogIn :size="18" /> Ir al login</a>
      </div>
    </main>

    <main v-else-if="isAdmin" class="admin-page">
      <aside class="admin-sidebar">
        <img :src="logoUrl" alt="" />
        <h1>Administrador</h1>
        <p>Edita el contenido de la landing conectado a Turso/libSQL.</p>
        <button class="admin-save" type="button" @click="persistContent">
          <Save :size="18" /> Guardar cambios
        </button>
        <button class="admin-link" type="button" @click="logout">Cerrar sesión</button>
        <a class="admin-link" href="/">Ver landing</a>
        <span class="admin-status">{{ adminStatus }}</span>
      </aside>

      <section class="admin-editor" :aria-busy="loading">
        <div class="admin-section">
          <h2>Idioma del contenido</h2>
          <div class="language-tabs">
            <button type="button" :class="{ active: adminLocale === 'es' }" @click="adminLocale = 'es'">Contenido en español</button>
            <button type="button" :class="{ active: adminLocale === 'en' }" @click="adminLocale = 'en'">Contenido en inglés</button>
          </div>
        </div>

        <div class="admin-section">
          <h2>Marca y navegación</h2>
          <label>Nombre <textarea v-model="draftLocale.brand.name" rows="2"></textarea></label>
          <label>Subtítulo <input v-model="draftLocale.brand.subtitle" /></label>
          <label>Menú <input v-model="navText" /></label>
        </div>

        <div class="admin-section">
          <h2>Inicio</h2>
          <label>Etiqueta <input v-model="draftLocale.hero.kicker" /></label>
          <label>Título <textarea v-model="draftLocale.hero.title" rows="2"></textarea></label>
          <label>Texto resaltado <input v-model="draftLocale.hero.highlight" /></label>
          <label>Descripción <textarea v-model="draftLocale.hero.text" rows="3"></textarea></label>
          <div class="admin-grid two">
            <label>Botón principal <input v-model="draftLocale.hero.primaryLabel" /></label>
            <label>URL principal <input v-model="draftLocale.hero.primaryHref" /></label>
            <label>Botón secundario <input v-model="draftLocale.hero.secondaryLabel" /></label>
            <label>URL secundaria <input v-model="draftLocale.hero.secondaryHref" /></label>
          </div>
        </div>

        <div class="admin-section">
          <h2>Servicios</h2>
          <label>Etiqueta <input v-model="draftLocale.servicesHeading.kicker" /></label>
          <label>Título <input v-model="draftLocale.servicesHeading.title" /></label>
          <article v-for="(service, index) in draftLocale.services" :key="index" class="admin-card">
            <input v-model="service.title" placeholder="Título" />
            <textarea v-model="service.text" rows="2" placeholder="Descripción"></textarea>
            <select v-model="service.icon">
              <option v-for="option in iconOptions" :key="option">{{ option }}</option>
            </select>
            <button type="button" class="danger" @click="removeItem(draftLocale.services, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.services, { title: 'Nuevo servicio', text: '', icon: 'Globe2' })">
            <Plus :size="16" /> Agregar servicio
          </button>
        </div>

        <div class="admin-section">
          <h2>Clientes</h2>
          <label>Etiqueta <input v-model="draftLocale.clientsHeading.kicker" /></label>
          <label>Título <input v-model="draftLocale.clientsHeading.title" /></label>
          <div class="admin-list">
            <label v-for="(_, index) in draftLocale.clients" :key="index">
              Cliente
              <input v-model="draftLocale.clients[index]" />
              <button type="button" class="danger compact" @click="removeItem(draftLocale.clients, index)"><Trash2 :size="16" /></button>
            </label>
          </div>
          <button type="button" class="admin-add" @click="addItem(draftLocale.clients, 'Nuevo cliente')"><Plus :size="16" /> Agregar cliente</button>
        </div>

        <div class="admin-section">
          <h2>Testimonios</h2>
          <label>Etiqueta <input v-model="draftLocale.testimonialsHeading.kicker" /></label>
          <label>Título <input v-model="draftLocale.testimonialsHeading.title" /></label>
          <article v-for="(item, index) in draftLocale.testimonials" :key="index" class="admin-card">
            <textarea v-model="item.text" rows="3" placeholder="Testimonio"></textarea>
            <input v-model="item.name" placeholder="Nombre" />
            <input v-model="item.role" placeholder="Cargo" />
            <button type="button" class="danger" @click="removeItem(draftLocale.testimonials, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.testimonials, { text: '', name: 'Nuevo cliente', role: '' })">
            <Plus :size="16" /> Agregar testimonio
          </button>
        </div>

        <div class="admin-section">
          <h2>Razones, métricas y proceso</h2>
          <label>Etiqueta razones <input v-model="draftLocale.reasonsHeading.kicker" /></label>
          <label>Título razones <input v-model="draftLocale.reasonsHeading.title" /></label>
          <article v-for="(reason, index) in draftLocale.reasons" :key="`reason-${index}`" class="admin-card">
            <input v-model="reason.title" placeholder="Título" />
            <input v-model="reason.text" placeholder="Descripción" />
            <select v-model="reason.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            <button type="button" class="danger" @click="removeItem(draftLocale.reasons, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.reasons, { title: 'Nueva razón', text: '', icon: 'ShieldCheck' })">
            <Plus :size="16" /> Agregar razón
          </button>

          <article v-for="(stat, index) in draftLocale.stats" :key="`stat-${index}`" class="admin-card">
            <input v-model="stat.value" placeholder="Valor" />
            <input v-model="stat.label" placeholder="Texto" />
            <select v-model="stat.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            <button type="button" class="danger" @click="removeItem(draftLocale.stats, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.stats, { value: '0+', label: 'Nueva métrica', icon: 'Award' })">
            <Plus :size="16" /> Agregar métrica
          </button>

          <label>Etiqueta proceso <input v-model="draftLocale.processHeading.kicker" /></label>
          <label>Título proceso <input v-model="draftLocale.processHeading.title" /></label>
          <article v-for="(step, index) in draftLocale.steps" :key="`step-${index}`" class="admin-card">
            <input v-model="step.title" placeholder="Paso" />
            <input v-model="step.text" placeholder="Descripción" />
            <select v-model="step.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            <button type="button" class="danger" @click="removeItem(draftLocale.steps, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.steps, { title: 'Nuevo paso', text: '', icon: 'CheckCircle2' })">
            <Plus :size="16" /> Agregar paso
          </button>
        </div>

        <div class="admin-section">
          <h2>CTA, contacto y footer</h2>
          <label>Título CTA <input v-model="draftLocale.cta.title" /></label>
          <label>Texto CTA <input v-model="draftLocale.cta.text" /></label>
          <div class="admin-grid two">
            <label>Botón principal <input v-model="draftLocale.cta.primaryLabel" /></label>
            <label>URL principal <input v-model="draftLocale.cta.primaryHref" /></label>
            <label>Botón secundario <input v-model="draftLocale.cta.secondaryLabel" /></label>
            <label>URL secundaria <input v-model="draftLocale.cta.secondaryHref" /></label>
          </div>
          <label>Dirección <input v-model="draftLocale.contact.address" /></label>
          <label>Teléfono <input v-model="draftLocale.contact.phone" /></label>
          <label>Email <input v-model="draftLocale.contact.email" /></label>
          <label>Título enlaces footer <input v-model="draftLocale.footer.quickLinksTitle" /></label>
          <label>Título servicios footer <input v-model="draftLocale.footer.servicesTitle" /></label>
          <label>Título contacto footer <input v-model="draftLocale.footer.contactTitle" /></label>
          <label>Descripción footer <textarea v-model="draftLocale.footer.description" rows="3"></textarea></label>
          <label>Copyright <input v-model="draftLocale.footer.copyright" /></label>
          <label>Legal <input v-model="draftLocale.footer.legal" /></label>
        </div>

        <div class="admin-section">
          <h2>Redes sociales</h2>
          <article v-for="(social, index) in draftLocale.socialLinks" :key="index" class="admin-card social-admin-card">
            <input v-model="social.label" placeholder="Nombre" />
            <input v-model="social.href" placeholder="https://..." />
            <select v-model="social.icon">
              <option>Linkedin</option>
              <option>Facebook</option>
              <option>Instagram</option>
              <option>Mail</option>
              <option>Phone</option>
            </select>
            <button type="button" class="danger" @click="removeItem(draftLocale.socialLinks, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.socialLinks, { label: 'Nueva red', icon: 'Linkedin', href: 'https://' })">
            <Plus :size="16" /> Agregar red social
          </button>
        </div>
      </section>
    </main>

    <template v-else>
      <header id="header" class="header">
        <a class="brand" href="#inicio" aria-label="Cortes Rodriguez Asesores">
          <img :src="logoUrl" alt="" />
          <span class="brand-text">
            <strong>{{ site.brand.name }}</strong>
            <small>{{ site.brand.subtitle }}</small>
          </span>
        </a>

        <nav class="desktop-nav" aria-label="Principal">
          <a v-for="(item, index) in navItems" :key="item" :href="navHref(index, item)">{{ item }}</a>
        </nav>

        <a class="quote-button" href="#contacto">
          {{ site.hero.primaryLabel }}
          <ArrowRight :size="18" />
        </a>

        <div class="language-switch" aria-label="Idioma">
          <button type="button" :class="{ active: activeLocale === 'es' }" @click="switchLocale('es')">ES</button>
          <button type="button" :class="{ active: activeLocale === 'en' }" @click="switchLocale('en')">EN</button>
        </div>

        <button class="menu-button" type="button" aria-label="Abrir menú" @click="menuOpen = !menuOpen">
          <X v-if="menuOpen" :size="25" />
          <Menu v-else :size="25" />
        </button>
      </header>

      <nav v-if="menuOpen" class="mobile-nav" aria-label="Móvil">
        <a v-for="(item, index) in navItems" :key="item" :href="navHref(index, item)" @click="menuOpen = false">{{ item }}</a>
        <div class="language-switch mobile">
          <button type="button" :class="{ active: activeLocale === 'es' }" @click="switchLocale('es')">ES</button>
          <button type="button" :class="{ active: activeLocale === 'en' }" @click="switchLocale('en')">EN</button>
        </div>
        <a class="quote-button" href="#contacto" @click="menuOpen = false">{{ site.hero.primaryLabel }} <ArrowRight :size="17" /></a>
      </nav>

      <main>
        <section id="inicio" class="hero" :style="{ backgroundImage: `url(${heroBgUrl})` }">
          <div class="hero-copy">
            <p class="eyebrow">{{ site.hero.kicker }}</p>
            <h1>
              {{ titleParts(site.hero.title, site.hero.highlight)[0] }}
              <span>{{ titleParts(site.hero.title, site.hero.highlight)[1] }}</span>
            </h1>
            <p class="hero-text">{{ site.hero.text }}</p>
            <div class="hero-actions">
              <a class="primary-button" :href="site.hero.primaryHref">{{ site.hero.primaryLabel }} <ArrowRight :size="18" /></a>
              <a class="outline-button" :href="site.hero.secondaryHref">{{ site.hero.secondaryLabel }} <ArrowRight :size="17" /></a>
            </div>
          </div>
          <div class="hero-visual-space" aria-hidden="true"></div>
        </section>

        <section id="servicios" class="section services-section">
          <p class="section-kicker">{{ site.servicesHeading.kicker }}</p>
          <h2>{{ site.servicesHeading.title }}</h2>
          <div class="service-grid">
            <article v-for="service in services" :key="service.title" class="service-card">
              <component :is="icon(service.icon)" :size="54" stroke-width="1.8" />
              <div>
                <h3>{{ service.title }}</h3>
                <p>{{ service.text }}</p>
              </div>
              <ArrowRight class="service-arrow" :size="18" />
            </article>
          </div>
        </section>

        <section id="clientes" class="section client-section">
          <p class="section-kicker">{{ site.clientsHeading.kicker }}</p>
          <h2>{{ site.clientsHeading.title }}</h2>
          <div class="client-strip">
            <div v-for="client in clients" :key="client" class="client-logo">{{ client }}</div>
          </div>
          <div class="slider-dots" aria-hidden="true"><span class="active"></span><span></span><span></span><span></span></div>
        </section>

        <section id="nosotros" class="section testimonials-section">
          <div class="split-heading">
            <div>
              <p class="section-kicker">{{ site.testimonialsHeading.kicker }}</p>
              <h2>{{ site.testimonialsHeading.title }}</h2>
            </div>
            <div class="slider-controls" aria-label="Controles de testimonios">
              <button type="button" aria-label="Testimonio anterior" @click="previousTestimonial"><ChevronLeft :size="20" /></button>
              <button type="button" aria-label="Testimonio siguiente" @click="nextTestimonial"><ChevronRight :size="20" /></button>
            </div>
          </div>
          <div class="testimonial-grid">
            <article v-for="item in visibleTestimonials" :key="`${item.name}-${item.role}`" class="testimonial-card">
              <Quote class="quote-icon" :size="30" />
              <p>{{ item.text }}</p>
              <div class="person">
                <span>{{ item.name.slice(0, 1) }}</span>
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.role }}</small>
                </div>
              </div>
            </article>
          </div>
          <div class="slider-dots testimonial-dots" aria-label="Seleccionar testimonio">
            <button
              v-for="(_, index) in testimonials"
              :key="index"
              type="button"
              :class="{ active: index === testimonialIndex }"
              :aria-label="`Ver testimonio ${index + 1}`"
              @click="goToTestimonial(index)"
            ></button>
          </div>
        </section>

        <section class="section reasons-section">
          <div class="reason-intro">
            <p class="section-kicker">{{ site.reasonsHeading.kicker }}</p>
            <h2>{{ site.reasonsHeading.title }}</h2>
          </div>
          <div class="reason-grid">
            <article v-for="reason in reasons" :key="reason.title" class="reason-item">
              <component :is="icon(reason.icon)" :size="36" />
              <h3>{{ reason.title }}</h3>
              <p>{{ reason.text }}</p>
            </article>
          </div>
        </section>

        <section class="stats-band" aria-label="Indicadores">
          <article v-for="stat in stats" :key="stat.label">
            <component :is="icon(stat.icon)" :size="56" />
            <div>
              <strong>{{ stat.value }}</strong>
              <span>{{ stat.label }}</span>
            </div>
          </article>
        </section>

        <section id="recursos" class="section process-section">
          <p class="section-kicker">{{ site.processHeading.kicker }}</p>
          <h2>{{ site.processHeading.title }}</h2>
          <div class="process-grid">
            <article v-for="(step, index) in steps" :key="step.title" class="process-step">
              <div class="step-icon">
                <component :is="icon(step.icon)" :size="30" />
                <span>{{ index + 1 }}</span>
              </div>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </article>
          </div>
        </section>

        <section id="contacto" class="cta-band">
          <div>
            <h2>{{ site.cta.title }}</h2>
            <p>{{ site.cta.text }}</p>
          </div>
          <div class="cta-actions">
            <a class="primary-button" :href="site.cta.primaryHref">{{ site.cta.primaryLabel }} <ArrowRight :size="18" /></a>
            <a class="outline-button" :href="site.cta.secondaryHref">{{ site.cta.secondaryLabel }} <ArrowRight :size="17" /></a>
          </div>
        </section>
      </main>

      <footer class="footer">
        <div class="footer-grid">
          <div>
            <img class="footer-logo" :src="logoUrl" alt="Cortes Rodriguez Asesores S.A.S." />
            <p>{{ site.footer.description }}</p>
            <div class="socials">
              <a v-for="social in socialLinks" :key="social.label" :href="social.href" :aria-label="social.label" target="_blank" rel="noreferrer">
                <component :is="icon(social.icon)" :size="18" />
              </a>
            </div>
          </div>
          <div>
            <h3>{{ site.footer.quickLinksTitle }}</h3>
            <a v-for="(item, index) in navItems" :key="item" :href="navHref(index, item)">{{ item }}</a>
          </div>
          <div>
            <h3>{{ site.footer.servicesTitle }}</h3>
            <a v-for="service in services" :key="service.title" href="#servicios">{{ service.title }}</a>
          </div>
          <div>
            <h3>{{ site.footer.contactTitle }}</h3>
            <p><MapPin :size="17" /> {{ site.contact.address }}</p>
            <p><Phone :size="17" /> {{ site.contact.phone }}</p>
            <p><Mail :size="17" /> {{ site.contact.email }}</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>{{ site.footer.copyright }}</span>
          <span>{{ site.footer.legal }}</span>
        </div>
      </footer>

      <a class="back-to-top" href="#header" aria-label="Volver al encabezado">
        <ArrowUp :size="24" />
      </a>
      <a class="admin-floating-link" href="/login" aria-label="Ir al administrador">
        <Settings :size="22" />
      </a>
    </template>
  </div>
</template>
