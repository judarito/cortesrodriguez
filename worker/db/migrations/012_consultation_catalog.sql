-- Reorganiza el catálogo: servicio general -> tipo de consulta -> precio/pool de expertos.

CREATE TABLE IF NOT EXISTS operations.consultation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.service_consultation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES operations.services(id) ON DELETE CASCADE,
  consultation_type_id UUID NOT NULL REFERENCES operations.consultation_types(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('COP', 'USD')),
  payment_required BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, consultation_type_id)
);

CREATE TABLE IF NOT EXISTS operations.consultation_type_experts (
  consultation_type_id UUID NOT NULL REFERENCES operations.consultation_types(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consultation_type_id, user_id)
);

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS general_service_code TEXT,
  ADD COLUMN IF NOT EXISTS general_service_name TEXT,
  ADD COLUMN IF NOT EXISTS consultation_type_id UUID REFERENCES operations.consultation_types(id),
  ADD COLUMN IF NOT EXISTS consultation_type_code TEXT,
  ADD COLUMN IF NOT EXISTS consultation_type_name TEXT;

INSERT INTO operations.services (code, name, description, sort_order)
VALUES
  ('importacion', 'Importación', 'Servicios de asesoría para operaciones de importación.', 10),
  ('exportacion', 'Exportación', 'Servicios de asesoría para operaciones de exportación.', 20),
  ('agente_carga', 'Agente de carga', 'Servicios de asesoría para gestión de carga internacional.', 30)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, active = TRUE, updated_at = NOW();

INSERT INTO operations.consultation_types (code, name, description)
VALUES
  ('consulta_basica', 'Consulta básica', 'Orientación inicial sobre una operación de comercio exterior.'),
  ('datos_legales', 'Consulta de datos legales', 'Revisión y orientación sobre requisitos y datos legales.'),
  ('importacion_casa', 'Importación de casa', 'Orientación para importar bienes de uso doméstico.' )
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, active = TRUE, updated_at = NOW();

INSERT INTO operations.service_consultation_types (service_id, consultation_type_id, amount_cents, currency)
SELECT s.id, c.id,
  CASE c.code WHEN 'consulta_basica' THEN 1000 WHEN 'datos_legales' THEN 1500 WHEN 'importacion_casa' THEN 2000 END,
  'USD'
FROM operations.services s
CROSS JOIN operations.consultation_types c
WHERE s.code IN ('importacion', 'exportacion', 'agente_carga')
  AND (s.code <> 'agente_carga' OR c.code = 'consulta_basica')
ON CONFLICT (service_id, consultation_type_id) DO NOTHING;

UPDATE operations.requests r
SET general_service_code = r.service_type,
    general_service_name = INITCAP(REPLACE(r.service_type, '_', ' '))
WHERE r.general_service_code IS NULL;
