-- Lexical similarity holds likely duplicates for explicit admin validation.
ALTER TABLE operations.request_assignments
  DROP CONSTRAINT IF EXISTS request_assignments_status_check;
ALTER TABLE operations.request_assignments
  ADD CONSTRAINT request_assignments_status_check CHECK (status IN ('assigned', 'reassigned', 'completed', 'failed', 'similarity_review'));

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_event_code_check;
ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_event_code_check CHECK (event_code IN (
    'payment_approved', 'payment_rejected', 'request_created', 'status_changed',
    'expert_response_submitted', 'feedback_received', 'feedback_low', 'expert_assigned',
    'assignment_failed', 'similar_question_review'
  ));

ALTER TABLE operations.expert_responses
  ALTER COLUMN expert_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS response_origin TEXT NOT NULL DEFAULT 'expert'
    CHECK (response_origin IN ('expert', 'reused_answer')),
  ADD COLUMN IF NOT EXISTS source_response_id UUID REFERENCES operations.expert_responses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authored_by UUID REFERENCES operations.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS operations.request_similarity_reviews (
  request_id UUID PRIMARY KEY REFERENCES operations.requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answer_reused', 'forwarded_to_expert')),
  selected_response_id UUID REFERENCES operations.expert_responses(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.request_similarity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.request_similarity_reviews(request_id) ON DELETE CASCADE,
  response_id UUID NOT NULL REFERENCES operations.expert_responses(id) ON DELETE CASCADE,
  similarity_score NUMERIC(6,5) NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  shared_terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_request_similarity_reviews_status
  ON operations.request_similarity_reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_similarity_candidates_request
  ON operations.request_similarity_candidates(request_id, similarity_score DESC);

CREATE INDEX IF NOT EXISTS idx_requests_similarity_lookup
  ON operations.requests(consultation_type_id, service_type, created_at DESC)
  WHERE question IS NOT NULL AND question <> '';
CREATE INDEX IF NOT EXISTS idx_expert_responses_sent_request
  ON operations.expert_responses(request_id, version DESC)
  WHERE status = 'sent';
