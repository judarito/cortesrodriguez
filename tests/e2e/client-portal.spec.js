import { expect, test } from '@playwright/test'

const clientEmail = 'ana@example.com'
const accessCode = '482901'
const ownedReference = 'CRA-20261028-PORTAL01'

const ownedRequest = {
  reference: ownedReference,
  service: 'Importación',
  consultation: 'Consulta de datos legales',
  status: 'in_review',
  paymentStatus: 'approved',
  paymentApproved: true,
  paymentRequired: true,
  amountCents: 1500,
  currency: 'USD',
  createdAt: '2026-10-28T12:00:00.000Z',
}

const ownedDetail = {
  ...ownedRequest,
  question: '¿Qué documentos necesito para esta operación?',
  paymentAction: 'none',
  checkoutMode: 'pro',
  paymentAttemptId: null,
  paymentSubmitted: false,
  paymentAttempts: [],
  attachments: [],
  response: {
    body: 'Debes presentar la factura comercial y los documentos de transporte correspondientes.',
    note: 'Respuesta revisada por nuestro equipo.',
    updatedAt: '2026-10-28T13:00:00.000Z',
  },
}

test('el cliente accede con código y consulta solo sus solicitudes y respuesta aprobada', async ({ page }) => {
  const apiCalls = []
  let requestedEmail = ''
  let submittedCode = ''

  await page.route('**/api/public/features', async (route) => {
    apiCalls.push({ method: route.request().method(), path: new URL(route.request().url()).pathname })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checkoutMode: 'pro' }),
    })
  })

  await page.route('**/api/client/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    apiCalls.push({ method: request.method(), path: `${url.pathname}${url.search}` })

    if (url.pathname === '/api/client/session' && request.method() === 'GET') {
      const headers = await request.allHeaders()
      if (headers.cookie?.includes('client_session=e2e-mock-session')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: { email: clientEmail, role: 'client' } }),
        })
      } else {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Inicia sesión para continuar.' }) })
      }
      return
    }

    if (url.pathname === '/api/client/access-code' && request.method() === 'POST') {
      const body = request.postDataJSON()
      requestedEmail = body.email
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Si encontramos solicitudes asociadas a ese correo, enviaremos un código de acceso.' }),
      })
      return
    }

    if (url.pathname === '/api/client/session' && request.method() === 'POST') {
      const body = request.postDataJSON()
      submittedCode = body.code
      if (body.email !== clientEmail || body.code !== accessCode) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'El correo o el código no son válidos.' }) })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'client_session=e2e-mock-session; Path=/; HttpOnly; SameSite=Lax' },
        body: JSON.stringify({ user: { email: clientEmail, role: 'client' } }),
      })
      return
    }

    if (url.pathname === '/api/client/requests' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [ownedRequest],
          pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        }),
      })
      return
    }

    if (url.pathname === `/api/client/requests/${ownedReference}` && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: ownedDetail }) })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Ruta API inesperada en esta prueba.' }) })
  })

  await page.goto('/portal-cliente')

  await page.getByLabel('Correo electrónico').fill(clientEmail)
  await page.getByRole('button', { name: 'Enviar código al correo' }).click()
  await expect(page.getByText('Código enviado al correo registrado. Revisa tu bandeja de entrada.')).toBeVisible()
  await expect(page.getByLabel('Código de acceso')).toBeVisible()

  await page.getByLabel('Código de acceso').fill(accessCode)
  await page.getByRole('button', { name: 'Ingresar al portal' }).click()

  await expect(page.getByRole('heading', { name: 'Mis solicitudes' })).toBeVisible()
  await expect(page.getByText(new RegExp(`Sesión iniciada como ${clientEmail}`))).toBeVisible()
  await expect(page.getByText(ownedReference)).toBeVisible()
  await expect(page.getByText('Consulta de datos legales')).toBeVisible()
  await expect(page.getByText('Estado del pago: Pagado')).toBeVisible()
  await expect(page.getByText('Respuesta revisada por nuestro equipo.')).toHaveCount(0)

  await page.getByRole('button', { name: 'Ver solicitud' }).click()

  await expect(page.getByRole('heading', { name: ownedReference })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Respuesta del equipo' })).toBeVisible()
  await expect(page.getByText(ownedDetail.response.body)).toBeVisible()
  await expect(page.getByText(ownedDetail.response.note)).toBeVisible()

  expect(requestedEmail).toBe(clientEmail)
  expect(submittedCode).toBe(accessCode)
  expect(apiCalls).toContainEqual({ method: 'GET', path: '/api/client/requests?page=1&pageSize=10' })
  expect(apiCalls).toContainEqual({ method: 'GET', path: `/api/client/requests/${ownedReference}` })
  expect(apiCalls.some(({ path }) => path.includes('UNOWNED'))).toBe(false)
  expect(apiCalls.every(({ path }) => path.startsWith('/api/client/') || path === '/api/public/features')).toBe(true)
})

test('portal de clientes en inglés ofrece controles etiquetados y no desborda en móvil', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'))
  await page.route('**/api/public/features', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ checkoutMode: 'pro' }),
  }))
  await page.route('**/api/client/session', (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Inicia sesión para continuar.' }),
  }))

  await page.goto('/portal-cliente')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByRole('heading', { name: 'View your requests' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send code by email' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
