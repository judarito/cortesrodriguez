-- Audiencias dinámicas para reglas de notificación.

ALTER TABLE operations.notification_rules
  ADD COLUMN IF NOT EXISTS audiences TEXT[] NOT NULL DEFAULT ARRAY['configured']::TEXT[];

ALTER TABLE operations.notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_audiences_check;

ALTER TABLE operations.notification_rules
  ADD CONSTRAINT notification_rules_audiences_check CHECK (
    audiences <@ ARRAY['configured', 'client', 'agent', 'expert', 'admin', 'all_involved']::TEXT[]
    AND cardinality(audiences) > 0
  );
