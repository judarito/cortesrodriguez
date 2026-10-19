export async function handlePublicFeedback(request, env) {
  const url = new URL(request.url)
  const token = String(url.searchParams.get('token') || '').trim()
  const isGet = url.pathname === '/api/public/feedback' && request.method === 'GET'
  const isPost = url.pathname === '/api/public/feedback' && request.method === 'POST'
  if (!isGet && !isPost) return null
  if (!token) return response({ error: 'El enlace de feedback no es válido.' }, 400)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const rows = await sql`
    SELECT f.id, f.rating, f.comment, f.status, r.reference, r.consultation_type_name
    FROM operations.client_feedback f
    JOIN operations.requests r ON r.id = f.request_id
    WHERE f.token_hash = ${await sha256(token)}
    LIMIT 1
  `
  if (!rows[0]) return response({ error: 'El enlace de feedback no es válido o ya no está disponible.' }, 404)
  if (isGet) return response({ reference: String(rows[0].reference), consultationType: rows[0].consultation_type_name ? String(rows[0].consultation_type_name) : '', submitted: Boolean(rows[0].rating), rating: rows[0].rating ? Number(rows[0].rating) : null })

  if (rows[0].rating) return response({ error: 'Ya registramos el feedback para esta respuesta.' }, 409)
  const input = await request.json().catch(() => ({}))
  const rating = Number(input.rating)
  const comment = text(input.comment)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response({ error: 'La calificación debe estar entre 1 y 5.' }, 400)
  if (comment.length > 5000) return response({ error: 'El comentario no puede superar 5.000 caracteres.' }, 400)
  const status = rating <= 3 ? 'escalated' : 'received'
  await sql`UPDATE operations.client_feedback SET rating = ${rating}, comment = ${comment || null}, status = ${status}, received_at = NOW() WHERE id = ${rows[0].id}`
  return response({ ok: true, status })
}

async function sha256(value) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
