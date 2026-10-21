-- Acceso passwordless limitado a solicitudes asociadas al correo verificado.
INSERT INTO operations.roles (name, label)
VALUES ('client', 'Cliente')
ON CONFLICT (name) DO NOTHING;

INSERT INTO operations.permissions (code, label, module)
VALUES ('client_requests.read', 'Ver solicitudes propias', 'client')
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code = 'client_requests.read'
WHERE r.name = 'client'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS operations.client_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_login_challenges_email_created
  ON operations.client_login_challenges (lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS operations.client_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.client_auth_events (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('code_requested', 'login', 'logout')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_auth_events_email_created
  ON operations.client_auth_events (lower(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_sessions_email_active
  ON operations.client_sessions (lower(email), expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operations_requests_email_created
  ON operations.requests (lower(trim(email)), created_at DESC);
