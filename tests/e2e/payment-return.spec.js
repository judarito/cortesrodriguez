import { expect, test } from '@playwright/test'

const originToken = 'B'.repeat(43)
const requestReference = 'CRA-20261028-PAY001'
const paymentId = 'mp-payment-e2e-20261028'

const publicCatalog = {
  items: [{
    serviceCode: 'importacion',
    serviceName: 'Importación',
    serviceDescription: 'Asesoría para operaciones de importación.',
    consultationCode: 'consulta_basica',
    consultationName: 'Consulta básica',
    consultationDescription: 'Orientación inicial sobre una operación de comercio exterior.',
    amountCents: 1000,
    currency: 'USD',
    paymentRequired: true,
  }],
}

test('prepara una preferencia Pro y confirma un retorno aprobado simulado', async ({ page }) => {
  const calls = new Map()
  let preferencePayload
  let verificationPayload
  const fulfillJson = async (route, key, body, status = 200) => {
    calls.set(key, (calls.get(key) || 0) + 1)
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  }

  await page.route('**/api/public/features', (route) => fulfillJson(route, 'features', {
    landingRequestButton: true,
    checkoutMode: 'pro',
  }))
  await page.route('**/api/public/request-start', (route) => fulfillJson(route, 'request-start', {
    token: originToken,
    type: 'direct_web',
  }))
  await page.route('**/api/public/turnstile-config', (route) => fulfillJson(route, 'turnstile-config', {
    enabled: false,
    siteKey: '',
  }))
  await page.route('**/api/public/catalog', (route) => fulfillJson(route, 'catalog', publicCatalog))
  await page.route('**/api/public/requests', async (route) => {
    calls.set('requests', (calls.get('requests') || 0) + 1)
    expect(route.request().method()).toBe('POST')
    const submittedForm = route.request().postDataBuffer()?.toString('utf8') || ''
    expect(submittedForm).toContain('Ana Ríos')
    expect(submittedForm).toContain('ana@example.com')
    expect(submittedForm).toContain(originToken)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reference: requestReference, status: 'pending', paymentRequired: true }),
    })
  })
  await page.route('**/api/public/payments/preference', async (route) => {
    calls.set('preference', (calls.get('preference') || 0) + 1)
    expect(route.request().method()).toBe('POST')
    preferencePayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preferenceId: 'mp-preference-e2e-20261028',
        initPoint: 'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=mocked',
        usdAmountCents: 1000,
        copAmountCents: 4000000,
        trm: 4000,
        trmDate: '2026-10-28',
      }),
    })
  })
  await page.route('**/api/public/payments/verify', async (route) => {
    calls.set('verify', (calls.get('verify') || 0) + 1)
    expect(route.request().method()).toBe('POST')
    verificationPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reference: requestReference, status: 'approved' }),
    })
  })

  await page.goto('/solicitud')
  await page.getByLabel('Nombre completo').fill('Ana Ríos')
  await page.getByLabel('Constitución legal').selectOption('natural')
  await page.getByLabel('Correo electrónico').fill('ana@example.com')
  await page.getByLabel('Servicio general').selectOption('importacion')
  await page.getByLabel('Tipo de consulta').selectOption('consulta_basica')
  await page.getByLabel('Tipo de producto').selectOption('mercancias')
  await page.getByLabel('¿Qué necesitas consultar?').fill('Necesito orientación para importar mercancías desde otro país.')
  await page.getByRole('button', { name: 'Enviar solicitud' }).click()

  await expect(page.getByRole('heading', { name: 'Revisa el valor antes de pagar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pagar' })).toBeVisible()
  expect(calls.get('requests')).toBe(1)
  expect(calls.get('preference')).toBe(1)
  expect(preferencePayload).toMatchObject({ reference: requestReference, submissionToken: expect.any(String) })

  // Simulate the provider's browser return without contacting Mercado Pago.
  await page.goto(`/solicitud/resultado-pago?payment=success&payment_id=${encodeURIComponent(paymentId)}&reference=${encodeURIComponent(requestReference)}`)

  expect(page.url()).toContain(`reference=${requestReference}`)
  await expect.poll(() => calls.get('verify') || 0).toBe(1)
  await expect(page.getByRole('heading', { name: 'Pago recibido' })).toBeVisible()
  await expect(page.getByText(requestReference)).toBeVisible()
  await expect(page.getByText('Tu solicitud quedó registrada. Nuestro equipo pronto te contactará con información sobre la respuesta.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Consultar mis solicitudes' })).toHaveAttribute('href', '/portal-cliente')
  expect(calls.get('verify')).toBe(1)
  expect(verificationPayload).toEqual({ paymentId, reference: requestReference })
  expect(calls.get('requests')).toBe(1)
  expect(calls.get('preference')).toBe(1)
})

test('mantiene la solicitud como registrada si el pago no se puede verificar', async ({ page }) => {
  let verificationCalls = 0
  await page.route('**/api/public/payments/verify', async (route) => {
    verificationCalls += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'No fue posible confirmar el pago ahora.' }),
    })
  })

  await page.goto(`/solicitud/resultado-pago?payment=success&payment_id=${encodeURIComponent(paymentId)}&reference=${encodeURIComponent(requestReference)}`)

  await expect(page.getByRole('heading', { name: 'Tu solicitud sigue registrada' })).toBeVisible()
  await expect(page.getByText(requestReference)).toBeVisible()
  await expect(page.locator('.payment-return-help')).toContainText('no vuelvas a pagar')
  await expect(page.getByRole('link', { name: 'Consultar mis solicitudes' })).toHaveAttribute('href', '/portal-cliente')
  await expect(page.getByRole('link', { name: 'Iniciar una nueva solicitud' })).toHaveCount(0)
  expect(verificationCalls).toBe(1)

  await page.getByRole('group', { name: 'Language / Idioma' }).getByRole('button', { name: 'EN' }).click()
  await expect(page.getByRole('heading', { name: 'Your request is still recorded' })).toBeVisible()
  await expect(page.locator('.payment-return-help')).toContainText('do not pay again')
})
