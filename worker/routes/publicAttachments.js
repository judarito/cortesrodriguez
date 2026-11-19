// Endpoints públicos de adjuntos para el flujo cotización → reserva.
//
// El navegador solo propone la categoría de cada archivo. El servidor resuelve
// la solicitud desde el hash del token opaco, lee el catálogo
// operations.request_attachment_requirements y valida categoría permitida por
// servicio, MIME real (firmas), extensión, tamaño, cupo, duplicados y estado.
// La base de datos vuelve a validar las mismas reglas mediante el trigger de la
// migración 049.
//
// Este módulo no importa publicRequests.js para evitar ciclos: publicRequests
// importa los helpers compartidos (sha256, inspectImage, rate limit) desde aquí.

import { isLandingRequestButtonEnabled } from '../lib/landingFeatureFlags.js'
import {
  attachmentDownloadHeaders,
  canonicalAttachmentType,
  storedObjectMatchesType,
} from '../lib/attachmentDownload.js'

const QUOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MAX_FILES_PER_UPLOAD = 10
const MAX_FILES_PER_REQUEST = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
const MAX_REQUEST_BODY_BYTES = 35 * 1024 * 1024

const ATTACHMENT_STAGES = ['cotizacion', 'reserva']
const ATTACHMENT_SERVICE_TYPES = ['importacion', 'exportacion', 'agente_carga']

export async function handlePublicAttachments(request, env) {
  const url = new URL(request.url)
  const isCollection = url.pathname === '/api/public/quotes/attachments'
  const isRequirements = url.pathname === '/api/public/attachment-requirements' && request.method === 'GET'
  const attachmentMatch = url.pathname.match(/^\/api\/public\/quotes\/attachments\/([^/]+)$/)
  const deleteMatch = attachmentMatch
  const isDelete = Boolean(deleteMatch) && request.method === 'DELETE'
  const isDownload = Boolean(attachmentMatch) && request.method === 'GET'
  const isOperation = (isCollection && ['GET', 'POST'].includes(request.method)) || isDelete || isDownload || isRequirements
  if (!isOperation) return null

  if (!env.NEON_DATABASE_URL) {
    return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  }
  // El índice aplica el flag a las rutas declaradas en landingFeatureFlags.js.
  // Estas rutas se registran aparte, así que repiten la comprobación para no
  // exponerse cuando el flujo público está deshabilitado.
  if (!await isLandingRequestButtonEnabled(env)) {
    return response({ error: 'Esta función no está disponible.' }, 404, { 'cache-control': 'no-store' })
  }

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  try {
    if (isRequirements) return await listAttachmentRequirements(sql, url)
    if (isDownload) return await downloadQuoteAttachment(sql, request, env, attachmentMatch[1], url)
    if (isCollection && request.method === 'GET') return await listQuoteAttachments(sql, request, url)
    if (request.method === 'POST') return await uploadQuoteAttachments(sql, request, env)
    return await deleteQuoteAttachment(sql, request, env, deleteMatch[1], url)
  } catch (error) {
    return errorResponse(error)
  }
}

// Catálogo público de la matriz documental. No expone datos de solicitudes:
// solo las categorías configuradas para un servicio y una etapa. El navegador
// lo consume para renderizar etiquetas, obligatoriedad y límites; no mantiene
// una copia hardcodeada de la matriz.
async function listAttachmentRequirements(sql, url) {
  const serviceType = text(url.searchParams.get('serviceType')).toLowerCase()
  if (!ATTACHMENT_SERVICE_TYPES.includes(serviceType)) {
    throw new RequestError('Selecciona un servicio válido.')
  }
  const requestedStage = text(url.searchParams.get('stage')).toLowerCase()
  const stage = ATTACHMENT_STAGES.includes(requestedStage) ? requestedStage : 'cotizacion'
  const requirements = await loadAttachmentRequirements(sql, serviceType, stage)
  return response({
    serviceType,
    stage,
    requirements: requirements.map(requirementPayload),
  }, 200, noStore())
}

