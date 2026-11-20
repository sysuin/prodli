-- Shared meeting notes (src/shares.ts): a snapshot of a meeting's summary,
-- readable by anyone with the link at /s/<id> until it expires, the user stops
-- sharing, or the account is deleted. One row per (user, meeting).
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS shares_user_meeting ON shares (user_id, meeting_id);
