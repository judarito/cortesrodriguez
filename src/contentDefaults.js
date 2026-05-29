const es = {
  navItems: ['Inicio', 'Servicios', 'Nosotros', 'Clientes', 'Eventos', 'Recursos', 'Contacto'],
  brand: {
    name: 'Cortes Rodriguez\nAsesores S.A.S.',
    subtitle: 'Asesores de aduana',
  },
  hero: {
    kicker: 'Experiencia • Confianza • Soluciones',
    title: 'Soluciones aduaneras y de comercio exterior que impulsan su negocio',
    highlight: 'impulsan su negocio',
    text: 'Asesoría integral para que su empresa importe, exporte y crezca sin fronteras, con respaldo experto en cada trámite.',
    image: '',
    images: [
      { image: '/hero-carousel-default.png', alt: 'Operaciones logísticas y comercio exterior' },
      { image: '/hero-carousel-1.png', alt: 'Gestión documental y operaciones portuarias internacionales' },
      { image: '/hero-carousel-2.png', alt: 'Supervisión logística de carga en terminal portuaria' },
    ],
    primaryLabel: 'Cotiza ahora',
    primaryHref: '#contacto',
    secondaryLabel: 'Escríbenos por WhatsApp',
    secondaryHref: 'https://wa.me/573001234567',
  },
  servicesHeading: {
    kicker: 'Nuestros servicios',
    title: 'Soluciones integrales para cada operación',
  },
  services: [
    { title: 'Importaciones', text: 'Gestión completa de sus importaciones con cumplimiento normativo y eficiencia.', icon: 'Import' },
    { title: 'Exportaciones', text: 'Acompañamiento experto para llevar sus productos a nuevos mercados.', icon: 'Ship' },
    { title: 'Tránsito aduanero', text: 'Movilizamos su carga de forma segura y ágil a través del territorio nacional.', icon: 'Truck' },
    { title: 'Asesoría en comercio exterior', text: 'Estrategias especializadas para fortalecer su competitividad internacional.', icon: 'Globe2' },
    { title: 'Clasificación arancelaria', text: 'Determinación correcta de partidas arancelarias para evitar riesgos y sanciones.', icon: 'FileCheck2' },
    { title: 'Gestión documental', text: 'Administración y revisión de documentos para procesos sin contratiempos.', icon: 'FolderKanban' },
  ],
  clientsHeading: {
    kicker: 'Nuestra fundación',
    title: 'Historias y momentos que construimos en comunidad',
  },
  clients: [
    {
      name: 'Jornadas de acompañamiento',
      image: '/hero-carousel-1.png',
      alt: 'Equipo de la fundación acompañando una jornada comunitaria',
      text: 'Programas de apoyo y orientación para familias y emprendedores.',
    },
    {
      name: 'Formación y bienestar',
      image: '/hero-carousel-2.png',
      alt: 'Espacio de formación y bienestar liderado por la fundación',
      text: 'Encuentros que fortalecen capacidades y redes de apoyo.',
    },
    {
      name: 'Alianzas con impacto',
      image: '/hero-carousel-default.png',
      alt: 'Actividad de la fundación con aliados estratégicos',
      text: 'Acciones conjuntas para impulsar oportunidades sostenibles.',
    },
  ],
  galleryHeading: {
    kicker: 'Eventos y noticias',
    title: 'Momentos que compartimos con nuestros clientes',
  },
  galleryItems: [
    {
      title: 'Actualidad en comercio exterior',
      text: 'Comparta aquí fotografías de eventos, capacitaciones o noticias relevantes para sus clientes.',
      image: '',
      alt: 'Evento de Cortes Rodriguez Asesores',
    },
  ],
  testimonialsHeading: {
    kicker: 'Testimonios',
    title: 'Lo que dicen nuestros clientes y aliados',
  },
  testimonials: [
    {
      text: 'Cortes Rodriguez Asesores nos ha brindado un servicio impecable, con soluciones rápidas y efectivas en cada operación.',
      name: 'Juan Pablo Gómez',
      role: 'Gerente de Logística',
    },
    {
      text: 'Su conocimiento y acompañamiento han sido clave para nuestro crecimiento en mercados internacionales.',
      name: 'María Fernanda Ruiz',
      role: 'Directora de Comercio Exterior',
    },
    {
      text: 'Profesionalismo, transparencia y cumplimiento. Un aliado estratégico que recomendamos totalmente.',
      name: 'Andrés Cardona',
      role: 'Gerente General',
    },
  ],
  reasonsHeading: {
    kicker: '¿Por qué elegirnos?',
    title: 'Su aliado estratégico en comercio exterior',
  },
  reasons: [
    { title: 'Experiencia y conocimiento', text: 'Más de 15 años en el sector aduanero.', icon: 'ShieldCheck' },
    { title: 'Atención personalizada', text: 'Soluciones adaptadas a cada empresa.', icon: 'UserRoundCheck' },
    { title: 'Cumplimiento y seguridad', text: 'Procesos alineados con la normatividad vigente.', icon: 'BadgeCheck' },
    { title: 'Agilidad y eficiencia', text: 'Optimizamos tiempos y costos operativos.', icon: 'Clock3' },
  ],
  stats: [
    { value: '15+', label: 'Años de experiencia', icon: 'CalendarDays' },
    { value: '5.500+', label: 'Operaciones exitosas', icon: 'Container' },
    { value: '250+', label: 'Clientes satisfechos', icon: 'UsersRound' },
    { value: '98%', label: 'Cumplimiento normativo', icon: 'Award' },
  ],
  processHeading: {
    kicker: 'Nuestro proceso',
    title: 'Así trabajamos por su tranquilidad',
  },
  steps: [
    { title: 'Escuchamos', text: 'Entendemos sus necesidades y objetivos de negocio.', icon: 'Mail' },
    { title: 'Analizamos', text: 'Evaluamos su operación y proponemos la mejor estrategia.', icon: 'ClipboardCheck' },
    { title: 'Gestionamos', text: 'Ejecutamos el proceso aduanero con eficiencia.', icon: 'Route' },
    { title: 'Acompañamos', text: 'Brindamos seguimiento y soporte permanente.', icon: 'CheckCircle2' },
  ],
  cta: {
    title: '¿Listo para llevar su negocio más allá de las fronteras?',
    text: 'Contáctenos hoy y reciba asesoría personalizada.',
    primaryLabel: 'Cotiza ahora',
    primaryHref: 'tel:+573001234567',
    secondaryLabel: 'WhatsApp',
    secondaryHref: 'https://wa.me/573001234567',
  },
  footer: {
    logo: '',
    quickLinksTitle: 'Enlaces rápidos',
    servicesTitle: 'Nuestros servicios',
    contactTitle: 'Contáctenos',
    description: 'Asesoría integral en comercio exterior y operaciones aduaneras con experiencia, confianza y soluciones a la medida.',
    copyright: '© 2026 Cortes Rodriguez Asesores S.A.S.',
    legal: 'Política de Privacidad · Términos y Condiciones',
  },
  contact: {
    address: 'Calle 100 # 11A-45, Bogotá, Colombia',
    phone: '+57 300 123 4567',
    email: 'info@cortesrodriguezasesores.com',
  },
  socialLinks: [
    { label: 'LinkedIn', icon: 'Linkedin', href: 'https://www.linkedin.com/' },
    { label: 'Facebook', icon: 'Facebook', href: 'https://www.facebook.com/' },
    { label: 'Instagram', icon: 'Instagram', href: 'https://www.instagram.com/' },
    { label: 'Correo', icon: 'Mail', href: 'mailto:info@cortesrodriguezasesores.com' },
  ],
}