async function listQuoteAttachments(sql, request, url) {
  const token = text(url.searchParams.get('token'))
  assertQuoteToken(token)
  const quote = await resolveQuote(sql, token)
  if (!quote) return response({ error: 'La cotización no existe.' }, 404, noStore())
  if (String(quote.status) === 'cotizacion' && !Boolean(quote.quote_active)) {
    return response({ error: 'La cotización venció. Solicita un enlace nuevo.' }, 409, noStore())
  }
  if (!['cotizacion', 'pending', 'in_progress', 'closed'].includes(String(quote.status))) {
    return response({ error: 'La cotización ya no está disponible.' }, 409, noStore())
  }

  const requirements = await loadAttachmentRequirements(sql, String(quote.service_type), 'reserva')
  const attachments = await listRequestAttachments(sql, String(quote.id))
  const [completeCotizacion, completeReserva] = await Promise.all([
    requestAttachmentsComplete(sql, String(quote.id), 'cotizacion'),
    requestAttachmentsComplete(sql, String(quote.id), 'reserva'),
  ])

  return response({
    request: {
      reference: String(quote.reference),
      serviceType: String(quote.service_type),
      productType: String(quote.product_type || ''),
      status: String(quote.status),
      expiresAt: quote.quote_expires_at ? String(quote.quote_expires_at) : null,
    },
    requirements: requirements.map(requirementPayload),
    attachments: attachments.map(attachmentPayload),
    complete: { cotizacion: completeCotizacion, reserva: completeReserva },
  }, 200, noStore())
}

async function downloadQuoteAttachment(sql, request, env, attachmentId, url) {
  if (!UUID_PATTERN.test(attachmentId)) return response({ error: 'Adjunto no encontrado.' }, 404, noStore())
  if (!env.GALLERY_IMAGES) return response({ error: 'El archivo no está disponible temporalmente.' }, 503, noStore())

  const token = text(url.searchParams.get('token'))
  assertQuoteToken(token)
  const quote = await resolveQuote(sql, token)
  if (!quote || !['cotizacion', 'pending', 'in_progress', 'closed'].includes(String(quote.status))) {
    return response({ error: 'Adjunto no encontrado.' }, 404, noStore())
  }
  const rows = await sql`
    SELECT storage_key, mime_type, original_name, size_bytes
    FROM operations.request_attachments
    WHERE id = ${attachmentId}::uuid
      AND request_id = ${String(quote.id)}::uuid
      AND status = 'validated'
      AND storage_key LIKE ${`requests/${String(quote.id)}/%`}
    LIMIT 1
  `
  const mimeType = canonicalAttachmentType(rows[0]?.mime_type)
  if (!mimeType) return response({ error: 'Adjunto no encontrado.' }, 404, noStore())
  const object = await env.GALLERY_IMAGES.get(String(rows[0].storage_key))
  if (!object || !storedObjectMatchesType(object, mimeType)) return response({ error: 'Adjunto no encontrado.' }, 404, noStore())
  return new Response(object.body, {
    headers: attachmentDownloadHeaders({ mimeType, name: rows[0].original_name, size: rows[0].size_bytes }),
  })
}

async function uploadQuoteAttachments(sql, request, env) {
  const limited = await enforcePublicRateLimit(request, env, 'quote_attachment_upload', 20, 3600)
  if (limited) return limited

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    return response({ error: 'La carga supera el tamaño máximo permitido.' }, 413, noStore())
  }

  const parsed = await parseAttachmentRequest(request)
  const token = text(parsed.fields.quoteToken || parsed.fields.token)
  assertQuoteToken(token)
  if (!parsed.files.length) throw new RequestError('Adjunta al menos un archivo.')

  const quote = await resolveQuote(sql, token)
  assertQuoteAcceptsAttachments(quote)
  throw new RequestError('Los adjuntos se cargan durante la reserva y el pago, después de aprobar la cotización.', 409)

  const requirements = await loadAttachmentRequirements(sql, String(quote.service_type), 'cotizacion')
  const snapshot = await loadAttachmentSnapshot(sql, String(quote.id))
  const verified = await verifyAttachmentFiles({
    files: parsed.files,
    categories: parsed.attachmentCategories,
    requirements,
    snapshot,
  })
  const stored = await storeRequestAttachments({
    sql,
    env,
    requestId: String(quote.id),
    attachments: verified,
    stage: 'cotizacion',
    uploadedByKind: 'client',
  })
  const [attachments, complete] = await Promise.all([
    listRequestAttachments(sql, String(quote.id)),
    requestAttachmentsComplete(sql, String(quote.id), 'cotizacion'),
  ])

  return response({
    ok: true,
    stored: stored.length,
    attachments: attachments.map(attachmentPayload),
    requirements: requirements.map(requirementPayload),
    complete,
  }, 201, noStore())
}

