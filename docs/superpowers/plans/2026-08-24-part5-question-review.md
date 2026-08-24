# Part 5 Question Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended when suitable) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extensible Part 5 wrong-question library with editable two-level categories, manual statuses, random or weak-first practice, automatic A-D grading, editable timing, and latest-result accuracy statistics.

**Architecture:** Add generic reading-question tables and focused domain modules under `src/lib/questionReview/`; keep route handlers thin and expose Part 5 through a dedicated `/reading/part5` client workspace. Session creation freezes a weighted, non-repeating question order, while immutable attempts provide correctness and latest-result statistics without denormalized counters.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript 5 strict mode, Vercel Postgres, Zod 4, Vitest 4, Tailwind CSS 4.

**Approved Spec:** `docs/superpowers/specs/2026-08-24-part5-question-review-design.md`

## Global Constraints

- Phase one exposes only reading Part 5; do not add visible Part 6 or Part 7 placeholders.
- Keep the existing listening review model unchanged.
- Use only local parsing for pasted questions; do not call DeepSeek, OpenAI, OCR, or any other paid API.
- Categories are exactly two levels; every top-level category owns one non-deletable default child named `未细分`.
- Seed exactly these top-level categories: `词性判断`, `固定搭配`, `连接词`, `介词搭配`, `语法（时态、语态、从句）`, and `词汇辨析`.
- Question status is user-controlled: `learning`, `mastered`, `inactive`, or `deleted`.
- Answer history never changes a question's status automatically.
- Unattempted questions do not enter accuracy denominators and must remain visible as a separate count.
- Category accuracy uses only each attempted question's latest result; `inactive` and `deleted` questions are excluded from current statistics.
- Every answer reveals analysis and notes, whether the answer is correct or wrong.
- A session uses a frozen, non-repeating order. If fewer questions are available than requested, shorten the session and report the actual count.
- Weak-first weights are exactly: unattempted `4`, latest wrong `3`, and latest correct `1`.
- The approved UI is quiet and work-focused: neutral page background, limited status color, no gradients, no nested cards, and card/dialog border radius at most `8px` for new Part 5 surfaces.
- Real database migration and integration tests touch the configured Vercel Postgres quota; obtain explicit user approval immediately before running them.
- Do not deploy to Preview or Production until local browser acceptance passes and the user explicitly approves deployment.

---

## File Structure

- `migrations/0005_part5_question_review.sql`: additive tables, constraints, indexes, and six seeded category trees.
- `src/lib/questionReview/types.ts`: shared domain and API types.
- `src/lib/questionReview/parser.ts`: browser-safe pasted-question parser.
- `src/lib/questionReview/categories.ts`: category tree, statistics, mutation, move, merge, and delete rules.
- `src/lib/questionReview/questions.ts`: question validation, pagination, CRUD, status transitions, and per-question aggregates.
- `src/lib/questionReview/selection.ts`: deterministic random and weak-first weighted selection.
- `src/lib/questionReview/sessions.ts`: transactional session creation, attempt submission, idempotency, and timing edits.
- `src/lib/questionReview/timing.ts`: pure elapsed-time and manual-duration normalization helpers.
- `src/app/api/question-categories/**`: category HTTP contract.
- `src/app/api/review-questions/**`: question HTTP contract.
- `src/app/api/question-review-sessions/route.ts`: training-session creation contract.
- `src/app/api/question-attempts/**`: answer and timing-update contract.
- `src/app/reading/part5/page.tsx`: route-level page shell.
- `src/components/part5/Part5Workspace.tsx`: loading, tabs, shared refresh, and errors.
- `src/components/part5/QuestionLibrary.tsx`: filters, table, status controls, pagination, and edit entry points.
- `src/components/part5/QuestionEditorModal.tsx`: local paste parsing and create/edit form.
- `src/components/part5/CategoryManager.tsx`: two-column category maintenance.
- `src/components/part5/TrainingSetup.tsx`: range, mode, question count, and mastered toggle.
- `src/components/part5/TrainingSession.tsx`: timer, answer controls, reveal, timing correction, and progress.
- `tests/unit/questionReview/*.test.ts`: parser, selection, and pure validation tests.
- `tests/integration/questionReview*.test.ts`: schema, repositories, idempotency, statistics, and route contracts.

