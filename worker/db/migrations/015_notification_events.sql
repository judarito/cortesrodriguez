-- Eventos adicionales para el ciclo experto -> admin -> cliente.

ALTER TABLE operations.notification_rules DROP CONSTRAINT IF EXISTS notification_rules_event_code_check;
ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_event_code_check CHECK (event_code IN (
    'payment_approved', 'payment_rejected', 'request_created', 'status_changed',
    'expert_response_submitted', 'feedback_received', 'feedback_low'
  ));

ALTER TABLE operations.notification_rules DROP CONSTRAINT IF EXISTS notification_rules_service_type_check;
ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_service_type_check CHECK (service_type IN ('all', 'importacion', 'exportacion', 'agente_carga'));
