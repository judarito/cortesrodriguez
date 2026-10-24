-- Idempotency for public request submissions. Store only hashes, never the
-- browser-provided key or raw submission payload.
ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS public_idempotency_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS public_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS public_submission_completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS operations_requests_public_idempotency_key_idx
  ON operations.requests (public_idempotency_key_hash)
  WHERE public_idempotency_key_hash IS NOT NULL;
