-- Voice dictation (Alt+Shift+D in the extension): AI polish and Command Mode
-- requests get their own monthly allowance. The audio itself counts against
-- transcribe_usage (seconds), like other AI transcription.
CREATE TABLE IF NOT EXISTS dictate_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
