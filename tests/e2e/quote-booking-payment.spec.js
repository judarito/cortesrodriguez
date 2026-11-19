import { expect, test } from '@playwright/test'

const quoteToken = 'Q'.repeat(43)
const invalidToken = 'bad-token'
const reference = 'CRA-20261118-QE2001'
const attachmentOne = { name: 'factura.pdf', type: 'application/pdf', body: 'fake-pdf-content' }
const attachmentTwo = { name: 'transporte.pdf', type: 'application/pdf', body: 'fake-transport-content' }

const catalog = {
  items: [{
    serviceCode: 'importacion',
    serviceName: 'Importación',
    consultationCode: 'consulta_basica',
    consultationName: 'Consulta básica',
    consultationDescription: 'Revisión inicial de la operación.',
    amountCents: 1500,
    currency: 'USD',
    paymentRequired: true,
  }],
}

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function installSafeMocks(page, state) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4178') return route.abort()
    return route.continue()
  })

  await page.route('**/api/public/features', (route) => json(route, { checkoutMode: 'pro' }))
  await page.route('**/api/public/catalog', (route) => json(route, catalog))
  await page.route('**/api/public/turnstile-config', (route) => json(route, { enabled: false, siteKey: '' }))
  await page.route('**/api/public/request-start', (route) => json(route, {
    token: 'A'.repeat(43), type: 'direct_web',
  }))

  await page.route('**/api/public/quotes/attachments', async (route) => {
    const request = route.request()
    const form = await request.postDataBuffer()
    if (!form || !form.includes(Buffer.from(quoteToken))) return json(route, { error: 'La cotización no es válida.' }, 400)
    const contentType = request.headers()['content-type'] || ''
    if (!contentType.includes('multipart/form-data') || form.includes(Buffer.from('malware.exe'))) return json(route, { error: 'Adjuntos inválidos.' }, 400)
    state.attachmentsUploaded = true
    return json(route, {
      ok: true,
      requestId: 'request-e2e-quote-001',
      complete: true,
      attachments: [
        { id: 'attachment-001', category: 'factura_comercial', originalName: attachmentOne.name, stage: 'cotizacion', status: 'available' },
        { id: 'attachment-002', category: 'documento_transporte', originalName: attachmentTwo.name, stage: 'cotizacion', status: 'available' },
      ],
    }, 201)
  })

  await page.route('**/api/public/quotes/convert', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload?.quoteToken !== quoteToken) return json(route, { error: 'La cotización no es válida.' }, 400)
    if (!state.attachmentsUploaded) return json(route, { error: 'Faltan adjuntos obligatorios.' }, 400)
    state.converted = true
    return json(route, { ok: true, reference, paymentRequired: true, status: 'pending' })
  })

  await page.route('**/api/public/payments/preference', async (route) => {
    const payload = route.request().postDataJSON()
    expect(payload.reference).toBe(reference)
    expect(state.converted).toBe(true)
    state.paymentPreferenceRequested = true
    return json(route, {
      initPoint: 'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=e2e-mock',
      usdAmountCents: 1500,
      copAmountCents: 600000000,
      trm: 4000,
      trmDate: '2026-11-18',
    })
  })
}

test('recorre cotización, múltiples adjuntos, enlace, reserva y pago sandbox', async ({ page }) => {
  const state = { attachmentsUploaded: false, converted: false, paymentPreferenceRequested: false }
  await installSafeMocks(page, state)

  await page.goto('/')
  const upload = await page.evaluate(async ({ token, first, second }) => {
    const form = new FormData()
    form.append('quoteToken', token)
    form.append('attachmentCategory', 'factura_comercial')
    form.append('attachmentCategory', 'documento_transporte')
    form.append('attachments', new File([first.body], first.name, { type: first.type }))
    form.append('attachments', new File([second.body], second.name, { type: second.type }))
    const response = await fetch('/api/public/quotes/attachments', { method: 'POST', body: form })
    return { status: response.status, body: await response.json() }
  }, { token: quoteToken, first: attachmentOne, second: attachmentTwo })
  expect(upload.status).toBe(201)
  expect(upload.body.attachments).toHaveLength(2)
  expect(upload.body.attachments.map((item) => item.stage)).toEqual(['cotizacion', 'cotizacion'])

  // Simulate the customer opening the quote link. The app converts the same
  // request to a reservation and prepares a sandbox payment preference.
  await page.goto(`/solicitud#quoteToken=${quoteToken}`)
  await expect(page.getByRole('heading', { name: 'Revisa el valor antes de pagar' })).toBeVisible()
  await expect(page.getByText(reference)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pagar' })).toBeVisible()
  await expect(page.getByText('6.000.000 COP')).toBeVisible()

  expect(state).toMatchObject({ attachmentsUploaded: true, converted: true, paymentPreferenceRequested: true })
  expect(page.url()).toMatch(/127\.0\.0\.1:4178\/solicitud$/)
  const checkoutRequest = page.waitForRequest((request) => request.url().includes('mercadopago.com.co/checkout/v1/redirect?pref_id=e2e-mock'))
  await page.getByRole('button', { name: 'Pagar' }).click()
  await checkoutRequest
  // This is only a mocked provider redirect; no payment approval is asserted.
})

test('rechaza token inválido y adjunto no permitido sin mutar la reserva', async ({ page }) => {
  const state = { attachmentsUploaded: false, converted: false, paymentPreferenceRequested: false }
  await installSafeMocks(page, state)

  await page.goto(`/solicitud#quoteToken=${invalidToken}`)
  await expect(page.getByRole('alert')).toContainText('La cotización no es válida.')
  expect(state).toEqual({ attachmentsUploaded: false, converted: false, paymentPreferenceRequested: false })

  await page.goto('/')
  const invalidUpload = await page.evaluate(async (token) => {
    const form = new FormData()
    form.append('quoteToken', token)
    form.append('attachmentCategory', 'factura_comercial')
    form.append('attachments', new File(['not-an-image'], 'malware.exe', { type: 'application/x-msdownload' }))
    const response = await fetch('/api/public/quotes/attachments', { method: 'POST', body: form })
    return { status: response.status, body: await response.json() }
  }, quoteToken)
  expect(invalidUpload.status).toBe(400)
  expect(invalidUpload.body.error).toContain('Adjuntos inválidos')
  expect(state.attachmentsUploaded).toBe(false)
})
