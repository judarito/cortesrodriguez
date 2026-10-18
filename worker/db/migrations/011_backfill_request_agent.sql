UPDATE operations.requests
SET agent_id = created_by,
    source_channel = 'agent_link'
WHERE source = 'agent'
  AND agent_id IS NULL
  AND created_by IS NOT NULL;
