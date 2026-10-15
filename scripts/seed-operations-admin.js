import crypto from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import 'dotenv/config'

if (!process.env.NEON_DATABASE_URL || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('Faltan NEON_DATABASE_URL, ADMIN_EMAIL o ADMIN_PASSWORD.')
}

const sql = neon(process.env.NEON_DATABASE_URL)
const email = process.env.ADMIN_EMAIL.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const salt = crypto.randomBytes(16).toString('base64url')
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64url')

const users = await sql`SELECT id FROM operations.users WHERE lower(email) = ${email} LIMIT 1`
let userId

if (users.length) {
  userId = users[0].id
  await sql`UPDATE operations.users SET full_name = ${email}, active = TRUE WHERE id = ${userId}`
  await sql`UPDATE operations.user_credentials SET password_hash = ${hash}, password_salt = ${salt}, failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE user_id = ${userId}`
} else {
  const created = await sql`INSERT INTO operations.users (email, full_name, role) VALUES (${email}, ${email}, 'admin') RETURNING id`
  userId = created[0].id
  await sql`INSERT INTO operations.user_credentials (user_id, password_hash, password_salt) VALUES (${userId}, ${hash}, ${salt})`
}

const roles = await sql`SELECT id FROM operations.roles WHERE name = 'admin' LIMIT 1`
await sql`INSERT INTO operations.user_roles (user_id, role_id) VALUES (${userId}, ${roles[0].id}) ON CONFLICT DO NOTHING`
console.log(`Administrador operativo preparado: ${email}`)
