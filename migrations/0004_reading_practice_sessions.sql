ALTER TABLE practice_sessions
  ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'listening';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'practice_sessions_section_check'
      AND conrelid = 'practice_sessions'::regclass
  ) THEN
    ALTER TABLE practice_sessions
      ADD CONSTRAINT practice_sessions_section_check
      CHECK (section IN ('listening', 'reading'));
  END IF;
END
$$;

ALTER TABLE practice_part_scores
  DROP CONSTRAINT IF EXISTS practice_part_scores_part_check;

ALTER TABLE practice_part_scores
  ADD CONSTRAINT practice_part_scores_part_check
  CHECK (part IN (1, 2, 3, 4, 5, 6, 7));
