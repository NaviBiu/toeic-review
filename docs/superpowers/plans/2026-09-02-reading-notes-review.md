# Reading Notes Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended when suitable) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add categorized rich reading notes, Word-only bulk import, and a reading spaced-repetition flow alongside the existing listening review without changing Part 5 question training.

**Architecture:** Create independent reading-note, category, and attempt tables because the current listening table requires listening-only Part, scenario, meaning, and example fields. Reuse the pure SRS functions in `src/lib/srs.ts`, expose focused reading APIs, and compose the existing pages from listening and reading tab panels. Store sanitized semantic HTML plus normalized plain text; parse `.docx` locally with Mammoth and JSDOM, and make DeepSeek a user-triggered fallback only.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript 5 strict mode, Vercel Postgres, Zod 4.4.3, Mammoth 1.12.0, JSDOM 27.0.1, Vitest 4.1.9, Tailwind CSS 4.

**Approved Spec:** `docs/superpowers/specs/2026-09-02-reading-notes-review-design.md`

## Global Constraints

- Keep the top-level labels `今日复盘`, `错题库`, `阅读训练`, `导入笔记`, `已掌握`, `模考记录`, and `统计` unchanged.
- `今日复盘` has independent `听力` and `阅读` tabs and independent pending counts.
- `错题库` uses `听力笔记` and `阅读笔记`; `导入笔记` uses the same two labels; `已掌握` uses `听力` and `阅读`.
- Reading notes have one editable category level and no Part 5, Part 6, or Part 7 field.
- Required fields are category and rich knowledge-point content; note is optional; note date defaults to the current Shanghai date.
- Rich content preserves paragraphs, line breaks, emphasis, ordered and unordered lists, tables, `rowspan`, and `colspan`; strip classes, styles, scripts, event handlers, comments, Word CSS, and unsupported tags.
- Reading bulk import accepts only `.docx`; client and server rejection copy is exactly `阅读笔记批量导入仅支持 Word(.docx) 文件`.
- Listening import continues accepting its existing PDF and `.docx` formats.
- Every manually created or confirmed imported reading note enters today's queue immediately, even when its note date is historical; there is no daily cap.
- Reading known/unknown decisions use the existing `CURVE_DAYS = [1, 2, 4, 7, 15, 30]` rules.
- A reading card shows the complete knowledge point and optional note immediately; there is no answer reveal phase.
- Clicking `知道` or `不知道` saves optimistically and immediately advances; unknown notes return later in the same session.
- Only the immediately previous known/unknown decision is correctable. Correction updates the same attempt from its pre-attempt snapshot and never creates a second attempt.
- The final previous decision remains correctable when the queue reaches zero.
- Mark mastered and permanent delete use the existing action icons and layout in both study and work mode.
- Permanent delete has no confirmation and exposes the existing five-second undo behavior.
- The Part 5 A/B/C/D question trainer and all listening behavior remain unchanged.
- No reading analytics, charts, automatic generation, or reading Part labels are added.
- Successful local parsing makes no paid API call. `使用 AI 重新解析` is the only path that may call DeepSeek, and automated tests must mock it.
- Before any real DeepSeek development call, state provider, model, purpose, call count, estimated token volume, and cost ceiling, then obtain explicit user approval.
- Real migration and integration tests consume configured Vercel Postgres quota; obtain explicit user approval immediately before running them.
- Preserve all existing and newly created real user data. Do not truncate, reseed, or delete test records.
- Do not deploy to Preview or Production until local browser acceptance passes and the user explicitly approves each deployment.
- New cards and dialogs use border radius no greater than `8px`, neutral surfaces, limited status color, zero gradients, and no nested cards.

---

## File Structure

- `migrations/0008_reading_notes.sql`: additive reading category, note, and review-attempt schema plus the protected `未分类` seed.
- `src/lib/readingNotes/types.ts`: reading domain and API contracts.
- `src/lib/readingNotes/richContent.ts`: browser-safe DOM allowlist walker, normalized-text extraction, and duplicate hash.
- `src/lib/readingNotes/richContent.server.ts`: server-only JSDOM wrapper for the shared DOM sanitizer.
- `src/lib/readingNotes/docxParser.ts`: Word-only validation, Mammoth conversion, deterministic date/category/note parsing, and confidence reporting.
- `src/lib/readingNotes/aiParser.ts`: one-call DeepSeek fallback contract, used only by the explicit AI route and mocked in tests.
- `src/lib/readingNotes/categories.ts`: list, create, rename, reorder, merge, and safe-delete operations.
- `src/lib/readingNotes/notes.ts`: note CRUD, filters, counts, queue reads, status transitions, and exact restore.
- `src/lib/readingNotes/review.ts`: transactional attempt creation, idempotency, correction, and SRS snapshots.
- `src/lib/readingNotes/importConfirm.ts`: duplicate preview and atomic category/note insertion.
- `src/app/api/reading-note-categories/**`: category route contracts.
- `src/app/api/reading-notes/**`: library and import route contracts.
- `src/app/api/reading-review/**`: count, bounded queue, attempt, and correction route contracts.
- `src/components/readingNotes/RichReadingContent.tsx`: rich-content editor and renderer.
- `src/components/readingNotes/ReadingNoteEditor.tsx`: manual create/edit dialog.
- `src/components/readingNotes/ReadingCategoryManager.tsx`: visible one-level category manager.
- `src/components/readingNotes/ReadingNoteLibrary.tsx`: filters, rows, optimistic item mutations, and pagination.
- `src/components/readingNotes/ReadingImport.tsx`: `.docx` picker, preview, explicit AI fallback, and confirm result.
- `src/components/readingNotes/ReadingReview.tsx`: start state, immediate decisions, repeat queue, previous-decision correction, status actions, and work mode.
- `src/components/readingNotes/ReadingMastered.tsx`: mastered reading list, restore, and permanent delete.
- `src/components/review/ListeningReview.tsx`: current listening implementation moved unchanged out of the route file.
- `src/components/SectionTabs.tsx`: shared accessible two-option tab control.
- `src/app/review/page.tsx`, `src/app/knowledge-points/page.tsx`, `src/app/knowledge-points/import/page.tsx`, and `src/app/mastered/page.tsx`: thin tabbed page composition.
- `tests/unit/readingNotes/**`: rich content, parser, preview, review state, and UI contract tests.
- `tests/integration/readingNotes*.test.ts`: repository, route, transaction, and correction tests.

---

### Task 1: Add Reading Note Schema And Shared Types

**Files:**
- Create: `migrations/0008_reading_notes.sql`
- Create: `src/lib/readingNotes/types.ts`
- Modify: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces tables `reading_note_categories`, `reading_notes`, and `reading_note_review_attempts`.
- Produces `ReadingNoteCategory`, `ReadingNote`, `ReadingNoteStatus`, `ReadingSrsSnapshot`, `ReadingReviewAttempt`, `ReadingImportCandidate`, `ReadingImportPreview`, and `ReadingQueuePage`.
- Consumes `SrsState` from `src/lib/srs.ts` without changing its semantics.

