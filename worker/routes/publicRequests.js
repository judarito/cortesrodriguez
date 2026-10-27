import { enqueueNotification } from './operationsEmail.js'
import { rankSimilarQuestions } from '../lib/questionSimilarity.js'
import { normalizeClientEmail } from '../lib/clientIdentity.js'

export async function handlePublicRequests(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/api/public/request-attribution-token') {
    return response({ error: 'Abre el formulario desde la página principal.' }, 404, { 'cache-control': 'no-store' })
  }
  if (url.pathname === '/api/public/request-start' && request.method === 'GET') {
    if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)
    const limited = await enforcePublicRateLimit(request, env, 'token', 20, 60)
    if (limited) return limited
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(env.NEON_DATABASE_URL)
    const token = createOpaqueToken()
    await sql`INSERT INTO operations.public_request_attribution_tokens (token_hash, attribution_type, expires_at) VALUES (${await sha256(token)}, 'direct_web', NOW() + INTERVAL '2 hours')`
    return new Response(null, { status: 302, headers: {
      location: new URL(`/solicitud#originToken=${encodeURIComponent(token)}`, url).toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    } })
  }
  if (url.pathname === '/api/public/turnstile-config' && request.method === 'GET') {
    const siteKey = typeof env.TURNSTILE_SITE_KEY === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(env.TURNSTILE_SITE_KEY)
      ? env.TURNSTILE_SITE_KEY
      : ''
    const enabled = Boolean(env.TURNSTILE_SECRET_KEY && siteKey)
    return response({ siteKey: enabled ? siteKey : '', enabled }, 200, { 'cache-control': 'no-store' })
  }
  if (url.pathname === '/api/public/service' && request.method === 'GET') {
    if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(env.NEON_DATABASE_URL)
    const rows = await sql`SELECT code, name, amount_cents, currency FROM operations.service_catalog WHERE code = 'asesoria_personalizada' AND active = TRUE LIMIT 1`
    if (!rows[0]) return response({ error: 'El servicio no está disponible.' }, 404)
    return response({ code: String(rows[0].code), name: String(rows[0].name), amountCents: Number(rows[0].amount_cents), currency: String(rows[0].currency) })
  }
  if (url.pathname === '/api/public/payments/preference' && request.method === 'POST') {
    if (!env.NEON_DATABASE_URL) return response({ error: 'El pago no está configurado.' }, 503)
    const limited = await enforcePublicRateLimit(request, env, 'payment_preference', 10, 900)
    if (limited) return limited
    return createPaymentPreference(request, env)
  }
  if (url.pathname === '/api/public/payments/verify' && request.method === 'POST') return verifyReturnedPayment(request, env)
  if (url.pathname === '/api/public/payments/webhook' && request.method === 'POST') return handlePaymentWebhook(request, env)
  if (url.pathname !== '/api/public/requests' || request.method !== 'POST') return null

  if (!env.NEON_DATABASE_URL) {
    return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BODY_BYTES) return response({ error: 'La solicitud supera el tamaño máximo permitido.' }, 413)

  const parsed = await parseInput(request)
  const attributionToken = text(parsed.fields.attributionToken || parsed.fields.agentToken)
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(attributionToken)) {
    return response({ error: 'El enlace de origen no es válido. Recarga el formulario e inténtalo de nuevo.' }, 400)
  }
  const limited = await enforcePublicRateLimit(request, env, 'request', 5, 3600)
  if (limited) return limited

  const input = validate(parsed.fields)
  input.locale = parsed.fields.locale === 'en' ? 'en' : 'es'
  const idempotencyKey = text(parsed.fields.idempotencyKey)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return response({ error: 'La clave de envío no es válida. Recarga el formulario e inténtalo de nuevo.' }, 400)
  }
  if (env.TURNSTILE_SECRET_KEY) {
    const token = text(parsed.fields.turnstileToken)
    if (!token || token.length > 2048 || !await verifyTurnstile(token, request, env.TURNSTILE_SECRET_KEY)) {
      return response({ error: 'No se pudo verificar el envío. Actualiza la verificación e inténtalo de nuevo.' }, 400)
    }
  }
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const attributionRows = await sql`
    SELECT t.attribution_type, t.agent_link_id, l.agent_id
    FROM operations.public_request_attribution_tokens t
    LEFT JOIN operations.agent_links l ON l.id = t.agent_link_id
    LEFT JOIN operations.users u ON u.id = l.agent_id
    WHERE t.token_hash = ${await sha256(attributionToken)}
      AND t.revoked_at IS NULL AND t.expires_at > NOW()
      AND ((t.attribution_type = 'direct_web' AND t.agent_link_id IS NULL)
        OR (t.attribution_type = 'agent_link' AND l.active = TRUE AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > NOW()) AND u.active = TRUE))
    LIMIT 1
  `
  if (!attributionRows[0]) return response({ error: 'El enlace de origen es inválido o venció. Recarga el formulario e inténtalo de nuevo.' }, 400)
  const sourceChannel = String(attributionRows[0].attribution_type)
  const source = sourceChannel === 'agent_link' ? 'agent' : 'landingpage'
  const agentId = attributionRows[0].agent_id || null
  const agentLinkId = attributionRows[0].agent_link_id || null
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
  const historicalResponses = input.question ? await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (r.id) er.id AS response_id, er.body AS response_body,
        r.id AS source_request_id, r.reference, r.question, er.sent_at
      FROM operations.expert_responses er
      JOIN operations.requests r ON r.id = er.request_id
      WHERE er.status = 'sent'
        AND r.question IS NOT NULL AND r.question <> ''
        AND r.consultation_type_id = ${service.consultation_type_id}
        AND r.service_type = ${input.serviceType}
      ORDER BY r.id, er.version DESC
    ) history
    ORDER BY sent_at DESC NULLS LAST
    LIMIT 500
  ` : []
  const similarCandidates = rankSimilarQuestions(input.question, historicalResponses.map((row) => ({
    responseId: String(row.response_id),
    sourceRequestId: String(row.source_request_id),
    reference: String(row.reference),
    question: String(row.question),
    responseBody: String(row.response_body),
    createdAt: row.sent_at ? String(row.sent_at) : '',
  })))
  const assignedExpertId = !similarCandidates.length && expertRows.length
    ? expertRows[crypto.getRandomValues(new Uint32Array(1))[0] % expertRows.length].id
    : null
  if (parsed.files.length > 5) return response({ error: 'Puedes adjuntar máximo 5 imágenes.' }, 400)
  const verifiedFiles = []
  let totalAttachmentBytes = 0
  for (const file of parsed.files) {
    if (file.size > MAX_ATTACHMENT_BYTES) return response({ error: 'Cada adjunto debe ser una imagen de máximo 10 MB.' }, 400)
    totalAttachmentBytes += file.size
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) return response({ error: 'El total de las imágenes no puede superar 25 MB.' }, 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const image = inspectImage(bytes)
    if (!image || (file.type && file.type !== image.type)) return response({ error: 'Uno de los adjuntos no es una imagen válida o supera las dimensiones permitidas.' }, 400)
    verifiedFiles.push({ file, bytes, type: image.type })
  }
  const clientId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const reference = `CRA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  const keyHash = await sha256(idempotencyKey)
  const attachmentHashes = await Promise.all(verifiedFiles.map(({ bytes }) => sha256Bytes(bytes)))
  const payloadHash = await sha256(JSON.stringify({ input, attachmentHashes }))
  const insertedRequest = await sql`
    WITH new_client AS (
      INSERT INTO operations.clients (id, full_name, email_normalized)
      VALUES (${clientId}, ${input.fullName}, ${normalizeClientEmail(input.email)})
      ON CONFLICT (email_normalized) DO UPDATE
        SET email_normalized = EXCLUDED.email_normalized
      RETURNING id
    )
    INSERT INTO operations.requests (
      id, client_id, reference, source, legal_entity_type, email, phone, whatsapp,
      service_name, service_amount_cents, service_currency, service_type, freight_agent, product_type, status,
      source_channel, agent_id, agent_link_id, specialty_id, specialty_name, specialty_description, question,
      general_service_code, general_service_name, consultation_type_id, consultation_type_code, consultation_type_name, consultation_type_description, payment_required,
      assigned_expert_id, public_idempotency_key_hash, public_payload_hash, preferred_locale
    )
    SELECT ${requestId}, new_client.id, ${reference}, ${source}, ${input.legalEntityType},
      ${input.email || null}, ${input.phone || null}, ${input.whatsapp || null},
      ${service.service_name}, ${service.amount_cents}, ${service.currency}, ${input.serviceType}, ${input.freightAgent || null}, ${input.productType}, 'pending',
      ${sourceChannel}, ${agentId}, ${agentLinkId}, NULL, NULL, NULL, ${input.question || null},
      ${input.serviceType}, ${service.service_name}, ${service.consultation_type_id}, ${input.consultationType}, ${service.consultation_name}, ${service.consultation_description}, ${service.payment_required},
      ${assignedExpertId}, ${keyHash}, ${payloadHash}, ${input.locale}
    FROM new_client
    ON CONFLICT (public_idempotency_key_hash) WHERE public_idempotency_key_hash IS NOT NULL DO NOTHING
    RETURNING id, reference
  `
  if (!insertedRequest[0]) {
    await sql`DELETE FROM operations.clients WHERE id = ${clientId} AND NOT EXISTS (SELECT 1 FROM operations.requests WHERE client_id = ${clientId})`
    const existing = await sql`
      SELECT id, reference, payment_required, public_payload_hash, public_submission_completed_at
      FROM operations.requests WHERE public_idempotency_key_hash = ${keyHash} LIMIT 1
    `
    if (!existing[0] || String(existing[0].public_payload_hash) !== payloadHash) {
      return response({ error: 'Este envío ya fue procesado con otra información. Recarga el formulario para iniciar uno nuevo.' }, 409)
    }
    if (!existing[0].public_submission_completed_at) {
      return response({ error: 'La solicitud sigue procesándose. Espera unos segundos y vuelve a enviar el mismo formulario.' }, 409)
    }
    return response({ ok: true, reference: String(existing[0].reference), status: 'pending', paymentRequired: Boolean(existing[0].payment_required) }, 200)
  }

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
  const assignmentRows = await sql`
    INSERT INTO operations.request_assignments (request_id, expert_id, consultation_type_id, candidate_count, strategy, status, reason)
    VALUES (${requestId}, ${assignedExpertId}, ${service.consultation_type_id}, ${expertRows.length}, ${similarCandidates.length ? 'lexical_similarity' : 'random_pool'}, ${similarCandidates.length ? 'similarity_review' : assignedExpertId ? 'assigned' : 'failed'}, ${similarCandidates.length ? 'possible_similar_question' : assignedExpertId ? null : 'no_active_expert'})
    RETURNING id
  `

  if (similarCandidates.length) {
    await sql`INSERT INTO operations.request_similarity_reviews (request_id) VALUES (${requestId})`
    for (const candidate of similarCandidates) {
      await sql`
        INSERT INTO operations.request_similarity_candidates (request_id, response_id, similarity_score, shared_terms)
        VALUES (${requestId}, ${candidate.responseId}, ${candidate.score}, ${candidate.sharedTerms})
      `
    }
  }

  // Si requiere pago y aún está pendiente, la política limita el aviso al admin.
  // Cliente/agente/experto solo se notifican después de la confirmación del pago.
  {
    try { await enqueueNotification(sql, requestId, 'request_created', { env, idempotencyKey: `request_created/${requestId}`, adminOnly: Boolean(service.payment_required) }) } catch (error) { console.error('No se pudo encolar la notificación de solicitud creada:', error.message) }
    if (assignedExpertId && !similarCandidates.length) {
      try { await enqueueNotification(sql, requestId, 'expert_assigned', { env, idempotencyKey: `expert_assigned/${assignmentRows[0].id}` }) } catch (error) { console.error('No se pudo encolar la notificación de asignación inicial:', error.message) }
    }
    if (!service.payment_required && similarCandidates.length) {
      try { await enqueueNotification(sql, requestId, 'similar_question_review', { env, idempotencyKey: `similar_question_review/${requestId}` }) } catch (error) { console.error('No se pudo encolar la revisión de similitud:', error.message) }
    } else if (!service.payment_required && !assignedExpertId) {
      try { await enqueueNotification(sql, requestId, 'assignment_failed', { env, idempotencyKey: `assignment_failed/${requestId}` }) } catch (error) { console.error('No se pudo encolar la asignación fallida:', error.message) }
    }
  }

  await sql`UPDATE operations.requests SET public_submission_completed_at = NOW() WHERE id = ${requestId}`
  return response({ ok: true, reference, status: 'pending', paymentRequired: Boolean(service.payment_required) }, 201)
}

