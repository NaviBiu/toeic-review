CREATE TABLE practice_sessions (
  id SERIAL PRIMARY KEY,
  practice_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('full_mock','part_drill')),
  title TEXT,
  notes TEXT,
  source_mock_exam_id INTEGER UNIQUE REFERENCES mock_exam_results(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE practice_part_scores (
  practice_session_id INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  part SMALLINT NOT NULL CHECK (part IN (1,2,3,4)),
  correct INTEGER NOT NULL CHECK (correct >= 0),
  total INTEGER NOT NULL CHECK (total >= 1 AND correct <= total),
  PRIMARY KEY (practice_session_id, part)
);

CREATE TABLE practice_scenario_scores (
  id SERIAL PRIMARY KEY,
  practice_session_id INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  scenario_major TEXT NOT NULL,
  scenario_minor TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct >= 0),
  total INTEGER NOT NULL CHECK (total >= 1 AND correct <= total)
);

INSERT INTO practice_sessions (practice_date, type, title, source_mock_exam_id, created_at)
SELECT test_date, 'full_mock', '完整模考', id, created_at
FROM mock_exam_results
ON CONFLICT (source_mock_exam_id) DO NOTHING;

INSERT INTO practice_part_scores (practice_session_id, part, correct, total)
SELECT ps.id, v.part, v.correct, v.total
FROM mock_exam_results mer
JOIN practice_sessions ps ON ps.source_mock_exam_id = mer.id
CROSS JOIN LATERAL (
  VALUES
    (1, mer.part1_correct, mer.part1_total),
    (2, mer.part2_correct, mer.part2_total),
    (3, mer.part3_correct, mer.part3_total),
    (4, mer.part4_correct, mer.part4_total)
) AS v(part, correct, total)
ON CONFLICT (practice_session_id, part) DO NOTHING;

INSERT INTO practice_scenario_scores (practice_session_id, scenario_major, scenario_minor, correct, total)
SELECT ps.id, mess.scenario_major, mess.scenario_minor, mess.correct, mess.total
FROM mock_exam_scenario_scores mess
JOIN practice_sessions ps ON ps.source_mock_exam_id = mess.mock_exam_result_id;