const en = {
  navItems: ['Home', 'Services', 'About', 'Clients', 'Events', 'Resources', 'Contact'],
  brand: {
    name: 'Cortes Rodriguez\nAsesores S.A.S.',
    subtitle: 'Customs advisors',
  },
  hero: {
    kicker: 'Experience • Trust • Solutions',
    title: 'Customs and foreign trade solutions that drive your business',
    highlight: 'drive your business',
    text: 'End-to-end advisory so your company can import, export, and grow across borders with expert support in every procedure.',
    image: '',
    images: [
      { image: '/hero-carousel-default.png', alt: 'Logistics and foreign trade operations' },
      { image: '/hero-carousel-1.png', alt: 'Documentation management and international port operations' },
      { image: '/hero-carousel-2.png', alt: 'Cargo logistics supervision at a port terminal' },
    ],
    primaryLabel: 'Request a quote',
    primaryHref: '#contacto',
    secondaryLabel: 'Message us on WhatsApp',
    secondaryHref: 'https://wa.me/573001234567',
  },
  servicesHeading: {
    kicker: 'Our services',
    title: 'Comprehensive solutions for every operation',
  },
  services: [
    { title: 'Imports', text: 'Complete import management with regulatory compliance and efficiency.', icon: 'Import' },
    { title: 'Exports', text: 'Expert support to bring your products into new markets.', icon: 'Ship' },
    { title: 'Customs transit', text: 'We move your cargo safely and quickly across national territory.', icon: 'Truck' },
    { title: 'Foreign trade advisory', text: 'Specialized strategies to strengthen your international competitiveness.', icon: 'Globe2' },
    { title: 'Tariff classification', text: 'Correct tariff code determination to avoid risks and penalties.', icon: 'FileCheck2' },
    { title: 'Document management', text: 'Administration and review of documents for smooth customs processes.', icon: 'FolderKanban' },
  ],
  clientsHeading: {
    kicker: 'Our foundation',
    title: 'Stories and moments we build together',
  },
  clients: [
    {
      name: 'Support programs',
      image: '/hero-carousel-1.png',
      alt: 'Foundation team supporting a community outreach event',
      text: 'Support and guidance programs for families and entrepreneurs.',
    },
    {
      name: 'Training and wellbeing',
      image: '/hero-carousel-2.png',
      alt: 'Training and wellbeing session led by the foundation',
      text: 'Sessions that strengthen capabilities and support networks.',
    },
    {
      name: 'Impact partnerships',
      image: '/hero-carousel-default.png',
      alt: 'Foundation activity with strategic partners',
      text: 'Joint actions to create sustainable opportunities.',
    },
  ],
  galleryHeading: {
    kicker: 'Events and news',
    title: 'Moments we share with our clients',
  },
  galleryItems: [
    {
      title: 'Foreign trade updates',
      text: 'Share photos from events, training sessions, or relevant news for your clients here.',
      image: '',
      alt: 'Cortes Rodriguez Asesores event',
    },
  ],
  testimonialsHeading: {
    kicker: 'Testimonials',
    title: 'What our clients and partners say',
  },
  testimonials: [
    {
      text: 'Cortes Rodriguez Asesores has provided impeccable service, with fast and effective solutions in every operation.',
      name: 'Juan Pablo Gómez',
      role: 'Logistics Manager',
    },
    {
      text: 'Their knowledge and support have been key to our growth in international markets.',
      name: 'María Fernanda Ruiz',
      role: 'Foreign Trade Director',
    },
    {
      text: 'Professionalism, transparency, and compliance. A strategic partner we fully recommend.',
      name: 'Andrés Cardona',
      role: 'General Manager',
    },
  ],
  reasonsHeading: {
    kicker: 'Why choose us?',
    title: 'Your strategic partner in foreign trade',
  },
  reasons: [
    { title: 'Experience and knowledge', text: 'More than 15 years in the customs sector.', icon: 'ShieldCheck' },
    { title: 'Personalized attention', text: 'Solutions tailored to each company.', icon: 'UserRoundCheck' },
    { title: 'Compliance and security', text: 'Processes aligned with current regulations.', icon: 'BadgeCheck' },
    { title: 'Speed and efficiency', text: 'We optimize time and operating costs.', icon: 'Clock3' },
  ],
  stats: [
    { value: '15+', label: 'Years of experience', icon: 'CalendarDays' },
    { value: '5,500+', label: 'Successful operations', icon: 'Container' },
    { value: '250+', label: 'Satisfied clients', icon: 'UsersRound' },
    { value: '98%', label: 'Regulatory compliance', icon: 'Award' },
  ],
  processHeading: {
    kicker: 'Our process',
    title: 'How we work for your peace of mind',
  },
  steps: [
    { title: 'We listen', text: 'We understand your needs and business goals.', icon: 'Mail' },
    { title: 'We analyze', text: 'We evaluate your operation and propose the best strategy.', icon: 'ClipboardCheck' },
    { title: 'We manage', text: 'We execute the customs process with efficiency.', icon: 'Route' },
    { title: 'We support', text: 'We provide ongoing follow-up and support.', icon: 'CheckCircle2' },
  ],
  cta: {
    title: 'Ready to take your business beyond borders?',
    text: 'Contact us today and receive personalized advisory.',
    primaryLabel: 'Request a quote',
    primaryHref: 'tel:+573001234567',
    secondaryLabel: 'WhatsApp',
    secondaryHref: 'https://wa.me/573001234567',
  },
  footer: {
    logo: '',
    quickLinksTitle: 'Quick links',
    servicesTitle: 'Our services',
    contactTitle: 'Contact us',
    description: 'Comprehensive advisory in foreign trade and customs operations with experience, trust, and tailored solutions.',
    copyright: '© 2026 Cortes Rodriguez Asesores S.A.S.',
    legal: 'Privacy Policy · Terms and Conditions',
  },
  contact: {
    address: 'Calle 100 # 11A-45, Bogotá, Colombia',
    phone: '+57 300 123 4567',
    email: 'info@cortesrodriguezasesores.com',
  },
  socialLinks: [
    { label: 'LinkedIn', icon: 'Linkedin', href: 'https://www.linkedin.com/' },
    { label: 'Facebook', icon: 'Facebook', href: 'https://www.facebook.com/' },
    { label: 'Instagram', icon: 'Instagram', href: 'https://www.instagram.com/' },
    { label: 'Email', icon: 'Mail', href: 'mailto:info@cortesrodriguezasesores.com' },
  ],
}

