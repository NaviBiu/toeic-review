BEGIN;

ALTER TABLE question_review_session_items
  ADD COLUMN correct_option_snapshot TEXT,
  ADD COLUMN analysis_snapshot TEXT,
  ADD COLUMN notes_snapshot TEXT;

CREATE FUNCTION set_question_review_session_item_snapshots()
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

CREATE TRIGGER question_review_session_items_set_snapshots
BEFORE INSERT ON question_review_session_items
FOR EACH ROW
EXECUTE FUNCTION set_question_review_session_item_snapshots();

UPDATE question_review_session_items AS item
SET correct_option_snapshot = question.correct_option,
  analysis_snapshot = question.analysis,
  notes_snapshot = question.notes
FROM review_questions AS question
WHERE question.id = item.question_id;

ALTER TABLE question_review_session_items
  ADD CONSTRAINT question_review_session_items_correct_option_snapshot_check
    CHECK (correct_option_snapshot IN ('A', 'B', 'C', 'D')) NOT VALID,
  ADD CONSTRAINT question_review_session_items_correct_option_snapshot_not_null
    CHECK (correct_option_snapshot IS NOT NULL) NOT VALID,
  ADD CONSTRAINT question_review_session_items_analysis_snapshot_not_null
    CHECK (analysis_snapshot IS NOT NULL) NOT VALID;

ALTER TABLE question_review_session_items
  VALIDATE CONSTRAINT question_review_session_items_correct_option_snapshot_check;

ALTER TABLE question_review_session_items
  VALIDATE CONSTRAINT question_review_session_items_correct_option_snapshot_not_null;

ALTER TABLE question_review_session_items
  VALIDATE CONSTRAINT question_review_session_items_analysis_snapshot_not_null;

ALTER TABLE question_review_session_items
  ALTER COLUMN correct_option_snapshot SET NOT NULL,
  ALTER COLUMN analysis_snapshot SET NOT NULL;

ALTER TABLE question_review_session_items
  DROP CONSTRAINT question_review_session_items_correct_option_snapshot_not_null,
  DROP CONSTRAINT question_review_session_items_analysis_snapshot_not_null;

COMMIT;