async function enforcePublicRateLimit(request, env, action, limit, windowSeconds) {
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
    return response({ error: 'Has realizado demasiados intentos. Espera antes de volver a intentarlo.' }, 429, { 'retry-after': String(windowSeconds) })
  }
  return null
}

export async function createClientPaymentPreference(request, env, verifiedEmail) {
  return createPaymentPreference(request, env, String(verifiedEmail || '').trim().toLowerCase())
}

async function createPaymentPreference(request, env, verifiedEmail = null) {
  if (!env.NEON_DATABASE_URL || !env.MP_ACCESS_TOKEN) return response({ error: 'El pago no está configurado.' }, 503)
  const body = await request.json().catch(() => ({}))
  const reference = text(body.reference)
  const idempotencyKey = text(body.idempotencyKey)
  const submissionToken = text(body.submissionToken)
  if (!reference) return response({ error: 'Falta la referencia de la solicitud.' }, 400)
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return response({ error: 'La clave de intento de pago no es válida.' }, 400)
  if (!verifiedEmail && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionToken)) {
    return response({ error: 'No se pudo autorizar el pago de esta solicitud.' }, 401)
  }
  const submissionTokenHash = verifiedEmail ? null : await sha256(submissionToken)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  await ensurePaymentSchema(sql)
  const rows = await sql`SELECT id, reference, service_amount_cents, service_currency, payment_required, status, confirmed_payment_attempt_id
    FROM operations.requests WHERE reference = ${reference}
      AND (${verifiedEmail}::text IS NULL OR lower(trim(email)) = ${verifiedEmail})
      AND (${verifiedEmail}::text IS NOT NULL OR (public_idempotency_key_hash = ${submissionTokenHash}
        AND public_submission_completed_at > NOW() - INTERVAL '2 hours')) LIMIT 1`
  if (!rows[0]) return response({ error: 'Solicitud no encontrada.' }, 404)
  if (String(rows[0].service_currency).toUpperCase() !== 'USD') return response({ error: 'La solicitud no tiene un precio USD válido.' }, 400)
  if (!rows[0].payment_required) return response({ error: 'Esta solicitud no requiere pago.' }, 409)
  if (['closed', 'cancelled'].includes(String(rows[0].status))) return response({ error: 'Esta solicitud ya no admite pagos.' }, 409)
  if (rows[0].confirmed_payment_attempt_id) return response({ error: 'Esta solicitud ya tuvo un pago confirmado. Contacta a administración para revisar su estado antes de iniciar otro cobro.' }, 409)
  const approved = await sql`SELECT 1 FROM operations.request_payments WHERE request_id = ${rows[0].id} AND status = 'approved' LIMIT 1`
  if (approved.length) return response({ error: 'Esta solicitud ya tiene un pago confirmado.' }, 409)
  const previousAttempt = await sql`
    SELECT init_point, usd_amount_cents, cop_amount_cents, trm_cop_per_usd, trm_effective_date
    FROM operations.request_payments
    WHERE request_id = ${rows[0].id} AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `
  if (previousAttempt[0]) {
    if (previousAttempt[0].init_point) return paymentPreferenceResponse(previousAttempt[0])
    return response({ error: 'Este intento está en verificación y todavía no se puede reemplazar.' }, 409)
  }
  const latestAttempts = await sql`SELECT id, status, init_point, usd_amount_cents, cop_amount_cents, trm_cop_per_usd, trm_effective_date
    FROM operations.request_payments WHERE request_id = ${rows[0].id} ORDER BY created_at DESC LIMIT 1`
  const latestAttempt = latestAttempts[0]
  if (latestAttempt && ['pending', 'in_process'].includes(String(latestAttempt.status))) {
    if (latestAttempt.init_point) return paymentPreferenceResponse(latestAttempt)
    return response({ error: 'Hay un intento de pago en curso. Espera la confirmación antes de crear otro.' }, 409)
  }
  if (latestAttempt && ['creating', 'creation_uncertain'].includes(String(latestAttempt.status))) {
    return response({ error: 'Estamos verificando si Mercado Pago creó el intento anterior. No inicies otro pago todavía.' }, 409)
  }
  let trm
  try {
    trm = await fetchOfficialTrm()
  } catch (error) {
    console.error('No fue posible consultar la TRM para iniciar el pago:', error.message)
    return response({ error: 'No fue posible consultar la TRM. Inténtalo nuevamente en unos minutos.' }, 503)
  }
  const usdCents = Number(rows[0].service_amount_cents)
  if (!Number.isSafeInteger(usdCents) || usdCents <= 0 || !Number.isFinite(trm.value) || trm.value <= 0) {
    return response({ error: 'El precio o la tasa de conversión no son válidos para iniciar el pago.' }, 409)
  }
  const copPesos = Math.round((usdCents / 100) * trm.value)
  const copCents = copPesos * 100
  const paymentId = crypto.randomUUID()
  const leaseToken = crypto.randomUUID()
  const lease = await sql`UPDATE operations.requests request
    SET payment_preference_lease_token = ${leaseToken}::uuid,
        payment_preference_lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
    WHERE request.id = ${rows[0].id}
      AND (request.payment_preference_lease_expires_at IS NULL OR request.payment_preference_lease_expires_at < NOW())
      AND NOT EXISTS (SELECT 1 FROM operations.request_payments p WHERE p.request_id = request.id AND p.status = 'approved')
      AND NOT EXISTS (SELECT 1 FROM operations.request_payments p WHERE p.request_id = request.id AND p.status IN ('pending', 'in_process', 'creating', 'creation_uncertain'))
    RETURNING request.id`
  if (!lease.length) return response({ error: 'Ya se está preparando un intento de pago para esta solicitud. Espera un momento y actualiza el estado.' }, 409)
  try {
    await sql`INSERT INTO operations.request_payments
      (id, request_id, reference, idempotency_key, usd_amount_cents, trm_cop_per_usd, cop_amount_cents, trm_effective_date, status)
      VALUES (${paymentId}, ${rows[0].id}, ${reference}, ${idempotencyKey}, ${usdCents}, ${trm.value}, ${copCents}, ${trm.date}, 'creating')`
  } catch (error) {
    await sql`UPDATE operations.requests SET payment_preference_lease_token = NULL, payment_preference_lease_expires_at = NULL
      WHERE id = ${rows[0].id} AND payment_preference_lease_token = ${leaseToken}::uuid`
    throw error
  }
  const origin = env.PUBLIC_APP_URL || new URL(request.url).origin
  const paymentReturnUrl = (status) => `${origin}/solicitud/resultado-pago?payment=${status}&reference=${encodeURIComponent(reference)}`
  let preference
  try {
    preference = await mercadoPago('/checkout/preferences', env.MP_ACCESS_TOKEN, {
      items: [{ id: reference, title: `Asesoría ${reference}`, quantity: 1, currency_id: 'COP', unit_price: copPesos }],
      external_reference: reference,
      back_urls: { success: paymentReturnUrl('success'), failure: paymentReturnUrl('failure'), pending: paymentReturnUrl('pending') },
      auto_return: 'approved',
      notification_url: `${origin}/api/public/payments/webhook`,
    })
  } catch (error) {
    const providerStatus = Number(error.status)
    const creationStatus = providerStatus >= 400 && providerStatus < 500 && ![408, 429].includes(providerStatus)
      ? 'creation_failed'
      : 'creation_uncertain'
    await sql`UPDATE operations.request_payments SET status = ${creationStatus}, updated_at = NOW() WHERE id = ${paymentId} AND status = 'creating'`
    await sql`UPDATE operations.requests SET payment_preference_lease_token = NULL, payment_preference_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${rows[0].id} AND payment_preference_lease_token = ${leaseToken}::uuid`
    console.error('Mercado Pago no pudo crear la preferencia:', error.message)
    return response({ error: 'No fue posible iniciar el checkout. Puedes volver a intentarlo.' }, 502)
  }
  if (!preference.id || !preference.init_point) {
    await sql`UPDATE operations.request_payments SET status = 'creation_uncertain', updated_at = NOW() WHERE id = ${paymentId} AND status = 'creating'`
    await sql`UPDATE operations.requests SET payment_preference_lease_token = NULL, payment_preference_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${rows[0].id} AND payment_preference_lease_token = ${leaseToken}::uuid`
    return response({ error: 'Mercado Pago devolvió un intento incompleto; validaremos el estado antes de reintentar.' }, 502)
  }
  const saved = await sql`UPDATE operations.request_payments
    SET mercado_pago_preference_id = ${preference.id}, init_point = ${preference.init_point}, status = 'pending', updated_at = NOW()
    WHERE id = ${paymentId} AND status = 'creating' RETURNING id`
  await sql`UPDATE operations.requests SET payment_preference_lease_token = NULL, payment_preference_lease_expires_at = NULL, updated_at = NOW()
    WHERE id = ${rows[0].id} AND payment_preference_lease_token = ${leaseToken}::uuid`
  if (!saved.length) return response({ error: 'Se creó el intento, pero estamos verificando su registro. Actualiza el estado antes de continuar.' }, 409)
  return response({ initPoint: preference.init_point, usdAmountCents: usdCents, copAmountCents: copCents, trm: trm.value, trmDate: trm.date })
}

