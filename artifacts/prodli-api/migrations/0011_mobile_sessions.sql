-- Phone apps (iOS / Android) sign in with their own session type, "mobile".
-- SQLite can't change a CHECK constraint in place, so the sessions table is
-- rebuilt with the same columns and rows. (Nothing references sessions.)
PRAGMA defer_foreign_keys = true;

CREATE TABLE sessions_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  client       TEXT NOT NULL CHECK (client IN ('extension', 'web', 'mobile')),
  device       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

INSERT INTO sessions_new (id, user_id, token_hash, client, device, created_at, last_used_at, expires_at)
  SELECT id, user_id, token_hash, client, device, created_at, last_used_at, expires_at FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);
