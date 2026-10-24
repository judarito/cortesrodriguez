-- Registra los eventos en el mismo commit que el cambio de negocio.
CREATE OR REPLACE FUNCTION operations.enqueue_notification_event(
  p_request_id UUID,
  p_event_code TEXT,
  p_idempotency_key TEXT,
  p_admin_only BOOLEAN DEFAULT FALSE,
  p_event_payload JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE SQL
AS $$
  INSERT INTO operations.notification_outbox (
    request_id, event_code, idempotency_key, admin_only, event_payload
  ) VALUES (
    p_request_id, p_event_code, p_idempotency_key, p_admin_only, COALESCE(p_event_payload, '{}'::jsonb)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION operations.capture_notification_domain_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'requests' THEN
    IF TG_OP = 'INSERT' THEN
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
        NEW.request_id, 'expert_assigned', 'expert_assigned/' || NEW.id::TEXT
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

DROP TRIGGER IF EXISTS requests_notification_event ON operations.requests;
CREATE TRIGGER requests_notification_event
AFTER INSERT OR UPDATE OF status ON operations.requests
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();

DROP TRIGGER IF EXISTS request_payments_notification_event ON operations.request_payments;
CREATE TRIGGER request_payments_notification_event
AFTER INSERT OR UPDATE OF status ON operations.request_payments
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();

DROP TRIGGER IF EXISTS request_assignments_notification_event ON operations.request_assignments;
CREATE TRIGGER request_assignments_notification_event
AFTER INSERT OR UPDATE OF status ON operations.request_assignments
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();

DROP TRIGGER IF EXISTS similarity_reviews_notification_event ON operations.request_similarity_reviews;
CREATE TRIGGER similarity_reviews_notification_event
AFTER INSERT ON operations.request_similarity_reviews
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();

DROP TRIGGER IF EXISTS expert_responses_notification_event ON operations.expert_responses;
CREATE TRIGGER expert_responses_notification_event
AFTER INSERT OR UPDATE OF status ON operations.expert_responses
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();

DROP TRIGGER IF EXISTS client_feedback_notification_event ON operations.client_feedback;
CREATE TRIGGER client_feedback_notification_event
AFTER UPDATE OF rating ON operations.client_feedback
FOR EACH ROW EXECUTE FUNCTION operations.capture_notification_domain_event();
