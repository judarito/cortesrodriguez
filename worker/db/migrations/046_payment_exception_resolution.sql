-- Administrative case tracking for provider-synchronized payment exceptions.
-- This migration never rewrites request_payments.status.

CREATE TABLE IF NOT EXISTS operations.payment_exception_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES operations.request_payments(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('duplicate_approved', 'refunded', 'chargeback')),
  resolution_status TEXT NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open', 'pending_external', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (payment_id, exception_type)
);

CREATE INDEX IF NOT EXISTS payment_exception_cases_status_idx
  ON operations.payment_exception_cases (resolution_status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_exception_cases_request_idx
  ON operations.payment_exception_cases (request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations.payment_exception_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES operations.payment_exception_cases(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES operations.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'refund_requested', 'refund_confirmed', 'retain_approved_payment',
    'refund_verified', 'chargeback_acknowledged', 'chargeback_disputed', 'chargeback_closed'
  )),
  from_status TEXT NOT NULL CHECK (from_status IN ('open', 'pending_external')),
  to_status TEXT NOT NULL CHECK (to_status IN ('pending_external', 'resolved')),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  external_reference TEXT,
  idempotency_key TEXT NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_exception_action_reference_required CHECK (
    action_type NOT IN ('refund_confirmed', 'chargeback_disputed', 'chargeback_closed')
    OR NULLIF(BTRIM(external_reference), '') IS NOT NULL
  ),
  CONSTRAINT payment_exception_action_status CHECK (
    (action_type IN ('refund_requested', 'chargeback_acknowledged', 'chargeback_disputed') AND to_status = 'pending_external')
    OR (action_type IN ('refund_confirmed', 'retain_approved_payment', 'refund_verified', 'chargeback_closed') AND to_status = 'resolved')
  ),
  UNIQUE (case_id, actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_exception_actions_case_idx
  ON operations.payment_exception_actions (case_id, created_at DESC);

CREATE OR REPLACE FUNCTION operations.materialize_payment_exception_case()
RETURNS TRIGGER AS $$
DECLARE
  exception_kind TEXT;
BEGIN
  exception_kind := CASE NEW.status
    WHEN 'duplicate_approved' THEN 'duplicate_approved'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'charged_back' THEN 'chargeback'
    ELSE NULL
  END;

  IF exception_kind IS NOT NULL THEN
    INSERT INTO operations.payment_exception_cases (request_id, payment_id, exception_type)
    VALUES (NEW.request_id, NEW.id, exception_kind)
    ON CONFLICT (payment_id, exception_type) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS request_payment_exception_case ON operations.request_payments;
CREATE TRIGGER request_payment_exception_case
AFTER INSERT OR UPDATE OF status ON operations.request_payments
FOR EACH ROW EXECUTE FUNCTION operations.materialize_payment_exception_case();

INSERT INTO operations.payment_exception_cases (request_id, payment_id, exception_type)
SELECT request_id, id,
  CASE status
    WHEN 'duplicate_approved' THEN 'duplicate_approved'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'charged_back' THEN 'chargeback'
  END
FROM operations.request_payments
WHERE status IN ('duplicate_approved', 'refunded', 'charged_back')
ON CONFLICT (payment_id, exception_type) DO NOTHING;
