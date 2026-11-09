-- Phase 5: nightly backups of each user's synced data to R2 (see src/backup.ts).
CREATE TABLE IF NOT EXISTS backups (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,      -- the user's sync sequence number at the last backup
  at INTEGER NOT NULL,       -- when (ms)
  key TEXT NOT NULL          -- R2 prefix of that backup
);
