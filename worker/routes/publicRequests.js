import { sendRequestNotification } from './operationsEmail.js'

export async function handlePublicRequests(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/public/requests' || request.method !== 'POST') return null

  if (!env.NEON_DATABASE_URL) {
    return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  }

  const input = validate(await request.json().catch(() => ({})))
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const clientId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const reference = `CRA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

  await sql`
    INSERT INTO operations.clients (id, full_name)
    VALUES (${clientId}, ${input.fullName})
  `
  await sql`
    INSERT INTO operations.requests (
      id, client_id, reference, source, legal_entity_type, email, phone, whatsapp,
      service_type, freight_agent, product_type, status
    ) VALUES (
      ${requestId}, ${clientId}, ${reference}, 'landingpage', ${input.legalEntityType},
      ${input.email || null}, ${input.phone || null}, ${input.whatsapp || null},
      ${input.serviceType}, ${input.freightAgent}, ${input.productType}, 'pending'
    )
  `

  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    try { await sendRequestNotification(sql, env, requestId, 'request_created') } catch (error) { console.error('No se pudo enviar la notificación de solicitud creada:', error.message) }
  }

  return response({ ok: true, reference, status: 'pending' }, 201)
}

function validate(payload) {
  const fullName = text(payload.fullName)
  const legalEntityType = text(payload.legalEntityType)
  const email = text(payload.email)
  const phone = text(payload.phone)
  const whatsapp = text(payload.whatsapp)
  const serviceType = text(payload.serviceType)
  const freightAgent = text(payload.freightAgent)
  const productType = text(payload.productType)

  if (!fullName) throw new RequestError('El nombre completo es obligatorio.')
  if (!['natural', 'juridica'].includes(legalEntityType)) throw new RequestError('Selecciona la constitución legal.')
  if (!email && !phone && !whatsapp) throw new RequestError('Ingresa al menos un medio de contacto.')
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new RequestError('Ingresa un correo electrónico válido.')
  if (!['exportacion', 'importacion'].includes(serviceType)) throw new RequestError('Selecciona el tipo de servicio.')
  if (!freightAgent) throw new RequestError('Indica el agente de carga.')
  if (!['vehiculos', 'mercancias'].includes(productType)) throw new RequestError('Selecciona el tipo de producto.')

  return { fullName, legalEntityType, email, phone, whatsapp, serviceType, freightAgent, productType }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

class RequestError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
