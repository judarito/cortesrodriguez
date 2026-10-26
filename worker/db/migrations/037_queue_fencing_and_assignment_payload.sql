ALTER TABLE operations.notification_outbox
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS dispatch_lease_token UUID;

ALTER TABLE operations.notification_email_effects
  ADD COLUMN IF NOT EXISTS lease_token UUID;

CREATE TABLE IF NOT EXISTS operations.notification_queue_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_message_id TEXT NOT NULL UNIQUE,
  queue_name TEXT NOT NULL,
  event_id UUID REFERENCES operations.notification_outbox(id) ON DELETE SET NULL,
  message_kind TEXT NOT NULL CHECK (message_kind IN ('dead_letter', 'invalid_message')),
  payload_sha256 TEXT NOT NULL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redriven', 'ignored')),
  resolution_note TEXT,
  resolved_by UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_queue_failures_status_idx
  ON operations.notification_queue_failures(status, created_at DESC);

ALTER TABLE operations.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_status_check,
  ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'dispatching', 'queued', 'processing', 'sent', 'failed', 'cancelled'));

-- Backfill assignment identity into events already created by the old trigger.
UPDATE operations.notification_outbox event
SET event_payload = jsonb_build_object('assignmentId', assignment.id, 'expertId', assignment.expert_id)
FROM operations.request_assignments assignment
WHERE event.event_code = 'expert_assigned'
  AND event.idempotency_key = 'expert_assigned/' || assignment.id::TEXT
  AND COALESCE(event.event_payload, '{}'::jsonb) = '{}'::jsonb;

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
        NEW.request_id, 'expert_assigned', 'expert_assigned/' || NEW.id::TEXT, FALSE,
        jsonb_build_object('assignmentId', NEW.id, 'expertId', NEW.expert_id)
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
