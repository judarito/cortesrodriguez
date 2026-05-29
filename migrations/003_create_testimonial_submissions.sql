CREATE TABLE IF NOT EXISTS testimonial_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  locale TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  review_notes TEXT,
  published_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