---

### Task 1: Add The Generic Question Review Schema And Types

**Files:**
- Create: `migrations/0005_part5_question_review.sql`
- Create: `src/lib/questionReview/types.ts`
- Modify: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces `QuestionCategory`, `ReviewQuestion`, `QuestionStatus`, `QuestionListItem`, `TrainingMode`, `SessionQuestion`, `AttemptResult`, and `CategoryNode`.
- Produces tables `question_categories`, `review_questions`, `question_review_sessions`, `question_review_session_items`, and `question_attempts`.

- [ ] **Step 1: Write failing schema tests for default children, option constraints, and idempotency**

Add tests that query the six seeded parent categories and insert one valid Part 5 question. Use this exact valid row shape:

```ts
const { rows: [category] } = await client.query(
  `SELECT id FROM question_categories
   WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
   ORDER BY id LIMIT 1`,
);
const { rows: [question] } = await client.query(
  `INSERT INTO review_questions
   (section, part, question_format, stem, option_a, option_b, option_c, option_d,
    correct_option, analysis, category_id)
   VALUES ('reading', 5, 'single_choice', 'The report is ___ complete.',
    'near', 'nearly', 'nearest', 'nearness', 'B', '副词修饰形容词。', $1)
   RETURNING id`,
  [category.id],
);
expect(question.id).toBeTypeOf('number');
```

Also assert a duplicate `question_attempts.request_id` is rejected and duplicate `(session_id, question_id)` is rejected.

- [ ] **Step 2: Run the focused schema test and verify it fails before migration**

Run only after receiving database approval:

```powershell
npm.cmd test -- tests/integration/schema.test.ts
```

Expected before migration: FAIL because `question_categories` does not exist.

- [ ] **Step 3: Add the migration with exact constraints and indexes**

Create all five tables with these enforced values:

```sql
-- question_categories
status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
-- review_questions
status TEXT NOT NULL CHECK (status IN ('learning', 'mastered', 'inactive', 'deleted'))
question_format TEXT NOT NULL CHECK (question_format IN ('single_choice'))
correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D'))
-- question_review_sessions
mode TEXT NOT NULL CHECK (mode IN ('weak_first', 'random'))
-- question_attempts
duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)
```

Add unique constraints on `question_attempts(request_id)`, `(session_id, question_id)`, `(session_id, position)`, and partial active sibling-name indexes. Seed the six approved top-level categories and one `未细分` child under each in a single migration transaction.

- [ ] **Step 4: Define shared TypeScript contracts without database-specific row names**

Use this public type shape in `types.ts`:

```ts
export type QuestionStatus = 'learning' | 'mastered' | 'inactive' | 'deleted';
export type TrainingMode = 'weak_first' | 'random';
export type QuestionOption = 'A' | 'B' | 'C' | 'D';

export type CategoryStats = {
  total: number;
  attempted: number;
  unattempted: number;
  latestCorrect: number;
  accuracy: number | null;
};

export type QuestionCategory = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  parentId: number | null;
  name: string;
  isDefault: boolean;
  status: 'active' | 'inactive';
  sortOrder: number;
};

export type CategoryNode = QuestionCategory & {
  stats: CategoryStats;
  children: CategoryNode[];
};

export type QuestionStats = {
  correctCount: number;
  wrongCount: number;
  latestCorrect: boolean | null;
  latestDurationMs: number | null;
};

export type ReviewQuestion = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  questionFormat: 'single_choice';
  stem: string;
  options: Record<QuestionOption, string>;
  correctOption: QuestionOption;
  analysis: string;
  notes: string | null;
  source: string | null;
  categoryId: number;
  status: QuestionStatus;
};

export type QuestionListItem = ReviewQuestion & {
  categoryPath: [string, string];
  stats: QuestionStats;
};

export type CreateSessionInput = {
  mode: TrainingMode;
  categoryScopeId: number | null;
  includeMastered: boolean;
  plannedCount: number;
};

export type SessionQuestion = {
  id: number;
  position: number;
  stem: string;
  options: Record<QuestionOption, string>;
  source: string | null;
  categoryPath: [string, string];
  stats: QuestionStats;
};
```