async function deleteQuoteAttachment(sql, request, env, attachmentId, url) {
  const limited = await enforcePublicRateLimit(request, env, 'quote_attachment_delete', 20, 3600)
  if (limited) return limited

  const body = await readSmallJson(request)
  const token = text(body?.quoteToken || body?.token || url.searchParams.get('token'))
  assertQuoteToken(token)
  if (!UUID_PATTERN.test(attachmentId)) return response({ error: 'Adjunto no encontrado.' }, 404, noStore())

  const quote = await resolveQuote(sql, token)
  assertQuoteAcceptsAttachments(quote)

  const rows = await sql`
    UPDATE operations.request_attachments
       SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
     WHERE id = ${attachmentId}::uuid
       AND request_id = ${String(quote.id)}::uuid
       AND status IN ('pending', 'validated')
    RETURNING id, storage_key
  `
  if (!rows[0]) return response({ error: 'Adjunto no encontrado.' }, 404, noStore())

  if (env.GALLERY_IMAGES?.delete) {
    try { await env.GALLERY_IMAGES.delete(String(rows[0].storage_key)) } catch (error) {
      console.error('No se pudo eliminar el archivo del almacenamiento:', error.message)
    }
  }
  return response({ ok: true, id: String(rows[0].id), status: 'deleted' }, 200, noStore())
}

async function resolveQuote(sql, token) {
  const tokenHash = await sha256(token)
  const rows = await sql`
    SELECT id, reference, status, service_type, product_type, quote_expires_at,
      (quote_expires_at IS NOT NULL AND quote_expires_at > NOW()) AS quote_active
    FROM operations.requests
    WHERE quote_token_hash = ${tokenHash}
    LIMIT 1
  `
  return rows[0] || null
}

function assertQuoteToken(token) {
  if (!QUOTE_TOKEN_PATTERN.test(token)) throw new RequestError('La cotización no es válida.')
}

function assertQuoteAcceptsAttachments(quote) {
  if (!quote) throw new RequestError('La cotización no existe.', 404)
  if (String(quote.status) !== 'cotizacion') {
    throw new RequestError('La cotización ya fue convertida y no admite cambios en sus adjuntos.', 409)
  }
  if (!Boolean(quote.quote_active)) throw new RequestError('La cotización venció. Solicita un enlace nuevo.', 409)
}

async function assertServiceActive(sql, serviceType) {
  const rows = await sql`
    SELECT 1 AS active FROM operations.services
    WHERE code = ${serviceType} AND active = TRUE
    LIMIT 1
  `
  if (!rows[0]) throw new RequestError('El servicio de esta solicitud no está disponible.', 409)
}

export async function loadAttachmentRequirements(sql, serviceType, stage) {
  const resolvedStage = ATTACHMENT_STAGES.includes(stage) ? stage : 'reserva'
  const rows = await sql`
    SELECT category, label_es, label_en, description_es, description_en, stage,
      min_files, max_files, max_size_bytes, allowed_mime_types, allowed_extensions, sort_order
    FROM operations.request_attachment_requirements
    WHERE service_type = ${serviceType}
      AND active = TRUE
      AND stage IN ('any', ${resolvedStage})
    ORDER BY sort_order, category
  `
  return rows.map((row) => ({
    category: String(row.category),
    labelEs: String(row.label_es),
    labelEn: String(row.label_en),
    descriptionEs: row.description_es ? String(row.description_es) : '',
    descriptionEn: row.description_en ? String(row.description_en) : '',
    stage: String(row.stage),
    minFiles: Number(row.min_files || 0),
    maxFiles: Number(row.max_files || 0),
    maxSizeBytes: Number(row.max_size_bytes || MAX_FILE_BYTES),
    allowedMimeTypes: normalizeList(row.allowed_mime_types),
    allowedExtensions: normalizeList(row.allowed_extensions).map((value) => value.toLowerCase()),
  }))
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^\{|\}$/g, '')
    return trimmed ? trimmed.split(',').map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean) : []
  }
  return []
}

