BEGIN;

CREATE TABLE reading_note_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reading_note_categories_active_name_key
  ON reading_note_categories (normalized_name) WHERE status = 'active';

CREATE TABLE reading_notes (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES reading_note_categories(id),
  content_html TEXT NOT NULL CHECK (btrim(content_html) <> ''),
  content_text TEXT NOT NULL CHECK (btrim(content_text) <> ''),
  content_hash TEXT NOT NULL,
  notes TEXT,
  note_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mastered', 'deleted')),
  correct_streak INTEGER NOT NULL DEFAULT 0 CHECK (correct_streak >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  next_review_date DATE,
  last_reviewed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reading_notes_active_duplicate_key
  ON reading_notes (category_id, content_hash) WHERE status <> 'deleted';
CREATE INDEX reading_notes_queue_idx
  ON reading_notes (status, next_review_date, wrong_count DESC, id);
CREATE INDEX reading_notes_category_idx
  ON reading_notes (category_id, status, note_date DESC, id DESC);

CREATE TABLE reading_note_review_attempts (
  id SERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  note_id INTEGER NOT NULL REFERENCES reading_notes(id),
  decision TEXT NOT NULL CHECK (decision IN ('known', 'unknown')),
  review_date DATE NOT NULL,
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reading_note_attempts_latest_idx
  ON reading_note_review_attempts (note_id, id DESC);

INSERT INTO reading_note_categories
  (name, normalized_name, sort_order, is_default)
VALUES ('未分类', '未分类', 0, true);

COMMIT;