async function handlePaymentWebhook(request, env) {
  if (!env.NEON_DATABASE_URL || !env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET) return response({ error: 'El webhook de pagos no está configurado.' }, 503)
  const url = new URL(request.url)
  const signatureId = url.searchParams.get('data.id') || ''
  if (!await verifyMercadoPagoWebhookSignature(request.headers.get('x-signature') || '', request.headers.get('x-request-id') || '', signatureId, env.MP_WEBHOOK_SECRET)) {
    logPaymentSecurityEvent('payment_webhook_signature_rejected')
    return response({ error: 'Firma de webhook inválida.' }, 401)
  }
  const payload = await request.json().catch(() => ({}))
  const paymentId = text(payload.data?.id || signatureId)
  if (!paymentId) return response({ ok: true })
  if (String(paymentId) !== String(signatureId)) {
    logPaymentSecurityEvent('payment_webhook_resource_mismatch')
    return response({ error: 'El recurso firmado no coincide con el evento.' }, 401)
  }
  const payment = await mercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, env.MP_ACCESS_TOKEN)
  const result = await recordVerifiedPayment(payment, paymentId, env, null, 'webhook')
  if (!result.matched) logPaymentSecurityEvent('payment_webhook_payment_mismatch')
  if (result.approved) logPaymentSecurityEvent('payment_webhook_payment_approved')
  return response({ ok: true })
}

