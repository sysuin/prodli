-- Writing check (underlines in notes and, once turned on, in text boxes on the
-- web): each request checks a few paragraphs and counts once. Checks done by
-- Chrome's on-device model never reach the server and aren't counted.
CREATE TABLE IF NOT EXISTS proofread_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,          -- "YYYY-MM" (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
