-- Adjuntos múltiples por solicitud para el flujo cotización → reserva.
--
-- Solo se guardan metadatos y claves del almacenamiento existente
-- (Cloudflare R2 vía el binding GALLERY_IMAGES). Ningún binario se persiste
-- en Neon ni en Turso.
--
-- Cambios:
--   1. Catálogo configurable de categorías documentales por service_type.
--   2. Metadatos de categoría, etapa y trazabilidad en request_attachments.
--   3. Ciclo de estados pending → validated → rejected/deleted (con
--      'available' migrado a 'validated' para filas existentes).
--   4. Validación de servidor en base de datos: categoría permitida por
--      servicio, MIME, tamaño, cupo por categoría y prefijo de storage_key.
--   5. Protección contra duplicados por checksum y helper de completitud.
--
-- Rollback (manual; ejecutar solo si se revierte el slice):
--   1. DROP TRIGGER IF EXISTS validate_request_attachment ON operations.request_attachments;
--   2. DROP FUNCTION IF EXISTS operations.validate_request_attachment();
--   3. DROP VIEW IF EXISTS operations.request_attachment_gaps;
--   4. DROP FUNCTION IF EXISTS operations.request_attachments_complete(uuid, text);
--   5. DROP TABLE IF EXISTS operations.request_attachment_requirements;
--   6. UPDATE operations.request_attachments SET status = 'available' WHERE status = 'validated';
--      ALTER TABLE operations.request_attachments DROP CONSTRAINT IF EXISTS request_attachments_status_check;
--      ALTER TABLE operations.request_attachments ADD CONSTRAINT request_attachments_status_check
--        CHECK (status IN ('pending', 'available', 'rejected', 'deleted'));
--      ALTER TABLE operations.request_attachments ALTER COLUMN status SET DEFAULT 'available';
--   7. DROP COLUMN de los metadatos agregados (category, stage, uploaded_*, checksum_sha256,
--      metadata, validated_*, rejected_*, rejection_reason, deleted_*, updated_at).
--   Los objetos en R2 deben conservarse o limpiarse por separado.

CREATE TABLE IF NOT EXISTS operations.request_attachment_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL CHECK (service_type IN ('importacion', 'exportacion', 'agente_carga')),
  category TEXT NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  label_es TEXT NOT NULL,
  label_en TEXT NOT NULL,
  description_es TEXT,
  description_en TEXT,
  stage TEXT NOT NULL DEFAULT 'any' CHECK (stage IN ('cotizacion', 'reserva', 'any')),
  min_files INTEGER NOT NULL DEFAULT 0 CHECK (min_files >= 0),
  max_files INTEGER NOT NULL DEFAULT 5 CHECK (max_files >= 1),
  max_size_bytes BIGINT NOT NULL DEFAULT 10485760 CHECK (max_size_bytes > 0),
  allowed_mime_types TEXT[] NOT NULL DEFAULT ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  ],
  allowed_extensions TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'jpg', 'jpeg', 'png', 'webp'],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_type, category),
  CONSTRAINT request_attachment_requirements_count_check CHECK (min_files <= max_files),
  CONSTRAINT request_attachment_requirements_mime_check CHECK (cardinality(allowed_mime_types) > 0),
  CONSTRAINT request_attachment_requirements_extension_check CHECK (cardinality(allowed_extensions) > 0)
);

CREATE INDEX IF NOT EXISTS idx_operations_request_attachment_requirements_service
  ON operations.request_attachment_requirements(service_type, active, sort_order);

ALTER TABLE operations.request_attachments
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'documento_general',
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'cotizacion',
  ADD COLUMN IF NOT EXISTS uploaded_by_kind TEXT NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_by_user_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE operations.request_attachments
  DROP CONSTRAINT IF EXISTS request_attachment_stage_check,
  DROP CONSTRAINT IF EXISTS request_attachment_uploaded_by_kind_check,
  DROP CONSTRAINT IF EXISTS request_attachment_checksum_check;

ALTER TABLE operations.request_attachments
  ADD CONSTRAINT request_attachment_stage_check
    CHECK (stage IN ('cotizacion', 'reserva')),
  ADD CONSTRAINT request_attachment_uploaded_by_kind_check
    CHECK (uploaded_by_kind IN ('client', 'agent', 'admin', 'system')),
  ADD CONSTRAINT request_attachment_checksum_check
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');

