CREATE TABLE IF NOT EXISTS operations.notification_email_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effect_key TEXT NOT NULL,
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  resend_idempotency_key TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'retryable', 'accepted', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  resend_email_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (effect_key, recipient_email)
);

CREATE INDEX IF NOT EXISTS notification_email_effects_status_idx
  ON operations.notification_email_effects(status, updated_at)
  WHERE status IN ('pending', 'retryable', 'sending', 'uncertain');

CREATE INDEX IF NOT EXISTS notification_email_effects_request_idx
  ON operations.notification_email_effects(request_id, event_code, created_at DESC);
