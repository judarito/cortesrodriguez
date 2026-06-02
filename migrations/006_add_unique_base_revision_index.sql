CREATE UNIQUE INDEX IF NOT EXISTS idx_site_content_versions_key_base_revision_unique
  ON site_content_versions (content_key, base_revision);
