CREATE TABLE IF NOT EXISTS operations.public_request_rate_limits (
  ip_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('token', 'request')),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ip_hash, action)
);

CREATE INDEX IF NOT EXISTS idx_public_request_rate_limits_window
  ON operations.public_request_rate_limits(window_started_at);

CREATE INDEX IF NOT EXISTS idx_public_request_attribution_direct_expiry
  ON operations.public_request_attribution_tokens(expires_at, id)
  WHERE attribution_type = 'direct_web';
