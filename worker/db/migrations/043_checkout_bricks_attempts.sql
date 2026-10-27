-- Preserve all historical payments as Checkout Pro and tag new attempts explicitly.
ALTER TABLE operations.request_payments
  ADD COLUMN IF NOT EXISTS checkout_mode TEXT NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS provider_submission_started_at TIMESTAMPTZ;

UPDATE operations.request_payments
SET checkout_mode = 'pro'
WHERE checkout_mode IS NULL;

ALTER TABLE operations.request_payments
  DROP CONSTRAINT IF EXISTS request_payments_checkout_mode_check;

ALTER TABLE operations.request_payments
  ADD CONSTRAINT request_payments_checkout_mode_check
  CHECK (checkout_mode IN ('pro', 'bricks'));

-- Bricks processing uses the same diagnostic/reconciliation pipeline as webhooks.
ALTER TABLE operations.payment_event_diagnostics
  DROP CONSTRAINT IF EXISTS payment_event_diagnostics_source_check;

ALTER TABLE operations.payment_event_diagnostics
  ADD CONSTRAINT payment_event_diagnostics_source_check
  CHECK (source IN ('webhook', 'browser_return', 'list_reconcile', 'admin_verify', 'bricks_process'));

-- Allow all reconciliation outcomes emitted by the current payment verifier.
ALTER TABLE operations.payment_event_diagnostics
  DROP CONSTRAINT IF EXISTS payment_event_diagnostics_match_status_check;

ALTER TABLE operations.payment_event_diagnostics
  ADD CONSTRAINT payment_event_diagnostics_match_status_check
  CHECK (match_status IN ('matched', 'mismatch', 'not_found', 'unapproved', 'unmatched', 'unverified', 'stale'));
