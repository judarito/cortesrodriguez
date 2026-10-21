import test from 'node:test'
import assert from 'node:assert/strict'
import { compareQuestions, questionTerms, rankSimilarQuestions } from '../worker/lib/questionSimilarity.js'

test('normaliza mayúsculas, acentos y puntuación, e ignora palabras comunes', () => {
  assert.deepEqual([...questionTerms('¿Qué documentos necesito PARA importar?')].sort(), ['documentos', 'importar', 'necesito'])
})

test('puntúa la similitud léxica por Jaccard y devuelve los términos compartidos', () => {
  const result = compareQuestions('Documentos para importar una casa en Colombia', '¿Qué documentos necesito para importar casa a Colombia?')
  assert.equal(result.score, 0.8)
  assert.deepEqual(result.sharedTerms, ['casa', 'colombia', 'documentos', 'importar'])
})

test('solo propone coincidencias sobre el umbral y con tres términos compartidos', () => {
  const ranked = rankSimilarQuestions('Documentos para importar casa a Colombia', [
    { responseId: 'close', question: 'Qué documentos necesito importar casa Colombia', createdAt: '2026-10-20' },
    { responseId: 'weak', question: 'Exportar maquinaria desde Brasil', createdAt: '2026-10-19' },
  ])
  assert.deepEqual(ranked.map((candidate) => candidate.responseId), ['close'])
})

test('no propone resultados para preguntas vacías o sin términos comparables', () => {
  assert.deepEqual(rankSimilarQuestions('', [{ question: 'Importar maquinaria a Colombia' }]), [])
  assert.deepEqual(rankSimilarQuestions('de y con la', [{ question: 'de y con la' }]), [])
})