export async function loadAttachmentSnapshot(sql, requestId) {
  const rows = await sql`
    SELECT category, checksum_sha256 FROM operations.request_attachments
    WHERE request_id = ${requestId}::uuid AND status <> 'deleted'
  `
  const counts = new Map()
  const checksums = new Set()
  for (const row of rows) {
    const category = String(row.category || '')
    counts.set(category, (counts.get(category) || 0) + 1)
    if (row.checksum_sha256) checksums.add(String(row.checksum_sha256))
  }
  return { counts, checksums, total: rows.length }
}

export async function verifyAttachmentFiles({ files, categories, requirements, snapshot }) {
  if (!files.length) return []
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new RequestError(`Puedes adjuntar máximo ${MAX_FILES_PER_UPLOAD} archivos por envío.`)
  }
  if (categories.length !== files.length) {
    throw new RequestError('Cada archivo debe indicar su categoría documental.')
  }

  const available = new Map(requirements.map((requirement) => [requirement.category, requirement]))
  const plannedCounts = new Map(snapshot.counts)
  const plannedChecksums = new Set(snapshot.checksums)
  let totalBytes = 0
  const verified = []

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const category = text(categories[index]).toLowerCase()
    const requirement = available.get(category)
    if (!requirement) {
      throw new RequestError(`La categoría documental "${category}" no está permitida para este servicio.`)
    }

    const size = Number(file.size || 0)
    if (!Number.isSafeInteger(size) || size <= 0) throw new RequestError('Uno de los archivos está vacío.')
    if (size > MAX_FILE_BYTES || size > requirement.maxSizeBytes) {
      throw new RequestError(`"${displayName(file.name)}" supera el tamaño máximo permitido para "${requirement.labelEs}".`)
    }
    totalBytes += size
    if (totalBytes > MAX_UPLOAD_BYTES) throw new RequestError('El total de los archivos supera el tamaño permitido por envío.')

    const occupied = plannedCounts.get(category) || 0
    if (occupied >= requirement.maxFiles) {
      throw new RequestError(`"${requirement.labelEs}" admite máximo ${requirement.maxFiles} archivos.`)
    }
    if (snapshot.total + verified.length + 1 > MAX_FILES_PER_REQUEST) {
      throw new RequestError(`La solicitud admite máximo ${MAX_FILES_PER_REQUEST} archivos.`)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const inspection = inspectUploadedFile(bytes)
    if (!inspection) {
      throw new RequestError(`"${displayName(file.name)}" no es un PDF, PNG, JPG o WEBP válido.`)
    }
    const declaredType = text(file.type).toLowerCase()
    if (declaredType && declaredType !== inspection.mimeType) {
      throw new RequestError(`El contenido de "${displayName(file.name)}" no coincide con su tipo declarado.`)
    }
    if (!requirement.allowedMimeTypes.includes(inspection.mimeType)) {
      throw new RequestError(`El tipo "${inspection.mimeType}" no está permitido para "${requirement.labelEs}".`)
    }
    const extension = extensionOf(file.name)
    if (!requirement.allowedExtensions.includes(extension)) {
      throw new RequestError(`La extensión ".${extension || 'sin extensión'}" no está permitida para "${requirement.labelEs}".`)
    }

    const checksum = await sha256Hex(bytes)
    if (plannedChecksums.has(checksum)) {
      throw new RequestError(`"${displayName(file.name)}" ya fue adjuntado a esta solicitud.`, 409)
    }
    plannedChecksums.add(checksum)
    plannedCounts.set(category, occupied + 1)

    verified.push({
      file,
      bytes,
      category,
      mimeType: inspection.mimeType,
      size,
      checksum,
      metadata: inspection.width ? { width: inspection.width, height: inspection.height } : {},
    })
  }

  return verified
}

