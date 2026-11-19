// Contrato común de descarga de adjuntos privados.
//
// Solo se sirven tipos explícitamente permitidos y la respuesta usa siempre el
// tipo canónico del catálogo, nunca un valor tomado sin validar de la base de
// datos o del almacenamiento. Las claves de R2 no salen del servidor: el
// llamador resuelve el objeto y aquí solo se construyen cabeceras seguras.

const DOWNLOAD_TYPES = new Map([
  ['application/pdf', { fallbackName: 'documento.pdf', disposition: 'attachment' }],
  ['image/jpeg', { fallbackName: 'imagen.jpg', disposition: 'inline' }],
  ['image/png', { fallbackName: 'imagen.png', disposition: 'inline' }],
  ['image/webp', { fallbackName: 'imagen.webp', disposition: 'inline' }],
])

// Devuelve el MIME canónico permitido o null. Parámetros como
// "application/pdf; charset=x" se descartan: el tipo servido es el del catálogo.
export function canonicalAttachmentType(value) {
  const normalized = String(value ?? '').split(';')[0].trim().toLowerCase()
  return DOWNLOAD_TYPES.has(normalized) ? normalized : null
}

// El objeto almacenado debe coincidir con el MIME registrado. R2 guarda el
// contentType usado al subir; si difiere, se falla cerrado.
export function storedObjectMatchesType(object, mimeType) {
  const stored = object?.httpMetadata?.contentType
  if (!stored) return true
  return canonicalAttachmentType(stored) === canonicalAttachmentType(mimeType)
}

export function attachmentDownloadHeaders({ mimeType, name, size = 0, disposition = '' }) {
  const type = canonicalAttachmentType(mimeType)
  if (!type) throw new Error('Tipo de adjunto no permitido.')
  const meta = DOWNLOAD_TYPES.get(type)
  const filename = safeAttachmentName(name, meta.fallbackName)
  const headers = new Headers({
    'content-type': type,
    'cache-control': 'private, no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'content-disposition': contentDisposition(disposition || meta.disposition, filename),
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
  })
  const bytes = Number(size)
  if (Number.isSafeInteger(bytes) && bytes > 0) headers.set('content-length', String(bytes))
  return headers
}

// Elimina controles (CR/LF evitan inyección de cabeceras), separadores de ruta
// y comillas; además acota la longitud del nombre.
export function safeAttachmentName(name, fallback = 'adjunto') {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/"]/g, '_')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

function contentDisposition(disposition, filename) {
  const kind = disposition === 'inline' ? 'inline' : 'attachment'
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
