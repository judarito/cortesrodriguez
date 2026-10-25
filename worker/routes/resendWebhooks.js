import { updateEmailAppNotificationStatus } from './appNotifications.js'

export async function handleResendWebhook(request, env) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/webhooks/resend' || request.method !== 'POST') return null
  if (!env.NEON_DATABASE_URL || !env.RESEND_WEBHOOK_SECRET) return response({ error: 'Webhook de Resend no configurado.' }, 500)

  const payload = await request.text()
  if (!await verifySignature(request, payload, env.RESEND_WEBHOOK_SECRET)) return response({ error: 'Firma de Resend inválida.' }, 400)

  const event = JSON.parse(payload)
  const eventId = request.headers.get('svix-id') || `${event.type}:${event.data?.email_id || 'unknown'}:${event.created_at || ''}`
  const eventType = String(event.type || '')
  const resendEmailId = event.data?.email_id ? String(event.data.email_id) : null
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.NEON_DATABASE_URL)
  const inserted = await sql`
    INSERT INTO operations.resend_webhook_events (resend_event_id, event_type, resend_email_id, payload)
    VALUES (${eventId}, ${eventType}, ${resendEmailId}, ${payload}::jsonb)
    ON CONFLICT (resend_event_id) DO NOTHING
    RETURNING id
  `
  if (!inserted.length) return response({ ok: true, duplicate: true })
  if (resendEmailId) await applyEmailEvent(sql, env, resendEmailId, eventType, event)
  return response({ ok: true })
}

async function applyEmailEvent(sql, env, resendEmailId, eventType, event) {
  const eventAt = event.created_at ? new Date(event.created_at) : new Date()
  const status = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.failed': 'failed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
  }[eventType]
  if (!status) return

  if (status === 'sent') await sql`UPDATE operations.notification_messages SET status = 'sent', sent_at = COALESCE(sent_at, ${eventAt}), last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  if (status === 'delivered') await sql`UPDATE operations.notification_messages SET status = CASE WHEN status IN ('opened', 'complained') THEN status ELSE 'delivered' END, delivered_at = COALESCE(delivered_at, ${eventAt}), last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  if (status === 'opened') await sql`UPDATE operations.notification_messages SET status = 'opened', opened_at = COALESCE(opened_at, ${eventAt}), last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  if (status === 'failed') await sql`UPDATE operations.notification_messages SET status = 'failed', failed_at = COALESCE(failed_at, ${eventAt}), error_message = ${event.data?.error || event.data?.failed?.reason || null}, last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  if (status === 'bounced') await sql`UPDATE operations.notification_messages SET status = 'bounced', failed_at = COALESCE(failed_at, ${eventAt}), error_message = ${event.data?.bounce?.message || null}, last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  if (status === 'complained') await sql`UPDATE operations.notification_messages SET status = 'complained', last_event_at = ${eventAt}, updated_at = NOW() WHERE resend_email_id = ${resendEmailId}`
  await refreshRequestNotificationStatus(sql, resendEmailId, eventAt)
  await updateEmailAppNotificationStatus(sql, env, resendEmailId, status)
}

async function refreshRequestNotificationStatus(sql, resendEmailId, eventAt) {
  await sql`
    UPDATE operations.requests r
    SET notification_status = CASE
      WHEN EXISTS (SELECT 1 FROM operations.notification_messages m WHERE m.request_id = r.id AND m.status = 'opened') THEN 'opened'
      WHEN EXISTS (SELECT 1 FROM operations.notification_messages m WHERE m.request_id = r.id AND m.status = 'delivered') THEN 'delivered'
      WHEN EXISTS (SELECT 1 FROM operations.notification_messages m WHERE m.request_id = r.id AND m.status = 'sent') THEN 'sent'
      WHEN EXISTS (SELECT 1 FROM operations.notification_messages m WHERE m.request_id = r.id AND m.status IN ('failed', 'bounced', 'complained')) THEN 'failed'
      ELSE 'not_sent'
    END,
    notification_last_event_at = ${eventAt},
    notification_last_opened_at = (SELECT MAX(m.opened_at) FROM operations.notification_messages m WHERE m.request_id = r.id),
    notification_last_error = (SELECT m.error_message FROM operations.notification_messages m WHERE m.request_id = r.id AND m.error_message IS NOT NULL ORDER BY m.updated_at DESC LIMIT 1),
    updated_at = NOW()
    WHERE r.id = (SELECT request_id FROM operations.notification_messages WHERE resend_email_id = ${resendEmailId})
  `
}

async function verifySignature(request, payload, secret) {
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  if (!id || !timestamp || !signature) return false
  const timestampNumber = Number(timestamp)
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false
  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (char) => char.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = `${id}.${timestamp}.${payload}`
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return signature.split(' ').some((value) => value.split(',')[1] === expected)
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
