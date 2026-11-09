-- Accounts and sessions (phase 1). Users' notes, to-dos etc. do NOT live here:
-- from phase 2 each user's data lives in their own Durable Object.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,               -- random UUID, never derived from Google data
  google_sub   TEXT NOT NULL UNIQUE,           -- Google's stable account ID
  email        TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  picture      TEXT,
  plan         TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro' (later)
  created_at   INTEGER NOT NULL,               -- ms since epoch
  updated_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Only a SHA-256 hash of each session token is stored, so a database leak
-- doesn't hand out working sessions.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  client       TEXT NOT NULL CHECK (client IN ('extension', 'web')),
  device       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);
