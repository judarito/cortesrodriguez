ALTER TABLE operations.notification_outbox
  ADD COLUMN IF NOT EXISTS app_notifications_generated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS operations.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  request_id UUID REFERENCES operations.requests(id) ON DELETE CASCADE,
  resend_email_id TEXT,
  idempotency_key TEXT NOT NULL,
  event_code TEXT NOT NULL,
  audience_role TEXT NOT NULL CHECK (audience_role IN ('admin', 'agent', 'expert')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '/app',
  email_status TEXT NOT NULL DEFAULT 'accepted' CHECK (email_status IN ('accepted', 'sent', 'delivered', 'opened', 'failed', 'bounced', 'complained', 'pending_retry')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
  ON operations.app_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_notifications_resend_email
  ON operations.app_notifications(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operations.notification_realtime_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL REFERENCES operations.sessions(token_hash) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_realtime_tickets_expiry
  ON operations.notification_realtime_tickets(expires_at);
