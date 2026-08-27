BEGIN;

ALTER TABLE question_attempts
  ADD COLUMN submitted_duration_ms INTEGER
  CONSTRAINT question_attempts_submitted_duration_nonnegative_check
    CHECK (submitted_duration_ms IS NULL OR submitted_duration_ms >= 0);

UPDATE question_attempts
SET submitted_duration_ms = duration_ms
WHERE duration_ms IS NOT NULL;

COMMIT;
