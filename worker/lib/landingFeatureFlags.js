export const LANDING_REQUEST_BUTTON_FLAG = 'landing_new_request_button'

export async function isLandingRequestButtonEnabled(env) {
  const flags = env?.LANDING_FLAGS
  if (typeof flags?.getBooleanValue !== 'function') return false

  try {
    return await flags.getBooleanValue(LANDING_REQUEST_BUTTON_FLAG, false)
  } catch {
    // Fail closed if Flagship is unavailable or misconfigured.
    return false
  }
}

export function isLandingRequestPage(pathname) {
  return pathname === '/solicitud'
    || pathname === '/solicitud/'
    || /^\/solicitud\/agente\/[^/]+\/?$/.test(pathname)
}

export function isLandingRequestApi(pathname) {
  return pathname === '/api/public/catalog'
    || pathname === '/api/public/service'
    || pathname === '/api/public/turnstile-config'
    || pathname === '/api/public/request-attribution-token'
    || pathname === '/api/public/requests'
    || /^\/api\/public\/agent-links\/[^/]+$/.test(pathname)
}
