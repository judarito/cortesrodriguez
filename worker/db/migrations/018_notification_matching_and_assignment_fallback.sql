-- Allow notification rules to target a consultation and request origin.
ALTER TABLE operations.notification_rules
  ADD COLUMN IF NOT EXISTS consultation_type_id UUID REFERENCES operations.consultation_types(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_channel TEXT CHECK (source_channel IN ('direct_web', 'agent_link'));

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_event_code_service_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_rules_matching
  ON operations.notification_rules (
    event_code,
    service_type,
    COALESCE(consultation_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(source_channel, 'all')
  );

-- Existing request-created rules must continue to notify the responsible
-- admin and source agent even if they were originally created for experts only.
UPDATE operations.notification_rules r
SET audiences = ARRAY(
  SELECT DISTINCT item.audience
  FROM unnest(COALESCE(r.audiences, ARRAY[]::TEXT[]) || ARRAY['admin', 'agent', 'client', 'expert']::TEXT[]) AS item(audience)
), updated_at = NOW()
WHERE r.event_code = 'request_created';

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_event_code_check;
ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_event_code_check CHECK (event_code IN (
    'payment_approved', 'payment_rejected', 'request_created', 'status_changed',
    'expert_response_submitted', 'feedback_received', 'feedback_low', 'expert_assigned', 'assignment_failed'
  ));

ALTER TABLE operations.request_assignments
  ALTER COLUMN expert_id DROP NOT NULL;

ALTER TABLE operations.request_assignments
  DROP CONSTRAINT IF EXISTS request_assignments_status_check;
ALTER TABLE operations.request_assignments
  ADD CONSTRAINT request_assignments_status_check CHECK (status IN ('assigned', 'reassigned', 'completed', 'failed'));
