export const SUPPORTED_LOCALES = ['es', 'en']

export function getInitialLocale() {
  if (typeof window === 'undefined') return 'es'
  const saved = window.localStorage.getItem('locale')
  if (SUPPORTED_LOCALES.includes(saved)) return saved
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  const preferred = languages.find((value) => /^(en|es)(-|$)/i.test(value || ''))
  return preferred?.toLowerCase().startsWith('en') ? 'en' : 'es'
}

export function persistLocale(locale) {
  const value = SUPPORTED_LOCALES.includes(locale) ? locale : 'es'
  if (typeof window !== 'undefined') window.localStorage.setItem('locale', value)
  return value
}

export function localeTag(locale) {
  return locale === 'en' ? 'en-US' : 'es-CO'
}
