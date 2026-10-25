ALTER TABLE operations.clients
  ADD COLUMN IF NOT EXISTS email_normalized TEXT;

-- Backfill an identity email for each existing client using its latest request.
WITH latest_client_email AS (
  SELECT DISTINCT ON (r.client_id)
    r.client_id,
    LOWER(BTRIM(r.email)) AS email_normalized
  FROM operations.requests r
  WHERE NULLIF(BTRIM(r.email), '') IS NOT NULL
  ORDER BY r.client_id, r.created_at DESC, r.id DESC
)
UPDATE operations.clients c
SET email_normalized = source.email_normalized
FROM latest_client_email source
WHERE c.id = source.client_id
  AND c.email_normalized IS NULL;

CREATE TABLE IF NOT EXISTS operations.client_identity_merges (
  source_client_id UUID PRIMARY KEY,
  canonical_client_id UUID NOT NULL,
  source_full_name TEXT NOT NULL,
  source_email_normalized TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Merge historical duplicate client rows into the oldest row for each email.
WITH client_map AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (PARTITION BY email_normalized ORDER BY created_at, id) AS canonical_id
  FROM operations.clients
  WHERE email_normalized IS NOT NULL
)
INSERT INTO operations.client_identity_merges (source_client_id, canonical_client_id, source_full_name, source_email_normalized)
SELECT duplicate.id, duplicate.canonical_id, client.full_name, client.email_normalized
FROM client_map duplicate
JOIN operations.clients client ON client.id = duplicate.id
WHERE duplicate.id <> duplicate.canonical_id
ON CONFLICT (source_client_id) DO NOTHING;

WITH client_map AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (PARTITION BY email_normalized ORDER BY created_at, id) AS canonical_id
  FROM operations.clients
  WHERE email_normalized IS NOT NULL
)
UPDATE operations.requests r
SET client_id = client_map.canonical_id
FROM client_map
WHERE r.client_id = client_map.id
  AND client_map.id <> client_map.canonical_id;

WITH client_map AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (PARTITION BY email_normalized ORDER BY created_at, id) AS canonical_id
  FROM operations.clients
  WHERE email_normalized IS NOT NULL
)
DELETE FROM operations.clients c
USING client_map
WHERE c.id = client_map.id
  AND client_map.id <> client_map.canonical_id;

CREATE UNIQUE INDEX IF NOT EXISTS operations_clients_email_normalized_unique
  ON operations.clients (email_normalized);
