-- Cloudflare Queues transports outbox event IDs; Neon remains the durable source of truth.
ALTER TABLE operations.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_status_check,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'dispatching', 'queued', 'processing', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS notification_outbox_dispatch_idx
  ON operations.notification_outbox(status, next_attempt_at, dispatch_lease_expires_at)
  WHERE status IN ('pending', 'dispatching', 'processing');
