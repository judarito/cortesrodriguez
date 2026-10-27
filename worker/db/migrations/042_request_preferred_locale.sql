ALTER TABLE operations.requests
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'es';

ALTER TABLE operations.requests
  DROP CONSTRAINT IF EXISTS requests_preferred_locale_check;

ALTER TABLE operations.requests
  ADD CONSTRAINT requests_preferred_locale_check
  CHECK (preferred_locale IN ('es', 'en'));
