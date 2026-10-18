-- Base para catálogo de asesorías y atribución segura de solicitudes.

CREATE TABLE IF NOT EXISTS operations.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.service_specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES operations.services(id) ON DELETE CASCADE,
  specialty_id UUID NOT NULL REFERENCES operations.specialties(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'COP' CHECK (currency IN ('COP', 'USD')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, specialty_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS operations.expert_specialties (
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  specialty_id UUID NOT NULL REFERENCES operations.specialties(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, specialty_id)
);

CREATE TABLE IF NOT EXISTS operations.agent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Enlace principal',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES operations.users(id),
  ADD COLUMN IF NOT EXISTS agent_link_id UUID REFERENCES operations.agent_links(id),
  ADD COLUMN IF NOT EXISTS specialty_id UUID REFERENCES operations.specialties(id),
  ADD COLUMN IF NOT EXISTS specialty_name TEXT,
  ADD COLUMN IF NOT EXISTS specialty_description TEXT,
  ADD COLUMN IF NOT EXISTS question TEXT;

UPDATE operations.requests
SET source_channel = CASE WHEN source = 'agent' THEN 'agent_link' ELSE 'direct_web' END
WHERE source_channel IS NULL;

CREATE INDEX IF NOT EXISTS idx_operations_agent_links_agent
  ON operations.agent_links(agent_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operations_requests_agent
  ON operations.requests(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operations_requests_specialty
  ON operations.requests(specialty_id, created_at DESC);

INSERT INTO operations.roles (name, label)
VALUES ('expert', 'Experto')
ON CONFLICT (name) DO NOTHING;

INSERT INTO operations.permissions (code, label, module)
VALUES
  ('agent_links.manage', 'Gestionar enlaces de agente', 'agents'),
  ('services.manage', 'Gestionar servicios y especialidades', 'services'),
  ('expert_requests.read', 'Ver solicitudes asignadas como experto', 'expert'),
  ('expert_responses.create', 'Responder solicitudes asignadas', 'expert'),
  ('responses.review', 'Revisar respuestas de expertos', 'requests'),
  ('attachments.read', 'Ver adjuntos autorizados', 'requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
CROSS JOIN operations.permissions p
WHERE r.name = 'agent'
  AND p.code IN ('dashboard.read', 'requests.read', 'agent_links.manage')
ON CONFLICT DO NOTHING;

DELETE FROM operations.role_permissions
WHERE role_id = (SELECT id FROM operations.roles WHERE name = 'agent')
  AND permission_id = (SELECT id FROM operations.permissions WHERE code = 'requests.create');

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
CROSS JOIN operations.permissions p
WHERE r.name = 'expert'
  AND p.code IN ('dashboard.read', 'expert_requests.read', 'expert_responses.create', 'attachments.read')
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
CROSS JOIN operations.permissions p
WHERE r.name = 'admin'
  AND p.code IN ('agent_links.manage', 'services.manage', 'expert_requests.read', 'expert_responses.create', 'responses.review', 'attachments.read')
ON CONFLICT DO NOTHING;

INSERT INTO operations.services (code, name, description, sort_order)
VALUES (
  'asesoria_personalizada',
  'Asesoría personalizada',
  'Orientación especializada para operaciones de comercio exterior.',
  10
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.specialties (code, name, description)
VALUES
  ('importacion', 'Importación', 'Asesoría para trámites y operaciones de importación.'),
  ('exportacion', 'Exportación', 'Asesoría para trámites y operaciones de exportación.'),
  ('agente_carga', 'Agente de carga', 'Asesoría relacionada con la gestión de carga internacional.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.service_specialties (service_id, specialty_id, amount_cents, currency)
SELECT s.id, sp.id, COALESCE(c.amount_cents, 0), COALESCE(c.currency, 'COP')
FROM operations.services s
JOIN operations.specialties sp ON sp.code IN ('importacion', 'exportacion', 'agente_carga')
LEFT JOIN operations.service_catalog c ON c.code = s.code
WHERE s.code = 'asesoria_personalizada'
ON CONFLICT (service_id, specialty_id) DO NOTHING;