export const defaultContent = {
  version: 2,
  defaultLocale: 'es',
  locales: { es, en },
}

export function normalizeContent(content) {
  const normalized = content?.locales?.es && content?.locales?.en ? content : {
    version: 2,
    defaultLocale: 'es',
    locales: {
      es: content || es,
      en,
    },
  }

  return {
    version: 2,
    defaultLocale: normalized.defaultLocale || 'es',
    locales: {
      es: mergeLocale(es, normalized.locales.es),
      en: mergeLocale(en, normalized.locales.en),
    },
  }
}

export function cloneDefaultContent() {
  return JSON.parse(JSON.stringify(defaultContent))
}

function mergeLocale(defaultLocale, locale) {
  const navItems = normalizeNavItems(defaultLocale.navItems, locale?.navItems)
  const hero = normalizeHero(defaultLocale.hero, locale?.hero)
  const clients = normalizeClients(defaultLocale.clients, locale?.clients)

  return {
    ...defaultLocale,
    ...locale,
    navItems,
    clients,
    brand: { ...defaultLocale.brand, ...locale?.brand },
    hero,
    servicesHeading: { ...defaultLocale.servicesHeading, ...locale?.servicesHeading },
    clientsHeading: { ...defaultLocale.clientsHeading, ...locale?.clientsHeading },
    galleryHeading: { ...defaultLocale.galleryHeading, ...locale?.galleryHeading },
    testimonialsHeading: { ...defaultLocale.testimonialsHeading, ...locale?.testimonialsHeading },
    reasonsHeading: { ...defaultLocale.reasonsHeading, ...locale?.reasonsHeading },
    processHeading: { ...defaultLocale.processHeading, ...locale?.processHeading },
    cta: { ...defaultLocale.cta, ...locale?.cta },
    footer: { ...defaultLocale.footer, ...locale?.footer },
    contact: { ...defaultLocale.contact, ...locale?.contact },
    galleryItems: locale?.galleryItems || defaultLocale.galleryItems,
    socialLinks: locale?.socialLinks || defaultLocale.socialLinks,
  }
}

