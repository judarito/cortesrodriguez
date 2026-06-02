CREATE TABLE IF NOT EXISTS site_content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT 'system',
  source TEXT NOT NULL DEFAULT 'system',
  base_revision TEXT,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_content_versions_key_id
  ON site_content_versions (content_key, id DESC);
