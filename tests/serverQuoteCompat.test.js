import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  app,
  OPERATIONAL_NOT_AVAILABLE_CODE,
  buildNotAvailableResponse,
} from '../server.js'
import worker from '../worker/index.js'

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  try {
    const { port } = server.address()
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

test('buildNotAvailableResponse responde not_available en el idioma solicitado', () => {
  const spanish = buildNotAvailableResponse('es', 'quote_requests')
  assert.equal(spanish.status, 503)
  assert.equal(spanish.body.code, OPERATIONAL_NOT_AVAILABLE_CODE)
  assert.equal(spanish.body.code, 'not_available')
  assert.equal(spanish.body.feature, 'quote_requests')
  assert.match(spanish.body.error, /no está disponible/i)

  const english = buildNotAvailableResponse('en', 'quote_requests')
  assert.equal(english.status, 503)
  assert.match(english.body.error, /not available/i)
})

test('la ruta legacy de cotizaciones no escribe en contact_leads y responde 503', async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/quote-requests`, {
      locale: 'es',
      fullName: 'Cliente Demo',
      email: 'cliente@example.test',
      phone: '5555555555',
      message: 'Quiero una cotización',
    })

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'not_available',
      feature: 'quote_requests',
      error: 'Esta función operativa no está disponible en el servidor Node local. Usa la API del Worker respaldada por Neon.',
    })
  })
})

test('la ruta vigente /api/public/quotes responde no disponible con locale en', async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/public/quotes`, { locale: 'en' })

    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(body.code, 'not_available')
    assert.equal(body.feature, 'quote_requests')
    assert.match(body.error, /not available/i)
  })
})

test('el Worker retira la escritura legacy y responde 410 sin tocar la base ni el correo', async () => {
  const touched = []
  const env = new Proxy({ LANDING_FLAGS: { getBooleanValue: async () => false } }, {
    get(target, property) {
      if (property in target) return target[property]
      touched.push(String(property))
      throw new Error(`env.${String(property)} no debe consultarse`)
    },
  })

  const response = await worker.fetch(new Request('https://example.test/api/quote-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locale: 'es',
      fullName: 'Cliente Demo',
      email: 'cliente@example.test',
      phone: '5555555555',
      message: 'Quiero una cotización',
    }),
  }), env)

  assert.equal(response.status, 410)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'quote_endpoint_retired',
    error: 'El endpoint legacy de cotizaciones fue retirado. Usa /api/public/quotes.',
  })
  assert.deepEqual(touched, [])
})

test('el Worker ya no escribe en contact_leads y conserva la lectura histórica de admin', async () => {
  const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /INSERT INTO\s+contact_leads/i)
  assert.doesNotMatch(source, /UPDATE\s+contact_leads/i)
  assert.doesNotMatch(source, /RESEND_API_KEY[\s\S]{0,200}Nueva solicitud de cotización/)
  assert.match(source, /quote_endpoint_retired/)
  assert.match(source, /SELECT COUNT\(\*\) AS total FROM contact_leads/)
})

test('GET /api/admin/leads sigue protegido como lectura histórica', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/admin/leads', {
    method: 'GET',
  }), {})

  assert.equal(response.status, 401)
})

test('el flujo público vigente usa Neon/operations y nunca contact_leads', async () => {
  const source = await readFile(new URL('../worker/routes/publicRequests.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /contact_leads/i)
  assert.match(source, /INSERT INTO operations\.clients/i)
  assert.match(source, /INSERT INTO operations\.requests/i)
  assert.doesNotMatch(source, /INSERT INTO\s+contact_leads/i)

  const response = await worker.fetch(new Request('https://example.test/api/public/quotes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Cliente Demo' }),
  }), {
    LANDING_FLAGS: { getBooleanValue: async () => true },
  })

  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /base de datos operativa no está configurada/i)
})

test('las rutas operativas de contact_leads no exponen lecturas legacy', async () => {
  await withServer(async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/admin/leads`)
    assert.equal(list.status, 503)
    assert.equal((await list.json()).feature, 'contact_leads')

    const detail = await fetch(`${baseUrl}/api/admin/leads/1`)
    assert.equal(detail.status, 503)
    assert.equal((await detail.json()).code, 'not_available')
  })
})

test('las rutas editoriales y de testimonios siguen activas', async () => {
  await withServer(async (baseUrl) => {
    const protectedAudit = await fetch(`${baseUrl}/api/admin/content/audit`)
    assert.equal(protectedAudit.status, 401)

    const invalidTestimonial = await postJson(`${baseUrl}/api/testimonials`, {})
    assert.equal(invalidTestimonial.status, 400)

    const protectedTestimonials = await fetch(`${baseUrl}/api/admin/testimonials`)
    assert.equal(protectedTestimonials.status, 401)
  })
})

test('server.js ya no contiene SQL operativo sobre contact_leads', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+contact_leads/i)
  assert.doesNotMatch(source, /saveLead\s*\(/)
  assert.doesNotMatch(source, /sendLeadEmail\s*\(/)
})
