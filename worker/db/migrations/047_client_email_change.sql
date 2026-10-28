CREATE TABLE IF NOT EXISTS operations.client_email_change_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lower(current_email) <> lower(new_email))
);

CREATE INDEX IF NOT EXISTS idx_client_email_change_challenges_pending
  ON operations.client_email_change_challenges (lower(current_email), lower(new_email), created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS operations.client_email_change_rate_limits (
  current_email TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.client_email_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  changed_request_count INTEGER NOT NULL CHECK (changed_request_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_email_change_audit_created
  ON operations.client_email_change_audit (created_at DESC);

ALTER TABLE operations.client_auth_events
  DROP CONSTRAINT IF EXISTS client_auth_events_event_type_check;

ALTER TABLE operations.client_auth_events
  ADD CONSTRAINT client_auth_events_event_type_check
  CHECK (event_type IN ('code_requested', 'login', 'logout', 'email_change_requested', 'email_changed'));
