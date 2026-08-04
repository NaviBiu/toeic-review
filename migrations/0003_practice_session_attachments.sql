CREATE TABLE practice_session_attachments (
  id SERIAL PRIMARY KEY,
  practice_session_id INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
  data_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX practice_session_attachments_session_idx
  ON practice_session_attachments (practice_session_id, id);
