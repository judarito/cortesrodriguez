-- Evoluciona el outbox de pagos a una cola idempotente para todos los eventos.
ALTER TABLE operations.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_request_id_event_code_key,
  ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE operations.notification_rules DROP CONSTRAINT IF EXISTS notification_rules_event_code_check;
ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_event_code_check CHECK (event_code IN (
    'payment_approved', 'payment_rejected', 'request_created', 'status_changed',
    'expert_response_submitted', 'expert_response_approved', 'feedback_received', 'feedback_low',
    'expert_assigned', 'assignment_failed', 'similar_question_review'
  ));

