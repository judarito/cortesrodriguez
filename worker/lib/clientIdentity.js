export function normalizeClientEmail(email) {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  return normalized || null
}
