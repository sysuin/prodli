-- Phase 4: AI summaries through ProdLi's own Claude key, with a monthly allowance per user.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
