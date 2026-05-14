import { cloneDefaultContent, normalizeContent } from '../contentDefaults'

export async function fetchContent() {
  const response = await fetch('/api/content')
  if (!response.ok) return cloneDefaultContent()
  return normalizeContent(await response.json())
}

export async function loginAdmin(credentials) {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'No se pudo iniciar sesión.' }))
    throw new Error(error.error || 'No se pudo iniciar sesión.')
  }

  return response.json()
}

export async function saveContent(content, jwt) {
  const response = await fetch('/api/admin/content', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(content),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'No se pudo guardar el contenido.' }))
    throw new Error(error.error || 'No se pudo guardar el contenido.')
  }

  return response.json()
}
