import { expect, test } from '@playwright/test'

const requestId = 'request-e2e-review-001'
const requestReference = 'CRA-20261028-REV001'
const responseId = 'response-e2e-review-001'
const expertToken = 'e2e-expert-token'
const adminToken = 'e2e-admin-token'
const responseBody = 'Para esta operación, prepara la factura comercial y el documento de transporte.'

async function openRequestsMenu(page) {
  const requestsButton = page.locator('#operations-navigation').getByRole('button', { name: /Solicitudes/ })
  if (!await requestsButton.isVisible()) {
    await page.getByRole('button', { name: 'Menú principal' }).click()
  }
  await requestsButton.click()
}

const users = {
  [expertToken]: {
    id: 'expert-001',
    name: 'Experto E2E',
    email: 'expert@example.com',
    roles: ['expert'],
    permissions: ['dashboard.read', 'expert_requests.read'],
  },
  [adminToken]: {
    id: 'admin-001',
    name: 'Admin E2E',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['dashboard.read', 'requests.read'],
  },
}

test('el experto responde y administración aprueba la respuesta desde la UI', async ({ page }) => {
  const unexpectedRequests = []
  const apiCalls = []
  const browserErrors = []
  let currentResponse = null
  page.on('pageerror', (error) => browserErrors.push(error.message))

  // Keep the browser offline except for the Vite app. Unknown local APIs are
  // recorded and blocked so the test cannot silently depend on a live service.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4178') {
      unexpectedRequests.push(url.href)
      await route.abort()
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await route.fallback()
      return
    }
    await route.continue()
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const auth = request.headers().authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const role = users[token]?.roles?.[0]
    const key = `${method} ${url.pathname}${url.search}`
    apiCalls.push({ key, role })
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (url.pathname === '/api/app/session' && method === 'GET') {
      return json(users[token] ? { user: users[token] } : { error: 'Sesión requerida.' }, users[token] ? 200 : 401)
    }

    if (url.pathname === '/api/app/dashboard' && method === 'GET') {
      return json({
        metrics: { total: 1, active: 1, pending: 0, inProgress: 1, closedThisMonth: 0 },
        pipeline: [{ label: 'En revisión', value: 1, color: 'violet' }],
        recent: [{
          reference: requestReference,
          clientName: 'Ana Ríos',
          serviceType: 'importacion',
          status: 'in_review',
          createdAt: '2026-10-28T12:00:00.000Z',
        }],
      })
    }

    if (url.pathname === '/api/app/notifications' && method === 'GET') {
      return json({ items: [], unreadCount: 0, nextCursor: null })
    }

    if (url.pathname === '/api/app/notifications/realtime-ticket' && method === 'POST') {
      return json({ error: 'Realtime se omite en esta prueba.' }, 503)
    }

    if (url.pathname === `/api/app/expert/requests` && method === 'GET' && role === 'expert') {
      return json({
        items: [{
          id: requestId,
          reference: requestReference,
          consultationType: 'Consulta básica',
          serviceName: 'Importación',
          serviceType: 'importacion',
          question: '¿Qué documentos necesito para esta operación?',
          attachmentCount: 0,
          responseStatus: currentResponse?.status || 'none',
          responseBody: currentResponse?.body || '',
          createdAt: '2026-10-28T12:00:00.000Z',
          attachments: [],
        }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      })
    }

    if (url.pathname === `/api/app/expert/requests/${requestId}/response` && method === 'POST' && role === 'expert') {
      const payload = request.postDataJSON()
      expect(payload).toEqual({ body: responseBody })
      currentResponse = {
        id: responseId,
        version: 1,
        expertName: users[expertToken].name,
        createdAt: '2026-10-28T13:00:00.000Z',
        status: 'pending_admin_review',
        body: payload.body,
        bodyVisible: false,
      }
      return json({ ok: true, item: currentResponse }, 201)
    }

    if (url.pathname === '/api/app/requests' && method === 'GET' && role === 'admin') {
      return json({
        items: [{
          id: requestId,
          reference: requestReference,
          clientName: 'Ana Ríos',
          serviceType: 'importacion',
          productType: 'mercancias',
          status: 'in_review',
          payment: null,
          paymentRequired: false,
          notificationStatus: 'not_sent',
          source: 'direct_web',
          createdAt: '2026-10-28T12:00:00.000Z',
        }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        filters: { agents: [] },
      })
    }

    if (url.pathname === `/api/app/requests/${requestId}` && method === 'GET' && role === 'admin') {
      return json({
        request: {
          id: requestId,
          reference: requestReference,
          status: 'in_review',
          clientName: 'Ana Ríos',
          legalEntityType: 'natural',
          email: 'ana@example.com',
          phone: '',
          whatsapp: '',
          clientCreatedAt: '2026-10-28T12:00:00.000Z',
          serviceName: 'Consulta básica',
          serviceType: 'importacion',
          productType: 'mercancias',
          source: 'Página web',
          createdAt: '2026-10-28T12:00:00.000Z',
          payment: null,
          paymentRequired: false,
        },
        assignment: { expertId: 'expert-001', expertName: users[expertToken].name, history: [] },
        eligibleExperts: [],
        responses: currentResponse ? [{ ...currentResponse, bodyVisible: currentResponse.status === 'approved' }] : [],
        history: [],
      })
    }

    if (url.pathname === `/api/app/requests/${requestId}/activity` && method === 'GET' && role === 'admin') {
      return json({ items: [] })
    }

    if (url.pathname === `/api/app/reviews/responses/${responseId}` && method === 'PUT' && role === 'admin') {
      const payload = request.postDataJSON()
      expect(payload).toMatchObject({ action: 'approve' })
      expect(currentResponse?.status).toBe('pending_admin_review')
      currentResponse = {
        ...currentResponse,
        status: 'approved',
        bodyVisible: true,
        publicNote: payload.publicNote,
        internalNote: payload.internalNote,
      }
      return json({ ok: true, queued: false, item: currentResponse })
    }

    unexpectedRequests.push(`${method} ${url.pathname}${url.search} (sin mock, rol ${role || 'desconocido'})`)
    return json({ error: 'API no interceptada por este spec.' }, 501)
  })

  await page.addInitScript(({ token, user }) => {
    const changedUser = sessionStorage.getItem('e2e-operations-session')
    const session = changedUser ? JSON.parse(changedUser) : { token, user }
    localStorage.setItem('operationsToken', session.token)
    localStorage.setItem('operationsUser', JSON.stringify(session.user))
  }, { token: expertToken, user: users[expertToken] })
  await page.goto('/app')

  await openRequestsMenu(page)
  await expect(page.getByRole('heading', { name: 'Solicitudes asignadas' })).toBeVisible()
  await expect(page.getByText(requestReference, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Responder' }).click()
  await page.getByLabel('Respuesta para revisión administrativa').fill(responseBody)
  await page.getByRole('button', { name: /Enviar a revisión/ }).click()
  await expect(page.getByText('Respuesta enviada a revisión administrativa.')).toBeVisible()
  await expect(page.getByText('En revisión')).toBeVisible()
  expect(currentResponse?.status).toBe('pending_admin_review')

  await page.evaluate(({ token, user }) => {
    sessionStorage.setItem('e2e-operations-session', JSON.stringify({ token, user }))
  }, { token: adminToken, user: users[adminToken] })
  await page.reload()

  await openRequestsMenu(page)
  await page.getByRole('button', { name: requestReference }).click()
  await expect.poll(() => apiCalls.some(({ key, role }) => key === `GET /api/app/requests/${requestId}` && role === 'admin')).toBe(true)
  await expect(page.getByText('Cargando detalle…')).toHaveCount(0)
  expect(browserErrors).toEqual([])
  await expect(page.getByRole('heading', { name: requestReference })).toBeVisible()
  await expect(page.getByText('La respuesta está pendiente de aprobación administrativa.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprobar y enviar' })).toBeVisible()
  await page.getByRole('button', { name: 'Aprobar y enviar' }).click()

  await expect(page.getByText('Respuesta aprobada.', { exact: true })).toBeVisible()
  await expect(page.getByText('Aprobada', { exact: true })).toBeVisible()
  await expect(page.getByText(responseBody)).toBeVisible()
  expect(currentResponse?.status).toBe('approved')
  expect(apiCalls).toContainEqual({ key: `POST /api/app/expert/requests/${requestId}/response`, role: 'expert' })
  expect(apiCalls).toContainEqual({ key: `PUT /api/app/reviews/responses/${responseId}`, role: 'admin' })
  expect(unexpectedRequests).toEqual([])
})
