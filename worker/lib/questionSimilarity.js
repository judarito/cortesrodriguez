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

  const exactTerms = [...leftTerms].filter((term) => rightTerms.has(term)).sort()
  const leftRemaining = [...leftTerms].filter((term) => !rightTerms.has(term))
  const rightRemaining = [...rightTerms].filter((term) => !leftTerms.has(term))
  const typoPairs = []

  const possiblePairs = leftRemaining.flatMap((leftTerm) => rightRemaining
    .map((rightTerm) => ({ leftTerm, rightTerm, distance: typoDistance(leftTerm, rightTerm) }))
    .filter((pair) => pair.distance !== null))
    .sort((a, b) => a.distance - b.distance || Math.min(b.leftTerm.length, b.rightTerm.length) - Math.min(a.leftTerm.length, a.rightTerm.length))

  const matchedLeft = new Set()
  const matchedRight = new Set()
  for (const pair of possiblePairs) {
    if (matchedLeft.has(pair.leftTerm) || matchedRight.has(pair.rightTerm)) continue
    matchedLeft.add(pair.leftTerm)
    matchedRight.add(pair.rightTerm)
    typoPairs.push(pair)
  }

  const sharedTerms = [
    ...exactTerms,
    ...typoPairs.map(({ leftTerm, rightTerm }) => `${leftTerm} ≈ ${rightTerm}`),
  ].sort()
  const matches = exactTerms.length + typoPairs.length
  const unionSize = leftTerms.size + rightTerms.size - matches
  const termScore = matches / unionSize
  const phraseScore = compareTermOrder([...leftTerms], [...rightTerms])
  const score = Number((termScore * 0.8 + phraseScore * 0.2).toFixed(5))
  return { score, termScore, phraseScore, sharedTerms, exactMatches: exactTerms.length, typoMatches: typoPairs.length }
}

export function rankSimilarQuestions(question, candidates, { threshold = 0.3, minimumSharedTerms = 3, limit = 5 } = {}) {
  return candidates
    .map((candidate) => {
      const comparison = compareQuestions(question, candidate.question)
      return {
        ...candidate,
        ...comparison,
        matchLevel: comparison.score >= 0.75 && comparison.sharedTerms.length >= 4 ? 'high' : 'possible',
      }
    })
    .filter((candidate) => candidate.score >= threshold && candidate.sharedTerms.length >= minimumSharedTerms)
    .sort((left, right) => right.score - left.score || String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, limit)
}

function compareTermOrder(leftTerms, rightTerms) {
  const bigrams = (terms) => terms.length > 1
    ? new Set(terms.slice(1).map((term, index) => `${terms[index]} ${term}`))
    : new Set(terms)
  const leftBigrams = bigrams(leftTerms)
  const rightBigrams = bigrams(rightTerms)
  if (!leftBigrams.size || !rightBigrams.size) return 0
  const shared = [...leftBigrams].filter((pair) => rightBigrams.has(pair)).length
  return (2 * shared) / (leftBigrams.size + rightBigrams.size)
}

function typoDistance(left, right) {
  const longest = Math.max(left.length, right.length)
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 2) return null
  const maxDistance = longest >= 9 ? 2 : 1
  if (Math.abs(left.length - right.length) > maxDistance) return null

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  let beforePrevious = null
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      const insertion = current[column - 1] + 1
      const deletion = previous[column] + 1
      let value = Math.min(substitution, insertion, deletion)
      if (beforePrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        value = Math.min(value, beforePrevious[column - 2] + 1)
      }
      current[column] = value
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maxDistance) return null
    beforePrevious = previous
    previous = current
  }
  return previous[right.length] <= maxDistance ? previous[right.length] : null
}