export async function storeRequestAttachments({ sql, env, requestId, attachments, stage, uploadedByKind }) {
  if (!attachments.length) return []
  if (!ATTACHMENT_STAGES.includes(stage)) throw new RequestError('La etapa del adjunto no es válida.')
  if (!env.GALLERY_IMAGES) throw new RequestError('El almacenamiento de archivos no está configurado.', 503)

  const prepared = []
  for (const attachment of attachments) {
    const attachmentId = crypto.randomUUID()
    const storageKey = `requests/${requestId}/${attachment.category}/${attachmentId}-${safeName(attachment.file.name)}`
    await env.GALLERY_IMAGES.put(storageKey, attachment.bytes, {
      httpMetadata: { contentType: attachment.mimeType },
    })
    prepared.push({ ...attachment, attachmentId, storageKey })
  }

  const storedIds = []
  try {
    for (const item of prepared) {
      const rows = await sql`
        INSERT INTO operations.request_attachments (
          id, request_id, storage_key, original_name, mime_type, size_bytes, status,
          category, stage, uploaded_by_kind, checksum_sha256, metadata, validated_at
        ) VALUES (
          ${item.attachmentId}, ${requestId}::uuid, ${item.storageKey},
          ${safeOriginalName(item.file.name)}, ${item.mimeType}, ${item.size}, 'validated',
          ${item.category}, ${stage}, ${uploadedByKind}, ${item.checksum},
          ${JSON.stringify(item.metadata || {})}::jsonb, NOW()
        )
        RETURNING id
      `
      storedIds.push(item.attachmentId)
    }
  } catch (error) {
    await discardStoredAttachments({ sql, env, requestId, attachmentIds: storedIds, storageKeys: prepared.map((item) => item.storageKey) })
    throw mapDatabaseError(error)
  }
  return prepared
}

// Borra adjuntos recién cargados cuando la operación que los justificaba no se
// completa (por ejemplo, una conversión concurrente que perdió la carrera).
export async function discardStoredAttachments({ sql, env, requestId, attachmentIds = [], storageKeys = [] }) {
  for (const attachmentId of attachmentIds) {
    try {
      await sql`DELETE FROM operations.request_attachments WHERE id = ${attachmentId}::uuid AND request_id = ${requestId}::uuid`
    } catch (error) {
      console.error('No se pudo revertir el metadato del adjunto:', error.message)
    }
  }
  for (const storageKey of storageKeys) {
    if (!env.GALLERY_IMAGES?.delete) continue
    try { await env.GALLERY_IMAGES.delete(storageKey) } catch (error) {
      console.error('No se pudo revertir el archivo del almacenamiento:', error.message)
    }
  }
}

export async function listRequestAttachments(sql, requestId) {
  const rows = await sql`
    SELECT id, original_name, mime_type, size_bytes, status, category, stage, created_at
    FROM operations.request_attachments
    WHERE request_id = ${requestId}::uuid AND status = 'validated'
    ORDER BY category, created_at
  `
  return rows
}

export async function requestAttachmentsComplete(sql, requestId, stage) {
  const resolvedStage = ATTACHMENT_STAGES.includes(stage) ? stage : 'reserva'
  const rows = await sql`
    SELECT operations.request_attachments_complete(${requestId}::uuid, ${resolvedStage}) AS complete
  `
  return Boolean(rows[0]?.complete)
}

