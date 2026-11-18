-- Audio transcription ("Transcribe audio with AI" in Meetings): seconds of audio per month.
CREATE TABLE IF NOT EXISTS transcribe_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
