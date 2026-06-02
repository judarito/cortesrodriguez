CREATE TABLE IF NOT EXISTS content_change_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  request_id TEXT NOT NULL,
  previous_updated_at TEXT,
  new_updated_at TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