export async function requestAttachmentGaps(sql, requestId, stage) {
  const resolvedStage = ATTACHMENT_STAGES.includes(stage) ? stage : 'reserva'
  const rows = await sql`
    SELECT category, label_es, label_en, stage, min_files, validated_count
    FROM operations.request_attachment_gaps
    WHERE request_id = ${requestId}::uuid AND stage IN ('any', ${resolvedStage})
    ORDER BY category
  `
  return rows.map((row) => ({
    category: String(row.category),
    labelEs: String(row.label_es),
    labelEn: String(row.label_en),
    minFiles: Number(row.min_files || 0),
    validatedCount: Number(row.validated_count || 0),
  }))
}

export function attachmentPayload(row) {
  return {
    id: String(row.id),
    originalName: String(row.original_name || 'Adjunto'),
    mimeType: String(row.mime_type || ''),
    sizeBytes: Number(row.size_bytes || 0),
    category: String(row.category || 'documento_general'),
    stage: String(row.stage || 'cotizacion'),
    status: String(row.status || 'pending'),
    createdAt: row.created_at ? String(row.created_at) : null,
  }
}

export function requirementPayload(requirement) {
  return {
    category: requirement.category,
    labelEs: requirement.labelEs,
    labelEn: requirement.labelEn,
    descriptionEs: requirement.descriptionEs,
    descriptionEn: requirement.descriptionEn,
    stage: requirement.stage,
    minFiles: requirement.minFiles,
    maxFiles: requirement.maxFiles,
    maxSizeBytes: requirement.maxSizeBytes,
    allowedMimeTypes: requirement.allowedMimeTypes,
    allowedExtensions: requirement.allowedExtensions,
  }
}

// El orden de los campos repetidos `attachmentCategory` debe coincidir con el
// orden de los archivos en `attachments`; el servidor empareja por posición.
async function parseAttachmentRequest(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    throw new RequestError('Envía los archivos en un formulario multipart.')
  }
  let formData
  try {
    formData = await request.formData()
  } catch {
    throw new RequestError('No fue posible leer los archivos enviados.')
  }
  const fields = {}
  const attachmentCategories = []
  for (const [name, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    if (name === 'attachmentCategory' || name === 'category') attachmentCategories.push(value.trim())
    else fields[name] = value
  }
  const files = formData.getAll('attachments').filter((value) => value && typeof value.arrayBuffer === 'function')
  return { fields, files, attachmentCategories }
}

function inspectUploadedFile(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mimeType: 'application/pdf', width: 0, height: 0 }
  }
  const image = inspectImage(bytes)
  if (!image) return null
  return { mimeType: image.type, width: image.width, height: image.height }
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,10})$/)
  return match ? match[1] : ''
}

function displayName(name) {
  return safeOriginalName(name)
}

function mapDatabaseError(error) {
  const message = String(error?.message || '')
  if (error?.code === '23505' || /duplicate key/i.test(message)) {
    return new RequestError('Ese archivo ya fue adjuntado a esta solicitud.', 409)
  }
  const known = message.match(/(La categoría .*?|El archivo .*?|El tipo .*?|La clave de almacenamiento .*?|La solicitud .*?)(?:\.|$)/i)
  if (error?.code === 'P0001' && known) return new RequestError(known[1].trim())
  return error
}