- [ ] **Step 1: Add failing schema assertions before creating the migration**

Add a focused test that asserts the protected category, note defaults, scoped duplicate index, attempt request id, and snapshot constraints:

```ts
it('stores reading notes independently with a protected uncategorized category', async () => {
  await withTestClient(async (client) => {
    const { rows: [category] } = await client.query(
      `SELECT id, name, is_default FROM reading_note_categories
       WHERE name = '未分类' AND status = 'active'`,
    );
    expect(category).toMatchObject({ name: '未分类', is_default: true });

    const { rows: [note] } = await client.query(
      `INSERT INTO reading_notes
       (category_id, content_html, content_text, content_hash, note_date, next_review_date)
       VALUES ($1, '<p>as a result</p>', 'as a result', 'hash-a', '2026-09-01', '2026-09-02')
       RETURNING status, correct_streak, correct_count, wrong_count`,
      [category.id],
    );
    expect(note).toEqual({ status: 'active', correct_streak: 0, correct_count: 0, wrong_count: 0 });

    await expect(client.query(
      `INSERT INTO reading_notes
       (category_id, content_html, content_text, content_hash, note_date, next_review_date)
       VALUES ($1, '<p>duplicate</p>', 'duplicate', 'hash-a', '2026-09-02', '2026-09-02')`,
      [category.id],
    )).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test only after database approval and verify the red state**

Run:

```powershell
npm.cmd test -- tests/integration/schema.test.ts
```

Expected before migration: FAIL because `reading_note_categories` does not exist. This command touches the configured Vercel Postgres database, so stop for approval immediately before running it.

- [ ] **Step 3: Create the additive migration with exact constraints**

Use these table contracts and indexes:

```sql
BEGIN;

CREATE TABLE reading_note_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reading_note_categories_active_name_key
  ON reading_note_categories (normalized_name) WHERE status = 'active';