- [ ] **Step 5: Apply and verify the migration after approval**

Run:

```powershell
npx.cmd tsx scripts/migrate.ts
npm.cmd test -- tests/integration/schema.test.ts
```

Expected: migration logs `Applied 0005_part5_question_review.sql`; schema tests PASS.

- [ ] **Step 6: Commit only the schema, types, and schema tests**

```powershell
git add migrations/0005_part5_question_review.sql src/lib/questionReview/types.ts tests/integration/schema.test.ts
git commit -m "feat: add question review schema"
```

---

### Task 2: Implement Category Rules, Statistics, And Routes

**Files:**
- Create: `src/lib/questionReview/categories.ts`
- Create: `src/app/api/question-categories/route.ts`
- Create: `src/app/api/question-categories/[id]/route.ts`
- Create: `src/app/api/question-categories/[id]/merge/route.ts`
- Create: `tests/integration/questionReviewCategories.test.ts`

**Interfaces:**
- Produces `listCategoryTree(client, { section, part }): Promise<CategoryNode[]>`.
- Produces `createCategory`, `updateCategory`, `deleteEmptyCategory`, and `mergeCategory`.
- `GET /api/question-categories?section=reading&part=5` returns the full active tree with latest-result statistics; `includeInactive=true` also returns stopped categories for management.

- [ ] **Step 1: Write category service tests for every destructive rule**

Cover these exact outcomes:

```ts
await expect(deleteEmptyCategory(client, defaultChildId))
  .rejects.toThrow('未细分类不能删除');
await expect(deleteEmptyCategory(client, categoryWithQuestionsId))
  .rejects.toThrow('该分类仍有关联题目，请先移动或合并');
await expect(updateCategory(client, childId, { parentId: childId }))
  .rejects.toThrow('分类不能移动到自身');
```

For a merge, assert questions move to the target child, the source becomes `inactive`, and latest-result statistics remain unchanged.

- [ ] **Step 2: Run the focused category tests and confirm missing exports**

```powershell
npm.cmd test -- tests/integration/questionReviewCategories.test.ts
```

Expected: FAIL because `@/lib/questionReview/categories` does not exist.

- [ ] **Step 3: Implement category tree and latest-result aggregation**

Use one `DISTINCT ON (question_id)` subquery ordered by `attempted_at DESC, id DESC`. Return this shape for both parent and child categories:

```ts
export type CategoryStats = {
  total: number;
  attempted: number;
  unattempted: number;
  latestCorrect: number;
  accuracy: number | null;
};

export type CategoryNode = {
  id: number;
  name: string;
  isDefault: boolean;
  status: 'active' | 'inactive';
  stats: CategoryStats;
  children: CategoryNode[];
};
```

Compute `accuracy` as `latestCorrect / attempted`; return `null` when `attempted === 0`.

- [ ] **Step 4: Implement transactional move and merge rules**

`mergeCategory(client, sourceId, targetId)` must start no transaction itself; callers own the transaction. It must reject cross-Part merges, parent-to-child merges, child-to-parent merges, and merging into inactive categories with these messages: `分类层级不一致`, `分类范围不一致`, and `目标分类已停用`.

