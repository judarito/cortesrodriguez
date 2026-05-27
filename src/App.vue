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
  ImagePlus,
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cloneDefaultContent } from './contentDefaults'
import {
  fetchAdminLeadDetail,
  fetchAdminLeads,
  fetchContent,
  loginAdmin,
  saveContent,
  submitQuoteRequest,
  uploadImage,
} from './lib/contentApi'
import logoUrl from './assets/logo-cortes-rodriguez.png'

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
  Phone,
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
const adminView = ref('content')
const loginForm = ref({ email: '', password: '' })
const adminStatus = ref('')
const adminToast = ref('')
const loading = ref(true)
const hasUnsavedChanges = ref(false)
const leadModalOpen = ref(false)
const leadForm = ref(createEmptyLeadForm(activeLocale.value))
const leadFormStatus = ref('')
const leadFormSubmitting = ref(false)
const adminLeads = ref([])
const adminLeadsPagination = ref({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
const adminLeadsLoading = ref(false)
const adminLeadsError = ref('')
const selectedLeadId = ref(null)
const selectedLead = ref(null)
const selectedLeadLoading = ref(false)
const selectedLeadError = ref('')
const heroIndex = ref(0)
const clientIndex = ref(0)
const galleryIndex = ref(0)
let heroCarouselTimer
let carouselTimer
let adminToastTimer

const maxUploadBytes = 8 * 1024 * 1024
const maxOptimizedImageBytes = 480 * 1024
const maxImageDimension = 1600
const defaultHeroSlideAlt = 'Imagen de inicio'
const adminLeadsPageSize = 10
const quoteFormCopy = {
  es: {
    modalTitle: 'Solicita tu cotización',
    modalText: 'Déjanos tus datos y te contactaremos para preparar una propuesta a la medida.',
    fullNameLabel: 'Nombre completo',
    fullNamePlaceholder: 'Tu nombre o empresa',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'nombre@empresa.com',
    phoneLabel: 'Teléfono',
    phonePlaceholder: '+57 300 123 4567',
    messageLabel: 'Mensaje',
    messagePlaceholder: 'Cuéntanos qué operación necesitas cotizar.',
    submitLabel: 'Enviar solicitud',
    submittingLabel: 'Enviando...',
    closeLabel: 'Cerrar',
    success: 'Recibimos tu solicitud. Pronto te contactaremos.',
    successWithWarning: 'Recibimos tu solicitud, pero hubo un problema al enviar la notificación por correo.',
  },
  en: {
    modalTitle: 'Request your quote',
    modalText: 'Leave your details and we will contact you to prepare a tailored proposal.',
    fullNameLabel: 'Full name',
    fullNamePlaceholder: 'Your name or company',
    emailLabel: 'Email address',
    emailPlaceholder: 'name@company.com',
    phoneLabel: 'Phone',
    phonePlaceholder: '+1 555 123 4567',
    messageLabel: 'Message',
    messagePlaceholder: 'Tell us what kind of operation you need to quote.',
    submitLabel: 'Send request',
    submittingLabel: 'Sending...',
    closeLabel: 'Close',
    success: 'We received your request. We will contact you soon.',
    successWithWarning: 'We received your request, but there was a problem sending the email notification.',
  },
}

function createEmptyLeadForm(locale = 'es') {
  return {
    locale,
    fullName: '',
    email: '',
    phone: '',
    message: '',
  }
}

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
const galleryItems = computed(() => {
  const items = site.value.galleryItems || []
  const itemsWithImages = items.filter((item) => item.image)
  return itemsWithImages.length ? itemsWithImages : items
})
const testimonials = computed(() => site.value.testimonials || [])
const reasons = computed(() => site.value.reasons || [])
const stats = computed(() => site.value.stats || [])
const steps = computed(() => site.value.steps || [])
const socialLinks = computed(() => site.value.socialLinks || [])
const footerLogoUrl = computed(() => site.value.footer?.logo || logoUrl)
const leadCopy = computed(() => quoteFormCopy[activeLocale.value] || quoteFormCopy.es)
const testimonialIndex = ref(0)
const heroSlides = computed(() => normalizeHeroSlides(site.value.hero))
const draftHeroSlides = computed(() => normalizeHeroSlides(draftLocale.value.hero))
const activeHeroIndex = computed(() => heroSlides.value.length ? heroIndex.value % heroSlides.value.length : 0)
const activeHeroSlide = computed(() => heroSlides.value[activeHeroIndex.value] || null)
const activeClientIndex = computed(() => clients.value.length ? clientIndex.value % clients.value.length : 0)
const activeGalleryIndex = computed(() => galleryItems.value.length ? galleryIndex.value % galleryItems.value.length : 0)
const visibleClients = computed(() => {
  const items = clients.value
  if (!items.length) return []
  return [0, 1, 2, 3].map((offset) => items[(activeClientIndex.value + offset) % items.length]).slice(0, Math.min(4, items.length))
})
const activeGalleryItem = computed(() => {
  const items = galleryItems.value
  if (!items.length) return null
  return items[activeGalleryIndex.value]
})
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
const hasAdminLeads = computed(() => adminLeads.value.length > 0)

function sectionId(item) {
  return item.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function navHref(index, item) {
  const ids = ['inicio', 'servicios', 'nosotros', 'clientes', 'eventos', 'recursos', 'contacto']
  return `#${ids[index] || sectionId(item)}`
}

function titleParts(title, highlight) {
  if (!highlight || !title?.includes(highlight)) return [title, '']
  return [title.replace(highlight, '').trim(), highlight]
}

function icon(name) {
  return iconMap[name] || Globe2
}

function normalizeHeroSlides(hero) {
  const slides = (hero?.images || [])
    .filter((item) => isFilled(item?.image))
    .map((item) => ({
      image: item.image.trim(),
      alt: isFilled(item?.alt) ? item.alt.trim() : defaultHeroSlideAlt,
    }))

  if (slides.length) return slides

  if (isFilled(hero?.image)) {
    return [{
      image: hero.image.trim(),
      alt: defaultHeroSlideAlt,
    }]
  }

  return []
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function assertFilled(value, label) {
  if (!isFilled(value)) {
    throw new Error(`${label} es obligatorio.`)
  }
}

function assertItems(items, label) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error(`${label} debe tener al menos un elemento.`)
  }
}

function validateLocaleContent(locale, localeKey) {
  const localeLabel = localeKey === 'es' ? 'Español' : 'Inglés'

  assertItems(locale.navItems, `Menú (${localeLabel})`)
  locale.navItems.forEach((item, index) => assertFilled(item, `Menú (${localeLabel}) - opción ${index + 1}`))

  assertFilled(locale.brand?.name, `Marca (${localeLabel}) - nombre`)
  assertFilled(locale.brand?.subtitle, `Marca (${localeLabel}) - subtítulo`)

  assertFilled(locale.hero?.kicker, `Inicio (${localeLabel}) - etiqueta`)
  assertFilled(locale.hero?.title, `Inicio (${localeLabel}) - título`)
  assertFilled(locale.hero?.highlight, `Inicio (${localeLabel}) - texto resaltado`)
  assertFilled(locale.hero?.text, `Inicio (${localeLabel}) - descripción`)
  assertFilled(locale.hero?.primaryLabel, `Inicio (${localeLabel}) - botón principal`)
  assertFilled(locale.hero?.primaryHref, `Inicio (${localeLabel}) - URL principal`)
  assertFilled(locale.hero?.secondaryLabel, `Inicio (${localeLabel}) - botón secundario`)
  assertFilled(locale.hero?.secondaryHref, `Inicio (${localeLabel}) - URL secundaria`)
  assertItems(locale.hero?.images, `Inicio (${localeLabel}) - imágenes`)
  locale.hero.images.forEach((item, index) => {
    assertFilled(item?.image, `Inicio (${localeLabel}) - imagen ${index + 1}`)
    assertFilled(item?.alt, `Inicio (${localeLabel}) - imagen ${index + 1} texto alternativo`)
  })

  assertFilled(locale.servicesHeading?.kicker, `Servicios (${localeLabel}) - etiqueta`)
  assertFilled(locale.servicesHeading?.title, `Servicios (${localeLabel}) - título`)
  assertItems(locale.services, `Servicios (${localeLabel})`)
  locale.services.forEach((service, index) => {
    assertFilled(service?.title, `Servicios (${localeLabel}) - servicio ${index + 1} título`)
    assertFilled(service?.text, `Servicios (${localeLabel}) - servicio ${index + 1} descripción`)
    assertFilled(service?.icon, `Servicios (${localeLabel}) - servicio ${index + 1} icono`)
  })

  assertFilled(locale.clientsHeading?.kicker, `Clientes (${localeLabel}) - etiqueta`)
  assertFilled(locale.clientsHeading?.title, `Clientes (${localeLabel}) - título`)
  assertItems(locale.clients, `Clientes (${localeLabel})`)
  locale.clients.forEach((client, index) => assertFilled(client, `Clientes (${localeLabel}) - cliente ${index + 1}`))

  assertFilled(locale.galleryHeading?.kicker, `Eventos y noticias (${localeLabel}) - etiqueta`)
  assertFilled(locale.galleryHeading?.title, `Eventos y noticias (${localeLabel}) - título`)
  assertItems(locale.galleryItems, `Eventos y noticias (${localeLabel})`)
  locale.galleryItems.forEach((item, index) => {
    assertFilled(item?.title, `Eventos y noticias (${localeLabel}) - elemento ${index + 1} título`)
    assertFilled(item?.text, `Eventos y noticias (${localeLabel}) - elemento ${index + 1} descripción`)
    if (item?.image) {
      assertFilled(item?.alt, `Eventos y noticias (${localeLabel}) - elemento ${index + 1} texto alternativo`)
    }
  })

  assertFilled(locale.testimonialsHeading?.kicker, `Testimonios (${localeLabel}) - etiqueta`)
  assertFilled(locale.testimonialsHeading?.title, `Testimonios (${localeLabel}) - título`)
  assertItems(locale.testimonials, `Testimonios (${localeLabel})`)
  locale.testimonials.forEach((item, index) => {
    assertFilled(item?.text, `Testimonios (${localeLabel}) - testimonio ${index + 1}`)
    assertFilled(item?.name, `Testimonios (${localeLabel}) - nombre ${index + 1}`)
    assertFilled(item?.role, `Testimonios (${localeLabel}) - cargo ${index + 1}`)
  })

  assertFilled(locale.reasonsHeading?.kicker, `Razones (${localeLabel}) - etiqueta`)
  assertFilled(locale.reasonsHeading?.title, `Razones (${localeLabel}) - título`)
  assertItems(locale.reasons, `Razones (${localeLabel})`)
  locale.reasons.forEach((item, index) => {
    assertFilled(item?.title, `Razones (${localeLabel}) - razón ${index + 1} título`)
    assertFilled(item?.text, `Razones (${localeLabel}) - razón ${index + 1} descripción`)
    assertFilled(item?.icon, `Razones (${localeLabel}) - razón ${index + 1} icono`)
  })

  assertItems(locale.stats, `Métricas (${localeLabel})`)
  locale.stats.forEach((item, index) => {
    assertFilled(item?.value, `Métricas (${localeLabel}) - métrica ${index + 1} valor`)
    assertFilled(item?.label, `Métricas (${localeLabel}) - métrica ${index + 1} texto`)
    assertFilled(item?.icon, `Métricas (${localeLabel}) - métrica ${index + 1} icono`)
  })

  assertFilled(locale.processHeading?.kicker, `Proceso (${localeLabel}) - etiqueta`)
  assertFilled(locale.processHeading?.title, `Proceso (${localeLabel}) - título`)
  assertItems(locale.steps, `Proceso (${localeLabel})`)
  locale.steps.forEach((item, index) => {
    assertFilled(item?.title, `Proceso (${localeLabel}) - paso ${index + 1} título`)
    assertFilled(item?.text, `Proceso (${localeLabel}) - paso ${index + 1} descripción`)
    assertFilled(item?.icon, `Proceso (${localeLabel}) - paso ${index + 1} icono`)
  })

  assertFilled(locale.cta?.title, `CTA (${localeLabel}) - título`)
  assertFilled(locale.cta?.text, `CTA (${localeLabel}) - texto`)
  assertFilled(locale.cta?.primaryLabel, `CTA (${localeLabel}) - botón principal`)
  assertFilled(locale.cta?.primaryHref, `CTA (${localeLabel}) - URL principal`)
  assertFilled(locale.cta?.secondaryLabel, `CTA (${localeLabel}) - botón secundario`)
  assertFilled(locale.cta?.secondaryHref, `CTA (${localeLabel}) - URL secundaria`)

  assertFilled(locale.contact?.address, `Contacto (${localeLabel}) - dirección`)
  assertFilled(locale.contact?.phone, `Contacto (${localeLabel}) - teléfono`)
  assertFilled(locale.contact?.email, `Contacto (${localeLabel}) - email`)

  assertFilled(locale.footer?.quickLinksTitle, `Footer (${localeLabel}) - título enlaces`)
  assertFilled(locale.footer?.servicesTitle, `Footer (${localeLabel}) - título servicios`)
  assertFilled(locale.footer?.contactTitle, `Footer (${localeLabel}) - título contacto`)
  assertFilled(locale.footer?.description, `Footer (${localeLabel}) - descripción`)
  assertFilled(locale.footer?.copyright, `Footer (${localeLabel}) - copyright`)
  assertFilled(locale.footer?.legal, `Footer (${localeLabel}) - legal`)

  assertItems(locale.socialLinks, `Redes sociales (${localeLabel})`)
  locale.socialLinks.forEach((item, index) => {
    assertFilled(item?.label, `Redes sociales (${localeLabel}) - red ${index + 1} nombre`)
    assertFilled(item?.href, `Redes sociales (${localeLabel}) - red ${index + 1} enlace`)
    assertFilled(item?.icon, `Redes sociales (${localeLabel}) - red ${index + 1} icono`)
  })
}

function validateRequiredContent(value) {
  Object.entries(value.locales || {}).forEach(([localeKey, locale]) => {
    validateLocaleContent(locale, localeKey)
  })
}

function addItem(collection, item) {
  collection.push(clone(item))
}

function removeItem(collection, index) {
  collection.splice(index, 1)
}

function addHeroSlide() {
  draftLocale.value.hero.images.push({
    image: '',
    alt: defaultHeroSlideAlt,
  })
}

function removeHeroSlide(index) {
  if ((draftLocale.value.hero.images || []).length <= 1) {
    adminStatus.value = 'El carrusel del inicio debe conservar al menos una imagen.'
    return
  }

  draftLocale.value.hero.images.splice(index, 1)
}

function nextHeroSlide() {
  if (!heroSlides.value.length) return
  heroIndex.value = (heroIndex.value + 1) % heroSlides.value.length
}

function goToHeroSlide(index) {
  heroIndex.value = index
}

function nextClient() {
  if (!clients.value.length) return
  clientIndex.value = (clientIndex.value + 1) % clients.value.length
}

function previousClient() {
  if (!clients.value.length) return
  clientIndex.value = (clientIndex.value - 1 + clients.value.length) % clients.value.length
}

function goToClient(index) {
  clientIndex.value = index
}

function nextGalleryItem() {
  if (!galleryItems.value.length) return
  galleryIndex.value = (galleryIndex.value + 1) % galleryItems.value.length
}

function previousGalleryItem() {
  if (!galleryItems.value.length) return
  galleryIndex.value = (galleryIndex.value - 1 + galleryItems.value.length) % galleryItems.value.length
}

function goToGalleryItem(index) {
  galleryIndex.value = index
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

function openLeadModal() {
  leadModalOpen.value = true
  menuOpen.value = false
  leadForm.value = createEmptyLeadForm(activeLocale.value)
  leadFormStatus.value = ''
}

function closeLeadModal() {
  leadModalOpen.value = false
  leadFormStatus.value = ''
  leadFormSubmitting.value = false
}

async function loadContent() {
  loading.value = true
  content.value = await fetchContent()
  draft.value = clone(content.value)
  hasUnsavedChanges.value = false
  heroIndex.value = 0
  clientIndex.value = 0
  galleryIndex.value = 0
  loading.value = false
}

async function refreshPublishedContent() {
  const freshContent = await fetchContent({ cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
  content.value = freshContent
  draft.value = clone(freshContent)
  hasUnsavedChanges.value = false
}

function showAdminToast(message) {
  adminToast.value = message
  if (adminToastTimer) window.clearTimeout(adminToastTimer)
  adminToastTimer = window.setTimeout(() => {
    adminToast.value = ''
  }, 2600)
}

function switchLocale(locale) {
  activeLocale.value = locale
  localStorage.setItem('locale', locale)
}

function formatLeadDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Intl.DateTimeFormat(activeLocale.value === 'en' ? 'en-US' : 'es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatAdminLeadDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function emailStatusLabel(status) {
  if (status === 'sent') return 'Correo enviado'
  if (status === 'failed') return 'Correo con error'
  return 'Pendiente'
}

async function submitLead() {
  leadFormSubmitting.value = true
  leadFormStatus.value = ''

  try {
    const response = await submitQuoteRequest({
      ...leadForm.value,
      locale: activeLocale.value,
    })
    leadForm.value = createEmptyLeadForm(activeLocale.value)
    leadFormStatus.value = response.emailSent ? leadCopy.value.success : leadCopy.value.successWithWarning
  } catch (error) {
    leadFormStatus.value = error.message
  } finally {
    leadFormSubmitting.value = false
  }
}

async function loadAdminLeads(page = adminLeadsPagination.value.page || 1) {
  if (!adminJwt.value) return

  adminLeadsLoading.value = true
  adminLeadsError.value = ''

  try {
    const response = await fetchAdminLeads(adminJwt.value, page, adminLeadsPageSize)
    adminLeads.value = response.items || []
    adminLeadsPagination.value = response.pagination || { page: 1, pageSize: adminLeadsPageSize, totalItems: 0, totalPages: 1 }
  } catch (error) {
    adminLeadsError.value = error.message
  } finally {
    adminLeadsLoading.value = false
  }
}

async function loadAdminLeadDetailById(leadId) {
  if (!adminJwt.value || !leadId) return

  selectedLeadLoading.value = true
  selectedLeadError.value = ''
  selectedLead.value = null

  try {
    const response = await fetchAdminLeadDetail(adminJwt.value, leadId)
    selectedLead.value = response.item
    selectedLeadId.value = response.item?.id || leadId
  } catch (error) {
    selectedLeadError.value = error.message
  } finally {
    selectedLeadLoading.value = false
  }
}

function closeAdminLeadDetail() {
  selectedLead.value = null
  selectedLeadId.value = null
  selectedLeadError.value = ''
  selectedLeadLoading.value = false
}

async function setAdminView(view) {
  adminView.value = view
  closeAdminLeadDetail()
  if (view === 'leads') {
    await loadAdminLeads(1)
  }
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
    adminView.value = 'content'
  } catch (error) {
    adminStatus.value = error.message
  }
}

function logout() {
  adminJwt.value = ''
  localStorage.removeItem('adminJwt')
  adminStatus.value = 'Sesión cerrada.'
  adminView.value = 'content'
  adminLeads.value = []
  selectedLead.value = null
  selectedLeadId.value = null
  window.history.pushState({}, '', '/login')
  routePath.value = '/login'
}

async function persistContent() {
  adminStatus.value = 'Guardando...'
  try {
    const cleanDraft = stripTransientGalleryState(draft.value)
    validateOptimizedImages(cleanDraft)
    validateRequiredContent(cleanDraft)
    await saveContent(cleanDraft, adminJwt.value)
    await refreshPublishedContent()
    adminStatus.value = 'Cambios guardados.'
    showAdminToast('Guardado correctamente.')
  } catch (error) {
    adminStatus.value = error.message
  }
}

function stripTransientGalleryState(value) {
  const cleanValue = clone(value)
  Object.values(cleanValue.locales || {}).forEach((locale) => {
    if (locale.hero) {
      delete locale.hero.imageStatus
      delete locale.hero.imageKey
      locale.hero.images = (locale.hero.images || []).map(({ imageStatus, imageKey, ...item }) => item)
    }
    if (locale.footer) {
      delete locale.footer.logoStatus
      delete locale.footer.logoKey
    }
    locale.galleryItems = (locale.galleryItems || []).map(({ imageStatus, ...item }) => item)
  })
  return cleanValue
}

function validateOptimizedImages(value) {
  Object.values(value.locales || {}).forEach((locale) => {
    if (locale.hero?.image?.startsWith('data:')) {
      throw new Error('La imagen del inicio está pendiente de subir. Vuelve a seleccionarla para enviarla al almacenamiento.')
    }
    ;(locale.hero?.images || []).forEach((item) => {
      if (!item.image) return
      if (item.image.startsWith('data:')) {
        throw new Error('Hay una imagen del carrusel de inicio pendiente de subir. Vuelve a seleccionarla para enviarla al almacenamiento.')
      }
    })
    ;(locale.galleryItems || []).forEach((item) => {
      if (!item.image) return
      if (item.image.startsWith('data:')) {
        throw new Error('Hay una imagen pendiente de subir. Vuelve a seleccionarla para enviarla al almacenamiento.')
      }
    })
    if (locale.footer?.logo?.startsWith('data:')) {
      throw new Error('El logo del footer está pendiente de subir. Vuelve a seleccionarlo para enviarlo al almacenamiento.')
    }
  })
}

async function handleGalleryImageUpload(event, item) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  try {
    item.imageStatus = 'Optimizando imagen...'
    const optimized = await optimizeImage(file)
    item.imageStatus = `Subiendo imagen optimizada: ${formatBytes(optimized.blob.size)}.`
    const uploaded = await uploadImage(optimized.blob, adminJwt.value, file.name)
    item.image = uploaded.url
    item.imageKey = uploaded.key
    item.imageStatus = `Imagen subida y optimizada: ${formatBytes(optimized.blob.size)}. Presiona "Guardar cambios" para publicarla.`
    if (!item.alt) item.alt = item.title || 'Imagen del sitio web'
  } catch (error) {
    item.imageStatus = error.message
  }
}

async function handleHeroImageUpload(event, item) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  try {
    item.imageStatus = 'Optimizando imagen...'
    const optimized = await optimizeImage(file)
    item.imageStatus = `Subiendo imagen optimizada: ${formatBytes(optimized.blob.size)}.`
    const uploaded = await uploadImage(optimized.blob, adminJwt.value, file.name)
    item.image = uploaded.url
    item.imageKey = uploaded.key
    item.imageStatus = `Imagen del carrusel subida y optimizada: ${formatBytes(optimized.blob.size)}. Presiona "Guardar cambios" para publicarla.`
  } catch (error) {
    item.imageStatus = error.message
  }
}

async function handleFooterLogoUpload(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  try {
    draftLocale.value.footer.logoStatus = 'Optimizando logo...'
    const optimized = await optimizeImage(file)
    draftLocale.value.footer.logoStatus = `Subiendo logo optimizado: ${formatBytes(optimized.blob.size)}.`
    const uploaded = await uploadImage(optimized.blob, adminJwt.value, file.name)
    draftLocale.value.footer.logo = uploaded.url
    draftLocale.value.footer.logoKey = uploaded.key
    draftLocale.value.footer.logoStatus = `Logo subido y optimizado: ${formatBytes(optimized.blob.size)}. Presiona "Guardar cambios" para publicarlo.`
  } catch (error) {
    draftLocale.value.footer.logoStatus = error.message
  }
}

async function optimizeImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Selecciona una imagen válida.')
  if (file.size > maxUploadBytes) throw new Error(`La imagen original no debe superar ${formatBytes(maxUploadBytes)}.`)

  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  for (const maxDimension of [maxImageDimension, 1400, 1200, 1000]) {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const width = Math.round(image.width * scale)
    const height = Math.round(image.height * scale)
    canvas.width = width
    canvas.height = height
    context.drawImage(image, 0, 0, width, height)

    for (const quality of [0.92, 0.88, 0.84, 0.8, 0.76]) {
      const blob = await canvasToBlob(canvas, 'image/webp', quality)
      if (blob.size <= maxOptimizedImageBytes) return { blob, width, height }
    }
  }

  throw new Error(`No se pudo optimizar por debajo de ${formatBytes(maxOptimizedImageBytes)}. Prueba con una imagen menos pesada.`)
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('No se pudo optimizar la imagen.'))
    }, type, quality)
  })
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    image.src = url
  })
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

