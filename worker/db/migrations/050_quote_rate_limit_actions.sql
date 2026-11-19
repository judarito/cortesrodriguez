-- Permite los buckets usados por el ciclo de cotización pública:
-- emisión de cotización, conversión a reserva y gestión de adjuntos.
ALTER TABLE operations.public_request_rate_limits
  DROP CONSTRAINT IF EXISTS public_request_rate_limits_action_check;

ALTER TABLE operations.public_request_rate_limits
  ADD CONSTRAINT public_request_rate_limits_action_check
  CHECK (action IN (
    'token',
    'request',
    'payment_preference',
    'payment_bricks_intent',
    'payment_bricks_process',
    'quote',
    'quote_convert',
    'quote_attachment_upload',
    'quote_attachment_delete'
  ));
