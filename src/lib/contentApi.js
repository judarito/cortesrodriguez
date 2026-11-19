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

// Slice D contract: the quote endpoint is owned by the Worker/API slice.
// The landing form only sends classification codes, client data, locale,
// attribution and an idempotency key; the server resolves catalog and price.
const QUOTE_REQUEST_PATH = '/api/public/quotes'
const PUBLIC_CATALOG_PATH = '/api/public/catalog'
const ATTACHMENT_REQUIREMENTS_PATH = '/api/public/attachment-requirements'
const QUOTE_ATTRIBUTION_PATH = '/api/public/request-start'

const QUOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/

export async function fetchPublicCatalog() {
  const response = await fetch(PUBLIC_CATALOG_PATH, { cache: 'no-store' })
  if (!response.ok) {
    throw await parseJsonError(response, 'No se pudo cargar el catálogo.')
  }

  const data = await response.json().catch(() => ({ items: [] }))
  return Array.isArray(data.items) ? data.items : []
}

// Matriz documental configurada en operations.request_attachment_requirements.
// El frontend nunca hardcodea categorías ni obligatoriedad: pide el catálogo
// del servicio y la etapa al Worker. Ante un fallo devuelve una lista vacía
// para no inventar requisitos ni bloquear el formulario.
export async function fetchAttachmentRequirements({ serviceType, stage = 'cotizacion' } = {}) {
  if (!serviceType) return []
  const params = new URLSearchParams({ serviceType, stage })
  try {
    const response = await fetch(`${ATTACHMENT_REQUIREMENTS_PATH}?${params}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return []
    const data = await response.json().catch(() => ({}))
    return Array.isArray(data.requirements) ? data.requirements : []
  } catch {
    return []
  }
}

export async function fetchQuoteAttributionToken() {
  try {
    const response = await fetch(QUOTE_ATTRIBUTION_PATH, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return ''

    const data = await response.json().catch(() => ({}))
    return QUOTE_TOKEN_PATTERN.test(data?.token || '') ? data.token : ''
  } catch {
    // Attribution is optional for direct traffic; the server decides.
    return ''
  }
}

export async function submitQuoteRequest(payload) {
  const files = Array.isArray(payload?.attachments) ? payload.attachments : []
  const requestBody = files.length
    ? (() => {
        const form = new FormData()
        Object.entries(payload).forEach(([key, value]) => {
          if (key !== 'attachments') form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
        })
        files.forEach(({ file, category }) => {
          form.append('attachments', file)
          form.append('attachmentCategory', category)
        })
        return form
      })()
    : JSON.stringify(payload)
  const response = await fetch(QUOTE_REQUEST_PATH, {
    method: 'POST',
    ...(files.length ? {} : { headers: { 'Content-Type': 'application/json' } }),
    body: requestBody,
  })

  const data = await response.json().catch(() => ({ error: 'No se pudo enviar la cotización.' }))
  if (!response.ok) {
    throw new ApiError(data.error || 'No se pudo enviar la cotización.', {
      status: response.status,
      payload: data,
    })
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