function normalizeHero(defaultHero, hero) {
  const mergedHero = { ...defaultHero, ...hero }
  const normalizedImages = normalizeHeroImages(defaultHero.images, hero)

  return {
    ...mergedHero,
    images: normalizedImages,
  }
}

function normalizeHeroImages(defaultImages, hero) {
  const imageList = Array.isArray(hero?.images)
    ? hero.images
      .filter((item) => typeof item?.image === 'string' && item.image.trim())
      .map((item) => ({
        image: item.image.trim(),
        alt: typeof item?.alt === 'string' && item.alt.trim() ? item.alt.trim() : defaultImages[0]?.alt || 'Imagen de inicio',
      }))
    : []

  if (imageList.length) return imageList

  if (typeof hero?.image === 'string' && hero.image.trim()) {
    return [
      {
        image: hero.image.trim(),
        alt: defaultImages[0]?.alt || 'Imagen de inicio',
      },
      ...defaultImages.slice(1),
    ]
  }

  return defaultImages
}

function normalizeNavItems(defaultItems, navItems) {
  if (!Array.isArray(navItems) || !navItems.length) return defaultItems
  if (navItems.length === defaultItems.length) return navItems

  if (navItems.length === defaultItems.length - 1) {
    const normalized = [...navItems]
    normalized.splice(4, 0, defaultItems[4])
    return normalized
  }

  return navItems
}

function normalizeClients(defaultItems, clients) {
  if (!Array.isArray(clients) || !clients.length) return defaultItems

  return clients.map((item, index) => {
    const fallback = defaultItems[index] || defaultItems[0]
    if (typeof item === 'string') {
      return {
        name: item,
        image: fallback?.image || '',
        alt: fallback?.alt || item,
        text: fallback?.text || '',
      }
    }

    return {
      name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : fallback?.name || 'Elemento',
      image: typeof item?.image === 'string' ? item.image.trim() : fallback?.image || '',
      alt: typeof item?.alt === 'string' && item.alt.trim() ? item.alt.trim() : fallback?.alt || fallback?.name || 'Imagen',
      text: typeof item?.text === 'string' ? item.text.trim() : fallback?.text || '',
    }
  })
}
