import { requireOperationsAuth } from './operationsAuth.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function handleOperationsAttachments(request, env) {
  const match = new URL(request.url).pathname.match(/^\/api\/app\/requests\/([^/]+)\/attachments\/([^/]+)$/)
  if (!match || request.method !== 'GET') return null
  if (!uuidPattern.test(match[1]) || !uuidPattern.test(match[2])) return response({ error: 'Adjunto no encontrado.' }, 404)

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.permissions?.includes('attachments.read')) return response({ error: 'No tienes permisos para consultar adjuntos.' }, 403)
  const isAdmin = claims.roles?.includes('admin')
  const isExpert = claims.roles?.includes('expert') && !isAdmin
  if (!isAdmin && !isExpert) return response({ error: 'No tienes acceso a este adjunto.' }, 403)
  if (!env.NEON_DATABASE_URL || !env.GALLERY_IMAGES) return response({ error: 'Almacenamiento no disponible.' }, 503)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const rows = await sql`
    SELECT a.storage_key, a.mime_type, a.original_name
    FROM operations.request_attachments a
    JOIN operations.requests r ON r.id = a.request_id
    WHERE a.id = ${match[2]}::uuid AND r.id = ${match[1]}::uuid AND a.status = 'available'
      AND a.storage_key LIKE ${`requests/${match[1]}/%`}
      AND (
        ${isAdmin} OR (
          r.assigned_expert_id = ${claims.sub}::uuid
          AND (r.payment_required = FALSE OR EXISTS (
            SELECT 1 FROM operations.request_payments p WHERE p.request_id = r.id AND p.status = 'approved'
          ))
          AND EXISTS (
            SELECT 1 FROM operations.users u
            JOIN operations.user_roles ur ON ur.user_id = u.id
            JOIN operations.roles role ON role.id = ur.role_id AND role.name = 'expert'
            WHERE u.id = ${claims.sub}::uuid AND u.active = TRUE
          )
        )
      )
    LIMIT 1
  `
  if (!rows[0] || !/^image\/(jpeg|png|webp)$/.test(String(rows[0].mime_type))) {
    return response({ error: 'Adjunto no encontrado.' }, 404)
  }
  const object = await env.GALLERY_IMAGES.get(String(rows[0].storage_key))
  if (!object) return response({ error: 'Adjunto no encontrado.' }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': String(rows[0].mime_type),
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment',
    },
  })
}

function response(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
