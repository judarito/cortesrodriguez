-- Allow the dedicated public rate-limit buckets used by Checkout Bricks.
ALTER TABLE operations.public_request_rate_limits
  DROP CONSTRAINT IF EXISTS public_request_rate_limits_action_check;

ALTER TABLE operations.public_request_rate_limits
  ADD CONSTRAINT public_request_rate_limits_action_check
  CHECK (action IN (
    'token',
    'request',
    'payment_preference',
    'payment_bricks_intent',
    'payment_bricks_process'
  ));