For a child-to-child merge, move all source questions to the target child and deactivate the source. For a parent-to-parent merge, process each source child by name: merge into an existing same-name target child, otherwise move that child under the target parent; then deactivate the source parent. The target parent's own default `未细分` remains the only default child.

Deactivating a parent removes it and all children from new-question and training selectors while retaining the child rows and question history. Reactivating the parent restores only children whose own status is still `active`.

- [ ] **Step 5: Add thin category routes with validated status codes**

Use `400` for malformed input, `404` for a missing category, and `409` for conflicts such as duplicate names or non-empty deletion. Wrap merge route calls in `BEGIN`/`COMMIT` with `ROLLBACK` on error.

- [ ] **Step 6: Run category and schema tests**

```powershell
npm.cmd test -- tests/integration/questionReviewCategories.test.ts tests/integration/schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the category slice**

```powershell
git add src/lib/questionReview/categories.ts src/app/api/question-categories tests/integration/questionReviewCategories.test.ts
git commit -m "feat: add question category management"
```

---

### Task 3: Implement Local Paste Parsing And Question CRUD

**Files:**
- Create: `src/lib/questionReview/parser.ts`
- Create: `src/lib/questionReview/questions.ts`
- Create: `src/app/api/review-questions/route.ts`
- Create: `src/app/api/review-questions/[id]/route.ts`
- Create: `tests/unit/questionReview/parser.test.ts`
- Create: `tests/unit/questionReview/questions.test.ts`
- Create: `tests/integration/questionReviewQuestions.test.ts`

**Interfaces:**
- Produces `parsePastedQuestion(input: string): ParsedQuestion`.
- Produces `listQuestions`, `createQuestion`, `updateQuestion`, and `softDeleteQuestion`.
- `GET /api/review-questions` supports `search`, `categoryId`, `status`, `sort`, `page`, and `pageSize`.

- [ ] **Step 1: Write parser tests for all approved option markers and safe fallback**

Use table-driven cases for `A.`, `A)`, `(A)`, and `A：`. Assert this exact success shape:

```ts
export type ParsedQuestion = {
  stem: string;
  options: Partial<Record<QuestionOption, string>>;
  complete: boolean;
  warning: string | null;
};

expect(parsePastedQuestion('The plan is ___.\n(A) practical\n(B) practice\n(C) practiced\n(D) practically'))
  .toEqual({
    stem: 'The plan is ___.',
    options: { A: 'practical', B: 'practice', C: 'practiced', D: 'practically' },
    complete: true,
    warning: null,
  });
```

For missing option D, assert `complete: false`, preserve all detected text, and return `warning: '未识别出完整的 A/B/C/D，请检查后手动补充'`.

- [ ] **Step 2: Run parser tests and confirm failure**

```powershell
npm.cmd test -- tests/unit/questionReview/parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement a pure parser with no API or DOM dependencies**

Normalize CRLF to LF, match option markers only at line starts, trim each captured field, and never discard the original stem text. Do not infer the correct answer or category.

- [ ] **Step 4: Write question validation and repository tests**

Assert empty stem, empty options, invalid answer, inactive category, parent category, and cross-Part category all reject with a specific Chinese message. Assert duplicate normalized stems return `duplicate: true` but save successfully only when input includes `confirmDuplicate: true`.

- [ ] **Step 5: Implement question validation and server-side pagination**

Expose this input contract:

```ts
export type ReviewQuestionInput = {
  stem: string;
  options: Record<QuestionOption, string>;
  correctOption: QuestionOption;
  analysis: string;
  notes?: string | null;
  source?: string | null;
  categoryId: number;
  status?: QuestionStatus;
  confirmDuplicate?: boolean;
};
```

Normalize duplicate detection with `lower(regexp_replace(trim(stem), '\\s+', ' ', 'g'))`. List queries must exclude `deleted` by default, accept `status=deleted` for recovery, and return `{ items, total, page, pageSize }`. Support sort values `updated_desc`, `created_desc`, `accuracy_asc`, and `unattempted_first`. Per-question aggregates use all attempts for correct/wrong counts, the final attempt ordered by `attempted_at DESC, id DESC` for latest correctness, and the final non-excluded attempt with non-null duration for recent duration.

