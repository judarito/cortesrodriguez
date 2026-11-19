-- Cotizaciones como solicitudes operativas desde el primer contacto.
-- La solicitud y su evento durable quedan en Neon; los efectos se procesan
-- posteriormente por los consumidores existentes de outbox/Queue.

ALTER TABLE operations.requests
  DROP CONSTRAINT IF EXISTS requests_status_check;

ALTER TABLE operations.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('cotizacion', 'pending', 'in_review', 'in_progress', 'closed', 'cancelled'));

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS quote_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quote_converted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS operations_requests_quote_token_hash_idx
  ON operations.requests (quote_token_hash)
  WHERE quote_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS operations_requests_quote_state_idx
  ON operations.requests (status, quote_expires_at)
  WHERE status = 'cotizacion';

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_event_code_check;

ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_event_code_check CHECK (event_code IN (
    'quote_created', 'payment_approved', 'payment_rejected', 'request_created', 'status_changed',
    'expert_response_submitted', 'feedback_received', 'feedback_low', 'expert_assigned', 'assignment_failed',
    'similar_question_review', 'expert_response_approved'
  ));

-- Conserva todas las ramas vigentes del trigger de la migración 037
-- (requests, request_payments, request_assignments, request_similarity_reviews,
-- expert_responses y client_feedback) y solo añade quote_created al INSERT de
-- solicitudes en estado cotizacion.
CREATE OR REPLACE FUNCTION operations.capture_notification_domain_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'requests' THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'cotizacion' THEN
      PERFORM operations.enqueue_notification_event(
        NEW.id, 'quote_created', 'quote_created/' || NEW.id::TEXT, TRUE
      );
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM operations.enqueue_notification_event(
        NEW.id, 'request_created', 'request_created/' || NEW.id::TEXT, NEW.payment_required
      );
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM operations.enqueue_notification_event(
        NEW.id, 'status_changed', 'status_changed/' || NEW.id::TEXT || '/' || gen_random_uuid()::TEXT,
        NEW.payment_required AND NOT EXISTS (
          SELECT 1 FROM operations.request_payments p WHERE p.request_id = NEW.id AND p.status = 'approved'
        )
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'request_payments' THEN
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id, 'payment_approved', 'payment_approved/' || NEW.request_id::TEXT
      );
    ELSIF NEW.status IN ('rejected', 'cancelled') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id, 'payment_rejected', 'payment_rejected/' || COALESCE(NEW.mercado_pago_payment_id, NEW.id::TEXT)
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'request_assignments' THEN
    IF TG_OP = 'INSERT' AND NEW.status IN ('assigned', 'reassigned') THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id, 'expert_assigned', 'expert_assigned/' || NEW.id::TEXT,
        FALSE, jsonb_build_object('assignmentId', NEW.id, 'expertId', NEW.expert_id)
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'request_similarity_reviews' AND TG_OP = 'INSERT' THEN
    PERFORM operations.enqueue_notification_event(
      NEW.request_id, 'similar_question_review', 'similar_question_review/' || NEW.request_id::TEXT, TRUE
    );
  ELSIF TG_TABLE_NAME = 'expert_responses' THEN
    IF NEW.status = 'pending_admin_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id, 'expert_response_submitted', 'expert_response_submitted/' || NEW.id::TEXT
      );
    ELSIF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id, 'expert_response_approved', 'expert_response_approved/' || NEW.id::TEXT,
        FALSE, jsonb_build_object('responseId', NEW.id)
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'client_feedback' AND TG_OP = 'UPDATE' THEN
    IF OLD.rating IS NULL AND NEW.rating IS NOT NULL THEN
      PERFORM operations.enqueue_notification_event(
        NEW.request_id,
        CASE WHEN NEW.status = 'escalated' THEN 'feedback_low' ELSE 'feedback_received' END,
        (CASE WHEN NEW.status = 'escalated' THEN 'feedback_low/' ELSE 'feedback_received/' END) || NEW.id::TEXT
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
