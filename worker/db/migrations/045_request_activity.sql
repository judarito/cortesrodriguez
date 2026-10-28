-- Internal comments and audited manual status transitions for requests.

CREATE TABLE IF NOT EXISTS operations.request_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  author_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility = 'internal'),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_comments_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  CONSTRAINT request_comments_idempotency_key_format CHECK (
    idempotency_key IS NULL OR (
      char_length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_operations_request_comments_request
  ON operations.request_comments(request_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_request_comments_idempotency
  ON operations.request_comments(request_id, author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS operations.request_status_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'close', 'reopen')),
  from_status TEXT NOT NULL CHECK (from_status IN ('pending', 'in_review', 'in_progress', 'closed', 'cancelled')),
  to_status TEXT NOT NULL CHECK (to_status IN ('cancelled', 'closed', 'in_progress')),
  reason TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_status_transitions_action_status CHECK (
    (action = 'cancel' AND to_status = 'cancelled')
    OR (action = 'close' AND to_status = 'closed')
    OR (action = 'reopen' AND to_status = 'in_progress')
  ),
  CONSTRAINT request_status_transitions_allowed_origin CHECK (
    (action IN ('cancel', 'close') AND from_status IN ('pending', 'in_review', 'in_progress'))
    OR (action = 'reopen' AND from_status IN ('closed', 'cancelled'))
  ),
  CONSTRAINT request_status_transitions_changes_status CHECK (from_status <> to_status),
  CONSTRAINT request_status_transitions_reason_length CHECK (
    reason IS NULL OR char_length(reason) <= 1000
  ),
  CONSTRAINT request_status_transitions_idempotency_key_format CHECK (
    idempotency_key IS NULL OR (
      char_length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_operations_request_status_transitions_request
  ON operations.request_status_transitions(request_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_request_status_transitions_idempotency
  ON operations.request_status_transitions(request_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
