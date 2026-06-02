import { cloneDefaultContent, normalizeContent } from '../contentDefaults'

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status || 500
    this.payload = options.payload
  }
}

async function parseJsonError(response, fallbackMessage) {
  const error = await response.json().catch(() => ({ error: fallbackMessage }))
  return new ApiError(error.error || fallbackMessage, {
    status: response.status,
    payload: error,
  })
}

async function fetchAdminJson(url, options, fallbackMessage) {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw await parseJsonError(response, fallbackMessage)
  }

  return response.json()
}

export async function fetchContent(options = {}) {
  const { fallbackToDefault = false, ...fetchOptions } = options
  const response = await fetch('/api/content', {
    cache: 'no-store',
    ...fetchOptions,
  })
  if (!response.ok) {
    if (fallbackToDefault) {
      return {
        ...cloneDefaultContent(),
        approvedTestimonials: { es: [], en: [] },
        contentMeta: null,
      }
    }

    const error = await response.json().catch(() => ({ error: 'No se pudo cargar el contenido.' }))
    throw new ApiError(error.error || 'No se pudo cargar el contenido.', {
      status: response.status,
      payload: error,
    })
  }

  const data = await response.json()
  return {
    ...normalizeContent(data),
    approvedTestimonials: data?.approvedTestimonials || { es: [], en: [] },
    contentMeta: data?.contentMeta || null,
  }
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
  const revision = content?.contentMeta?.revision || content?.contentMeta?.updatedAt || ''
  const requestId = globalThis.crypto?.randomUUID?.() || `save-${Date.now()}`
  return fetchAdminJson('/api/admin/content', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'X-Content-Revision': revision,
      'X-Request-Id': requestId,
      'X-Save-Source': 'admin-panel',
    },
    body: JSON.stringify(content),
  }, 'No se pudo guardar el contenido.')
}

export async function uploadImage(blob, jwt, fileName = 'imagen.webp') {
  return fetchAdminJson('/api/admin/images', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'image/webp',
      'X-File-Name': fileName,
      Authorization: `Bearer ${jwt}`,
    },
    body: blob,
  }, 'No se pudo subir la imagen.')
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

export async function submitTestimonial(payload) {
  const response = await fetch('/api/testimonials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({ error: 'No se pudo enviar el testimonio.' }))
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo enviar el testimonio.')
  }

  return data
}

export async function fetchAdminLeads(jwt, page = 1, pageSize = 10) {
  return fetchAdminJson(`/api/admin/leads?page=${page}&pageSize=${pageSize}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }, 'No se pudieron cargar las solicitudes.')
}

export async function fetchAdminLeadDetail(jwt, leadId) {
  return fetchAdminJson(`/api/admin/leads/${leadId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }, 'No se pudo cargar el detalle.')
}

export async function fetchAdminTestimonials(jwt, page = 1, pageSize = 10) {
  return fetchAdminJson(`/api/admin/testimonials?page=${page}&pageSize=${pageSize}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }, 'No se pudieron cargar los testimonios.')
}

export async function fetchAdminTestimonialDetail(jwt, testimonialId) {
  return fetchAdminJson(`/api/admin/testimonials/${testimonialId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }, 'No se pudo cargar el detalle del testimonio.')
}

export async function reviewAdminTestimonial(jwt, testimonialId, payload) {
  return fetchAdminJson(`/api/admin/testimonials/${testimonialId}/review`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(payload),
  }, 'No se pudo revisar el testimonio.')
}

export async function fetchContentVersions(jwt, limit = 20) {
  return fetchAdminJson(`/api/admin/content/versions?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }, 'No se pudieron cargar las versiones del contenido.')
}

export async function restoreContentVersion(jwt, revision, currentRevision) {
  const requestId = globalThis.crypto?.randomUUID?.() || `restore-${Date.now()}`
  return fetchAdminJson(`/api/admin/content/versions/${revision}/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Content-Revision': currentRevision,
      'X-Request-Id': requestId,
      'X-Save-Source': 'admin-history',
    },
  }, 'No se pudo restaurar la versión.')
}
