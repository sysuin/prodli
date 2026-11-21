-- Desktop apps (Mac / Windows) sign in with their own session type, "desktop".
-- They sign in through the browser: app.prodli.com (already signed in with
-- Google) hands the app a one-time code over a loopback redirect, and the app
-- trades it for a session (with a PKCE verifier, so an intercepted code is
-- useless). Codes live in desktop_codes for five minutes and work once.
--
-- SQLite can't change a CHECK constraint in place, so the sessions table is
-- rebuilt with the same columns and rows (as in 0011).
PRAGMA defer_foreign_keys = true;

CREATE TABLE sessions_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  client       TEXT NOT NULL CHECK (client IN ('extension', 'web', 'mobile', 'desktop')),
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

CREATE TABLE IF NOT EXISTS desktop_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_codes_by_expiry ON desktop_codes(expires_at);
