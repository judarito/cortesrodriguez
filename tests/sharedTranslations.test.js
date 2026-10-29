import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sharedMessages, sharedText } from '../src/lib/translations.js'
import { uiEnglish, uiEnglishExtra } from '../src/operations/operationsTranslations.js'

test('shared translations provide matching Spanish and English labels for reusable controls', () => {
  for (const key of Object.keys(sharedMessages.es)) {
    assert.equal(typeof sharedMessages.en[key], 'string', `Missing English translation for ${key}`)
    assert.notEqual(sharedMessages.en[key], sharedMessages.es[key], `Untranslated shared label: ${key}`)
  }
})

test('sharedText safely falls back to Spanish for unsupported locales and missing keys', () => {
  assert.equal(sharedText('fr', 'previous'), 'Anterior')
  assert.equal(sharedText('en', 'unknownKey'), 'unknownKey')
})

test('literal operations UI strings have a centralized English translation', () => {
  const source = readFileSync(new URL('../src/operations/OperationsApp.vue', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/\btx\('([^']+)'\)/g)].map((match) => match[1])
  const missing = [...new Set(keys.filter((key) => !(key in uiEnglish) && !(key in uiEnglishExtra)))]
  assert.deepEqual(missing, [])
})
