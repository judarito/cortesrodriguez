-- Serializa solicitudes de código por correo y limita a cuatro por ventana móvil.
CREATE TABLE IF NOT EXISTS operations.client_login_rate_limits (
  email TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  request_lease_token UUID,
  request_lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_login_rate_limits_lease_idx
  ON operations.client_login_rate_limits (request_lease_expires_at)
  WHERE request_lease_token IS NOT NULL;