-- Ciclo de estados nuevo. Las filas existentes con 'available' ya estaban
-- disponibles para descarga, por lo que equivalen a 'validated'.
ALTER TABLE operations.request_attachments
  DROP CONSTRAINT IF EXISTS request_attachments_status_check;

UPDATE operations.request_attachments
   SET status = 'validated'
 WHERE status = 'available';

ALTER TABLE operations.request_attachments
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE operations.request_attachments
  ADD CONSTRAINT request_attachments_status_check
  CHECK (status IN ('pending', 'validated', 'rejected', 'deleted'));

UPDATE operations.request_attachments
   SET category = 'documento_general'
 WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS idx_operations_request_attachments_category
  ON operations.request_attachments(request_id, category, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operations_request_attachments_pending
  ON operations.request_attachments(status, created_at)
  WHERE status = 'pending';

-- Un mismo archivo (mismo checksum) no puede quedar dos veces activo en la
-- misma solicitud; sí puede volver a cargarse después de rechazado/eliminado.
CREATE UNIQUE INDEX IF NOT EXISTS operations_request_attachments_checksum_idx
  ON operations.request_attachments(request_id, checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL AND status IN ('pending', 'validated');

-- Validación de servidor a nivel de base de datos: la categoría debe existir
-- en el catálogo del servicio de la solicitud y el archivo debe respetar los
-- límites configurados. El navegador solo propone; la base de datos confirma.
CREATE OR REPLACE FUNCTION operations.validate_request_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_service TEXT;
  requirement operations.request_attachment_requirements%ROWTYPE;
  occupied_slots INTEGER;
BEGIN
  SELECT r.service_type INTO request_service
    FROM operations.requests r
   WHERE r.id = NEW.request_id;

  IF request_service IS NULL THEN
    RAISE EXCEPTION 'La solicitud % no existe.', NEW.request_id;
  END IF;

  IF NEW.storage_key NOT LIKE 'requests/' || NEW.request_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'La clave de almacenamiento no corresponde a la solicitud.';
  END IF;

  SELECT * INTO requirement
    FROM operations.request_attachment_requirements
   WHERE service_type = request_service
     AND category = NEW.category
     AND active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría % no está permitida para el servicio %.', NEW.category, request_service;
  END IF;

  IF NEW.size_bytes > requirement.max_size_bytes THEN
    RAISE EXCEPTION 'El archivo supera el tamaño máximo de la categoría %.', NEW.category;
  END IF;

  IF NOT (LOWER(NEW.mime_type) = ANY (requirement.allowed_mime_types)) THEN
    RAISE EXCEPTION 'El tipo % no está permitido para la categoría %.', NEW.mime_type, NEW.category;
  END IF;

  IF NEW.status <> 'deleted' THEN
    SELECT COUNT(*) INTO occupied_slots
      FROM operations.request_attachments a
     WHERE a.request_id = NEW.request_id
       AND a.category = NEW.category
       AND a.status <> 'deleted'
       AND a.id <> NEW.id;

    IF occupied_slots >= requirement.max_files THEN
      RAISE EXCEPTION 'La categoría % admite máximo % archivos.', NEW.category, requirement.max_files;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_request_attachment ON operations.request_attachments;
CREATE TRIGGER validate_request_attachment
  BEFORE INSERT OR UPDATE ON operations.request_attachments
  FOR EACH ROW
  EXECUTE FUNCTION operations.validate_request_attachment();

-- Completitud por etapa: verdadero solo si cada requisito activo del servicio
-- tiene al menos min_files adjuntos en estado validated. No cuenta pending,
-- rejected ni deleted.
CREATE OR REPLACE FUNCTION operations.request_attachments_complete(
  p_request_id UUID,
  p_stage TEXT DEFAULT 'reserva'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_stage NOT IN ('cotizacion', 'reserva') THEN
    RAISE EXCEPTION 'Etapa de adjuntos inválida: %.', p_stage;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM operations.requests r WHERE r.id = p_request_id) THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
      FROM operations.requests r
      JOIN operations.request_attachment_requirements req
        ON req.service_type = r.service_type
       AND req.active = TRUE
       AND req.stage IN ('any', p_stage)
     WHERE r.id = p_request_id
       AND (
         SELECT COUNT(*)
           FROM operations.request_attachments a
          WHERE a.request_id = r.id
            AND a.category = req.category
            AND a.status = 'validated'
       ) < req.min_files
  );
END;
$$;

CREATE OR REPLACE VIEW operations.request_attachment_gaps AS
SELECT
  r.id AS request_id,
  r.service_type,
  req.category,
  req.label_es,
  req.label_en,
  req.stage,
  req.min_files,
  COUNT(a.id) FILTER (WHERE a.status = 'validated')::INTEGER AS validated_count
FROM operations.requests r
JOIN operations.request_attachment_requirements req
  ON req.service_type = r.service_type
 AND req.active = TRUE
LEFT JOIN operations.request_attachments a
  ON a.request_id = r.id
 AND a.category = req.category
GROUP BY r.id, r.service_type, req.id, req.category, req.label_es, req.label_en, req.stage, req.min_files
HAVING COUNT(a.id) FILTER (WHERE a.status = 'validated') < req.min_files;

COMMENT ON TABLE operations.request_attachment_requirements IS
  'Catálogo de categorías documentales por service_type. La matriz de documentos obligatorios se configura aquí; no se codifica en el navegador.';
COMMENT ON TABLE operations.request_attachments IS
  'Metadatos de adjuntos. Los binarios viven únicamente en el almacenamiento de objetos (R2); Neon y Turso no los persisten.';
COMMENT ON COLUMN operations.request_attachments.storage_key IS
  'Clave del objeto en R2; debe iniciar con requests/<request_id>/.';
COMMENT ON COLUMN operations.request_attachments.checksum_sha256 IS
  'SHA-256 hexadecimal del archivo, usado para idempotencia y detección de duplicados.';
COMMENT ON COLUMN operations.request_attachments.metadata IS
  'Metadatos adicionales no binarios (dimensiones, origen de la carga, etc.).';

-- Semilla base. Toda categoría nace opcional para no bloquear solicitudes
-- existentes; operaciones debe ajustar min_files/max_files/etapas según la
-- matriz documental definitiva. La re-ejecución no sobrescribe configuración.
INSERT INTO operations.request_attachment_requirements
  (service_type, category, label_es, label_en, stage, min_files, max_files, sort_order)
VALUES
  ('importacion', 'documento_general', 'Documento general', 'General document', 'any', 0, 10, 0),
  ('importacion', 'factura_comercial', 'Factura comercial', 'Commercial invoice', 'any', 0, 5, 10),
  ('importacion', 'packing_list', 'Packing list', 'Packing list', 'any', 0, 5, 20),
  ('importacion', 'documento_transporte', 'Documento de transporte', 'Transport document', 'any', 0, 5, 30),
  ('importacion', 'certificado_origen', 'Certificado de origen', 'Certificate of origin', 'any', 0, 5, 40),
  ('exportacion', 'documento_general', 'Documento general', 'General document', 'any', 0, 10, 0),
  ('exportacion', 'factura_comercial', 'Factura comercial', 'Commercial invoice', 'any', 0, 5, 10),
  ('exportacion', 'packing_list', 'Packing list', 'Packing list', 'any', 0, 5, 20),
  ('exportacion', 'documento_transporte', 'Documento de transporte', 'Transport document', 'any', 0, 5, 30),
  ('exportacion', 'certificado_origen', 'Certificado de origen', 'Certificate of origin', 'any', 0, 5, 40),
  ('agente_carga', 'documento_general', 'Documento general', 'General document', 'any', 0, 10, 0),
  ('agente_carga', 'instrucciones_embarque', 'Instrucciones de embarque', 'Shipping instructions', 'any', 0, 5, 10),
  ('agente_carga', 'packing_list', 'Packing list', 'Packing list', 'any', 0, 5, 20),
  ('agente_carga', 'documento_transporte', 'Documento de transporte', 'Transport document', 'any', 0, 5, 30)
ON CONFLICT (service_type, category) DO NOTHING;
