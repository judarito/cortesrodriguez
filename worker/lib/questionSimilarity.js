const STOP_WORDS = new Set([
  'acerca', 'algo', 'algun', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'asi',
  'como', 'con', 'contra', 'cual', 'cuando', 'cuanto', 'de', 'del', 'desde', 'donde', 'dos',
  'durante', 'e', 'el', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entre', 'era', 'eramos', 'eran',
  'es', 'esa', 'esas', 'ese', 'eso', 'esos', 'esta', 'estaba', 'estaban', 'estado', 'estan',
  'estar', 'estas', 'este', 'esto', 'estos', 'fue', 'fueron', 'ha', 'hace', 'hacen', 'hacer',
  'hacia', 'han', 'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi',
  'mis', 'mucho', 'muy', 'nada', 'ni', 'no', 'nos', 'nuestra', 'nuestro', 'o', 'os', 'otra',
  'otras', 'otro', 'otros', 'para', 'pero', 'poco', 'por', 'porque', 'que', 'quien', 'se',
  'ser', 'si', 'sin', 'sobre', 'su', 'sus', 'tambien', 'te', 'tiene', 'tienen', 'todo', 'todos',
  'tras', 'tu', 'tus', 'un', 'una', 'unas', 'uno', 'unos', 'usted', 'ustedes', 'y', 'ya',
])

export function questionTerms(value) {
  return new Set(String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
    ?.filter((term) => !STOP_WORDS.has(term)) || [])
}

export function compareQuestions(left, right) {
  const leftTerms = questionTerms(left)
  const rightTerms = questionTerms(right)
  if (!leftTerms.size || !rightTerms.size) return { score: 0, sharedTerms: [] }
  const sharedTerms = [...leftTerms].filter((term) => rightTerms.has(term)).sort()
  const unionSize = new Set([...leftTerms, ...rightTerms]).size
  return { score: sharedTerms.length / unionSize, sharedTerms }
}

export function rankSimilarQuestions(question, candidates, { threshold = 0.3, minimumSharedTerms = 3, limit = 5 } = {}) {
  return candidates
    .map((candidate) => ({ ...candidate, ...compareQuestions(question, candidate.question) }))
    .filter((candidate) => candidate.score >= threshold && candidate.sharedTerms.length >= minimumSharedTerms)
    .sort((left, right) => right.score - left.score || String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, limit)
}