- [ ] **Step 6: Add question routes and explicit duplicate response**

`POST /api/review-questions` returns `409` with `{ error: '检测到相同题干', duplicateId }` unless `confirmDuplicate` is true. `DELETE /api/review-questions/[id]` performs a soft delete and returns `{ id, status: 'deleted' }`; `PATCH` can restore it to `learning`.

- [ ] **Step 7: Run question unit and integration tests**

```powershell
npm.cmd test -- tests/unit/questionReview/parser.test.ts tests/unit/questionReview/questions.test.ts tests/integration/questionReviewQuestions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the question-library slice**

```powershell
git add src/lib/questionReview/parser.ts src/lib/questionReview/questions.ts src/app/api/review-questions tests/unit/questionReview tests/integration/questionReviewQuestions.test.ts
git commit -m "feat: add Part 5 question library APIs"
```

---

### Task 4: Implement Frozen Session Selection And Attempts

**Files:**
- Create: `src/lib/questionReview/selection.ts`
- Create: `src/lib/questionReview/sessions.ts`
- Create: `src/app/api/question-review-sessions/route.ts`
- Create: `src/app/api/question-attempts/route.ts`
- Create: `src/app/api/question-attempts/[id]/route.ts`
- Create: `tests/unit/questionReview/selection.test.ts`
- Create: `tests/integration/questionReviewSessions.test.ts`
- Create: `tests/integration/questionReviewApi.test.ts`

**Interfaces:**
- Produces `selectQuestionIds(candidates, count, mode, random): number[]`.
- Produces `createReviewSession`, `submitAttempt`, and `updateAttemptTiming`.
- Session creation returns only unrevealed question data; attempt submission returns the answer, analysis, notes, and aggregates.

- [ ] **Step 1: Write deterministic selection tests using injected random values**

Use this candidate contract:

```ts
type SelectionCandidate = {
  id: number;
  latestCorrect: boolean | null;
};
```

Assert `weak_first` maps weights to unattempted `4`, latest wrong `3`, latest correct `1`; assert output has no duplicate ids; assert requesting 10 from 3 candidates returns exactly 3.

- [ ] **Step 2: Run selection tests and confirm failure**

```powershell
npm.cmd test -- tests/unit/questionReview/selection.test.ts
```

Expected: FAIL because the selection module does not exist.

- [ ] **Step 3: Implement weighted sampling without replacement**

Accept `random: () => number = Math.random`, recalculate total weight after each removal, and never mutate the caller's candidate array.

- [ ] **Step 4: Write session and attempt integration tests**

Cover all of these outcomes:

```ts
expect(session.questions).toHaveLength(availableCount);
expect(new Set(session.questions.map((item) => item.id)).size).toBe(availableCount);
expect(session.questions[0]).not.toHaveProperty('correctOption');
expect(session.questions[0]).not.toHaveProperty('analysis');
expect(attempt.correctOption).toBe('B');
expect(attempt.analysis).toBe('副词修饰形容词。');
```

Submit the same `requestId` twice and assert the same attempt id is returned and only one row exists. Edit duration to `12500`, then set `durationExcluded: true`; correctness must remain unchanged.

- [ ] **Step 5: Implement transactional session creation**

Validate scope, status, and Part 5 before selecting. Insert `question_review_sessions` and all ordered `question_review_session_items` inside one transaction. Return `{ id, plannedCount, actualCount, questions }`, where each question contains stem, options, category path, source, and prior aggregates only.

- [ ] **Step 6: Implement server-side grading and idempotent attempts**

Use `INSERT ... ON CONFLICT (request_id) DO NOTHING`, then select the stored attempt. Reject a question not present in the session with `题目不属于本次训练`. Return:

```ts
export type AttemptResult = {
  attemptId: number;
  isCorrect: boolean;
  correctOption: QuestionOption;
  analysis: string;
  notes: string | null;
  durationMs: number | null;
  durationExcluded: boolean;
  stats: QuestionStats;
};
```

- [ ] **Step 7: Add routes and validate request bodies**

Session input is `{ mode, categoryScopeId, includeMastered, plannedCount }`; attempt input is `{ requestId, sessionId, questionId, selectedOption, durationMs }`; timing patch input is `{ durationMs, durationExcluded }`. Clamp `plannedCount` to `1..100` and reject negative duration.

- [ ] **Step 8: Run all training-core tests**

```powershell
npm.cmd test -- tests/unit/questionReview/selection.test.ts tests/integration/questionReviewSessions.test.ts tests/integration/questionReviewApi.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the training core**

