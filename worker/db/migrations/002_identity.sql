CREATE TABLE IF NOT EXISTS operations.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.user_roles (
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES operations.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS operations.role_permissions (
  role_id UUID NOT NULL REFERENCES operations.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES operations.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS operations.user_credentials (
  user_id UUID PRIMARY KEY REFERENCES operations.users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES operations.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operations.roles (name, label)
VALUES
  ('admin', 'Administrador'),
  ('advisor', 'Asesor'),
  ('reviewer', 'Revisor'),
  ('finance', 'Financiero'),
  ('operator', 'Operador'),
  ('viewer', 'Consulta')
ON CONFLICT (name) DO NOTHING;

INSERT INTO operations.permissions (code, label, module)
VALUES
  ('dashboard.read', 'Ver inicio', 'dashboard'),
  ('clients.read', 'Ver clientes', 'clients'),
  ('requests.read', 'Ver solicitudes', 'requests'),
  ('requests.update', 'Actualizar solicitudes', 'requests'),
  ('payments.read', 'Ver pagos', 'payments'),
  ('documents.read', 'Ver documentos', 'documents'),
  ('reports.read', 'Ver reportes', 'reports'),
  ('users.manage', 'Gestionar usuarios', 'users'),
  ('settings.manage', 'Gestionar configuración', 'settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
CROSS JOIN operations.permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code IN ('dashboard.read', 'clients.read', 'requests.read', 'requests.update', 'documents.read')
WHERE r.name = 'advisor'
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code IN ('dashboard.read', 'requests.read', 'requests.update', 'documents.read')
WHERE r.name = 'reviewer'
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code IN ('dashboard.read', 'payments.read', 'reports.read')
WHERE r.name = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code IN ('dashboard.read', 'clients.read', 'requests.read', 'requests.update', 'documents.read')
WHERE r.name = 'operator'
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code IN ('dashboard.read', 'clients.read', 'requests.read')
WHERE r.name = 'viewer'
ON CONFLICT DO NOTHING;
