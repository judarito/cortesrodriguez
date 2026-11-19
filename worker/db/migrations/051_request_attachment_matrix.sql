-- Matriz inicial configurable de adjuntos para el flujo cotización → reserva.
--
-- Esta migración NO crea una tabla nueva: ajusta el catálogo
-- operations.request_attachment_requirements creado por 049 para que la matriz
-- de documentos viva en la base de datos y el navegador solo la consuma.
--
-- Criterios de esta matriz inicial:
--   1. Categorías documentales genéricas (factura comercial, packing list,
--      documento de transporte, certificado de origen, instrucciones de
--      embarque), sin supuestos sobre productos o países concretos.
--   2. Diferenciación por etapa: `documento_general`, `factura_comercial` y
--      `instrucciones_embarque` quedan disponibles desde `cotizacion` (etapa
--      `any`); los documentos operativos que suelen aparecer después (packing
--      list, documento de transporte, certificado de origen) se habilitan en
--      `reserva`.
--   3. Postura conservadora: todos los `min_files` quedan en 0. No se bloquea
--      la creación de la cotización ni su conversión mientras operaciones no
--      defina la matriz documental definitiva. La conversión ya exige
--      completitud en la etapa `reserva`, por lo que elevar `min_files` aquí
--      basta para volver obligatoria una categoría, sin tocar el frontend ni
--      el Worker.
--   4. Operaciones puede ajustar `stage`, `min_files`, `max_files`,
--      `max_size_bytes`, `allowed_mime_types`, `allowed_extensions`, `active`,
--      `sort_order`, etiquetas y descripciones directamente en la tabla. Los
--      cambios aplican a las siguientes consultas públicas del catálogo.
--
-- Idempotencia:
--   - Las filas se insertan con ON CONFLICT DO NOTHING.
--   - Las filas existentes se actualizan solo si siguen con la firma de la
--     semilla de 049 (`stage = 'any'`, `min_files = 0`, sin descripción). Si
--     operaciones ya personalizó una fila, la re-ejecución la respeta.
--
-- Rollback (manual; solo si se revierte el slice). Restaura la semilla de 049:
--   UPDATE operations.request_attachment_requirements
--      SET stage = 'any', min_files = 0, description_es = NULL,
--          description_en = NULL, updated_at = NOW()
--    WHERE service_type IN ('importacion', 'exportacion', 'agente_carga')
--      AND category IN ('documento_general', 'factura_comercial', 'packing_list',
--                       'documento_transporte', 'certificado_origen',
--                       'instrucciones_embarque');
--   -- Las filas agregadas por esta migración (si existieran) se eliminan con:
--   -- DELETE FROM operations.request_attachment_requirements WHERE ...;

COMMENT ON TABLE operations.request_attachment_requirements IS
  'Matriz configurable de adjuntos por service_type y etapa. Vive solo en la base de datos: el navegador consume el catálogo público y nunca hardcodea categorías ni obligatoriedad. Operaciones ajusta stage/min_files aquí.';
COMMENT ON COLUMN operations.request_attachment_requirements.stage IS
  'Etapa en la que aplica la categoría: cotizacion, reserva o any. La disponibilidad y la completitud usan este valor.';
COMMENT ON COLUMN operations.request_attachment_requirements.min_files IS
  'Mínimo de adjuntos validados para considerar completa la etapa. 0 = opcional (matriz inicial conservadora).';

INSERT INTO operations.request_attachment_requirements
  (service_type, category, label_es, label_en, description_es, description_en, stage, min_files, max_files, sort_order)
VALUES
  -- Importación ---------------------------------------------------------------
  ('importacion', 'documento_general', 'Documento general', 'General document',
   'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.',
   'any', 0, 10, 0),
  ('importacion', 'factura_comercial', 'Factura comercial', 'Commercial invoice',
   'Factura o proforma de la mercancía a importar.', 'Invoice or proforma for the goods being imported.',
   'any', 0, 5, 10),
  ('importacion', 'packing_list', 'Packing list', 'Packing list',
   'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.',
   'reserva', 0, 5, 20),
  ('importacion', 'documento_transporte', 'Documento de transporte', 'Transport document',
   'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.',
   'reserva', 0, 5, 30),
  ('importacion', 'certificado_origen', 'Certificado de origen', 'Certificate of origin',
   'Certificado de origen cuando la operación lo requiera.', 'Certificate of origin when the operation requires it.',
   'reserva', 0, 5, 40),

  -- Exportación ---------------------------------------------------------------
  ('exportacion', 'documento_general', 'Documento general', 'General document',
   'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.',
   'any', 0, 10, 0),
  ('exportacion', 'factura_comercial', 'Factura comercial', 'Commercial invoice',
   'Factura o proforma de la mercancía a exportar.', 'Invoice or proforma for the goods being exported.',
   'any', 0, 5, 10),
  ('exportacion', 'packing_list', 'Packing list', 'Packing list',
   'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.',
   'reserva', 0, 5, 20),
  ('exportacion', 'documento_transporte', 'Documento de transporte', 'Transport document',
   'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.',
   'reserva', 0, 5, 30),
  ('exportacion', 'certificado_origen', 'Certificado de origen', 'Certificate of origin',
   'Certificado de origen cuando la operación lo requiera.', 'Certificate of origin when the operation requires it.',
   'reserva', 0, 5, 40),

  -- Agente de carga -----------------------------------------------------------
  ('agente_carga', 'documento_general', 'Documento general', 'General document',
   'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.',
   'any', 0, 10, 0),
  ('agente_carga', 'instrucciones_embarque', 'Instrucciones de embarque', 'Shipping instructions',
   'Instrucciones de embarque entregadas por el cliente.', 'Shipping instructions provided by the client.',
   'any', 0, 5, 10),
  ('agente_carga', 'packing_list', 'Packing list', 'Packing list',
   'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.',
   'reserva', 0, 5, 20),
  ('agente_carga', 'documento_transporte', 'Documento de transporte', 'Transport document',
   'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.',
   'reserva', 0, 5, 30)
