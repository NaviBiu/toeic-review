BEGIN;

CREATE TABLE question_categories (
  id SERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('reading')),
  part SMALLINT NOT NULL CHECK (part IN (5, 6, 7)),
  parent_id INTEGER REFERENCES question_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX question_categories_active_root_name_unique
  ON question_categories (section, part, lower(name))
  WHERE parent_id IS NULL AND status = 'active';

CREATE UNIQUE INDEX question_categories_active_child_name_unique
  ON question_categories (parent_id, lower(name))
  WHERE parent_id IS NOT NULL AND status = 'active';

CREATE TABLE review_questions (
  id SERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('reading')),
  part SMALLINT NOT NULL CHECK (part IN (5, 6, 7)),
  question_format TEXT NOT NULL CHECK (question_format IN ('single_choice')),
  stem TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  analysis TEXT NOT NULL,
  notes TEXT,
  source TEXT,
  category_id INTEGER NOT NULL REFERENCES question_categories(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'learning' CHECK (status IN ('learning', 'mastered', 'inactive', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_questions_category_status_idx
  ON review_questions (category_id, status, id);

CREATE TABLE question_review_sessions (
  id SERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('reading')),
  part SMALLINT NOT NULL CHECK (part IN (5, 6, 7)),
  mode TEXT NOT NULL CHECK (mode IN ('weak_first', 'random')),
  category_scope_id INTEGER REFERENCES question_categories(id) ON DELETE SET NULL,
  include_mastered BOOLEAN NOT NULL DEFAULT false,
  planned_count INTEGER NOT NULL CHECK (planned_count >= 1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE question_review_session_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES question_review_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES review_questions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, question_id),
  UNIQUE (session_id, position)
);

CREATE TABLE question_attempts (
  id SERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  session_id INTEGER NOT NULL REFERENCES question_review_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES review_questions(id) ON DELETE RESTRICT,
  selected_option TEXT NOT NULL CHECK (selected_option IN ('A', 'B', 'C', 'D')),
  is_correct BOOLEAN NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  duration_excluded BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX question_attempts_question_attempted_at_idx
  ON question_attempts (question_id, attempted_at DESC, id DESC);

WITH seeded_parents AS (
  INSERT INTO question_categories (section, part, name, sort_order)
  VALUES
    ('reading', 5, '词性判断', 1),
    ('reading', 5, '固定搭配', 2),
    ('reading', 5, '连接词', 3),
    ('reading', 5, '介词搭配', 4),
    ('reading', 5, '语法（时态、语态、从句）', 5),
    ('reading', 5, '词汇辨析', 6)
  RETURNING id, section, part
)
INSERT INTO question_categories (section, part, parent_id, name, sort_order, is_default)
SELECT section, part, id, '未细分', 0, true
FROM seeded_parents;

COMMIT;
