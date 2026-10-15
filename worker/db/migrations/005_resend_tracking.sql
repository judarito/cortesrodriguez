ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS notification_status TEXT NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS notification_last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_last_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_last_error TEXT;

CREATE TABLE IF NOT EXISTS operations.notification_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL,
  resend_email_id TEXT NOT NULL UNIQUE,
  subject TEXT,
  to_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'sent', 'delivered', 'opened', 'failed', 'bounced', 'complained')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.resend_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  resend_email_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_messages_request
  ON operations.notification_messages(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_messages_resend_email
  ON operations.notification_messages(resend_email_id);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_email
  ON operations.resend_webhook_events(resend_email_id);
