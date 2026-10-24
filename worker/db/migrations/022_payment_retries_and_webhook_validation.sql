-- Permite varios intentos de checkout por solicitud y deduplica reintentos HTTP.
ALTER TABLE operations.request_payments
  DROP CONSTRAINT IF EXISTS request_payments_reference_key;

ALTER TABLE operations.request_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS init_point TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS request_payments_request_attempt_idx
  ON operations.request_payments (request_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS request_payments_reference_created_idx
  ON operations.request_payments (reference, created_at DESC);
