-- Answers from the "Why did you uninstall?" page (prodli.com/goodbye), which
-- Chrome opens after someone removes the extension. Anonymous: no user id, no
-- IP address, no browser details; only the reason, optional words and the
-- extension version.
CREATE TABLE IF NOT EXISTS uninstall_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uninstall_feedback_by_time ON uninstall_feedback (created_at);