```powershell
git add src/lib/questionReview/selection.ts src/lib/questionReview/sessions.ts src/app/api/question-review-sessions src/app/api/question-attempts tests/unit/questionReview/selection.test.ts tests/integration/questionReviewSessions.test.ts tests/integration/questionReviewApi.test.ts
git commit -m "feat: add Part 5 training sessions"
```

---

### Task 5: Add The Part 5 Workspace Shell And Navigation

**Files:**
- Modify: `src/lib/disguiseMode.ts`
- Create: `src/app/reading/part5/page.tsx`
- Create: `src/components/part5/Part5Workspace.tsx`
- Create: `src/components/part5/TrainingSetup.tsx`
- Create: `tests/unit/questionReview/workspace.test.ts`

**Interfaces:**
- Normal navigation adds `{ href: '/reading/part5', label: '阅读训练' }` after `错题库`.
- `Part5Workspace` owns active tab, category refresh version, create/edit question id, and active session.
- `TrainingSetup` emits `onStart(input: CreateSessionInput)`.

- [ ] **Step 1: Add pure workspace-state tests**

Test `normalizeTrainingCount(value, available)` with `0 -> 1`, `20 with 8 available -> 8`, and empty availability -> `0`. Test `buildTrainingSummary` returns `计划 20 题，可用 8 题，本次将练习 8 题`.

- [ ] **Step 2: Implement the route and compact three-tab shell**

Use tabs `错题库`, `分类管理`, and `训练设置`. Above the tabs, show a compact summary for effective total, attempted, unattempted, and current latest-result accuracy. Render an explicit loading line, an error line with a `重试` button, and the selected tab content; never use an empty array to represent loading.

- [ ] **Step 3: Implement training controls with approved defaults**

Default to `weak_first`, all categories, 20 questions, and `includeMastered = false`. Use a segmented control for mode, category select, numeric stepper/input, and checkbox for mastered status. Disable start when no eligible questions exist.

- [ ] **Step 4: Update navigation without adding Part 6/7 entries**

Add only the reading workspace link to `studyNav`. Add `'/reading/part5': 'Reading Review Requirements'` to `sectionTitles` so direct visits while Work mode is active do not expose a Chinese page title in the document metadata.

- [ ] **Step 5: Run unit tests and build**

```powershell
npm.cmd test -- tests/unit/questionReview/workspace.test.ts
npm.cmd run build
```

Expected: PASS and a successful Next.js production build.

- [ ] **Step 6: Commit the workspace shell**

```powershell
git add src/lib/disguiseMode.ts src/app/reading/part5/page.tsx src/components/part5/Part5Workspace.tsx src/components/part5/TrainingSetup.tsx tests/unit/questionReview/workspace.test.ts
git commit -m "feat: add Part 5 training workspace"
```

---

### Task 6: Build The Question Library And Editor

**Files:**
- Modify: `src/components/Modal.tsx`
- Create: `src/components/part5/QuestionLibrary.tsx`
- Create: `src/components/part5/QuestionEditorModal.tsx`
- Modify: `src/components/part5/Part5Workspace.tsx`

