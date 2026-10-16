CREATE TABLE IF NOT EXISTS operations.service_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'COP' CHECK (currency IN ('COP', 'USD')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operations.service_catalog (code, name, amount_cents, currency)
VALUES ('asesoria_personalizada', 'Asesoría personalizada', 0, 'COP')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS service_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_currency TEXT NOT NULL DEFAULT 'COP';
