CREATE TABLE IF NOT EXISTS operations.request_payments (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES operations.requests(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  usd_amount_cents INTEGER NOT NULL,
  trm_cop_per_usd NUMERIC(14,4) NOT NULL,
  cop_amount_cents INTEGER NOT NULL,
  trm_effective_date DATE NOT NULL,
  mercado_pago_preference_id TEXT,
  mercado_pago_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS request_payments_request_id_idx ON operations.request_payments(request_id);
