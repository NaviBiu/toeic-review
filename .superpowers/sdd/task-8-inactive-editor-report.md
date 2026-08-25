# Task 8 Report: Inactive Category Question Editing

## Status

Implemented inactive-category question editing and status management in this commit.

## Delivered

- Kept the workspace's initial category request active-only so summaries, library filters, category management, and training retain their existing first-load behavior.
- Added a separate abortable `includeInactive=true` category request while editing an existing question.
- Preserved the question's original category ID while inclusive editor data loads instead of falling back to the first active child.
- Rendered inactive parent and child options with visible labels and disabled them as explicit destinations.
- Allowed status/content updates when the submitted category ID is unchanged, including questions under an inactive child or inactive parent.
- Retained active-category validation for creates and actual category changes, including rejection of moves to an inactive child or a child under an inactive parent.

## TDD Evidence

The initial focused run failed in five expected places:

- no inclusive editor category request was made;
- inactive child editing fell back from category `12` to active category `11`;
- inactive parent editing fell back from parent `2` to active parent `1`;
- status-only updates rejected an unchanged inactive category;
- content updates rejected an explicitly retained inactive category ID.

After the implementation, the focused regression suite passed all 23 tests.

## Verification

- `npm.cmd test -- tests/unit/questionReview/questions.test.ts tests/unit/questionReview/inactiveQuestionEditor.test.tsx`
  - Passed: 2 files, 23 tests.
- `npm.cmd test -- tests/unit/questionReview`
  - Passed: 12 files, 62 tests.
- `npm.cmd run lint -- src/components/part5/Part5Workspace.tsx src/components/part5/QuestionEditorModal.tsx src/lib/questionReview/questions.ts tests/unit/questionReview/questions.test.ts tests/unit/questionReview/inactiveQuestionEditor.test.tsx`
  - Passed.
- `npm.cmd run build`
  - Passed. Next.js emitted the existing multiple-lockfile workspace-root warning.

## Constraints

- No real database or model calls were made.
- No development server was started.
- No migrations, category/session repositories, shared types, or unrelated application files were edited.
