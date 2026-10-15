CREATE TABLE IF NOT EXISTS operations.notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  recipient_type TEXT NOT NULL DEFAULT 'to' CHECK (recipient_type IN ('to', 'cc', 'bcc')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event_code TEXT NOT NULL CHECK (event_code IN ('payment_approved', 'payment_rejected', 'request_created', 'status_changed')),
  service_type TEXT NOT NULL DEFAULT 'all' CHECK (service_type IN ('all', 'importacion', 'exportacion')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_code, service_type)
);

CREATE TABLE IF NOT EXISTS operations.notification_rule_recipients (
  rule_id UUID NOT NULL REFERENCES operations.notification_rules(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES operations.notification_recipients(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_event_service
  ON operations.notification_rules(event_code, service_type, active);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_active
  ON operations.notification_recipients(active);
