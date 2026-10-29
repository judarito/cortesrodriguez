// Shared interface copy for controls reused across the public and operations apps.
// Domain-specific content remains with its feature until it is migrated here.
export const sharedMessages = {
  es: {
    language: 'Idioma',
    spanish: 'Español',
    english: 'Inglés',
    recordsFound: 'registros encontrados',
    page: 'Página',
    of: 'de',
    previous: 'Anterior',
    next: 'Siguiente',
    loadingList: 'Cargando listado',
    mainMenu: 'Menú principal',
    searchPlatform: 'Buscar en la plataforma...',
    signOut: 'Cerrar sesión',
  },
  en: {
    language: 'Language',
    spanish: 'Spanish',
    english: 'English',
    recordsFound: 'records found',
    page: 'Page',
    of: 'of',
    previous: 'Previous',
    next: 'Next',
    loadingList: 'Loading list',
    mainMenu: 'Main menu',
    searchPlatform: 'Search the platform...',
    signOut: 'Sign out',
  },
}

export function sharedText(locale, key) {
  const language = locale === 'en' ? 'en' : 'es'
  return sharedMessages[language][key] || sharedMessages.es[key] || key
}
