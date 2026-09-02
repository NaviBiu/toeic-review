# Task 3 Report: Category And Reading Note CRUD

## Status

DONE_WITH_CONCERNS

Implementation is complete. The database-backed integration suites were intentionally not run because the controller has not provided the required new approval. No Vercel Postgres, DeepSeek, OpenAI, or other paid/metered API call was made.

## Implementation

- Added one-level reading category CRUD with normalized names, active-name conflict handling, counts, default-category protection, lossless merge/delete destinations, and exact all-active-id reorder validation.
- Category reorder, merge, and delete own one transaction each and roll back on errors. Merge/delete lock category rows before moving notes and only then mark the source deleted.
- Added reading note list/create/update/status/delete/restore repositories with PostgreSQL snake-case to domain camel-case mapping.
- List reads join category names in one query and use `COUNT(*) OVER()` for pagination. Supported filters are `search`, `categoryId`, `status`, `dateFrom`, `dateTo`, `page`, and `pageSize`.
- Create and update always use `sanitizeReadingHtmlServer`, persist sanitized HTML/text/hash, reject empty content, normalize optional notes, and translate scoped duplicate violations to conflicts.
- Future create dates and HTTP update dates clamp to Shanghai today. Restoring a mastered note to active schedules it for today.
- Soft delete locks the note and captures the exact pre-delete SRS snapshot before mutation.
- Added HMAC-SHA256, base64url undo tokens signed with `AUTH_SECRET`. Tokens contain only `{ noteId, snapshot, expiresAt }`, expire after five minutes, use timing-safe signature comparison, and reject tampering or a mismatched note id before connecting to the database.
- Added strict Zod validation to all category/note route handlers and mapped invalid/not-found/conflict outcomes to HTTP 400/404/409.
- Documented `AUTH_SECRET` in `.env.example`.
- Migration `0008_reading_notes.sql` was not changed.

## RED Evidence

1. Initial required run:
   `npm.cmd test -- tests/unit/readingNotes/categories.test.ts tests/unit/readingNotes/noteValidation.test.ts`
   Result: 2 failed suites because `categories.ts` and `notes.ts` did not exist.
2. Sanitizer error mapping regression:
   `npm.cmd test -- tests/unit/readingNotes/noteValidation.test.ts`
   Result: 1 failed, 5 passed. Empty content returned a plain `Error` instead of `{ kind: 'invalid' }`.
3. Delete/status race regression:
   `npm.cmd test -- tests/unit/readingNotes/noteValidation.test.ts`
   Result: 1 failed, 6 passed. A zero-row concurrent status update caused a `TypeError` instead of a typed conflict.

## GREEN Evidence

- Required unit command: 2 files passed, 14 tests passed.
- Broader reading-note unit run: 4 files passed, 28 tests passed.
- Targeted ESLint over implementation and Task 3 tests: exit 0, no warnings or errors.
- `npm.cmd run build`: exit 0; compilation, Next.js TypeScript phase, page generation, and route discovery passed. All five new route modules appeared in the route manifest.
- `git diff --check`: no whitespace errors; Git only reported the configured LF-to-CRLF notice for `.env.example`.
- Standalone repository-wide `tsc --noEmit` remains nonzero because of pre-existing test typing errors outside Task 3. After the local tuple fix, filtering its output for `readingNotes`/`reading-note` produced no Task 3 diagnostics. The Next.js production TypeScript build passed.

## Tests Added

- `tests/unit/readingNotes/categories.test.ts`
  Category normalization, empty names, exact deletion plans/errors, complete reorder transaction, and rollback for missing/repeated ids.
- `tests/unit/readingNotes/noteValidation.test.ts`
  Empty content, date clamping/validation, exact undo snapshot round-trip, tamper/expiry rejection, and concurrent-delete status protection.
- `tests/integration/readingNotesCrud.test.ts`
  Scoped duplicate behavior, lossless merge, uncategorized delete destination, mastered/delete/exact restore/active scheduling. Includes nested-savepoint adaptation so repository-owned transactions cannot commit fixture rows.
- `tests/integration/readingNotesApi.test.ts`
  Validation before DB connection and tampered-token rejection before DB access.

## Files Changed

- `.env.example`
- `src/lib/readingNotes/categories.ts`
- `src/lib/readingNotes/notes.ts`
- `src/app/api/reading-note-categories/route.ts`
- `src/app/api/reading-note-categories/[id]/route.ts`
- `src/app/api/reading-note-categories/[id]/merge/route.ts`
- `src/app/api/reading-notes/route.ts`
- `src/app/api/reading-notes/[id]/route.ts`
- `tests/unit/readingNotes/categories.test.ts`
- `tests/unit/readingNotes/noteValidation.test.ts`
- `tests/integration/readingNotesCrud.test.ts`
- `tests/integration/readingNotesApi.test.ts`
- `.superpowers/sdd/task-3-report.md` (ignored project report)

## Self-Review

- Confirmed every required repository export and HTTP verb/path is present.
- Confirmed reorder compares a unique id set against every locked active category and writes all sort values in one SQL update.
- Confirmed merge/delete move all note statuses, including soft-deleted notes, before deleting the category, preventing later restore into a deleted category.
- Confirmed category/note unique violations become 409 conflicts and repository-specific missing rows become 404.
- Confirmed client-provided snapshots are not accepted by the restore schema; only the signed token payload reaches `restoreReadingNoteSnapshot`.
- Fixed two issues found during review: sanitizer errors now map to 400, and status/edit writes cannot race a delete into an unsigned restore.
- No actionable issue remains from the local review.

## Concerns

1. `tests/integration/readingNotesCrud.test.ts` and `tests/integration/readingNotesApi.test.ts` remain unexecuted by instruction. Real PostgreSQL SQL syntax, lock behavior, unique-index behavior, and live route/database wiring therefore remain the primary verification gap.
2. The deployed environment must receive a strong `AUTH_SECRET`; delete intentionally returns HTTP 500 when it is absent so unsigned undo cannot occur.
3. Repository-wide standalone `tsc --noEmit` is not clean due to unrelated existing test diagnostics, although the production build and Task 3 paths type-check.
