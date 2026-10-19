-- Feedback seguro del cliente sobre una respuesta aprobada.

CREATE TABLE IF NOT EXISTS operations.client_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  response_id UUID NOT NULL REFERENCES operations.expert_responses(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received', 'reviewed', 'escalated')),
  reviewed_by UUID REFERENCES operations.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_feedback_response
  ON operations.client_feedback(response_id);

CREATE INDEX IF NOT EXISTS idx_operations_feedback_status
  ON operations.client_feedback(status, created_at DESC);