async function readSmallJson(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return null
  const raw = await request.text()
  if (!raw || raw.length > 2048) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function enforcePublicRateLimit(request, env, action, limit, windowSeconds) {
  const ip = request.headers.get('CF-Connecting-IP')?.trim()
  if (!ip || ip.length > 64 || !env.PUBLIC_RATE_LIMIT_SECRET) {
    return response({ error: 'El servicio de solicitudes no está disponible.' }, 503)
  }
  const keyHash = await sha256(`${env.PUBLIC_RATE_LIMIT_SECRET}:${ip}`)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const rows = await sql`
    WITH expired_rate_rows AS (
      SELECT ctid
      FROM operations.public_request_rate_limits
      WHERE window_started_at < NOW() - INTERVAL '2 hours'
      ORDER BY window_started_at
      LIMIT 100
    ), cleanup AS (
      DELETE FROM operations.public_request_rate_limits limits
      USING expired_rate_rows
      WHERE limits.ctid = expired_rate_rows.ctid
    ), expired_token_rows AS (
      SELECT id
      FROM operations.public_request_attribution_tokens
      WHERE attribution_type = 'direct_web' AND (expires_at <= NOW() OR revoked_at IS NOT NULL)
      ORDER BY expires_at, id
      LIMIT 100
    ), cleanup_tokens AS (
      DELETE FROM operations.public_request_attribution_tokens tokens
      USING expired_token_rows
      WHERE tokens.id = expired_token_rows.id
    ), updated AS (
      INSERT INTO operations.public_request_rate_limits (ip_hash, action, window_started_at, request_count)
      VALUES (${keyHash}, ${action}, date_trunc('minute', NOW()), 1)
      ON CONFLICT (ip_hash, action) DO UPDATE SET
        request_count = CASE
          WHEN operations.public_request_rate_limits.window_started_at <= NOW() - (${windowSeconds} * INTERVAL '1 second') THEN 1
          ELSE operations.public_request_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN operations.public_request_rate_limits.window_started_at <= NOW() - (${windowSeconds} * INTERVAL '1 second') THEN date_trunc('minute', NOW())
          ELSE operations.public_request_rate_limits.window_started_at
        END,
        updated_at = NOW()
      RETURNING request_count
    ) SELECT request_count FROM updated
  `
  if (Number(rows[0]?.request_count) > limit) {
    return response({ error: 'Has realizado demasiados intentos. Espera antes de volver a intentarlo.' }, 429, { ...noStore(), 'retry-after': String(windowSeconds) })
  }
  return null
}

export function inspectImage(bytes) {
  const maxDimension = 12000
  const maxPixels = 40_000_000
  const validDimensions = (width, height) => Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && width <= maxDimension && height <= maxDimension && width * height <= maxPixels
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  const isPng = bytes.length >= 45 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  if (isPng) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    const validHeader = view.getUint32(8) === 13 && ascii(12, 16) === 'IHDR'
    const validEnd = ascii(bytes.length - 8, bytes.length - 4) === 'IEND'
    return validHeader && validEnd && validDimensions(width, height) ? { type: 'image/png', width, height } : null
  }
  const isJpeg = bytes.length >= 16 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (isJpeg) {
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset < bytes.length - 2) {
      if (bytes[offset] !== 0xff) return null
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset++]
      if (marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) return null
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
      if (frameMarkers.has(marker)) {
        if (segmentLength < 7) return null
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
        return validDimensions(width, height) ? { type: 'image/jpeg', width, height } : null
      }
      offset += segmentLength
    }
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const webpChunkSize = bytes.length >= 20 ? view.getUint32(16, true) : 0
  const isWebp = bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    && view.getUint32(4, true) === bytes.length - 8 && webpChunkSize <= bytes.length - 20
  if (isWebp) {
    let width = 0
    let height = 0
    if (ascii(12, 16) === 'VP8X' && webpChunkSize >= 10) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    } else if (ascii(12, 16) === 'VP8L' && webpChunkSize >= 5 && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8)
      height = 1 + ((bytes[22] >> 6) & 0x03) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
    } else if (ascii(12, 16) === 'VP8 ' && webpChunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = ((bytes[27] & 0x3f) << 8) | bytes[26]
      height = ((bytes[29] & 0x3f) << 8) | bytes[28]
    }
    return validDimensions(width, height) ? { type: 'image/webp', width, height } : null
  }
  return null
}

export async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeName(name) {
  return String(name || 'document').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'document'
}

function safeOriginalName(name) {
  return String(name || 'document').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120) || 'document'
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function noStore() {
  return { 'cache-control': 'no-store' }
}

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export { RequestError }

function errorResponse(error) {
  if (error instanceof RequestError || Number.isInteger(error?.status)) {
    const status = Number.isInteger(error.status) ? error.status : 400
    if (status >= 500) console.error(error)
    return response({ error: error.message || 'Solicitud no válida.' }, status, noStore())
  }
  console.error('Error al procesar adjuntos públicos:', error)
  return response({ error: 'No fue posible procesar los adjuntos. Intenta nuevamente.' }, 500, noStore())
}

function response(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}