onMounted(() => {
  loadContent()
  heroCarouselTimer = window.setInterval(() => {
    nextHeroSlide()
  }, 8400)
  carouselTimer = window.setInterval(() => {
    nextClient()
    nextGalleryItem()
  }, 5200)
})

onBeforeUnmount(() => {
  if (heroCarouselTimer) window.clearInterval(heroCarouselTimer)
  if (carouselTimer) window.clearInterval(carouselTimer)
  if (adminToastTimer) window.clearTimeout(adminToastTimer)
})

watch(draft, () => {
  if (loading.value) return
  hasUnsavedChanges.value = JSON.stringify(stripTransientGalleryState(draft.value)) !== JSON.stringify(content.value)
}, { deep: true })

watch(activeLocale, (locale) => {
  if (!leadModalOpen.value) {
    leadForm.value.locale = locale
  }
})

watch(heroSlides, (items) => {
  if (!items.length) {
    heroIndex.value = 0
    return
  }

  heroIndex.value %= items.length
}, { immediate: true })
</script>

<template>
  <div class="site-shell">
    <main v-if="isLogin" class="login-page">
      <form class="login-card" @submit.prevent="login">
        <img :src="logoUrl" alt="" />
        <h1>Acceso administrativo</h1>
        <p>Ingresa tus credenciales para gestionar el contenido del sitio web.</p>
        <label>
          Correo
          <input v-model="loginForm.email" type="email" autocomplete="username" />
        </label>
        <label>
          Contraseña
          <input v-model="loginForm.password" type="password" autocomplete="current-password" />
        </label>
        <button class="admin-save" type="submit"><LogIn :size="18" /> Entrar</button>
        <a class="admin-link" href="/">Volver al sitio web</a>
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
        <p>Actualiza los textos, enlaces e información que aparecen en el sitio web.</p>
        <div class="admin-nav">
          <button type="button" class="admin-link" :class="{ active: adminView === 'content' }" @click="setAdminView('content')">Contenido</button>
          <button type="button" class="admin-link" :class="{ active: adminView === 'leads' }" @click="setAdminView('leads')">Solicitudes</button>
        </div>
        <button class="admin-link" type="button" @click="logout">Cerrar sesión</button>
        <a class="admin-link" href="/">Ver sitio web</a>
        <span class="admin-status">{{ adminStatus }}</span>
      </aside>

      <section class="admin-editor" :aria-busy="loading">
        <button v-if="adminView === 'content'" class="admin-save admin-save-floating" type="button" @click="persistContent">
          <Save :size="18" /> Guardar cambios
        </button>
        <div v-if="adminToast" class="admin-toast" role="status" aria-live="polite">{{ adminToast }}</div>

        <template v-if="adminView === 'content'">
        <div class="admin-section">
          <h2>Idioma del contenido</h2>
          <p class="admin-note" :class="{ active: hasUnsavedChanges }">
            {{ hasUnsavedChanges ? 'Tienes cambios sin guardar. Presiona "Guardar cambios" para publicarlos en el sitio web.' : 'Cuando realices cualquier cambio, presiona "Guardar cambios" para publicarlo en el sitio web.' }}
          </p>
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
          <article v-for="(item, index) in draftLocale.hero.images" :key="`hero-slide-${index}`" class="admin-card hero-slide-admin-card">
            <div class="image-preview hero-image-preview">
              <img v-if="item.image" :src="item.image" :alt="item.alt || `Vista previa de la imagen ${index + 1}`" />
              <ImagePlus v-else :size="34" />
            </div>
            <div class="gallery-admin-fields">
              <input v-model="item.alt" placeholder="Texto alternativo de la imagen" />
              <label class="file-field">
                Cambiar imagen del carrusel
                <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleHeroImageUpload($event, item)" />
              </label>
              <small>{{ item.imageStatus || `Máximo ${formatBytes(maxUploadBytes)}. Se guarda optimizada hasta ${formatBytes(maxOptimizedImageBytes)}.` }}</small>
            </div>
            <button type="button" class="danger" @click="removeHeroSlide(index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addHeroSlide">
            <Plus :size="16" /> Agregar imagen al carrusel
          </button>
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
            <div class="icon-select-field">
              <span class="icon-preview" aria-hidden="true">
                <component :is="icon(service.icon)" :size="18" />
              </span>
              <select v-model="service.icon">
                <option v-for="option in iconOptions" :key="option">{{ option }}</option>
              </select>
            </div>
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
          <h2>Eventos y noticias</h2>
          <label>Etiqueta <input v-model="draftLocale.galleryHeading.kicker" /></label>
          <label>Título <input v-model="draftLocale.galleryHeading.title" /></label>
          <article v-for="(item, index) in draftLocale.galleryItems" :key="index" class="admin-card gallery-admin-card">
            <div class="image-preview">
              <img v-if="item.image" :src="item.image" :alt="item.alt || item.title" />
              <ImagePlus v-else :size="34" />
            </div>
            <div class="gallery-admin-fields">
              <input v-model="item.title" placeholder="Título" />
              <textarea v-model="item.text" rows="2" placeholder="Descripción o noticia"></textarea>
              <input v-model="item.alt" placeholder="Texto alternativo de la imagen" />
              <label class="file-field">
                Subir foto optimizada
                <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleGalleryImageUpload($event, item)" />
              </label>
              <small>{{ item.imageStatus || `Máximo ${formatBytes(maxUploadBytes)}. Se guarda optimizada hasta ${formatBytes(maxOptimizedImageBytes)}.` }}</small>
            </div>
            <button type="button" class="danger" @click="removeItem(draftLocale.galleryItems, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button
            type="button"
            class="admin-add"
            @click="addItem(draftLocale.galleryItems, { title: 'Nuevo evento', text: '', image: '', alt: 'Evento de Cortes Rodriguez Asesores' })"
          >
            <Plus :size="16" /> Agregar evento o noticia
          </button>
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
            <div class="icon-select-field">
              <span class="icon-preview" aria-hidden="true">
                <component :is="icon(reason.icon)" :size="18" />
              </span>
              <select v-model="reason.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            </div>
            <button type="button" class="danger" @click="removeItem(draftLocale.reasons, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.reasons, { title: 'Nueva razón', text: '', icon: 'ShieldCheck' })">
            <Plus :size="16" /> Agregar razón
          </button>

          <article v-for="(stat, index) in draftLocale.stats" :key="`stat-${index}`" class="admin-card">
            <input v-model="stat.value" placeholder="Valor" />
            <input v-model="stat.label" placeholder="Texto" />
            <div class="icon-select-field">
              <span class="icon-preview" aria-hidden="true">
                <component :is="icon(stat.icon)" :size="18" />
              </span>
              <select v-model="stat.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            </div>
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
            <div class="icon-select-field">
              <span class="icon-preview" aria-hidden="true">
                <component :is="icon(step.icon)" :size="18" />
              </span>
              <select v-model="step.icon"><option v-for="option in iconOptions" :key="option">{{ option }}</option></select>
            </div>
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
          <article class="admin-card gallery-admin-card">
            <div class="image-preview footer-logo-preview">
              <img v-if="draftLocale.footer.logo || logoUrl" :src="draftLocale.footer.logo || logoUrl" alt="Vista previa del logo del footer" />
              <ImagePlus v-else :size="34" />
            </div>
            <div class="gallery-admin-fields">
              <label class="file-field">
                Subir logo del footer
                <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleFooterLogoUpload" />
              </label>
              <small>{{ draftLocale.footer.logoStatus || 'Ideal: logo en PNG/WebP con fondo transparente para que contraste mejor sobre el footer azul.' }}</small>
            </div>
          </article>
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
            <div class="icon-select-field">
              <span class="icon-preview" aria-hidden="true">
                <component :is="icon(social.icon)" :size="18" />
              </span>
              <select v-model="social.icon">
                <option>Linkedin</option>
                <option>Facebook</option>
                <option>Instagram</option>
                <option>Mail</option>
                <option>Phone</option>
              </select>
            </div>
            <button type="button" class="danger" @click="removeItem(draftLocale.socialLinks, index)"><Trash2 :size="16" /> Eliminar</button>
          </article>
          <button type="button" class="admin-add" @click="addItem(draftLocale.socialLinks, { label: 'Nueva red', icon: 'Linkedin', href: 'https://' })">
            <Plus :size="16" /> Agregar red social
          </button>
        </div>
        </template>

        <template v-else>
          <div class="admin-section">
            <div class="admin-section-header">
              <div>
                <h2>Solicitudes de cotización</h2>
                <p class="admin-note">Aquí verás los datos enviados desde el formulario público y el estado del correo enviado por Resend.</p>
              </div>
              <button type="button" class="admin-link" @click="loadAdminLeads(adminLeadsPagination.page)">Actualizar</button>
            </div>

            <div v-if="adminLeadsError" class="admin-inline-error">{{ adminLeadsError }}</div>

            <div v-if="!selectedLead && !selectedLeadLoading" class="lead-admin-list">
                <div class="lead-list-toolbar">
                  <strong>{{ adminLeadsPagination.totalItems }} solicitudes</strong>
                  <span>Página {{ adminLeadsPagination.page }} de {{ adminLeadsPagination.totalPages }}</span>
                </div>

                <div v-if="adminLeadsLoading" class="lead-empty-state">Cargando solicitudes...</div>
                <div v-else-if="!hasAdminLeads" class="lead-empty-state">Aún no hay solicitudes registradas.</div>
                <article
                  v-for="item in adminLeads"
                  v-else
                  :key="item.id"
                  class="lead-list-item"
                >
                  <div class="lead-list-item-top">
                    <strong>{{ item.fullName }}</strong>
                    <span class="lead-status-pill" :class="item.emailStatus">{{ emailStatusLabel(item.emailStatus) }}</span>
                  </div>
                  <span>{{ item.email }}</span>
                  <span>{{ item.phone }}</span>
                  <small>{{ item.messagePreview }}</small>
                  <div class="lead-list-item-bottom">
                    <small>{{ formatAdminLeadDate(item.createdAt) }}</small>
                    <button type="button" class="admin-link lead-detail-button" @click="loadAdminLeadDetailById(item.id)">Ver detalle</button>
                  </div>
                </article>

                <div class="lead-pagination">
                  <button
                    type="button"
                    class="admin-link"
                    :disabled="adminLeadsLoading || adminLeadsPagination.page <= 1"
                    @click="loadAdminLeads(adminLeadsPagination.page - 1)"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    class="admin-link"
                    :disabled="adminLeadsLoading || adminLeadsPagination.page >= adminLeadsPagination.totalPages"
                    @click="loadAdminLeads(adminLeadsPagination.page + 1)"
                  >
                    Siguiente
                  </button>
                </div>
            </div>

              <div v-else class="lead-admin-detail">
                <div class="lead-detail-toolbar">
                  <button type="button" class="admin-link" @click="closeAdminLeadDetail">Volver al listado</button>
                  <button type="button" class="admin-link" @click="loadAdminLeads(adminLeadsPagination.page)">Actualizar listado</button>
                </div>
                <div v-if="selectedLeadLoading" class="lead-empty-state">Cargando detalle...</div>
                <div v-else-if="selectedLeadError" class="admin-inline-error">{{ selectedLeadError }}</div>
                <div v-else-if="selectedLead" class="lead-detail-card">
                  <div class="lead-detail-header">
                    <div>
                      <h3>{{ selectedLead.fullName }}</h3>
                      <p>{{ formatAdminLeadDate(selectedLead.createdAt) }}</p>
                    </div>
                    <span class="lead-status-pill" :class="selectedLead.emailStatus">{{ emailStatusLabel(selectedLead.emailStatus) }}</span>
                  </div>
                  <div class="lead-detail-grid">
                    <div>
                      <span>Idioma</span>
                      <strong>{{ selectedLead.locale.toUpperCase() }}</strong>
                    </div>
                    <div>
                      <span>Correo</span>
                      <strong>{{ selectedLead.email }}</strong>
                    </div>
                    <div>
                      <span>Teléfono</span>
                      <strong>{{ selectedLead.phone }}</strong>
                    </div>
                    <div>
                      <span>Destino del correo</span>
                      <strong>{{ selectedLead.recipientEmail }}</strong>
                    </div>
                  </div>
                  <div class="lead-message-box">
                    <span>Mensaje</span>
                    <p>{{ selectedLead.message }}</p>
                  </div>
                  <div v-if="selectedLead.emailError" class="admin-inline-error">
                    Error de correo: {{ selectedLead.emailError }}
                  </div>
                </div>
                <div v-else class="lead-empty-state">Selecciona una solicitud para ver el detalle.</div>
              </div>
          </div>
        </template>
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

        <button class="quote-button" type="button" @click="openLeadModal">
          {{ site.hero.primaryLabel }}
          <ArrowRight :size="18" />
        </button>

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
        <button class="quote-button" type="button" @click="openLeadModal">{{ site.hero.primaryLabel }} <ArrowRight :size="17" /></button>
      </nav>

      <main>
        <section id="inicio" class="hero">
          <div class="hero-media" aria-hidden="true">
            <div
              v-for="(slide, index) in heroSlides"
              :key="`${slide.image}-${index}`"
              class="hero-slide"
              :class="{ active: index === activeHeroIndex }"
              :style="{ '--slide-bg': `url(${slide.image})` }"
            ></div>
          </div>
          <div class="hero-copy">
            <p class="eyebrow">{{ site.hero.kicker }}</p>
            <h1>
              {{ titleParts(site.hero.title, site.hero.highlight)[0] }}
              <span>{{ titleParts(site.hero.title, site.hero.highlight)[1] }}</span>
            </h1>
            <p class="hero-text">{{ site.hero.text }}</p>
            <div class="hero-actions">
              <button class="primary-button" type="button" @click="openLeadModal">{{ site.hero.primaryLabel }} <ArrowRight :size="18" /></button>
              <a class="outline-button" :href="site.hero.secondaryHref">{{ site.hero.secondaryLabel }} <ArrowRight :size="17" /></a>
            </div>
            <div v-if="heroSlides.length > 1" class="slider-dots hero-dots" aria-label="Seleccionar imagen principal">
              <button
                v-for="(slide, index) in heroSlides"
                :key="`${slide.image}-${index}`"
                type="button"
                :class="{ active: index === activeHeroIndex }"
                :aria-label="slide.alt || `Imagen ${index + 1}`"
                @click="goToHeroSlide(index)"
              ></button>
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
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">{{ site.clientsHeading.kicker }}</p>
              <h2>{{ site.clientsHeading.title }}</h2>
            </div>
            <div class="slider-controls" aria-label="Controles de clientes">
              <button type="button" aria-label="Cliente anterior" @click="previousClient"><ChevronLeft :size="20" /></button>
              <button type="button" aria-label="Cliente siguiente" @click="nextClient"><ChevronRight :size="20" /></button>
            </div>
          </div>
          <div class="client-strip">
            <div v-for="client in visibleClients" :key="client" class="client-logo">{{ client }}</div>
          </div>
          <div class="slider-dots" aria-label="Seleccionar cliente">
            <button
              v-for="(_, index) in clients"
              :key="index"
              type="button"
              :class="{ active: index === activeClientIndex }"
              :aria-label="`Ver cliente ${index + 1}`"
              @click="goToClient(index)"
            ></button>
          </div>
        </section>

        <section id="eventos" class="section gallery-section">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">{{ site.galleryHeading.kicker }}</p>
              <h2>{{ site.galleryHeading.title }}</h2>
            </div>
            <div class="slider-controls" aria-label="Controles de eventos y noticias">
              <button type="button" aria-label="Foto anterior" @click="previousGalleryItem"><ChevronLeft :size="20" /></button>
              <button type="button" aria-label="Foto siguiente" @click="nextGalleryItem"><ChevronRight :size="20" /></button>
            </div>
          </div>
          <article class="gallery-card">
            <img v-if="activeGalleryItem?.image" :src="activeGalleryItem.image" :alt="activeGalleryItem.alt || activeGalleryItem.title" />
            <div v-else class="gallery-placeholder">
              <ImagePlus :size="48" />
            </div>
            <div>
              <h3>{{ activeGalleryItem?.title || site.galleryHeading.title }}</h3>
              <p>{{ activeGalleryItem?.text || 'Muy pronto compartiremos fotos, eventos y noticias.' }}</p>
            </div>
          </article>
          <div v-if="galleryItems.length > 1" class="slider-dots" aria-label="Seleccionar foto">
            <button
              v-for="(_, index) in galleryItems"
              :key="index"
              type="button"
              :class="{ active: index === activeGalleryIndex }"
              :aria-label="`Ver foto ${index + 1}`"
              @click="goToGalleryItem(index)"
            ></button>
          </div>
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
            <button class="primary-button" type="button" @click="openLeadModal">{{ site.cta.primaryLabel }} <ArrowRight :size="18" /></button>
            <a class="outline-button" :href="site.cta.secondaryHref">{{ site.cta.secondaryLabel }} <ArrowRight :size="17" /></a>
          </div>
        </section>
      </main>

      <div v-if="leadModalOpen" class="lead-modal-backdrop" @click.self="closeLeadModal">
        <div class="lead-modal" role="dialog" aria-modal="true" :aria-label="leadCopy.modalTitle">
          <button type="button" class="lead-modal-close" :aria-label="leadCopy.closeLabel" @click="closeLeadModal">
            <X :size="20" />
          </button>
          <h2>{{ leadCopy.modalTitle }}</h2>
          <p>{{ leadCopy.modalText }}</p>
          <form class="lead-form" @submit.prevent="submitLead">
            <label>
              {{ leadCopy.fullNameLabel }}
              <input v-model="leadForm.fullName" :placeholder="leadCopy.fullNamePlaceholder" />
            </label>
            <label>
              {{ leadCopy.emailLabel }}
              <input v-model="leadForm.email" type="email" :placeholder="leadCopy.emailPlaceholder" />
            </label>
            <label>
              {{ leadCopy.phoneLabel }}
              <input v-model="leadForm.phone" :placeholder="leadCopy.phonePlaceholder" />
            </label>
            <label>
              {{ leadCopy.messageLabel }}
              <textarea v-model="leadForm.message" rows="5" :placeholder="leadCopy.messagePlaceholder"></textarea>
            </label>
            <button class="admin-save lead-submit-button" type="submit" :disabled="leadFormSubmitting">
              {{ leadFormSubmitting ? leadCopy.submittingLabel : leadCopy.submitLabel }}
            </button>
            <span class="lead-form-status">{{ leadFormStatus }}</span>
          </form>
        </div>
      </div>

      <footer class="footer">
        <div class="footer-grid">
          <div>
            <img class="footer-logo" :src="footerLogoUrl" alt="Cortes Rodriguez Asesores S.A.S." />
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
