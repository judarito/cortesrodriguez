ALTER TABLE operations.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_email_status_check;

ALTER TABLE operations.app_notifications
  ADD CONSTRAINT app_notifications_email_status_check
  CHECK (email_status IN ('not_sent', 'accepted', 'sent', 'delivered', 'opened', 'failed', 'bounced', 'complained', 'pending_retry'));
