ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES operations.users(id),
  ADD COLUMN IF NOT EXISTS payment_required BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_operations_requests_created_by
  ON operations.requests(created_by, created_at DESC);

INSERT INTO operations.roles (name, label)
VALUES ('agent', 'Agente comercial')
ON CONFLICT (name) DO NOTHING;

INSERT INTO operations.permissions (code, label, module)
VALUES ('requests.create', 'Crear solicitudes', 'requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
CROSS JOIN operations.permissions p
WHERE r.name = 'agent' AND p.code IN ('dashboard.read', 'requests.read', 'requests.create')
ON CONFLICT DO NOTHING;

INSERT INTO operations.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM operations.roles r
JOIN operations.permissions p ON p.code = 'requests.create'
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
