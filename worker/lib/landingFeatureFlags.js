export const LANDING_REQUEST_BUTTON_FLAG = 'landing_new_request_button'
export const PAYMENT_CHECKOUT_BRICKS_FLAG = 'payment_checkout_bricks_enabled'

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

export async function isPaymentCheckoutBricksEnabled(env) {
  const flags = env?.LANDING_FLAGS
  if (typeof flags?.getBooleanValue !== 'function') return false

  try {
    return await flags.getBooleanValue(PAYMENT_CHECKOUT_BRICKS_FLAG, false)
  } catch {
    // Fail closed if Flagship is unavailable or misconfigured.
    return false
  }
}

export function isPaymentCheckoutBricksConfigured(env) {
  const publicKey = typeof env?.MP_BRICKS_PUBLIC_KEY === 'string' ? env.MP_BRICKS_PUBLIC_KEY.trim() : ''
  const bricksToken = typeof env?.MP_BRICKS_ACCESS_TOKEN === 'string' ? env.MP_BRICKS_ACCESS_TOKEN.trim() : ''
  const proToken = typeof env?.MP_ACCESS_TOKEN === 'string' ? env.MP_ACCESS_TOKEN.trim() : ''
  return Boolean(publicKey && bricksToken && bricksToken !== proToken)
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
    || pathname === '/api/public/request-start'
    || pathname === '/api/public/requests'
    || /^\/api\/public\/agent-links\/[^/]+$/.test(pathname)
}
