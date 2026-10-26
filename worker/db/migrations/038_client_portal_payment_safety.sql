-- Serializa la preparación del checkout para evitar preferencias concurrentes
-- de la misma solicitud (incluidos doble clic y pestañas múltiples).
ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS payment_preference_lease_token UUID,
  ADD COLUMN IF NOT EXISTS payment_preference_lease_expires_at TIMESTAMPTZ;

-- Conserva una sola aprobación canónica por solicitud, incluso si un checkout
-- antiguo se completa después de que el cliente inició un reintento.
ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS confirmed_payment_attempt_id UUID
    REFERENCES operations.request_payments(id) ON DELETE SET NULL;

WITH first_approved_attempt AS (
  SELECT DISTINCT ON (request_id) request_id, id
  FROM operations.request_payments
  WHERE status = 'approved'
  ORDER BY request_id, created_at, id
)
UPDATE operations.requests request
SET confirmed_payment_attempt_id = first_approved_attempt.id
FROM first_approved_attempt
WHERE request.id = first_approved_attempt.request_id
  AND request.confirmed_payment_attempt_id IS NULL;

WITH ranked_approved_attempts AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY created_at, id) AS attempt_number
  FROM operations.request_payments
  WHERE status = 'approved'
)
UPDATE operations.request_payments payment
SET status = 'duplicate_approved', updated_at = NOW()
FROM ranked_approved_attempts ranked
WHERE payment.id = ranked.id AND ranked.attempt_number > 1;

CREATE INDEX IF NOT EXISTS request_payments_active_attempt_idx
  ON operations.request_payments (request_id, created_at DESC)
  WHERE status IN ('pending', 'in_process', 'creating', 'creation_uncertain');
