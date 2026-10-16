ALTER TABLE operations.requests
  ALTER COLUMN freight_agent DROP NOT NULL;

ALTER TABLE operations.requests
  DROP CONSTRAINT IF EXISTS requests_service_type_check;

ALTER TABLE operations.requests
  ADD CONSTRAINT requests_service_type_check
  CHECK (service_type IN ('exportacion', 'importacion', 'agente_carga'));

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS service_name TEXT NOT NULL DEFAULT 'asesoria_personalizada';

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_service_type_check;

ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_service_type_check
  CHECK (service_type IN ('all', 'importacion', 'exportacion', 'agente_carga'));
