-- Shared videos (🎥 Record a video → Get a share link): one row per shared
-- recording; the file itself is in R2 (VIDEOS bucket) under `key`. Kept until
-- the owner stops sharing or deletes their account.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                 -- in the link: /v/<id>
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL,            -- the recording in the owner's ProdLi
  title TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  size INTEGER NOT NULL,               -- bytes, as announced before the upload
  mime TEXT NOT NULL,
  key TEXT NOT NULL,                   -- R2 object key
  upload_id TEXT,                      -- R2 multipart upload, until complete
  parts TEXT NOT NULL DEFAULT '[]',    -- uploaded parts [{partNumber, etag}]
  status TEXT NOT NULL,                -- 'uploading' | 'ready'
  payload TEXT NOT NULL DEFAULT '{}',  -- what the page shows: date, summary, transcript
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, meeting_id)
);
CREATE INDEX IF NOT EXISTS videos_user ON videos (user_id);
