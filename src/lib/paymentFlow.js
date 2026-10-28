// Keep sent/uncertain attempts on their original integration. A never-sent
// Brick may switch to Pro only through the backend's atomic invalidation path.
export function shouldKeepBricksAttempt(detail, configuredMode = 'bricks') {
  if (detail?.checkoutMode !== 'bricks' || ['pay', 'retry'].includes(detail?.paymentAction)) return false
  if (configuredMode === 'pro' && detail.paymentAction === 'resume' && detail.paymentSubmitted === false) return false
  return true
}
