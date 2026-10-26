CREATE TABLE IF NOT EXISTS operations.login_attempt_limits (
  scope TEXT NOT NULL CHECK (scope IN ('account', 'ip')),
  identifier_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL,
  locked_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, identifier_hash)
);

CREATE INDEX IF NOT EXISTS operations_login_attempt_limits_expiry_idx
  ON operations.login_attempt_limits (expires_at);
