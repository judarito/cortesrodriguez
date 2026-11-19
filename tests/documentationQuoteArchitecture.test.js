import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const planUrl = new URL('../docs/PLAN-COTIZACION-A-RESERVA.md', import.meta.url)
const qaUrl = new URL('../docs/QA-FUNCIONAL-MVP.md', import.meta.url)

test('la documentación fija Worker, Neon y la prohibición de contact_leads', async () => {
  const [plan, qa] = await Promise.all([readFile(planUrl, 'utf8'), readFile(qaUrl, 'utf8')])

  assert.match(plan, /Worker es el runtime operativo canónico/i)
  assert.match(plan, /Neon es la única fuente de verdad para\s+cotizaciones/i)
  assert.match(plan, /`contact_leads` no puede crear, leer, actualizar ni\s+servir como fallback/i)
  assert.match(plan, /responder explícitamente `not_available`/i)

  assert.match(qa, /Runtime operativo:.*Worker es el runtime canónico/is)
  assert.match(qa, /Fuente única.*Neon es la única fuente de verdad/is)
  assert.match(qa, /Fuente prohibida.*`contact_leads` no puede/is)
  for (const id of ['ARCH-01', 'ARCH-02', 'ARCH-03', 'ARCH-04']) assert.match(qa, new RegExp(id))
})