CREATE TABLE reading_notes (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES reading_note_categories(id),
  content_html TEXT NOT NULL CHECK (btrim(content_html) <> ''),
  content_text TEXT NOT NULL CHECK (btrim(content_text) <> ''),
  content_hash TEXT NOT NULL,
  notes TEXT,
  note_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mastered', 'deleted')),
  correct_streak INTEGER NOT NULL DEFAULT 0 CHECK (correct_streak >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  next_review_date DATE,
  last_reviewed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reading_notes_active_duplicate_key
  ON reading_notes (category_id, content_hash) WHERE status <> 'deleted';
CREATE INDEX reading_notes_queue_idx
  ON reading_notes (status, next_review_date, wrong_count DESC, id);
CREATE INDEX reading_notes_category_idx
  ON reading_notes (category_id, status, note_date DESC, id DESC);

CREATE TABLE reading_note_review_attempts (
  id SERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  note_id INTEGER NOT NULL REFERENCES reading_notes(id),
  decision TEXT NOT NULL CHECK (decision IN ('known', 'unknown')),
  review_date DATE NOT NULL,
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reading_note_attempts_latest_idx
  ON reading_note_review_attempts (note_id, id DESC);

INSERT INTO reading_note_categories
  (name, normalized_name, sort_order, is_default)
VALUES ('未分类', '未分类', 0, true);

COMMIT;
```

- [ ] **Step 4: Define the exact domain contracts**

Create `types.ts` with these public shapes:

```ts
import type { SrsState } from '@/lib/srs';

export type ReadingNoteStatus = 'active' | 'mastered' | 'deleted';
export type ReadingDecision = 'known' | 'unknown';
export type ReadingSrsSnapshot = SrsState & { lastReviewedDate: string | null };

export type ReadingNoteCategory = {
  id: number;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  status: 'active' | 'deleted';
  noteCount: number;
};

export type ReadingNote = {
  id: number;
  categoryId: number;
  categoryName: string;
  contentHtml: string;
  contentText: string;
  notes: string | null;
  noteDate: string;
  status: ReadingNoteStatus;
  correctStreak: number;
  correctCount: number;
  wrongCount: number;
  nextReviewDate: string | null;
  lastReviewedDate: string | null;
};

export type ReadingReviewAttempt = {
  id: number;
  requestId: string;
  noteId: number;
  decision: ReadingDecision;
  reviewDate: string;
  beforeState: ReadingSrsSnapshot;
  afterState: ReadingSrsSnapshot;
};

export type ReadingImportCandidate = {
  sourceIndex: number;
  categoryName: string;
  contentHtml: string;
  contentText: string;
  notes: string | null;
  noteDate: string;
  confidence: 'high' | 'low';
  issue: string | null;
};

export type ReadingImportPreview = {
  token: string;
  recognizedCount: number;
  duplicateCount: number;
  unrecognizedCount: number;
  existingCategories: string[];
  proposedCategories: string[];
  candidates: ReadingImportCandidate[];
  exceptions: ReadingImportCandidate[];
  aiFallbackAvailable: boolean;
};

export type ReadingQueuePage = {
  items: ReadingNote[];
  totalPending: number;
  hasMore: boolean;
};
```

- [ ] **Step 5: Apply and verify the migration after the same database approval**

Run:

```powershell
npx.cmd tsx scripts/migrate.ts
npm.cmd test -- tests/integration/schema.test.ts
```

Expected: `Applied 0008_reading_notes.sql` once, then the schema suite PASS. Existing migrations log as skipped.

- [ ] **Step 6: Commit the schema unit**

```powershell
git add migrations/0008_reading_notes.sql src/lib/readingNotes/types.ts tests/integration/schema.test.ts
git commit -m "feat: add reading notes schema"
```

---

### Task 2: Build Rich Content And Deterministic Word Parsing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/readingNotes/richContent.ts`
- Create: `src/lib/readingNotes/richContent.server.ts`
- Create: `src/lib/readingNotes/docxParser.ts`
- Create: `tests/unit/readingNotes/richContent.test.ts`
- Create: `tests/unit/readingNotes/docxParser.test.ts`
- Create: `tests/fixtures/reading-notes.docx`

**Interfaces:**
- Produces browser-safe `sanitizeReadingHtml(html: string): { html: string; text: string }`.
- Produces server-only `sanitizeReadingHtmlServer(html: string): { html: string; text: string; hash: string }`.
- Produces browser-safe `normalizeReadingText(text: string): string` and server-only `hashReadingText(text: string): string`.
- Produces `validateReadingDocx(file: { name: string; size: number; buffer: Buffer }): void`.
- Produces `parseReadingDocx(buffer: Buffer, importDate: string): Promise<ReadingImportCandidate[]>`.
- Move `jsdom` from `devDependencies` to `dependencies`; add `@types/jsdom` to `devDependencies`. Do not add a second HTML parser.

- [ ] **Step 1: Write sanitizer tests for supported semantics and forbidden document markup**

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeReadingHtmlServer } from '@/lib/readingNotes/richContent.server';

describe('reading rich content', () => {
  it('keeps semantic content and table spans while stripping Word CSS and scripts', () => {
    const result = sanitizeReadingHtmlServer(`
      <style>p.MsoNormal { mso-style-name: 正文 }</style>
      <!-- office metadata -->
      <p class="MsoNormal" style="color:red" onclick="alert(1)"><strong>结果关系</strong></p>
      <ul><li>as a result</li></ul>
      <table class="MsoTableGrid"><tr><th colspan="2">表达</th></tr>
      <tr><td rowspan="2">therefore</td><td>因此</td></tr></table>
      <script>alert(1)</script>`);

    expect(result.html).toContain('<strong>结果关系</strong>');
    expect(result.html).toContain('<ul><li>as a result</li></ul>');
    expect(result.html).toContain('colspan="2"');
    expect(result.html).toContain('rowspan="2"');
    expect(result.html).not.toMatch(/style=|class=|onclick=|<script|MsoNormal/);
    expect(result.text).toContain('结果关系 as a result 表达 therefore 因此');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Write `.docx` parser tests for inherited dates, categories, tables, defaults, and rejection**

The fixture contains two dates, two categories, one table inside a knowledge point, one missing note, and one unrecognized paragraph. Assert:

```ts
const items = await parseReadingDocx(fixtureBuffer, '2026-09-02');
expect(items.map(({ categoryName, noteDate, notes }) => ({ categoryName, noteDate, notes }))).toEqual([
  { categoryName: '高频商务词汇', noteDate: '2026-08-31', notes: '优先建立直接反应。' },
  { categoryName: '固定搭配', noteDate: '2026-08-31', notes: null },
  { categoryName: '动词 + 名词搭配', noteDate: '2026-09-01', notes: null },
]);
expect(items[1].contentHtml).toContain('<table>');
expect(items.filter((item) => item.confidence === 'low')).toHaveLength(1);
expect(() => validateReadingDocx({ name: 'notes.pdf', size: 100, buffer: Buffer.from('x') }))
  .toThrow('阅读笔记批量导入仅支持 Word(.docx) 文件');
```

- [ ] **Step 3: Run the focused unit tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/richContent.test.ts tests/unit/readingNotes/docxParser.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the allowlist sanitizer and stable duplicate normalization**

Keep the DOM walker browser-safe; keep Node hashing in the server-only wrapper. Retain only these tags and attributes:

```ts
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
]);
const ALLOWED_ATTRIBUTES = new Map([
  ['TH', new Set(['rowspan', 'colspan'])],
  ['TD', new Set(['rowspan', 'colspan'])],
]);

export function normalizeReadingText(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

```

`richContent.ts` exports a DOM walker that receives a `Document`; its browser wrapper creates that document with the native `DOMParser` and returns HTML/text only. `richContent.server.ts` imports `JSDOM` and Node `createHash`, calls the same walker, and adds the SHA-256 text hash. This prevents JSDOM and Node crypto from entering the client bundle. Walk the DOM, remove comments and forbidden elements, unwrap unknown formatting containers, remove every non-allowlisted attribute, clamp spans to integers `1..20`, and return canonical body HTML plus normalized `textContent`. Throw `知识点不能为空` when normalized text is empty.

The server-only hash implementation is:

```ts
import { createHash } from 'node:crypto';

export function hashReadingText(text: string) {
  return createHash('sha256').update(normalizeReadingText(text)).digest('hex');
}
```

- [ ] **Step 5: Implement local Word extraction as a state machine over semantic blocks**

Use `mammoth.convertToHtml({ buffer })`, sanitize the result, then inspect top-level paragraph/list/table nodes in order. Recognize these exact marker forms:

```ts
const DATE_MARKER = /^日期\s*[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/;
const CATEGORY_MARKER = /^分类(?:[一二三四五六七八九十\d]+)?\s*[：:]\s*(.+)$/;
const KNOWLEDGE_MARKER = /^(?:\d+[.、．]\s*)?知识点\s*[：:]\s*(.*)$/;
const NOTES_MARKER = /^备注\s*[：:]\s*(.*)$/;
```

The parser maintains `currentDate`, `currentCategory`, `currentContentNodes`, and `currentNotes`. A date applies until replaced; a missing date uses `importDate`; a table/list after `知识点：` belongs to that item; `备注：` starts plain optional note capture. Flush an item at the next date/category/knowledge marker or end of document. Mark confidence low when content precedes any category, a marker is malformed, or a nonempty block cannot be attached; never silently discard it.

`validateReadingDocx` enforces: filename ends in `.docx` case-insensitively, size is `1..5 * 1024 * 1024`, and bytes start with ZIP signature `0x50 0x4b`. Every failure returns the approved file-type message except oversize, which returns `文件超过 5MB 上限`.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/richContent.test.ts tests/unit/readingNotes/docxParser.test.ts
```

Expected: PASS with no network calls.

Commit:

```powershell
git add package.json package-lock.json src/lib/readingNotes/richContent.ts src/lib/readingNotes/richContent.server.ts src/lib/readingNotes/docxParser.ts tests/unit/readingNotes tests/fixtures/reading-notes.docx
git commit -m "feat: parse rich reading notes from Word"
```

---

### Task 3: Implement Category And Reading Note CRUD

**Files:**
- Create: `src/lib/readingNotes/categories.ts`
- Create: `src/lib/readingNotes/notes.ts`
- Create: `src/app/api/reading-note-categories/route.ts`
- Create: `src/app/api/reading-note-categories/[id]/route.ts`
- Create: `src/app/api/reading-note-categories/[id]/merge/route.ts`
- Create: `src/app/api/reading-notes/route.ts`
- Create: `src/app/api/reading-notes/[id]/route.ts`
- Create: `tests/unit/readingNotes/categories.test.ts`
- Create: `tests/unit/readingNotes/noteValidation.test.ts`
- Create: `tests/integration/readingNotesCrud.test.ts`
- Create: `tests/integration/readingNotesApi.test.ts`

**Interfaces:**
- Produces `listReadingCategories`, `createReadingCategory`, `updateReadingCategory`, `reorderReadingCategories`, `mergeReadingCategory`, and `deleteReadingCategory`.
- Produces `listReadingNotes`, `createReadingNote`, `updateReadingNote`, `setReadingNoteStatus`, `softDeleteReadingNote`, and `restoreReadingNoteSnapshot`.
- HTTP list filters are `search`, `categoryId`, `status`, `dateFrom`, `dateTo`, `page`, and `pageSize`.

- [ ] **Step 1: Write pure validation and category-deletion tests**

Assert trimmed/whitespace-normalized category names, empty content rejection, future date clamping to today, default category protection, and these decisions:

```ts
expect(planCategoryDeletion({ isDefault: false, noteCount: 0 }, null)).toEqual({ kind: 'delete' });
expect(planCategoryDeletion({ isDefault: false, noteCount: 3 }, 'uncategorized')).toEqual({ kind: 'move_to_uncategorized' });
expect(planCategoryDeletion({ isDefault: false, noteCount: 3 }, 9)).toEqual({ kind: 'merge', targetCategoryId: 9 });
expect(() => planCategoryDeletion({ isDefault: true, noteCount: 0 }, null)).toThrow('未分类不能删除');
expect(() => planCategoryDeletion({ isDefault: false, noteCount: 3 }, null)).toThrow('请选择合并分类或移到未分类');
```

- [ ] **Step 2: Write integration tests for scoped duplicates and lossless category operations**

Create the same normalized content in two categories and expect success; create it twice in one active category and expect `409`. Merge a populated category and assert all notes move before the source becomes deleted. Delete with `destination: 'uncategorized'` and assert no notes are deleted. Update a note to `mastered`, `deleted`, and back to `active`, verifying restore sets `next_review_date` to today.

- [ ] **Step 3: Run pure tests for the red state**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/categories.test.ts tests/unit/readingNotes/noteValidation.test.ts
```

Expected: FAIL because the repositories and validators are missing.

- [ ] **Step 4: Implement repository contracts with one transaction per category operation**

Use these signatures:

```ts
export async function listReadingCategories(client: VercelClient, includeDeleted = false): Promise<ReadingNoteCategory[]>;
export async function createReadingCategory(client: VercelClient, name: string): Promise<ReadingNoteCategory>;
export async function updateReadingCategory(client: VercelClient, id: number, fields: { name?: string; sortOrder?: number }): Promise<ReadingNoteCategory>;
export async function reorderReadingCategories(client: VercelClient, orderedIds: number[]): Promise<ReadingNoteCategory[]>;
export async function mergeReadingCategory(client: VercelClient, sourceId: number, targetId: number): Promise<void>;
export async function deleteReadingCategory(client: VercelClient, id: number, destination: 'uncategorized' | number | null): Promise<void>;

export async function createReadingNote(client: VercelClient, input: {
  categoryId: number; contentHtml: string; notes: string | null; noteDate: string; today: string;
}): Promise<ReadingNote>;
export async function updateReadingNote(client: VercelClient, id: number, input: {
  categoryId?: number; contentHtml?: string; notes?: string | null; noteDate?: string;
}): Promise<ReadingNote>;
export async function setReadingNoteStatus(client: VercelClient, id: number, status: 'active' | 'mastered', today: string): Promise<ReadingNote>;
export async function softDeleteReadingNote(client: VercelClient, id: number): Promise<{
  note: ReadingNote; snapshot: ReadingSrsSnapshot;
}>;
export async function restoreReadingNoteSnapshot(client: VercelClient, id: number, snapshot: ReadingSrsSnapshot): Promise<ReadingNote>;
```

Every create/update calls server-only `sanitizeReadingHtmlServer`, persists its returned text/hash, and maps PostgreSQL snake-case rows to the Task 1 camel-case types. List queries select `COUNT(*) OVER()` for pagination and join category names in one query. Merge/delete use `BEGIN`, `SELECT ... FOR UPDATE`, `UPDATE reading_notes`, category status update, then `COMMIT`; rollback on every error. `softDeleteReadingNote` locks the row and returns the pre-delete SRS snapshot.

- [ ] **Step 5: Implement thin Zod-validated route handlers**

Route behavior:

```text
GET    /api/reading-note-categories
POST   /api/reading-note-categories                 { name }
PATCH  /api/reading-note-categories                 { orderedIds }
PATCH  /api/reading-note-categories/:id             { name?, sortOrder? }
DELETE /api/reading-note-categories/:id             { destination: null | "uncategorized" | number }
POST   /api/reading-note-categories/:id/merge       { targetCategoryId }
GET    /api/reading-notes                            query filters
POST   /api/reading-notes                            { categoryId, contentHtml, notes, noteDate }
PATCH  /api/reading-notes/:id                        fields, { status }, or { status: "restore", undoToken }
```

On delete, sign `{ noteId, snapshot, expiresAt }` with `AUTH_SECRET` and return `{ note, undoToken }`; accept that token for five minutes even though the UI shows undo for only five seconds. Restore the exact pre-delete status, counts, streak, next date, and last-reviewed date. Bulk reorder validates that each active category id appears exactly once and updates all `sort_order` values in one transaction and one request. Return `400` for malformed data, `404` for missing rows, and `409` for duplicate names/content or unsafe category deletion. Do not expose database ids in headings or other visible copy.

- [ ] **Step 6: Run integration tests only after database approval**

Run:

```powershell
npm.cmd test -- tests/integration/readingNotesCrud.test.ts tests/integration/readingNotesApi.test.ts
```

Expected: PASS; transaction wrappers roll back test rows, and existing real rows remain untouched.

- [ ] **Step 7: Commit the CRUD unit**

```powershell
git add src/lib/readingNotes/categories.ts src/lib/readingNotes/notes.ts src/app/api/reading-note-categories src/app/api/reading-notes tests/unit/readingNotes tests/integration/readingNotesCrud.test.ts tests/integration/readingNotesApi.test.ts
git commit -m "feat: manage reading notes and categories"
```

---

### Task 4: Add Transactional Reading Review Attempts And Correction

**Files:**
- Create: `src/lib/readingNotes/review.ts`
- Create: `src/app/api/reading-review/count/route.ts`
- Create: `src/app/api/reading-review/queue/route.ts`
- Create: `src/app/api/reading-review/attempts/route.ts`
- Create: `src/app/api/reading-review/attempts/[id]/route.ts`
- Create: `tests/unit/readingNotes/reviewState.test.ts`
- Create: `tests/integration/readingNotesReview.test.ts`
- Create: `tests/integration/readingNotesReviewApi.test.ts`

**Interfaces:**
- Produces `getReadingPendingCount`, `getReadingQueuePage`, `recordReadingAttempt`, and `correctReadingAttempt`.
- `recordReadingAttempt` is idempotent by UUID `requestId`.
- `correctReadingAttempt` rejects an attempt that is no longer the latest attempt for that note.

- [ ] **Step 1: Write pure state tests proving repeat-queue correction behavior**

Define and test:

```ts
type ReadingSessionState = {
  queue: number[];
  cursor: number;
  pending: number;
  previous: { attemptId: number; noteId: number; decision: ReadingDecision } | null;
};

expect(applyOptimisticDecision(base, 7, 'unknown').queue).toEqual([7, 8, 7]);
expect(applyCorrectedDecision(unknownState, 'known')).toMatchObject({ queue: [7, 8], pending: 1 });
expect(applyCorrectedDecision(knownState, 'unknown')).toMatchObject({ queue: [7, 8, 7], pending: 2 });
expect(applyCorrectedDecision(completedState, 'unknown').queue.at(-1)).toBe(7);
```

Also assert rollback returns the exact state snapshot captured before the optimistic operation.

- [ ] **Step 2: Write integration tests for SRS snapshots, one-attempt correction, idempotency, and staleness**

The test sequence is exact:

1. Insert one active note with zero counts.
2. Record `unknown` with a fixed UUID; assert `wrong_count = 1`, streak `0`, and `next_review_date = today`.
3. Repeat the same request UUID; assert the same attempt id and unchanged counts.
4. Correct that attempt to `known`; assert the same attempt id, `correct_count = 1`, `wrong_count = 0`, and scheduling is recomputed from `before_state`.
5. Record a newer attempt for the note.
6. Try to correct the older attempt; expect `409` with `只能修改该知识点最近一次复盘结果`.

- [ ] **Step 3: Run the pure tests and verify failure**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/reviewState.test.ts
```

Expected: FAIL because the state helpers are missing.

- [ ] **Step 4: Implement database review functions with row locks and shared SRS functions**

Use these exact signatures:

```ts
export async function getReadingPendingCount(client: VercelClient, today: string, categoryId?: number): Promise<number>;
export async function getReadingQueuePage(client: VercelClient, today: string, input: { categoryId?: number; limit: number }): Promise<ReadingQueuePage>;
export async function recordReadingAttempt(client: VercelClient, input: {
  requestId: string; noteId: number; decision: ReadingDecision; today: string;
}): Promise<{ attempt: ReadingReviewAttempt; note: ReadingNote }>;
export async function correctReadingAttempt(client: VercelClient, input: {
  attemptId: number; decision: ReadingDecision; today: string;
}): Promise<{ attempt: ReadingReviewAttempt; note: ReadingNote }>;
```

For creation: begin a transaction, return an existing row for the same request UUID, lock the note `FOR UPDATE`, capture all SRS fields plus `lastReviewedDate`, run `applyCorrectAnswer` or `applyWrongAnswer`, insert one attempt, update the note, and commit.

For correction: lock attempt and note, verify `attempt.id = (SELECT id ... ORDER BY id DESC LIMIT 1)`, reconstruct state exclusively from `before_state`, apply the new decision, update the same attempt's decision/after-state/corrected timestamp, update the note, and commit. On error rollback both records.

Queue reads use `LIMIT 50`, ordered by `wrong_count DESC, next_review_date ASC, id ASC`, and return `hasMore` from one extra row. Calling the endpoint again after the 50 visible due notes are resolved supplies the next batch, so the session has no daily cap.

- [ ] **Step 5: Implement route contracts**

```text
GET   /api/reading-review/count?categoryId=
GET   /api/reading-review/queue?categoryId=&limit=50
POST  /api/reading-review/attempts       { requestId, noteId, decision }
PATCH /api/reading-review/attempts/:id   { decision }
```

Clamp `limit` to `1..50`. Validate UUIDs and decisions with Zod. Return `409` for a stale correction and `404` for missing/deleted notes.

- [ ] **Step 6: Run database tests after approval and commit**

Run:

```powershell
npm.cmd test -- tests/integration/readingNotesReview.test.ts tests/integration/readingNotesReviewApi.test.ts
```

Expected: PASS with no duplicate count increments.

Commit:

```powershell
git add src/lib/readingNotes/review.ts src/app/api/reading-review tests/unit/readingNotes/reviewState.test.ts tests/integration/readingNotesReview.test.ts tests/integration/readingNotesReviewApi.test.ts
git commit -m "feat: add correctable reading review attempts"
```

---

### Task 5: Add The Reading Library, Editor, And Category Manager

**Files:**
- Create: `src/components/SectionTabs.tsx`
- Create: `src/components/readingNotes/RichReadingContent.tsx`
- Create: `src/components/readingNotes/ReadingNoteEditor.tsx`
- Create: `src/components/readingNotes/ReadingCategoryManager.tsx`
- Create: `src/components/readingNotes/ReadingNoteLibrary.tsx`
- Create: `src/components/knowledgePoints/ListeningKnowledgePointLibrary.tsx`
- Modify: `src/app/knowledge-points/page.tsx`
- Create: `tests/unit/readingNotes/richContentComponents.test.tsx`
- Create: `tests/unit/readingNotes/libraryInteraction.test.tsx`
- Create: `tests/unit/readingNotes/categoryManager.test.tsx`

**Interfaces:**
- `SectionTabs<T extends string>` receives `value`, `options`, and `onChange` and renders an ARIA tablist.
- `RichReadingEditor` emits sanitized HTML on paste/input; `RichReadingContent` renders only sanitizer output.
- `ReadingNoteLibrary` owns reading filters and optimistic row mutations; listening state stays inside the extracted listening component.

- [ ] **Step 1: Write jsdom component tests for the approved visible workflow**

Assert all of the following in rendered HTML and event callbacks:

```ts
expect(screen.getByRole('tab', { name: '听力笔记' })).toBeTruthy();
expect(screen.getByRole('tab', { name: '阅读笔记' })).toBeTruthy();
expect(screen.getByRole('button', { name: '新增阅读笔记' })).toBeTruthy();
expect(screen.getByRole('button', { name: '管理分类' })).toBeTruthy();
expect(screen.queryByText(/Part [567]/)).toBeNull();
expect(screen.queryByText(/#\d+/)).toBeNull();
```

Paste a Word-style table into `RichReadingEditor`; assert the callback contains a table but no `class`, `style`, or `mso-`. Render that value through `RichReadingContent` and assert the table cells are visible.

- [ ] **Step 2: Run component tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/richContentComponents.test.tsx tests/unit/readingNotes/libraryInteraction.test.tsx tests/unit/readingNotes/categoryManager.test.tsx
```

Expected: FAIL because the reading components do not exist.

- [ ] **Step 3: Extract listening page behavior without changing its HTTP calls or copy**

Move the current `src/app/knowledge-points/page.tsx` implementation verbatim into `ListeningKnowledgePointLibrary.tsx`, removing only its outer `<main>`, `<Header>`, page heading, and top padding. Keep `/api/knowledge-points`, AI assist, pagination, edit, delete, and five-second undo behavior unchanged. Add a snapshot-style render test comparing its key labels and request URLs before and after extraction.

- [ ] **Step 4: Implement accessible tabs and reading rich content surfaces**

`SectionTabs` uses stable equal-width buttons, `role="tablist"`, `role="tab"`, `aria-selected`, and no pill radius beyond `rounded-md`. `RichReadingEditor` uses `contentEditable`, intercepts paste HTML/plain text, calls `sanitizeReadingHtml`, and never uses raw unsanitized HTML. `RichReadingContent` receives already-sanitized HTML from the API and renders it in a constrained `.reading-rich-content` wrapper with responsive table overflow.

Add global rich-content rules only for semantic descendants:

```css
.reading-rich-content table { width: 100%; border-collapse: collapse; }
.reading-rich-content th,
.reading-rich-content td { border: 1px solid #a8a29e; padding: 0.45rem 0.6rem; vertical-align: top; }
.reading-rich-content th { background: #f5f5f4; font-weight: 600; }
.reading-rich-content ul { list-style: disc; padding-left: 1.25rem; }
.reading-rich-content ol { list-style: decimal; padding-left: 1.25rem; }
```

- [ ] **Step 5: Implement manual editor, category manager, and responsive library**

The editor has exactly category, knowledge point, optional note, and note date fields. The library header exposes `新增阅读笔记` and `管理分类`. Filters are search/category/status/date range. Rows show category, rich-content summary, optional note summary, date, and status, with edit/mastered/delete icon actions. Create and edit update the affected row locally, then revalidate in the background without blocking the dialog on a full-list reload.

The category manager supports add, inline rename, up/down reorder, merge, and delete. For nonempty delete, show only two valid choices: `移到未分类` or a target category. Empty categories delete directly; `未分类` has no delete action.

- [ ] **Step 6: Compose the mistake-library route and run tests**

Make `src/app/knowledge-points/page.tsx` render one `Header`, heading `错题库`, the two tabs, and only the active panel. Prefetch `/api/reading-note-categories` and `/api/reading-notes?page=1&pageSize=20` after the listening panel becomes ready, but do not mount duplicate listening effects.

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/richContentComponents.test.tsx tests/unit/readingNotes/libraryInteraction.test.tsx tests/unit/readingNotes/categoryManager.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the reading library UI**

```powershell
git add src/components/SectionTabs.tsx src/components/readingNotes src/components/knowledgePoints/ListeningKnowledgePointLibrary.tsx src/app/knowledge-points/page.tsx src/app/globals.css tests/unit/readingNotes
git commit -m "feat: add reading notes library"
```

---

### Task 6: Add Word-Only Import Preview And Atomic Confirmation

**Files:**
- Create: `src/lib/readingNotes/importConfirm.ts`
- Create: `src/lib/readingNotes/aiParser.ts`
- Create: `src/app/api/reading-notes/import/route.ts`
- Create: `src/app/api/reading-notes/import/ai/route.ts`
- Create: `src/app/api/reading-notes/import/confirm/route.ts`
- Create: `src/components/readingNotes/ReadingImport.tsx`
- Create: `src/components/knowledgePoints/ListeningImport.tsx`
- Modify: `src/app/knowledge-points/import/page.tsx`
- Create: `tests/unit/readingNotes/importPreview.test.ts`
- Create: `tests/unit/readingNotes/aiParser.test.ts`
- Create: `tests/unit/readingNotes/importUi.test.tsx`
- Create: `tests/integration/readingNotesImport.test.ts`
- Create: `tests/integration/readingNotesImportApi.test.ts`

**Interfaces:**
- Produces `buildReadingImportPreview`, `confirmReadingImport`, and `parseReadingImportWithAi`.
- Local route accepts multipart field `file`; AI route accepts a signed preview token and calls DeepSeek at most once per click.
- Confirm route accepts `{ token, acceptedSourceIndexes }` and performs one transaction.

- [ ] **Step 1: Write preview and transaction tests**

Assert duplicate identity is `(category normalized name, content hash)`, the same content in another category is not a duplicate, proposed categories are not inserted during preview, exceptions are capped at five, and a forced failure on the second insert rolls back both category and first note.

Use this preview assertion:

```ts
expect(preview).toMatchObject({
  recognizedCount: 3,
  duplicateCount: 1,
  unrecognizedCount: 6,
  existingCategories: ['固定搭配'],
  proposedCategories: ['高频商务词汇'],
  aiFallbackAvailable: true,
});
expect(preview.exceptions).toHaveLength(5);
```

- [ ] **Step 2: Write mocked AI and UI file-validation tests**

Inject `Pick<OpenAI, 'chat'>` into `parseReadingImportWithAi`, return one fixed JSON response, and assert one `chat.completions.create` call. Verify `.pdf`, `.doc`, and `.txt` are rejected before fetch; `.docx` produces one multipart request; no AI request occurs until `使用 AI 重新解析` is clicked.

- [ ] **Step 3: Run focused non-database tests and verify failure**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/importPreview.test.ts tests/unit/readingNotes/aiParser.test.ts tests/unit/readingNotes/importUi.test.tsx
```

Expected: FAIL because import modules are missing. No real DeepSeek call is allowed.

- [ ] **Step 4: Implement preview tokens and local parsing route**

Use an HMAC-signed, base64url token containing sanitized candidates and a 30-minute expiry; sign with `AUTH_SECRET` so preview creates no database rows and confirm cannot accept client-tampered HTML. `POST /api/reading-notes/import` calls `validateReadingDocx`, `parseReadingDocx`, loads categories and duplicate hashes in two queries, and returns counts plus at most five expanded exceptions.

The reading file input is exactly:

```tsx
<input
  type="file"
  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  onChange={handleReadingFile}
/>
```

Both client and server use `阅读笔记批量导入仅支持 Word(.docx) 文件` for disallowed formats.

- [ ] **Step 5: Implement the explicit DeepSeek fallback with one capped request**

`parseReadingImportWithAi(client, plainText, importDate)` uses the configured `DEEPSEEK_MODEL` or existing default and a Zod response schema containing only category, content HTML, notes, and date. Set `maxRetries: 0` through `createDeepSeekClient`, `stream: false`, `thinking: { type: 'disabled' }`, and `max_tokens: 4096`. The route is never called automatically and the button copy states `使用 AI 重新解析（调用 DeepSeek 1 次）`.

Development verification uses the injected mock. A real call requires a new explicit approval containing model, one-call limit, input size, and conservative cost ceiling.

- [ ] **Step 6: Implement one-request, one-transaction confirmation**

Use this signature:

```ts
export async function confirmReadingImport(
  client: VercelClient,
  input: { candidates: ReadingImportCandidate[]; acceptedSourceIndexes: number[]; today: string },
): Promise<{ requested: number; inserted: number; duplicates: number; categoriesCreated: number }>;
```

Begin once, lock/load category names, create missing categories, recheck all duplicates, insert nonduplicates with `next_review_date = today`, then commit. Any error rolls back everything. Response copy is totals only: `本次确认导入 X 条，新增成功 Y 条，新增分类 Z 个，跳过重复 W 条。`

- [ ] **Step 7: Extract listening import unchanged and compose the import tabs**

Move the existing import implementation into `ListeningImport.tsx`; preserve PDF/Word acceptance, existing DeepSeek behavior, preview button, and result behavior. The route page renders one header, title `导入错题笔记`, and `听力笔记 / 阅读笔记` tabs. Switching tabs must not submit or clear the other tab's draft.

- [ ] **Step 8: Run database tests after approval, then commit**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/importPreview.test.ts tests/unit/readingNotes/aiParser.test.ts tests/unit/readingNotes/importUi.test.tsx
npm.cmd test -- tests/integration/readingNotesImport.test.ts tests/integration/readingNotesImportApi.test.ts
```

Expected: all PASS; AI mock call count is one; rollback test leaves zero new rows.

Commit:

```powershell
git add src/lib/readingNotes/importConfirm.ts src/lib/readingNotes/aiParser.ts src/app/api/reading-notes/import src/components/readingNotes/ReadingImport.tsx src/components/knowledgePoints/ListeningImport.tsx src/app/knowledge-points/import/page.tsx tests/unit/readingNotes tests/integration/readingNotesImport.test.ts tests/integration/readingNotesImportApi.test.ts
git commit -m "feat: import reading notes from Word"
```

---

### Task 7: Add Immediate Reading Review In Study And Work Modes

**Files:**
- Create: `src/components/review/ListeningReview.tsx`
- Create: `src/components/readingNotes/ReadingReview.tsx`
- Modify: `src/app/review/page.tsx`
- Modify: `src/lib/disguiseMode.ts`
- Create: `tests/unit/readingNotes/reviewInteraction.test.tsx`
- Create: `tests/unit/readingNotes/workModeReview.test.tsx`
- Modify: `tests/unit/disguiseMode.test.ts`

**Interfaces:**
- `ListeningReview` preserves the current queue, speech, reveal, correction, mastered, delete, undo, and work-mode behavior.
- `ReadingReview` receives `{ mode: 'study' | 'work'; prefetched?: ReadingQueuePage }`.
- Both tab counts load in parallel; inactive initial queues are prefetched once.

- [ ] **Step 1: Write interaction tests for the approved reading state machine**

Use mocked fetch responses to prove:

```ts
expect(screen.getByRole('button', { name: '开始阅读复盘' })).toBeTruthy();
expect(screen.queryByRole('button', { name: '知道' })).toBeNull();
await user.click(screen.getByRole('button', { name: '开始阅读复盘' }));
expect(screen.getByText('as a result')).toBeTruthy();
await user.click(screen.getByRole('button', { name: '不知道' }));
expect(screen.getByText('上一条：不知道')).toBeTruthy();
expect(screen.getByText('therefore')).toBeTruthy();
await user.click(screen.getByRole('button', { name: '修改上一条结果' }));
expect(screen.getByText('上一条：知道')).toBeTruthy();
```

Also test unknown returns after later notes, known-to-unknown appends it, final result remains correctable at zero, status icons advance, delete undo restores exact position, and failed persistence restores queue/count with a retry action.

- [ ] **Step 2: Write work-mode tests**

Assert surrounding copy uses `Daily Review Requirements`, `Reading review`, `Known`, `Needs follow-up`, and `Previous: known/unknown`; the original Chinese rich knowledge point remains visible; `Study mode` and `Open another document` remain in `Header`; no warning, audio label, answer section, or Part label appears.

- [ ] **Step 3: Run review UI tests and verify failure**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/reviewInteraction.test.tsx tests/unit/readingNotes/workModeReview.test.tsx tests/unit/disguiseMode.test.ts
```

Expected: FAIL because `ReadingReview` and its copy do not exist.

- [ ] **Step 4: Extract listening review with a regression guard**

Move the current 450-line review implementation into `ListeningReview.tsx`. Keep its `/api/review/queue`, `/api/review/:id/answer`, `/api/knowledge-points/:id`, speech synthesis, phase behavior, keyboard action, filters, copy, and CSS classes unchanged. Only remove its outer `Header` so the route owns one shared header.

- [ ] **Step 5: Implement serialized optimistic reading decisions**

Maintain these state fields:

```ts
const [started, setStarted] = useState(false);
const [queue, setQueue] = useState<ReadingNote[]>([]);
const [pending, setPending] = useState(0);
const [previous, setPrevious] = useState<{
  attemptId: number; note: ReadingNote; decision: ReadingDecision;
} | null>(null);
const writeChain = useRef(Promise.resolve());
```

On known/unknown: snapshot client state, apply optimistic advance, append unknown to the queue tail, create `requestId = crypto.randomUUID()`, and enqueue the POST on `writeChain`. Replace the optimistic previous record with the returned attempt id. On failure restore the exact snapshot and show one retry button.

On previous-result correction: enqueue PATCH after the original POST, flip the badge immediately, remove the previous note's queued repeats for unknown-to-known, append one repeat for known-to-unknown, adjust pending, and roll all of that back on failure. The correction icon has `aria-label` and tooltip `修改上一条结果`.

- [ ] **Step 6: Implement start state, bounded refill, status actions, and work-mode skin**

Before start show pending count, category select, and `开始阅读复盘`. Start from the prefetched 50-item page. Refill when fewer than 10 unseen server items remain and `hasMore` is true; deduplicate by note id while retaining deliberate same-session unknown repeats.

Render category/date, `RichReadingContent`, optional note, decision buttons, previous-result row, and shared `ReviewItemActions`. Mastered/delete clear correction for that item. Delete captures the returned signed `undoToken` and queue index for a five-second undo; undo PATCHes `{ status: 'restore', undoToken }` and reinserts the returned exact note at that index.

Add reading work copy:

```ts
export const workReadingReviewCopy = {
  tab: 'Reading review',
  start: 'Begin review',
  known: 'Known',
  unknown: 'Needs follow-up',
  previousKnown: 'Previous: known',
  previousUnknown: 'Previous: needs follow-up',
  changePrevious: 'Change previous decision',
  category: 'Workstream',
  noteDate: 'Reference date',
};
```

- [ ] **Step 7: Compose parallel tab counts and prefetching in the route**

`src/app/review/page.tsx` renders `Header`, tabs, and the active panel. On first mount use `Promise.all` for `/api/review/queue` and `/api/reading-review/count`, then prefetch `/api/reading-review/queue?limit=50` without delaying listening. When reading is active, keep the listening queue cached and do not restart speech until the user returns to listening.

- [ ] **Step 8: Run tests and commit**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/reviewInteraction.test.tsx tests/unit/readingNotes/workModeReview.test.tsx tests/unit/disguiseMode.test.ts tests/unit/srs.test.ts
```

Expected: PASS; existing SRS suite remains unchanged.

Commit:

```powershell
git add src/components/review/ListeningReview.tsx src/components/readingNotes/ReadingReview.tsx src/app/review/page.tsx src/lib/disguiseMode.ts tests/unit/readingNotes tests/unit/disguiseMode.test.ts
git commit -m "feat: add reading notes review flow"
```

---

### Task 8: Add Reading Mastered Management And Cross-Page Performance Guards

**Files:**
- Create: `src/components/mastered/ListeningMastered.tsx`
- Create: `src/components/readingNotes/ReadingMastered.tsx`
- Modify: `src/app/mastered/page.tsx`
- Modify: `src/components/readingNotes/ReadingNoteLibrary.tsx`
- Modify: `src/components/readingNotes/ReadingCategoryManager.tsx`
- Create: `tests/unit/readingNotes/masteredInteraction.test.tsx`
- Create: `tests/unit/readingNotes/performanceContracts.test.tsx`

**Interfaces:**
- Reading mastered restore returns a note to today's active queue.
- Reading permanent delete removes the row optimistically and supports five-second exact restoration.
- Mutations never await a second full-list GET before the UI updates.

- [ ] **Step 1: Write tests for restore, delete undo, and request counts**

Assert restoring a mastered item requires the same confirmation semantics as listening, then removes it immediately and PATCHes `{ status: 'active' }`. Assert permanent delete has no confirmation, removes immediately, exposes `撤销`, and restores the mastered state with `{ status: 'restore', undoToken }`. Count fetches so create/edit/master/delete/category add each makes one mutation request and at most one nonblocking revalidation request.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/masteredInteraction.test.tsx tests/unit/readingNotes/performanceContracts.test.tsx
```

Expected: FAIL because mastered reading UI is missing.

- [ ] **Step 3: Extract listening mastered UI and compose the reading tab**

Move current listening mastered behavior into `ListeningMastered.tsx` unchanged. `ReadingMastered` uses `/api/reading-notes?status=mastered`, renders category/date/rich summary, and exposes restore plus delete icon actions. The route renders `听力 / 阅读` tabs and prefetches the inactive first page.

- [ ] **Step 4: Enforce immediate local updates across reading management**

For create prepend the returned row; edit replace by id; mastered/delete remove by id; category rename replace category names locally; category merge rewrite affected category ids/names locally. Use background `void revalidate()` only after the mutation response succeeds. Disable only the action being written, not the whole page.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm.cmd test -- tests/unit/readingNotes/masteredInteraction.test.tsx tests/unit/readingNotes/performanceContracts.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add src/components/mastered/ListeningMastered.tsx src/components/readingNotes/ReadingMastered.tsx src/app/mastered/page.tsx src/components/readingNotes/ReadingNoteLibrary.tsx src/components/readingNotes/ReadingCategoryManager.tsx tests/unit/readingNotes
git commit -m "feat: manage mastered reading notes"
```

---

### Task 9: Run Regression, Browser Acceptance, And Deployment Checkpoints

**Files:**
- Modify only if verification finds a defect: files introduced in Tasks 1-8
- Do not modify: existing real database records
- Do not stage: `.superpowers/`, `dev-server.err.log`, `dev-server.out.log`

**Interfaces:**
- Confirms the approved specification end to end.
- Produces no paid API traffic during automated verification.

- [ ] **Step 1: Run the complete local static and unit verification**

Run:

```powershell
npm.cmd run lint
npm.cmd test -- tests/unit
npm.cmd run build
```

Expected: ESLint exits `0`; all unit tests PASS; Next.js production build exits `0` with no TypeScript errors.

- [ ] **Step 2: Obtain database approval and run all integration tests serially**

Run only after explicit approval:

```powershell
npm.cmd test -- tests/integration
```

Expected: all integration tests PASS serially. Do not delete any real or user-created test data; integration setup must continue using rollback transactions.

- [ ] **Step 3: Start a local server without calling DeepSeek**

Run:

```powershell
npm.cmd run dev
```

Expected: Next.js reports a local URL. Keep the server running through browser acceptance. Use a `.docx` fixture and mocked/disabled AI fallback only.

- [ ] **Step 4: Verify desktop and mobile behavior with Playwright**

At `1440x900` and `390x844`, verify:

1. All four affected pages expose the approved listening/reading tabs without horizontal page scrolling.
2. Manual reading create preserves a pasted table and shows no Word CSS.
3. Category add/rename/reorder/merge/delete has immediate visual feedback and never deletes notes.
4. PDF and `.doc` reading import are rejected; `.docx` preview creates no database rows; cancel creates nothing; confirm inserts totals atomically.
5. Reading review has a start button, complete content, immediate known/unknown advance, unknown repeat, both correction directions, final correction at zero, mastered/delete icons, and five-second undo.
6. Work mode keeps original knowledge text but disguises surrounding UI and retains `Study mode` and `Open another document`.
7. Listening review audio, reveal, correction, filters, counts, and status actions still work.
8. Part 5 question training still loads, submits, reveals analysis, and records timing.

Capture screenshots for reading review start, active study mode, active work mode, library table content, import preview, and mobile overflow review. Check `document.documentElement.scrollWidth <= window.innerWidth` at both viewport widths.

- [ ] **Step 5: Request user acceptance on the local URL**

Report the URL and the exact tested flows. Wait for the user to test with real data. Do not deploy, migrate another environment, or clean test data while waiting.

- [ ] **Step 6: Commit verification-only fixes and inspect the branch**

If verification required fixes, inspect `git diff --name-only`, confirm every changed path belongs to this feature, then stage only this explicit feature path set (Git ignores paths without changes):

```powershell
git add migrations/0008_reading_notes.sql package.json package-lock.json src/lib/readingNotes src/app/api/reading-note-categories src/app/api/reading-notes src/app/api/reading-review src/components/readingNotes src/components/review/ListeningReview.tsx src/components/knowledgePoints src/components/mastered src/components/SectionTabs.tsx src/app/review/page.tsx src/app/knowledge-points/page.tsx src/app/knowledge-points/import/page.tsx src/app/mastered/page.tsx src/app/globals.css src/lib/disguiseMode.ts tests/unit/readingNotes tests/integration/readingNotesCrud.test.ts tests/integration/readingNotesApi.test.ts tests/integration/readingNotesReview.test.ts tests/integration/readingNotesReviewApi.test.ts tests/integration/readingNotesImport.test.ts tests/integration/readingNotesImportApi.test.ts tests/integration/schema.test.ts
git commit -m "fix: polish reading notes workflow"
```

Then run:

```powershell
git status --short
git log --oneline -10
```

Expected: only the known untracked prototype/log files remain; feature commits are visible; no secret or environment file is staged.

- [ ] **Step 7: Use the branch-finishing workflow after local acceptance**

Invoke `finishing-a-development-branch`. Recommend merging `worktree-toeic-review-impl` into the default branch only after tests and user acceptance pass. Resolve against the latest default branch without overwriting unrelated user changes.

- [ ] **Step 8: Deploy Preview only after explicit approval, test it, then request Production approval separately**

Preview acceptance repeats the reading create/import/review/correction/work-mode smoke tests without a real AI call. Production deployment is a separate explicit approval. After Production, verify the public URL, schema availability, independent counts, and one reading-note round trip; preserve every test and production record.

---

## Self-Review Results

- Spec coverage: Tasks 1-9 cover data isolation, one-level categories, rich content, Word-only import, local-first parsing, explicit AI fallback, atomic confirmation, review start/decisions/correction/repeats, statuses/undo, work mode, page tabs, performance, and regression protection.
- Placeholder scan: passed; every implementation step names concrete behavior, files, interfaces, commands, and expected results.
- Type consistency: reading decision names are `known | unknown`; status names are `active | mastered | deleted`; rich content uses `contentHtml/contentText`; queue pages use `items/totalPending/hasMore`; all later tasks use the Task 1 names.
- Safety check: migration/integration, real DeepSeek, Preview, and Production each have explicit approval gates; automated tests use mocks; no step removes real data.