async function verifyReturnedPayment(request, env) {
  if (!env.NEON_DATABASE_URL || !env.MP_ACCESS_TOKEN) return response({ error: 'La verificación de pagos no está configurada.' }, 503)
  const body = await request.json().catch(() => ({}))
  const paymentId = text(body.paymentId)
  const reference = text(body.reference)
  if (!/^\d{1,32}$/.test(paymentId) || !/^CRA-[A-Z0-9-]{8,40}$/i.test(reference)) {
    return response({ error: 'La referencia de pago no es válida.' }, 400)
  }
  let payment
  try {
    payment = await mercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, env.MP_ACCESS_TOKEN)
  } catch (error) {
    console.error('No se pudo verificar el pago al regresar de Mercado Pago:', error.message)
    return response({ error: 'No fue posible confirmar el pago. Actualiza el estado en unos minutos.' }, 502)
  }
  if (String(payment.external_reference || '') !== reference) return response({ error: 'El pago no corresponde a esta solicitud.' }, 409)
  const result = await recordVerifiedPayment(payment, paymentId, env, null, 'browser_return')
  if (!result.matched) return response({ error: 'El pago no coincide con el valor registrado para esta solicitud.' }, 409)
  return response({ ok: true, reference, status: result.status })
}

export async function refreshRequestPayment(sql, requestId, env) {
  if (!env.MP_ACCESS_TOKEN) throw new Error('La consulta de pagos de Mercado Pago no está configurada.')
  const rows = await sql`SELECT id, reference FROM operations.requests WHERE id = ${requestId} LIMIT 1`
  if (!rows[0]) return null
  const reference = String(rows[0].reference)
  const search = await mercadoPago(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=50&offset=0`, env.MP_ACCESS_TOKEN)
  const payments = Array.isArray(search.results) ? search.results : []
  for (const payment of payments) {
    const result = await recordVerifiedPayment(payment, String(payment.id || ''), env, sql, 'list_reconcile')
    if (result.matched && result.status === 'approved') return { reference, status: 'approved' }
  }
  const latest = await sql`
    SELECT status FROM operations.request_payments
    WHERE request_id = ${requestId}
    ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1
  `
  return { reference, status: String(latest[0]?.status || 'pending') }
}

export async function verifyRequestPayment(sql, requestId, env, actorId = null) {
  const requests = await sql`SELECT id, reference FROM operations.requests WHERE id = ${requestId} LIMIT 1`
  if (!requests[0]) return null
  const request = requests[0]
  const attempts = await sql`
    SELECT id, request_id, reference, cop_amount_cents, mercado_pago_preference_id, status, provider_updated_at
    FROM operations.request_payments WHERE request_id = ${requestId}
    ORDER BY created_at DESC
  `
  if (!attempts.length) {
    await writePaymentDiagnostic(sql, { requestId, actorId, source: 'admin_verify', reference: request.reference, matchStatus: 'not_found', reasonCode: 'no_local_attempt' })
    return { status: 'not_started', reconciled: false, reasonCode: 'no_local_attempt' }
  }
  if (!env.MP_ACCESS_TOKEN) throw new Error('La consulta de pagos de Mercado Pago no está configurada.')
  let payments
  try {
    const search = await mercadoPago(`/v1/payments/search?external_reference=${encodeURIComponent(String(request.reference))}&sort=date_created&criteria=desc&limit=50&offset=0`, env.MP_ACCESS_TOKEN)
    payments = Array.isArray(search.results) ? search.results : []
  } catch {
    await writePaymentDiagnostic(sql, { requestId, actorId, source: 'admin_verify', reference: request.reference, matchStatus: 'not_found', reasonCode: 'provider_unavailable' })
    return { status: 'unknown', reconciled: false, reasonCode: 'provider_unavailable' }
  }
  if (!payments.length) {
    await writePaymentDiagnostic(sql, { requestId, actorId, source: 'admin_verify', reference: request.reference, matchStatus: 'not_found', reasonCode: 'payment_not_found' })
    return { status: 'not_found', reconciled: false, reasonCode: 'payment_not_found' }
  }
  let lastResult = null
  for (const payment of payments) {
    const result = await recordVerifiedPayment(payment, String(payment.id || ''), env, sql, 'admin_verify', requestId, actorId, request.reference)
    if (result.matched && result.status === 'approved') {
      return {
        status: 'approved', reconciled: result.reconciled,
        payment: safePaymentSummary(payment, result.expectedAmountCents),
        reasonCode: result.reconciled ? 'payment_reconciled' : 'already_approved',
      }
    }
    if (result.matched || !lastResult) lastResult = result
  }
  return {
    status: lastResult?.status || 'pending',
    reconciled: false,
    reasonCode: lastResult?.reasonCode || 'payment_not_approved',
    payment: lastResult?.payment || null,
    expectedAmountCents: lastResult?.expectedAmountCents ?? null,
  }
}

async function recordVerifiedPayment(payment, paymentId, env, database = null, source = 'webhook', targetRequestId = null, actorId = null, targetReference = null) {
  const reference = text(payment.external_reference)
  const sql = database || (await import('@neondatabase/serverless')).neon(env.NEON_DATABASE_URL)
  const candidates = reference ? await sql`
    SELECT id, request_id, reference, cop_amount_cents, mercado_pago_preference_id, status, provider_updated_at
    FROM operations.request_payments WHERE reference = ${reference}
    ORDER BY created_at DESC
  ` : []
  const providerPreferenceId = text(payment.preference_id)
  const record = providerPreferenceId
    ? candidates.find((item) => String(item.mercado_pago_preference_id || '') === providerPreferenceId) || null
    : candidates[0] || null
  const expectedAttempt = record || candidates[0] || null
  const reasonCode = paymentMatchReason(payment, expectedAttempt, targetReference)
  const resolvedRequestId = targetRequestId || expectedAttempt?.request_id || null
  const observedStatus = String(payment.status || '').toLowerCase()
  const diagnosticReason = reasonCode && reasonCode !== 'payment_not_approved'
    ? reasonCode
    : observedStatus === 'approved' ? 'verified' : `payment_${observedStatus || 'unknown'}`
  await writePaymentDiagnostic(sql, {
    requestId: resolvedRequestId,
    actorId,
    source,
    reference,
    paymentId,
    preferenceId: payment.preference_id,
    paymentStatus: payment.status,
    currency: payment.currency_id,
    amountCents: Number.isFinite(Number(payment.transaction_amount)) ? Math.round(Number(payment.transaction_amount) * 100) : null,
    expectedAmountCents: expectedAttempt?.cop_amount_cents,
    matchStatus: reasonCode && reasonCode !== 'payment_not_approved' ? 'mismatch' : expectedAttempt ? 'matched' : 'unmatched',
    reasonCode: diagnosticReason,
  })
  if (!record || reasonCode && reasonCode !== 'payment_not_approved') {
    return {
      matched: false, approved: false, reconciled: false,
      status: text(payment.status) || 'unknown', reasonCode: reasonCode || 'no_local_attempt',
      payment: safePaymentSummary(payment, expectedAttempt?.cop_amount_cents),
      expectedAmountCents: expectedAttempt ? Number(expectedAttempt.cop_amount_cents) : null,
    }
  }
  const normalizedStatus = String(payment.status || '').toLowerCase()
  const status = ['approved', 'rejected', 'cancelled', 'refunded', 'charged_back', 'in_process', 'pending'].includes(normalizedStatus)
    ? normalizedStatus
    : 'pending'
  const providerUpdatedAt = validProviderTimestamp(payment.date_last_updated)
  if (record.provider_updated_at && !providerUpdatedAt) {
    const current = await sql`SELECT status FROM operations.request_payments WHERE id = ${record.id} LIMIT 1`
    await writePaymentDiagnostic(sql, {
      requestId: record.request_id, actorId, source, reference, paymentId,
      preferenceId: payment.preference_id, paymentStatus: payment.status, currency: payment.currency_id,
      expectedAmountCents: record.cop_amount_cents, matchStatus: 'unverified', reasonCode: 'provider_updated_at_missing',
    })
    return {
      matched: true, approved: String(current[0]?.status || record.status) === 'approved', reconciled: false,
      status: String(current[0]?.status || record.status), reasonCode: 'provider_updated_at_missing',
      payment: safePaymentSummary(payment, record.cop_amount_cents), expectedAmountCents: Number(record.cop_amount_cents),
    }
  }
  const updated = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT payment.id, payment.request_id
      FROM operations.request_payments payment
      WHERE payment.id = ${record.id}
        AND (
          payment.provider_updated_at IS NULL
          OR (${providerUpdatedAt}::timestamptz IS NOT NULL AND ${providerUpdatedAt}::timestamptz > payment.provider_updated_at)
          OR (${providerUpdatedAt}::timestamptz = payment.provider_updated_at AND payment.status = ${status})
        )
      FOR UPDATE
    ), claimed AS (
      UPDATE operations.requests request
      SET confirmed_payment_attempt_id = eligible.id, updated_at = NOW()
      FROM eligible
      WHERE request.id = eligible.request_id AND ${status} = 'approved'
        AND (request.confirmed_payment_attempt_id IS NULL OR request.confirmed_payment_attempt_id = eligible.id)
      RETURNING request.id
    ), claim_state AS (
      SELECT EXISTS (SELECT 1 FROM claimed) AS accepted
    ), changed AS (
      UPDATE operations.request_payments payment
      SET mercado_pago_payment_id = ${paymentId},
          status = CASE WHEN ${status} = 'approved' AND NOT claim_state.accepted THEN 'duplicate_approved' ELSE ${status} END,
          provider_updated_at = COALESCE(${providerUpdatedAt}::timestamptz, payment.provider_updated_at),
          updated_at = NOW()
      FROM eligible CROSS JOIN claim_state
      WHERE payment.id = eligible.id
      RETURNING payment.request_id, payment.status
    )
    SELECT changed.request_id, changed.status FROM changed
  `
  if (!updated[0]) {
    const current = await sql`SELECT status FROM operations.request_payments WHERE id = ${record.id} LIMIT 1`
    await writePaymentDiagnostic(sql, {
      requestId: record.request_id, actorId, source, reference, paymentId,
      preferenceId: payment.preference_id, paymentStatus: payment.status, currency: payment.currency_id,
      expectedAmountCents: record.cop_amount_cents, matchStatus: 'stale', reasonCode: 'stale_provider_update',
    })
    return {
      matched: true, approved: String(current[0]?.status || record.status) === 'approved', reconciled: false,
      status: String(current[0]?.status || record.status), reasonCode: 'stale_provider_update',
      payment: safePaymentSummary(payment, record.cop_amount_cents), expectedAmountCents: Number(record.cop_amount_cents),
    }
  }
  if (updated[0].status === 'duplicate_approved') {
    await writePaymentDiagnostic(sql, {
      requestId: record.request_id, actorId, source, reference, paymentId,
      preferenceId: payment.preference_id, paymentStatus: payment.status,
      currency: payment.currency_id,
      amountCents: Number.isFinite(Number(payment.transaction_amount)) ? Math.round(Number(payment.transaction_amount) * 100) : null,
      expectedAmountCents: record.cop_amount_cents,
      matchStatus: 'mismatch', reasonCode: 'duplicate_approved_attempt',
    })
    return {
      matched: true, approved: false, reconciled: false, status: 'duplicate_approved',
      reasonCode: 'duplicate_approved_attempt',
      payment: safePaymentSummary(payment, record.cop_amount_cents),
      expectedAmountCents: Number(record.cop_amount_cents),
    }
  }
  if (updated[0]?.request_id && status === 'approved') {
    try { await enqueueNotification(sql, updated[0].request_id, 'payment_approved', { env, idempotencyKey: `payment_approved/${updated[0].request_id}`, actorId, retryFailed: source === 'admin_verify' }) }
    catch (error) { console.error(JSON.stringify({ event: 'payment_approval_email_enqueue_failed', severity: 'error', requestId: String(updated[0].request_id), errorCode: 'outbox_enqueue_failed' })) }
  } else if (updated[0]?.request_id && ['rejected', 'cancelled'].includes(status) && record.status !== status) {
    try { await enqueueNotification(sql, updated[0].request_id, 'payment_rejected', { env, idempotencyKey: `payment_rejected/${paymentId}` }) }
    catch (error) { console.error(JSON.stringify({ event: 'payment_failure_email_enqueue_failed', severity: 'error', requestId: String(updated[0].request_id), errorCode: 'outbox_enqueue_failed' })) }
  }
  return {
    matched: true,
    approved: Boolean(updated[0]?.request_id && status === 'approved'),
    reconciled: status === 'approved' && record.status !== 'approved',
    status: String(updated[0]?.status || record.status || status),
    reasonCode: status === 'approved' ? (record.status === 'approved' ? 'already_approved' : 'payment_reconciled') : ['refunded', 'charged_back'].includes(status) ? `payment_${status}` : 'payment_not_approved',
    payment: safePaymentSummary(payment, record.cop_amount_cents),
    expectedAmountCents: Number(record.cop_amount_cents),
  }
}

export function paymentMatchReason(payment, attempt, targetReference = null) {
  if (!payment.external_reference) return 'missing_external_reference'
  if (targetReference && String(payment.external_reference) !== String(targetReference)) return 'reference_mismatch'
  if (!attempt) return 'no_local_attempt'
  if (String(payment.external_reference) !== String(attempt.reference)) return 'reference_mismatch'
  // Some approved Checkout Pro payment resources omit preference_id. In that
  // case the resource was still fetched with our access token, so the exact
  // external reference, currency and amount remain the authoritative match.
  // A preference explicitly returned by Mercado Pago must always match.
  if (payment.preference_id && String(payment.preference_id) !== String(attempt.mercado_pago_preference_id || '')) return 'preference_mismatch'
  if (String(payment.currency_id || '').toUpperCase() !== 'COP') return 'currency_mismatch'
  const amountCents = Math.round(Number(payment.transaction_amount) * 100)
  if (!Number.isFinite(amountCents) || amountCents !== Number(attempt.cop_amount_cents)) return 'amount_mismatch'
  return String(payment.status || '').toLowerCase() === 'approved' ? null : 'payment_not_approved'
}

function safePaymentSummary(payment, expectedAmountCents = null) {
  const safeText = (value) => value == null ? '' : String(value).slice(0, 100)
  return {
    paymentId: safeText(payment.id),
    preferenceId: safeText(payment.preference_id),
    status: safeText(payment.status).slice(0, 40),
    currency: safeText(payment.currency_id).slice(0, 8),
    amountCents: Number.isFinite(Number(payment.transaction_amount)) ? Math.round(Number(payment.transaction_amount) * 100) : null,
    expectedAmountCents: expectedAmountCents == null ? null : Number(expectedAmountCents),
  }
}

async function writePaymentDiagnostic(sql, diagnostic) {
  await sql`
    INSERT INTO operations.payment_event_diagnostics (
      request_id, actor_id, source, reference, payment_id, preference_id, payment_status,
      currency, amount_cents, expected_cop_cents, match_status, reason_code
    ) VALUES (
      ${diagnostic.requestId || null}, ${diagnostic.actorId || null}, ${diagnostic.source}, ${text(diagnostic.reference).slice(0, 120) || null},
      ${text(diagnostic.paymentId).slice(0, 80) || null}, ${text(diagnostic.preferenceId).slice(0, 100) || null},
      ${text(diagnostic.paymentStatus).slice(0, 40) || null}, ${text(diagnostic.currency).slice(0, 8) || null},
      ${Number.isSafeInteger(diagnostic.amountCents) ? diagnostic.amountCents : null},
      ${diagnostic.expectedAmountCents != null && Number.isSafeInteger(Number(diagnostic.expectedAmountCents)) ? Number(diagnostic.expectedAmountCents) : null},
      ${diagnostic.matchStatus}, ${diagnostic.reasonCode}
    )
  `
}

function logPaymentSecurityEvent(event) {
  const allowedEvents = new Set([
    'payment_webhook_signature_rejected',
    'payment_webhook_resource_mismatch',
    'payment_webhook_payment_mismatch',
    'payment_webhook_payment_approved',
  ])
  if (!allowedEvents.has(event)) return
  const severity = event.endsWith('_approved') ? 'info' : 'warning'
  const entry = JSON.stringify({ event, severity, eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() })
  if (severity === 'info') console.info(entry)
  else console.error(entry)
}

async function ensurePaymentSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS operations.request_payments (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
    reference TEXT NOT NULL,
    idempotency_key TEXT,
    usd_amount_cents INTEGER NOT NULL,
    trm_cop_per_usd NUMERIC(14,4) NOT NULL,
    cop_amount_cents INTEGER NOT NULL,
    trm_effective_date DATE NOT NULL,
    mercado_pago_preference_id TEXT,
    init_point TEXT,
    mercado_pago_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`ALTER TABLE operations.request_payments DROP CONSTRAINT IF EXISTS request_payments_reference_key`
  await sql`ALTER TABLE operations.request_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT`
  await sql`ALTER TABLE operations.request_payments ADD COLUMN IF NOT EXISTS init_point TEXT`
  await sql`ALTER TABLE operations.request_payments ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS request_payments_request_attempt_idx ON operations.request_payments(request_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS request_payments_request_id_idx ON operations.request_payments(request_id)`
}

export async function verifyMercadoPagoWebhookSignature(signatureHeader, requestId, dataId, secret) {
  if (!signatureHeader || !requestId || !dataId || !secret) return false
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => part.trim().split('=', 2)))
  if (!/^\d+$/.test(parts.ts || '') || !/^[a-f\d]{64}$/i.test(parts.v1 || '')) return false
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return constantTimeEqual(expected, parts.v1.toLowerCase())
}

