import { sendRequestNotification } from './operationsEmail.js'

export async function handlePublicRequests(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/api/public/turnstile-config' && request.method === 'GET') {
    const enabled = Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY)
    return response({ siteKey: enabled ? env.TURNSTILE_SITE_KEY : '', enabled })
  }
  if (url.pathname === '/api/public/service' && request.method === 'GET') {
    if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(env.NEON_DATABASE_URL)
    const rows = await sql`SELECT code, name, amount_cents, currency FROM operations.service_catalog WHERE code = 'asesoria_personalizada' AND active = TRUE LIMIT 1`
    if (!rows[0]) return response({ error: 'El servicio no está disponible.' }, 404)
    return response({ code: String(rows[0].code), name: String(rows[0].name), amountCents: Number(rows[0].amount_cents), currency: String(rows[0].currency) })
  }
  if (url.pathname !== '/api/public/requests' || request.method !== 'POST') return null

  if (!env.NEON_DATABASE_URL) {
    return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BODY_BYTES) return response({ error: 'La solicitud supera el tamaño máximo permitido.' }, 413)

  const parsed = await parseInput(request)
  const input = validate(parsed.fields)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const serviceRows = await sql`
    SELECT s.code AS service_code, s.name AS service_name, s.description AS service_description,
      c.id AS consultation_type_id, c.code AS consultation_code, c.name AS consultation_name,
      c.description AS consultation_description, sct.amount_cents, sct.currency, sct.payment_required
    FROM operations.service_consultation_types sct
    JOIN operations.services s ON s.id = sct.service_id
    JOIN operations.consultation_types c ON c.id = sct.consultation_type_id
    WHERE s.code = ${input.serviceType} AND c.code = ${input.consultationType}
      AND s.active = TRUE AND c.active = TRUE AND sct.active = TRUE
    LIMIT 1
  `
  if (!serviceRows[0]) return response({ error: 'La especialidad seleccionada no está disponible.' }, 503)
  const service = serviceRows[0]
  const expertRows = await sql`
    SELECT u.id
    FROM operations.consultation_type_experts cte
    JOIN operations.users u ON u.id = cte.user_id AND u.active = TRUE
    JOIN operations.user_roles ur ON ur.user_id = u.id
    JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
    WHERE cte.consultation_type_id = ${service.consultation_type_id}
      AND cte.active = TRUE
    ORDER BY u.id
  `
  const assignedExpertId = expertRows.length
    ? expertRows[crypto.getRandomValues(new Uint32Array(1))[0] % expertRows.length].id
    : null
  let source = 'landingpage'
  let sourceChannel = 'direct_web'
  let agentId = null
  let agentLinkId = null
  if (input.agentToken) {
    const agentRows = await sql`
      SELECT l.id, l.agent_id
      FROM operations.agent_links l
      JOIN operations.users u ON u.id = l.agent_id
      WHERE l.token_hash = ${await sha256(input.agentToken)}
        AND l.active = TRUE AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > NOW())
        AND u.active = TRUE
      LIMIT 1
    `
    if (!agentRows[0]) return response({ error: 'El enlace de agente es inválido o venció.' }, 400)
    source = 'agent'
    sourceChannel = 'agent_link'
    agentId = agentRows[0].agent_id
    agentLinkId = agentRows[0].id
  }
  if (parsed.files.length > 5) return response({ error: 'Puedes adjuntar máximo 5 imágenes.' }, 400)
  const verifiedFiles = []
  let totalAttachmentBytes = 0
  for (const file of parsed.files) {
    if (file.size > MAX_ATTACHMENT_BYTES) return response({ error: 'Cada adjunto debe ser una imagen de máximo 10 MB.' }, 400)
    totalAttachmentBytes += file.size
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) return response({ error: 'El total de las imágenes no puede superar 25 MB.' }, 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const detectedType = detectImageType(bytes)
    if (!detectedType || (file.type && file.type !== detectedType)) return response({ error: 'Uno de los adjuntos no es una imagen válida.' }, 400)
    verifiedFiles.push({ file, bytes, type: detectedType })
  }
  const clientId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const reference = `CRA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

  await sql`
    INSERT INTO operations.clients (id, full_name)
    VALUES (${clientId}, ${input.fullName})
  `

  if (parsed.files.length) {
    if (!env.GALLERY_IMAGES) return response({ error: 'El almacenamiento de imágenes no está configurado.' }, 503)
    for (const { file, bytes, type } of verifiedFiles) {
      const attachmentId = crypto.randomUUID()
      const storageKey = `requests/${requestId}/${attachmentId}-${safeName(file.name)}`
      await env.GALLERY_IMAGES.put(storageKey, bytes, { httpMetadata: { contentType: type } })
      await sql`
        INSERT INTO operations.request_attachments (id, request_id, storage_key, original_name, mime_type, size_bytes)
        VALUES (${attachmentId}, ${requestId}, ${storageKey}, ${safeOriginalName(file.name)}, ${type}, ${file.size})
      `
    }
  }
  await sql`
    INSERT INTO operations.requests (
      id, client_id, reference, source, legal_entity_type, email, phone, whatsapp,
      service_name, service_amount_cents, service_currency, service_type, freight_agent, product_type, status,
      source_channel, agent_id, agent_link_id, specialty_id, specialty_name, specialty_description, question,
      general_service_code, general_service_name, consultation_type_id, consultation_type_code, consultation_type_name, consultation_type_description, payment_required,
      assigned_expert_id
    ) VALUES (
      ${requestId}, ${clientId}, ${reference}, ${source}, ${input.legalEntityType},
      ${input.email || null}, ${input.phone || null}, ${input.whatsapp || null},
      ${service.service_name}, ${service.amount_cents}, ${service.currency}, ${input.serviceType}, ${input.freightAgent || null}, ${input.productType}, 'pending',
      ${sourceChannel}, ${agentId}, ${agentLinkId}, NULL, NULL, NULL, ${input.question || null},
      ${input.serviceType}, ${service.service_name}, ${service.consultation_type_id}, ${input.consultationType}, ${service.consultation_name}, ${service.consultation_description}, ${service.payment_required},
      ${assignedExpertId}
    )
  `

  await sql`
    INSERT INTO operations.request_assignments (request_id, expert_id, consultation_type_id, candidate_count, strategy, status, reason)
    VALUES (${requestId}, ${assignedExpertId}, ${service.consultation_type_id}, ${expertRows.length}, 'random_pool', ${assignedExpertId ? 'assigned' : 'failed'}, ${assignedExpertId ? null : 'no_active_expert'})
  `

  if ((env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) && env.RESEND_FROM_EMAIL) {
    try { await sendRequestNotification(sql, env, requestId, 'request_created') } catch (error) { console.error('No se pudo enviar la notificación de solicitud creada:', error.message) }
    if (!assignedExpertId) {
      try { await sendRequestNotification(sql, env, requestId, 'assignment_failed') } catch (error) { console.error('No se pudo notificar la asignación fallida:', error.message) }
    }
  }

  return response({ ok: true, reference, status: 'pending' }, 201)
}

function validate(payload) {
  const fullName = text(payload.fullName)
  const legalEntityType = text(payload.legalEntityType)
  const email = text(payload.email).toLowerCase()
  const phone = normalizePhone(payload.phone, 'El teléfono')
  const whatsapp = normalizePhone(payload.whatsapp, 'El WhatsApp')
  const serviceType = text(payload.serviceType)
  const consultationType = text(payload.consultationType)
  const productType = text(payload.productType)
  const question = text(payload.question)
  const agentToken = text(payload.agentToken)

  if (!fullName) throw new RequestError('El nombre completo es obligatorio.')
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(fullName)) throw new RequestError('El nombre debe tener entre 2 y 120 caracteres y solo puede contener letras, espacios, puntos o guiones.')
  if (!['natural', 'juridica'].includes(legalEntityType)) throw new RequestError('Selecciona la constitución legal.')
  if (!email && !phone && !whatsapp) throw new RequestError('Ingresa al menos un medio de contacto.')
  if (email && (email.length > 254 || /[\u0000-\u001F\u007F<>]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) throw new RequestError('Ingresa un correo electrónico válido.')
  if (!['exportacion', 'importacion', 'agente_carga'].includes(serviceType)) throw new RequestError('Selecciona el tipo de servicio.')
  if (!consultationType) throw new RequestError('Selecciona el tipo de consulta.')
  if (!['vehiculos', 'mercancias'].includes(productType)) throw new RequestError('Selecciona el tipo de producto.')
  if (!question) throw new RequestError('Cuéntanos qué necesitas consultar.')
  if (question.length < 20 || question.length > 3000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(question)) throw new RequestError('La consulta debe tener entre 20 y 3000 caracteres.')

  return { fullName, legalEntityType, email, phone, whatsapp, serviceType, consultationType, freightAgent: null, productType, question, agentToken }
}

async function parseInput(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) return { fields: await request.json().catch(() => ({})), files: [] }
  let formData
  try {
    formData = await request.formData()
  } catch {
    throw new RequestError('No fue posible leer los datos enviados.')
  }
  const fields = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === 'string'))
  const files = formData.getAll('attachments').filter((value) => value && typeof value.arrayBuffer === 'function')
  return { fields, files }
}

function safeName(name) {
  return String(name || 'image').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'image'
}

function safeOriginalName(name) {
  return String(name || 'image').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120) || 'image'
}

function normalizePhone(value, label) {
  const raw = text(value)
  if (!raw) return ''
  const normalized = raw.replace(/[\s().-]/g, '')
  if (!/^\+?\d{7,15}$/.test(normalized)) throw new RequestError(`${label} debe tener entre 7 y 15 dígitos y usar un formato válido.`)
  return normalized
}

function detectImageType(bytes) {
  const isPng = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  if (isPng) return 'image/png'
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (isJpeg) return 'image/jpeg'
  const isWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (isWebp) return 'image/webp'
  return ''
}

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_REQUEST_BODY_BYTES = 35 * 1024 * 1024
