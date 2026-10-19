-- Asignación privada de solicitudes y respuestas de expertos.

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS assigned_expert_id UUID REFERENCES operations.users(id),
  ADD COLUMN IF NOT EXISTS consultation_type_description TEXT;

CREATE INDEX IF NOT EXISTS idx_operations_requests_assigned_expert
  ON operations.requests(assigned_expert_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations.request_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  expert_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE RESTRICT,
  consultation_type_id UUID REFERENCES operations.consultation_types(id),
  strategy TEXT NOT NULL DEFAULT 'random_pool',
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'reassigned', 'completed', 'failed')),
  reason TEXT,
  assigned_by UUID REFERENCES operations.users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_request_assignments_expert
  ON operations.request_assignments(expert_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_operations_request_assignments_request
  ON operations.request_assignments(request_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS operations.expert_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  expert_id UUID NOT NULL REFERENCES operations.users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_admin_review', 'rejected', 'approved', 'sent')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES operations.users(id),
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_expert_responses_request
  ON operations.expert_responses(request_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_expert_responses_version
  ON operations.expert_responses(request_id, version);
