-- Writing help ("✨ Improve" in Notes): its own monthly allowance.
CREATE TABLE IF NOT EXISTS write_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