**Interfaces:**
- `Modal` gains optional `size?: 'sm' | 'md' | 'lg'` while preserving current `md` behavior for existing callers.
- `QuestionLibrary` accepts `categories`, `refreshVersion`, `onEdit`, and `onChanged`.
- `QuestionEditorModal` accepts `questionId: number | null`, category tree, `open`, `onClose`, and `onSaved`.

- [ ] **Step 1: Extend Modal with stable width options**

Map sizes exactly as follows and keep the existing backdrop, Escape behavior, and title layout:

```ts
const widthClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-3xl',
}[size];
```

- [ ] **Step 2: Implement server-filtered library loading**

Keep independent `loading`, `loadError`, `items`, and `total` state. Reset page to 1 when search/category/status/sort changes. Search only after a 250 ms debounce and cancel stale requests with `AbortController`.

- [ ] **Step 3: Build the compact library table and mobile rows**

Show category path, truncated stem, status, latest result, recent duration, correct count, wrong count, and edit action. Use `—` for never attempted, green/red only for result status, and no decorative gradients. Status changes require one click plus a confirmation only for `inactive` and `deleted`; the deleted filter exposes a restore command that returns the item to `learning`.

- [ ] **Step 4: Build the wide question editor**

Place the paste box first with `解析到表单` command. Below it, render editable stem, four option inputs, answer segmented control, parent/child category selects, analysis, notes, source, and status. On duplicate `409`, show the matched question id and a `仍然保存` button that resubmits with `confirmDuplicate: true`.

- [ ] **Step 5: Preserve unsaved edits and validation messages**

Track `dirty`; closing a dirty modal calls `window.confirm('尚有未保存内容，确定离开吗？')`. Map server errors next to the form and retain all user-entered values after failure.

- [ ] **Step 6: Verify parser and production build**

```powershell
npm.cmd test -- tests/unit/questionReview/parser.test.ts
npm.cmd run build
```

Expected: PASS and successful build.

- [ ] **Step 7: Commit the library UI**

```powershell
git add src/components/Modal.tsx src/components/part5/QuestionLibrary.tsx src/components/part5/QuestionEditorModal.tsx src/components/part5/Part5Workspace.tsx
git commit -m "feat: add Part 5 question library UI"
```

---

### Task 7: Build Category Management And Practice UI

**Files:**
- Create: `src/lib/questionReview/timing.ts`
- Create: `src/components/part5/CategoryManager.tsx`
- Create: `src/components/part5/TrainingSession.tsx`
- Modify: `src/components/part5/Part5Workspace.tsx`
- Create: `tests/unit/questionReview/timing.test.ts`

**Interfaces:**
- `CategoryManager` performs create, rename, move, merge, deactivate, and empty delete.
- `TrainingSession` receives the created session payload and calls `onExit()` after completion or abandonment.
- Produces pure `elapsedMs(startedAt, endedAt)` and `normalizeEditedDuration(seconds)` helpers.

- [ ] **Step 1: Write timer helper tests**

Assert `elapsedMs(1000, 4500) === 3500`, negative clock movement returns `0`, `normalizeEditedDuration('12.5') === 12500`, blank returns `null`, and negative input throws `用时不能小于 0`.

- [ ] **Step 2: Implement the pure timer helpers**

`elapsedMs` returns `Math.max(0, Math.round(endedAt - startedAt))`. `normalizeEditedDuration` trims the input, returns `null` for blank, rejects non-finite or negative values, and otherwise returns `Math.round(Number(seconds) * 1000)`.

- [ ] **Step 3: Build the two-column category manager**

Selecting a parent loads its children in the right column. A management toggle shows inactive categories without mixing them into normal selectors. Inline rename saves on Enter and cancels on Escape. Delete buttons are disabled for `isDefault`; non-empty deletion surfaces `该分类仍有关联题目，请先移动或合并`. Merge requires source, target, and an explicit confirmation naming both categories.

