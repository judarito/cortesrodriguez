-- Límite adicional por IP sin persistir la dirección original.
CREATE TABLE IF NOT EXISTS operations.client_login_ip_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_login_ip_rate_limits_window_idx
  ON operations.client_login_ip_rate_limits (window_started_at);
