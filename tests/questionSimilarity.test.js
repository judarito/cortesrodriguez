import test from 'node:test'
import assert from 'node:assert/strict'
import { compareQuestions, questionTerms, rankSimilarQuestions } from '../worker/lib/questionSimilarity.js'

test('normaliza mayúsculas, acentos y puntuación, e ignora palabras comunes', () => {
  assert.deepEqual([...questionTerms('¿Qué documentos necesito PARA importar?')].sort(), ['documentos', 'importar', 'necesito'])
})

test('puntúa la similitud léxica por Jaccard y devuelve los términos compartidos', () => {
  const result = compareQuestions('Documentos para importar una casa en Colombia', '¿Qué documentos necesito para importar casa a Colombia?')
  assert.equal(result.termScore, 0.8)
  assert.ok(result.phraseScore > 0)
  assert.deepEqual(result.sharedTerms, ['casa', 'colombia', 'documentos', 'importar'])
})

test('solo propone coincidencias sobre el umbral y con tres términos compartidos', () => {
  const ranked = rankSimilarQuestions('Documentos para importar casa a Colombia', [
    { responseId: 'close', question: 'Qué documentos necesito importar casa Colombia', createdAt: '2026-10-20' },
    { responseId: 'weak', question: 'Exportar maquinaria desde Brasil', createdAt: '2026-10-19' },
  ])
  assert.deepEqual(ranked.map((candidate) => candidate.responseId), ['close'])
})

test('detecta una errata o transposición en un término significativo', () => {
  const result = compareQuestions(
    'Qué documentos necesito para importar una casa a Colombia',
    'Que documentos necesito para imporrtar una casa a Colombia',
  )
  assert.equal(result.score, 0.9)
  assert.equal(result.typoMatches, 1)
  assert.ok(result.sharedTerms.includes('importar ≈ imporrtar'))
})

test('tolera una letra omitida y palabras agregadas sin aceptar términos cortos por errata', () => {
  const ranked = rankSimilarQuestions('Documentos para importar maquinaria Colombia', [
    { responseId: 'typo-plus-context', question: 'Documentos para impoortar maquinaria a Colombia urgente' },
    { responseId: 'short-token-noise', question: 'Documentos para importar maquinaria Colombia con una duda' },
  ])
  const typoCandidate = ranked.find((candidate) => candidate.responseId === 'typo-plus-context')
  assert.ok(typoCandidate?.typoMatches)
  assert.equal(compareQuestions('ley documentos importar casa', 'leyy documentos importar casa').typoMatches, 0)
})

test('no propone resultados para preguntas vacías o sin términos comparables', () => {
  assert.deepEqual(rankSimilarQuestions('', [{ question: 'Importar maquinaria a Colombia' }]), [])
  assert.deepEqual(rankSimilarQuestions('de y con la', [{ question: 'de y con la' }]), [])
})