- [ ] **Step 4: Start timing only after the question is painted**

When `currentQuestion.id` changes, call `requestAnimationFrame(() => setStartedAt(performance.now()))`. Clicking an option immediately captures `performance.now()`, disables all options, creates `crypto.randomUUID()`, and submits once. Retrying a failed save reuses the same UUID.

- [ ] **Step 5: Render answer controls and reveal without changing their actions**

Use four full-width A/B/C/D option buttons. After submit, mark the chosen and correct options, always show analysis and notes, and show cumulative correct/wrong counts. The next button remains disabled until the attempt is saved.

- [ ] **Step 6: Implement timing correction and exclusion**

The result panel shows seconds to one decimal place. `修改用时` opens an inline numeric input; `本次用时不计入统计` toggles `durationExcluded`. PATCH failure keeps the editor open and shows `用时保存失败，请重试` without altering the answer result.

- [ ] **Step 7: Complete session progress and exit states**

Show `第 n / actualCount 题`. The final answer changes `下一题` to `完成训练`; completion returns to the workspace and refreshes category/question statistics. A separate `放弃本次训练` action requires confirmation and preserves attempts already saved.

- [ ] **Step 8: Run timer tests and build**

```powershell
npm.cmd test -- tests/unit/questionReview/timing.test.ts
npm.cmd run build
```

Expected: PASS and successful build.

- [ ] **Step 9: Commit category and practice UI**

```powershell
git add src/lib/questionReview/timing.ts src/components/part5/CategoryManager.tsx src/components/part5/TrainingSession.tsx src/components/part5/Part5Workspace.tsx tests/unit/questionReview/timing.test.ts
git commit -m "feat: complete Part 5 review workflow"
```

---

### Task 8: Full Regression, Browser Acceptance, And Delivery Checkpoint

**Files:**
- Verify: all files changed in Tasks 1-7
- Update only if a defect is found: the smallest owning file and its focused test

**Interfaces:**
- The completed feature is available at `/reading/part5`.
- No deployment or paid API call occurs in this task.

- [ ] **Step 1: Run all local unit tests**

```powershell
npm.cmd test -- tests/unit
```

Expected: all unit tests PASS without external model API calls.

- [ ] **Step 2: After database approval, run all integration tests serially**

```powershell
npm.cmd test -- tests/integration
```

Expected: all integration tests PASS; Vitest uses `fileParallelism: false` to respect the database connection limit.

- [ ] **Step 3: Run lint, type/build verification, and inspect the diff**

```powershell
npm.cmd run lint
npm.cmd run build
git diff --check
git status --short
```

Expected: lint and build succeed, `git diff --check` prints nothing, and status contains only intentional files.

- [ ] **Step 4: Start the local application and perform browser acceptance**

```powershell
npm.cmd run dev
```

At desktop `1440x900` and mobile `390x844`, verify: navigation has only one reading entry; category statistics distinguish unattempted items; pasted `A.`/`(A)` text stays editable; duplicate confirmation works; filters refresh on first load; weak-first and random sessions contain no duplicates; A-D clicks save once; correct and wrong answers both reveal analysis; timing edits do not change correctness; mastered items are excluded by default and included when enabled; no text overlaps or horizontal page scrollbar appear.

- [ ] **Step 5: Run a final regression of existing listening workflows**

Open `/review`, `/knowledge-points`, and `/mock-exams`; verify loading, review actions, listening records, reading score records, attachments, Work mode, and existing navigation remain functional.

- [ ] **Step 6: Report acceptance evidence and stop before deployment**

Record the test totals, build result, inspected desktop/mobile viewports, and any remaining risk in the implementation summary. If acceptance exposes a defect, return to the owning task, add a focused regression test, fix that task's owning file, rerun its verification command, and commit those named files before repeating Task 8. Do not deploy; report the local URL and wait for user acceptance and explicit deployment approval.
