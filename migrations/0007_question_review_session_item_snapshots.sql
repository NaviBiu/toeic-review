BEGIN;

ALTER TABLE question_review_session_items
  ADD COLUMN IF NOT EXISTS correct_option_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS analysis_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS notes_snapshot TEXT;

CREATE OR REPLACE FUNCTION set_question_review_session_item_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.correct_option_snapshot IS NULL OR NEW.analysis_snapshot IS NULL THEN
    SELECT question.correct_option, question.analysis, question.notes
    INTO NEW.correct_option_snapshot, NEW.analysis_snapshot, NEW.notes_snapshot
    FROM review_questions AS question
    WHERE question.id = NEW.question_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS question_review_session_items_set_snapshots
  ON question_review_session_items;

CREATE TRIGGER question_review_session_items_set_snapshots
BEFORE INSERT ON question_review_session_items
FOR EACH ROW
EXECUTE FUNCTION set_question_review_session_item_snapshots();

COMMIT;

BEGIN;

UPDATE question_review_session_items AS item
SET correct_option_snapshot = question.correct_option,
  analysis_snapshot = question.analysis,
  notes_snapshot = question.notes
FROM review_questions AS question
WHERE question.id = item.question_id
  AND (item.correct_option_snapshot IS NULL OR item.analysis_snapshot IS NULL);

COMMIT;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'question_review_session_items_correct_option_snapshot_check'
      AND conrelid = 'question_review_session_items'::regclass
  ) THEN
    ALTER TABLE question_review_session_items
      ADD CONSTRAINT question_review_session_items_correct_option_snapshot_check
        CHECK (correct_option_snapshot IN ('A', 'B', 'C', 'D')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'question_review_session_items_correct_option_snapshot_not_null'
      AND conrelid = 'question_review_session_items'::regclass
  ) THEN
    ALTER TABLE question_review_session_items
      ADD CONSTRAINT question_review_session_items_correct_option_snapshot_not_null
        CHECK (correct_option_snapshot IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'question_review_session_items_analysis_snapshot_not_null'
      AND conrelid = 'question_review_session_items'::regclass
  ) THEN
    ALTER TABLE question_review_session_items
      ADD CONSTRAINT question_review_session_items_analysis_snapshot_not_null
        CHECK (analysis_snapshot IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

COMMIT;

BEGIN;

ALTER TABLE question_review_session_items
  VALIDATE CONSTRAINT question_review_session_items_correct_option_snapshot_check,
  VALIDATE CONSTRAINT question_review_session_items_correct_option_snapshot_not_null,
  VALIDATE CONSTRAINT question_review_session_items_analysis_snapshot_not_null;

COMMIT;

BEGIN;

ALTER TABLE question_review_session_items
  ALTER COLUMN correct_option_snapshot SET NOT NULL,
  ALTER COLUMN analysis_snapshot SET NOT NULL;

ALTER TABLE question_review_session_items
  DROP CONSTRAINT IF EXISTS question_review_session_items_correct_option_snapshot_not_null,
  DROP CONSTRAINT IF EXISTS question_review_session_items_analysis_snapshot_not_null;

COMMIT;
