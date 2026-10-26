CREATE TABLE IF NOT EXISTS operations.public_request_attribution_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  attribution_type TEXT NOT NULL CHECK (attribution_type IN ('direct_web', 'agent_link')),
  agent_link_id UUID REFERENCES operations.agent_links(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((attribution_type = 'direct_web' AND agent_link_id IS NULL) OR (attribution_type = 'agent_link' AND agent_link_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_public_request_attribution_expiry
  ON operations.public_request_attribution_tokens(expires_at)
  WHERE revoked_at IS NULL;

INSERT INTO operations.public_request_attribution_tokens (token_hash, attribution_type, agent_link_id, expires_at, revoked_at)
SELECT token_hash, 'agent_link', id, COALESCE(expires_at, NOW() + INTERVAL '1 year'), revoked_at
FROM operations.agent_links
ON CONFLICT (token_hash) DO NOTHING;
