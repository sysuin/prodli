-- AI daily briefs: a separate monthly allowance from meeting summaries.
CREATE TABLE IF NOT EXISTS brief_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
