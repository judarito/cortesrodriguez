import { expect, test } from '@playwright/test'

const originToken = 'A'.repeat(43)
const requestReference = 'CRA-20261028-E2E001'

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
    paymentRequired: false,
  }],
}

test('permite enviar una solicitud pública sin iniciar un pago real', async ({ page }) => {
  const calls = new Map()
  let submittedForm = ''
  const mockJson = async (route, key, body, status = 200) => {
    calls.set(key, (calls.get(key) || 0) + 1)
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  }

  await page.route('**/api/public/features', (route) => mockJson(route, 'features', {
    landingRequestButton: true,
    checkoutMode: 'pro',
  }))
  await page.route('**/api/public/request-start', (route) => mockJson(route, 'request-start', {
    token: originToken,
    type: 'direct_web',
  }))
  await page.route('**/api/public/turnstile-config', (route) => mockJson(route, 'turnstile-config', {
    enabled: false,
    siteKey: '',
  }))
  await page.route('**/api/public/catalog', (route) => mockJson(route, 'catalog', publicCatalog))
  await page.route('**/api/public/payments/**', (route) => {
    calls.set('payments', (calls.get('payments') || 0) + 1)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/public/requests', async (route) => {
    calls.set('requests', (calls.get('requests') || 0) + 1)
    expect(route.request().method()).toBe('POST')
    submittedForm = route.request().postDataBuffer()?.toString('utf8') || ''
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reference: requestReference, status: 'pending', paymentRequired: false }),
    })
  })

  await page.goto('/solicitud')

  await expect(page.getByLabel('Nombre completo')).toBeVisible()
  await expect(page.getByLabel('Verificación de seguridad')).toHaveCount(0)
  await expect(page.getByLabel('Correo electrónico')).toHaveAttribute('required', '')
  await expect(page.getByLabel('Teléfono')).not.toHaveAttribute('required', '')
  await expect(page.getByLabel('WhatsApp')).not.toHaveAttribute('required', '')

  await page.getByRole('button', { name: 'Enviar solicitud' }).click()
  expect(calls.get('requests') || 0).toBe(0)

  await page.getByLabel('Nombre completo').fill('Ana Ríos')
  await page.getByLabel('Constitución legal').selectOption('natural')
  await page.getByLabel('Correo electrónico').fill('ana@example.com')
  await page.getByLabel('Servicio general').selectOption('importacion')
  await page.getByLabel('Tipo de consulta').selectOption('consulta_basica')
  await page.getByLabel('Tipo de producto').selectOption('mercancias')
  await page.getByLabel('¿Qué necesitas consultar?').fill('Necesito orientación para importar mercancías desde otro país.')
  await page.getByRole('button', { name: 'Enviar solicitud' }).click()

  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText(requestReference)
  await expect(confirmation.getByRole('link', { name: 'Consultar mis solicitudes' })).toHaveAttribute('href', '/portal-cliente')

  expect(calls.get('features')).toBe(1)
  expect(calls.get('request-start')).toBe(1)
  expect(calls.get('turnstile-config')).toBe(1)
  expect(calls.get('catalog')).toBe(1)
  expect(calls.get('requests')).toBe(1)
  expect(submittedForm).toContain('Ana Ríos')
  expect(submittedForm).toContain('ana@example.com')
  expect(submittedForm).toContain('importacion')
  expect(submittedForm).toContain('consulta_basica')
  expect(submittedForm).toContain('mercancias')
  expect(submittedForm).toContain('Necesito orientación para importar mercancías desde otro país.')
  expect(submittedForm).toContain(originToken)
  expect(calls.get('payments') || 0).toBe(0)
})
