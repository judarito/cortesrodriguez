import { cloneDefaultContent, normalizeContent } from '../contentDefaults'

export async function fetchContent(options = {}) {
  const response = await fetch('/api/content', {
    cache: 'no-store',
    ...options,
  })
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

export async function uploadImage(blob, jwt, fileName = 'imagen.webp') {
  const response = await fetch('/api/admin/images', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'image/webp',
      'X-File-Name': fileName,
      Authorization: `Bearer ${jwt}`,
    },
    body: blob,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'No se pudo subir la imagen.' }))
    throw new Error(error.error || 'No se pudo subir la imagen.')
  }

  return response.json()
}

export async function submitQuoteRequest(payload) {
  const response = await fetch('/api/quote-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({ error: 'No se pudo enviar la solicitud.' }))
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo enviar la solicitud.')
  }

  return data
}

export async function fetchAdminLeads(jwt, page = 1, pageSize = 10) {
  const response = await fetch(`/api/admin/leads?page=${page}&pageSize=${pageSize}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  })

  const data = await response.json().catch(() => ({ error: 'No se pudieron cargar las solicitudes.' }))
  if (!response.ok) {
    throw new Error(data.error || 'No se pudieron cargar las solicitudes.')
  }

  return data
}

export async function fetchAdminLeadDetail(jwt, leadId) {
  const response = await fetch(`/api/admin/leads/${leadId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  })

  const data = await response.json().catch(() => ({ error: 'No se pudo cargar el detalle.' }))
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo cargar el detalle.')
  }

  return data
}