export function matchesExpectedPayment(payment, reference, record) {
  const paidCents = Math.round(Number(payment.transaction_amount) * 100)
  return String(payment.external_reference || '') === String(reference)
    && (!payment.preference_id || String(payment.preference_id) === String(record.mercado_pago_preference_id || ''))
    && String(payment.currency_id || '').toUpperCase() === 'COP'
    && Number.isFinite(paidCents)
    && paidCents === Number(record.cop_amount_cents)
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

function validProviderTimestamp(value) {
  if (typeof value !== 'string' || !value) return null
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

function paymentPreferenceResponse(attempt) {
  return response({
    initPoint: String(attempt.init_point),
    usdAmountCents: Number(attempt.usd_amount_cents),
    copAmountCents: Number(attempt.cop_amount_cents),
    trm: Number(attempt.trm_cop_per_usd),
    trmDate: String(attempt.trm_effective_date),
  })
}

async function mercadoPago(path, token, body) {
  const result = await fetch(`https://api.mercadopago.com${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
  const data = await result.json().catch(() => ({}))
  if (!result.ok) { const error = new Error(data.message || 'Mercado Pago rechazó la operación.'); error.status = result.status; throw error }
  return data
}

async function fetchOfficialTrm() {
  const endpoint = 'https://www.superfinanciera.gov.co/SuperfinancieraWebServiceTRM/TCRMServicesWebService/TCRMServicesWebService'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://action.trm.services.generic.action.superfinanciera.nexura.sc.com.co/"><soap:Body><tns:queryTCRM><tns:tcrmQueryAssociatedDate>${today}</tns:tcrmQueryAssociatedDate></tns:queryTCRM></soap:Body></soap:Envelope>`
  const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: '""' }, body: soap })
  const xml = await result.text()
  const value = Number((xml.match(/<valor>([^<]+)/i) || [])[1])
  const resolvedValue = Number.isFinite(value) ? value : Number((xml.match(/<value>([^<]+)/i) || [])[1])
  const date = (xml.match(/<fecha>([^<]+)/i) || xml.match(/<validityFrom>([^<]+)/i) || [])[1]
  if (!result.ok || !Number.isFinite(resolvedValue) || !date) throw new Error('No fue posible obtener la TRM oficial.')
  return { value: resolvedValue, date: date.slice(0, 10) }
}