ON CONFLICT (service_type, category) DO NOTHING;

-- Solo actualiza filas que conservan la semilla de 049 sin personalización.
UPDATE operations.request_attachment_requirements AS req
   SET stage = matrix.stage,
       min_files = matrix.min_files,
       max_files = matrix.max_files,
       sort_order = matrix.sort_order,
       label_es = matrix.label_es,
       label_en = matrix.label_en,
       description_es = COALESCE(req.description_es, matrix.description_es),
       description_en = COALESCE(req.description_en, matrix.description_en),
       updated_at = NOW()
  FROM (VALUES
    ('importacion', 'documento_general', 'any', 0, 10, 0, 'Documento general', 'General document',
     'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.'),
    ('importacion', 'factura_comercial', 'any', 0, 5, 10, 'Factura comercial', 'Commercial invoice',
     'Factura o proforma de la mercancía a importar.', 'Invoice or proforma for the goods being imported.'),
    ('importacion', 'packing_list', 'reserva', 0, 5, 20, 'Packing list', 'Packing list',
     'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.'),
    ('importacion', 'documento_transporte', 'reserva', 0, 5, 30, 'Documento de transporte', 'Transport document',
     'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.'),
    ('importacion', 'certificado_origen', 'reserva', 0, 5, 40, 'Certificado de origen', 'Certificate of origin',
     'Certificado de origen cuando la operación lo requiera.', 'Certificate of origin when the operation requires it.'),
    ('exportacion', 'documento_general', 'any', 0, 10, 0, 'Documento general', 'General document',
     'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.'),
    ('exportacion', 'factura_comercial', 'any', 0, 5, 10, 'Factura comercial', 'Commercial invoice',
     'Factura o proforma de la mercancía a exportar.', 'Invoice or proforma for the goods being exported.'),
    ('exportacion', 'packing_list', 'reserva', 0, 5, 20, 'Packing list', 'Packing list',
     'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.'),
    ('exportacion', 'documento_transporte', 'reserva', 0, 5, 30, 'Documento de transporte', 'Transport document',
     'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.'),
    ('exportacion', 'certificado_origen', 'reserva', 0, 5, 40, 'Certificado de origen', 'Certificate of origin',
     'Certificado de origen cuando la operación lo requiera.', 'Certificate of origin when the operation requires it.'),
    ('agente_carga', 'documento_general', 'any', 0, 10, 0, 'Documento general', 'General document',
     'Documento o imagen de soporte para la cotización.', 'Supporting document or image for the quote.'),
    ('agente_carga', 'instrucciones_embarque', 'any', 0, 5, 10, 'Instrucciones de embarque', 'Shipping instructions',
     'Instrucciones de embarque entregadas por el cliente.', 'Shipping instructions provided by the client.'),
    ('agente_carga', 'packing_list', 'reserva', 0, 5, 20, 'Packing list', 'Packing list',
     'Detalle de bultos, cantidades y peso de la mercancía.', 'Package, quantity and weight breakdown.'),
    ('agente_carga', 'documento_transporte', 'reserva', 0, 5, 30, 'Documento de transporte', 'Transport document',
     'Conocimiento de embarque, guía aérea o documento equivalente.', 'Bill of lading, air waybill or equivalent.')
  ) AS matrix(service_type, category, stage, min_files, max_files, sort_order,
             label_es, label_en, description_es, description_en)
 WHERE req.service_type = matrix.service_type
   AND req.category = matrix.category
   AND req.stage = 'any'
   AND req.min_files = 0
   AND req.description_es IS NULL;

-- En la matriz inicial ninguna categoría es obligatoria. Si operaciones eleva
-- min_files, la completitud de la etapa correspondiente empieza a exigirla y
-- la conversión a reserva devuelve las categorías faltantes.
