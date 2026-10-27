-- Conserva la última versión conocida del estado financiero de Mercado Pago
-- para ignorar respuestas obtenidas antes de un evento más reciente.
ALTER TABLE operations.request_payments
  ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ;

-- Limita los intentos de creación de checkout por IP, además de exigir
-- autorización ligada a la solicitud recién creada o sesión del portal.
ALTER TABLE operations.public_request_rate_limits
  DROP CONSTRAINT IF EXISTS public_request_rate_limits_action_check;

ALTER TABLE operations.public_request_rate_limits
  ADD CONSTRAINT public_request_rate_limits_action_check
  CHECK (action IN ('token', 'request', 'payment_preference'));
