// Resend email/message IDs are UUIDs; re_ prefixes identify API credentials.
const resendEmailIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isResendEmailId(value) {
  return typeof value === 'string' && resendEmailIdPattern.test(value.trim())
}
