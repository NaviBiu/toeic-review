CREATE TABLE knowledge_points (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example TEXT NOT NULL,
  notes TEXT,
  part SMALLINT NOT NULL CHECK (part IN (1,2,3,4)),
  scenario_major TEXT NOT NULL,
  scenario_minor TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT 'listening',
  date_added DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','deleted')),
  correct_streak INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  next_review_date DATE,
  last_reviewed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches src/lib/termNormalize.ts's normalizeTerm() exactly (lowercase, strip
-- whitespace/hyphen/apostrophe) so "check-in"/"check in"/"checkin" collide here too,
-- not just in the application-level findMatch() check.
CREATE UNIQUE INDEX knowledge_points_unique_key
  ON knowledge_points (
    lower(regexp_replace(term, '[\s''-]', '', 'g')),
    part, scenario_major, scenario_minor, skill
  )
  WHERE status != 'deleted';

CREATE INDEX knowledge_points_queue_idx
  ON knowledge_points (status, next_review_date);

CREATE TABLE mock_exam_results (
  id SERIAL PRIMARY KEY,
  test_date DATE NOT NULL,
  part1_correct INTEGER NOT NULL CHECK (part1_correct >= 0),
  part1_total INTEGER NOT NULL CHECK (part1_total >= 1 AND part1_correct <= part1_total),
  part2_correct INTEGER NOT NULL CHECK (part2_correct >= 0),
  part2_total INTEGER NOT NULL CHECK (part2_total >= 1 AND part2_correct <= part2_total),
  part3_correct INTEGER NOT NULL CHECK (part3_correct >= 0),
  part3_total INTEGER NOT NULL CHECK (part3_total >= 1 AND part3_correct <= part3_total),
  part4_correct INTEGER NOT NULL CHECK (part4_correct >= 0),
  part4_total INTEGER NOT NULL CHECK (part4_total >= 1 AND part4_correct <= part4_total),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mock_exam_scenario_scores (
  id SERIAL PRIMARY KEY,
  mock_exam_result_id INTEGER NOT NULL REFERENCES mock_exam_results(id) ON DELETE CASCADE,
  scenario_major TEXT NOT NULL,
  scenario_minor TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct >= 0),
  total INTEGER NOT NULL CHECK (total >= 1 AND correct <= total)
);
