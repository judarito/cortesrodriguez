import { requireOperationsAuth } from './operationsAuth.js'

export async function handleOperationsSecurity(request, env) {
  const url = new URL(request.url)
  const isUsers = url.pathname === '/api/app/security/users' && request.method === 'GET'
  const isRoles = url.pathname === '/api/app/security/roles' && request.method === 'GET'
  const createUser = url.pathname === '/api/app/security/users' && request.method === 'POST'
  const createRole = url.pathname === '/api/app/security/roles' && request.method === 'POST'
  if (!isUsers && !isRoles && !createUser && !createRole) return null

  const claims = await requireOperationsAuth(request, env)
  if (!claims) return response({ error: 'Sesión requerida.' }, 401)
  if (!claims.permissions?.includes('users.manage')) return response({ error: 'No tienes permisos para administrar seguridad.' }, 403)
  if (!env.NEON_DATABASE_URL) return response({ error: 'La base de datos operativa no está configurada.' }, 500)

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)

  if (isUsers) {
    const users = await sql`
      SELECT u.id, u.email, u.full_name, u.active, u.created_at,
        COALESCE(string_agg(r.label, ', ' ORDER BY r.label), '') AS roles
      FROM operations.users u
      LEFT JOIN operations.user_roles ur ON ur.user_id = u.id
      LEFT JOIN operations.roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `
    return response({ items: users.map((row) => ({ id: String(row.id), email: String(row.email), fullName: String(row.full_name), active: Boolean(row.active), createdAt: String(row.created_at), roles: row.roles ? String(row.roles).split(', ') : [] })) })
  }

  if (isRoles) {
    const roles = await sql`
      SELECT r.id, r.name, r.label, r.created_at,
        COALESCE(string_agg(p.code, ', ' ORDER BY p.code), '') AS permissions
      FROM operations.roles r
      LEFT JOIN operations.role_permissions rp ON rp.role_id = r.id
      LEFT JOIN operations.permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.label
    `
    const permissions = await sql`SELECT code, label, module FROM operations.permissions ORDER BY module, code`
    return response({
      items: roles.map((row) => ({ id: String(row.id), name: String(row.name), label: String(row.label), createdAt: String(row.created_at), permissions: row.permissions ? String(row.permissions).split(', ') : [] })),
      permissions: permissions.map((row) => ({ code: String(row.code), label: String(row.label), module: String(row.module) })),
    })
  }

  const body = await request.json().catch(() => ({}))
  if (createUser) return createOperationsUser(sql, body, claims.sub)
  return createOperationsRole(sql, body, claims.sub)
}

async function createOperationsUser(sql, body, actorId) {
  const fullName = text(body.fullName)
  const email = text(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const roleName = text(body.roleName)
  if (!fullName || !email || !password || !roleName) return response({ error: 'Nombre, correo, contraseña y rol son obligatorios.' }, 400)
  if (!/^\S+@\S+\.\S+$/.test(email)) return response({ error: 'Ingresa un correo válido.' }, 400)
  if (password.length < 10) return response({ error: 'La contraseña debe tener al menos 10 caracteres.' }, 400)

  const roles = await sql`SELECT id FROM operations.roles WHERE name = ${roleName} LIMIT 1`
  if (!roles.length) return response({ error: 'El rol seleccionado no existe.' }, 400)
  const salt = randomSalt()
  const hash = await derivePassword(password, salt)
  try {
    const created = await sql`INSERT INTO operations.users (email, full_name, role) VALUES (${email}, ${fullName}, ${roleName}) RETURNING id, email, full_name, active, created_at`
    const user = created[0]
    await sql`INSERT INTO operations.user_credentials (user_id, password_hash, password_salt) VALUES (${user.id}, ${hash}, ${salt})`
    await sql`INSERT INTO operations.user_roles (user_id, role_id) VALUES (${user.id}, ${roles[0].id})`
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'create', 'user', ${user.id}, ${JSON.stringify({ email, roleName })}::jsonb)`
    return response({ ok: true, user: { id: String(user.id), email: String(user.email), fullName: String(user.full_name), active: Boolean(user.active), roles: [roleName] } }, 201)
  } catch (error) {
    if (String(error.message).includes('users_email_key')) return response({ error: 'Ya existe un usuario con ese correo.' }, 409)
    throw error
  }
}

async function createOperationsRole(sql, body, actorId) {
  const name = text(body.name).toLowerCase()
  const label = text(body.label)
  const permissionCodes = Array.isArray(body.permissions) ? body.permissions.filter((value) => typeof value === 'string') : []
  if (!/^[a-z][a-z0-9_-]{2,40}$/.test(name)) return response({ error: 'El identificador debe usar letras minúsculas, números, guion o guion bajo.' }, 400)
  if (!label) return response({ error: 'El nombre visible del rol es obligatorio.' }, 400)

  try {
    const created = await sql`INSERT INTO operations.roles (name, label) VALUES (${name}, ${label}) RETURNING id, name, label, created_at`
    const role = created[0]
    if (permissionCodes.length) {
      const permissions = await sql`SELECT id, code FROM operations.permissions WHERE code = ANY(${permissionCodes})`
      for (const permission of permissions) await sql`INSERT INTO operations.role_permissions (role_id, permission_id) VALUES (${role.id}, ${permission.id}) ON CONFLICT DO NOTHING`
    }
    await sql`INSERT INTO operations.audit_log (user_id, action, entity_type, entity_id, metadata) VALUES (${actorId}, 'create', 'role', ${role.id}, ${JSON.stringify({ name, permissionCodes })}::jsonb)`
    return response({ ok: true, role: { id: String(role.id), name: String(role.name), label: String(role.label), permissions: permissionCodes } }, 201)
  } catch (error) {
    if (String(error.message).includes('roles_name_key')) return response({ error: 'Ya existe un rol con ese identificador.' }, 409)
    throw error
  }
}

function randomSalt() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlBytes(bytes)
}

async function derivePassword(password, salt) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256)
  return base64UrlBytes(new Uint8Array(bits))
}

function base64UrlBytes(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }
function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) }
