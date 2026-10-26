ALTER TABLE operations.expert_responses
  ADD COLUMN IF NOT EXISTS internal_note TEXT;
