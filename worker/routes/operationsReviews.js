import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsReviews(request, env) {
  const url = new URL(request.url)
  const isList = url.pathname === '/api/app/reviews/responses' && request.method === 'GET'
  const match = url.pathname.match(/^\/api\/app\/reviews\/responses\/([^/]+)$/)
  const isUpdate = Boolean(match) && request.method === 'PUT'
  if (!isList && !isUpdate) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims?.permissions?.includes('responses.review')) return response({ error: 'No tienes permisos para revisar respuestas.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  if (isList) {
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), 50)
    const offset = (page - 1) * pageSize
    const [countRows, rows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM operations.expert_responses WHERE status = 'pending_admin_review'`,
      sql`SELECT er.id, er.request_id, er.version, er.body, er.status, er.created_at,
          r.reference, r.service_type, r.consultation_type_name, r.email,
          c.full_name AS client_name, u.full_name AS expert_name
        FROM operations.expert_responses er
        JOIN operations.requests r ON r.id = er.request_id
        JOIN operations.clients c ON c.id = r.client_id
        JOIN operations.users u ON u.id = er.expert_id
        WHERE er.status = 'pending_admin_review'
        ORDER BY er.created_at ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
    ])
    return response({ items: rows.map(serializeReview), pagination: pagination(page, pageSize, countRows[0]?.total) })
  }

  const input = await request.json().catch(() => ({}))
  const action = text(input.action)
  const adminNote = text(input.adminNote)
  if (!['approve', 'reject'].includes(action)) return response({ error: 'Acción de revisión inválida.' }, 400)
  const rows = await sql`
    SELECT er.id, er.request_id, er.body, er.status, r.reference, r.email, c.full_name AS client_name
    FROM operations.expert_responses er
    JOIN operations.requests r ON r.id = er.request_id
    JOIN operations.clients c ON c.id = r.client_id
    WHERE er.id = ${match[1]}
    LIMIT 1
  `
  if (!rows[0]) return response({ error: 'Respuesta no encontrada.' }, 404)
  if (rows[0].status !== 'pending_admin_review') return response({ error: 'La respuesta ya fue revisada.' }, 409)

  if (action === 'reject') {
    const updated = await sql`
      UPDATE operations.expert_responses
      SET status = 'rejected', admin_note = ${adminNote || null}, reviewed_by = ${claims.sub}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${match[1]}
      RETURNING id, status, admin_note
    `
    await sql`UPDATE operations.requests SET status = 'in_progress', updated_at = NOW() WHERE id = ${rows[0].request_id}`
    return response({ ok: true, response: { id: String(updated[0].id), status: String(updated[0].status), adminNote: updated[0].admin_note || '' } })
  }

  const approved = await sql`
    UPDATE operations.expert_responses
    SET status = 'approved', admin_note = ${adminNote || null}, reviewed_by = ${claims.sub}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${match[1]}
    RETURNING id, status, admin_note
  `
  let sent = false
  let reason = ''
  let feedbackUrl = ''
  if (rows[0].email && (env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY) && env.RESEND_FROM_EMAIL) {
    try {
      const feedbackToken = randomToken()
      await sql`INSERT INTO operations.client_feedback (request_id, response_id, token_hash) VALUES (${rows[0].request_id}, ${match[1]}, ${await sha256(feedbackToken)})`
      feedbackUrl = `${env.PUBLIC_APP_URL || 'https://cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev'}/feedback?token=${encodeURIComponent(feedbackToken)}`
      await sendApprovedResponse(env, rows[0], adminNote, feedbackUrl)
      await sql`UPDATE operations.expert_responses SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = ${match[1]}`
      sent = true
    } catch (error) { reason = error.message }
  } else {
    reason = rows[0].email ? 'Falta configurar el correo de operaciones.' : 'El cliente no tiene correo registrado.'
  }
  await sql`UPDATE operations.requests SET status = 'closed', updated_at = NOW() WHERE id = ${rows[0].request_id}`
  return response({ ok: true, sent, reason, response: { id: String(approved[0].id), status: sent ? 'sent' : 'approved', adminNote: approved[0].admin_note || '' } })
}

async function sendApprovedResponse(env, row, adminNote, feedbackUrl) {
  const subject = `Respuesta a tu solicitud · ${row.reference}`
  const textBody = [`Hola ${row.client_name},`, '', row.body, adminNote ? `\nNota de administración:\n${adminNote}` : '', '', 'Gracias por confiar en Cortés Rodríguez Asesores.'].join('\n')
  const feedbackText = feedbackUrl ? `\n\nEvalúa esta respuesta: ${feedbackUrl}` : ''
  const html = `<p>Hola ${escapeHtml(row.client_name)},</p><div>${escapeHtml(row.body).replaceAll('\n', '<br />')}</div>${adminNote ? `<p><strong>Nota de administración:</strong><br />${escapeHtml(adminNote).replaceAll('\n', '<br />')}</p>` : ''}${feedbackUrl ? `<p>¿Cómo fue tu experiencia? <a href="${escapeHtml(feedbackUrl)}">Déjanos tu feedback</a>.</p>` : ''}<p>Gracias por confiar en Cortés Rodríguez Asesores.</p>`
  const result = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_OPERATIONS_API_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [row.email], subject, text: `${textBody}${feedbackText}`, html }) })
  const body = await result.json().catch(() => ({}))
  if (!result.ok || !body.id) throw new Error(body.message || 'Resend no aceptó el envío.')
}

function serializeReview(row) { return { id: String(row.id), requestId: String(row.request_id), reference: String(row.reference), version: Number(row.version), body: String(row.body), status: String(row.status), serviceType: String(row.service_type), consultationType: row.consultation_type_name ? String(row.consultation_type_name) : '', clientName: String(row.client_name), clientEmail: row.email ? String(row.email) : '', expertName: String(row.expert_name), createdAt: String(row.created_at) } }
function pagination(page, pageSize, totalValue) { const totalItems = Number(totalValue || 0); return { page, pageSize, totalItems, totalPages: Math.max(Math.ceil(totalItems / pageSize), 1) } }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
async function sha256(value) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
