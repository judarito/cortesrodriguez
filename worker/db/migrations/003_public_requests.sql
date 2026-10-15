CREATE TABLE IF NOT EXISTS operations.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES operations.clients(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'landingpage',
  legal_entity_type TEXT NOT NULL CHECK (legal_entity_type IN ('natural', 'juridica')),
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  service_type TEXT NOT NULL CHECK (service_type IN ('exportacion', 'importacion')),
  freight_agent TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('vehiculos', 'mercancias')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'in_progress', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_requests_status
  ON operations.requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operations_requests_client
  ON operations.requests(client_id);