export function validate(payload) {
  const fullName = text(payload.fullName)
  const legalEntityType = text(payload.legalEntityType)
  const email = text(payload.email).toLowerCase()
  const phone = normalizePhone(payload.phone, 'El teléfono')
  const whatsapp = normalizePhone(payload.whatsapp, 'El WhatsApp')
  const serviceType = text(payload.serviceType)
  const consultationType = text(payload.consultationType)
  const productType = text(payload.productType)
  const question = text(payload.question)
  const agentToken = text(payload.attributionToken || payload.agentToken)

  if (!fullName) throw new RequestError('El nombre completo es obligatorio.')
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(fullName)) throw new RequestError('El nombre debe tener entre 2 y 120 caracteres y solo puede contener letras, espacios, puntos o guiones.')
  if (!['natural', 'juridica'].includes(legalEntityType)) throw new RequestError('Selecciona la constitución legal.')
  if (!email) throw new RequestError('El correo electrónico es obligatorio.')
  if (email.length > 254 || /[\u0000-\u001F\u007F<>]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new RequestError('Ingresa un correo electrónico válido.')
  if (!['exportacion', 'importacion', 'agente_carga'].includes(serviceType)) throw new RequestError('Selecciona el tipo de servicio.')
  if (!consultationType) throw new RequestError('Selecciona el tipo de consulta.')
  if (!['vehiculos', 'mercancias'].includes(productType)) throw new RequestError('Selecciona el tipo de producto.')
  if (!question) throw new RequestError('Cuéntanos qué necesitas consultar.')
  if (question.length < 20 || question.length > 3000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(question)) throw new RequestError('La consulta debe tener entre 20 y 3000 caracteres.')

  return { fullName, legalEntityType, email, phone, whatsapp, serviceType, consultationType, freightAgent: null, productType, question, agentToken }
}

function createOpaqueToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
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

async function verifyTurnstile(token, request, secret) {
  let result
  try {
    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!verifyResponse.ok) return false
    result = await verifyResponse.json()
  } catch (error) {
    console.error('No se pudo validar Turnstile:', error.message)
    return false
  }
  return result.success === true
    && result.hostname === new URL(request.url).hostname
    && result.action === 'request_create'
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

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let binary = ''
  digest.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
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

function response(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_REQUEST_BODY_BYTES = 35 * 1024 * 1024
