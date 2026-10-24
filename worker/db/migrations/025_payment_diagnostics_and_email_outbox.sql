CREATE TABLE IF NOT EXISTS operations.payment_event_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES operations.requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('webhook', 'browser_return', 'list_reconcile', 'admin_verify')),
  reference TEXT,
  payment_id TEXT,
  preference_id TEXT,
  payment_status TEXT,
  currency TEXT,
  amount_cents BIGINT,
  expected_cop_cents BIGINT,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched', 'mismatch', 'not_found', 'unapproved')),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_event_diagnostics_request_idx
  ON operations.payment_event_diagnostics(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  resend_email_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (request_id, event_code)
);

CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON operations.notification_outbox(status, next_attempt_at)
  WHERE status IN ('pending', 'processing');

