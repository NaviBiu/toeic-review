# Reading Notes Review Design

Date: 2026-09-02  
Status: Approved through text review and interactive prototype

## 1. Purpose

Add a reading-note memorization workflow to the existing TOEIC review app. Reading notes may cover any reading Part and are not labeled as Part 5, Part 6, or Part 7.

The feature must support:

- editable one-level categories such as high-frequency business vocabulary, fixed expressions, and verb + noun collocations;
- rich knowledge-point content containing text and tables;
- optional notes and an editable note date;
- manual creation and document-based bulk import;
- spaced repetition using the existing listening review rules;
- mastered and permanently deleted states;
- the existing normal and work-mode presentations.

## 2. Non-goals

This release does not add:

- reading Part classification;
- a question-and-answer or answer-reveal phase;
- reading analytics or charts;
- automatic knowledge-point generation;
- changes to the existing Part 5 multiple-choice question trainer;
- migration of existing listening data into a new shared table.

## 3. Information Architecture

Keep all current top-level navigation labels.

### Today Review

Add `听力` and `阅读` tabs with independent pending counts. The listening tab preserves its existing behavior. The reading tab opens the reading-note review flow described below.

### Mistake Library

Add `听力笔记` and `阅读笔记` tabs. This page manages items that enter the spaced-repetition system.

The complete Part 5 questions with A/B/C/D options, answers, and analysis remain under `阅读训练`. They are not mixed with reading notes.

### Import Notes

Keep the page name `导入笔记`. Add `听力笔记` and `阅读笔记` tabs. Reading notes support both bulk document import and manual creation.

### Mastered

Add `听力` and `阅读` tabs. Mastered reading notes can be restored to the active review queue or permanently deleted.

## 4. Data Model

Use new reading-specific tables so existing listening records and behavior are not put at migration risk. Share the pure spaced-repetition calculation code with listening rather than sharing the listening-oriented table.

### Reading note categories

Each category contains:

- identifier;
- name;
- sort order;
- active/deleted state;
- created and updated timestamps.

Category names are unique after trimming and normalizing whitespace. Categories do not have a Part field or a second level.

### Reading notes

Each reading note contains:

- category identifier;
- sanitized rich-text knowledge-point content;
- normalized plain text derived from the rich content for search and duplicate detection;
- optional note text;
- note date, defaulting to the current local date;
- status: active, mastered, or deleted;
- the same scheduling state used by listening, including next review date, last review date, streak, correct count, and incorrect count;
- created and updated timestamps.

Allowed rich-content structures include paragraphs, line breaks, emphasis, lists, and tables. Tables may retain logical rows, columns, `rowspan`, and `colspan`, but imported inline styles, classes, scripts, event handlers, comments, and Word CSS are removed. Rendering uses the website's own table style.

Duplicate detection is scoped to one category and uses normalized knowledge-point text. The same content may exist in different categories.

### Reading review attempts

Persist each reading review decision as an attempt with:

- note identifier;
- final decision, known or unknown;
- the note's scheduling snapshot immediately before the attempt;
- resulting scheduling state;
- timestamp.

The immediately previous attempt may be corrected. Correction updates the same attempt and recomputes counts and scheduling from its pre-attempt snapshot. It must not create both an incorrect and a correct attempt for one user action.

## 5. Reading Review Flow

### Start state

The reading tab shows:

- the reading pending count;
- an optional category filter, defaulting to all categories;
- a `开始阅读复盘` button.

The note date is source metadata and does not delay first review. Every newly imported or manually created note enters the reading queue on the day it is added, even when its note date is historical. There is no daily cap. When the note date is omitted, the note date itself defaults to the day the item is added.

### Active card

The card displays all study content immediately:

- category and note date in a quiet header;
- full rich knowledge-point content;
- optional notes below the knowledge point.

There is no question state and no answer page.

The primary actions are `知道` and `不知道`, arranged like the existing listening decision buttons. Clicking either action immediately advances to the next note and saves in the background.

An unknown note is appended to the end of the current session and remains due today. It can continue reappearing until marked known, mastered, deleted, or the user leaves the session.

### Correcting the previous decision

After the first decision, a compact row below the new card shows:

- `上一条：知道` or `上一条：不知道`;
- a switch-result icon with a tooltip.

The switch applies only to the immediately previous known/unknown decision and does not navigate back to the previous card.

- Changing unknown to known updates the same attempt and removes the queued repeat from the current session.
- Changing known to unknown updates the same attempt and appends the note to the current session.
- The pending count changes to match the corrected result.
- When the current session has otherwise completed, the previous-decision control remains available so the final decision can still be corrected.
- Answering the next note replaces the correction target with that new immediately previous attempt.

Client writes are serialized so a correction cannot overtake creation of its original attempt. If persistence fails, the optimistic state is reverted and a retry message is shown.

### Master and delete actions

Use the same icons, tooltips, order, and placement as listening review.

- Marking a note as mastered immediately advances and removes it from future queues.
- Permanent delete does not ask for confirmation. It advances immediately and displays the existing timed undo control.
- Undo restores the exact deleted note and its session position.
- Mastering or deleting is a status action, not a known/unknown decision, so it clears the previous-decision correction control for that item.

## 6. Reading Note Management

The reading-note library provides visible `新增阅读笔记` and `管理分类` actions.

### List and filters

Support:

- search over normalized knowledge-point text and notes;
- category, status, and date filters;
- newest note date first by default;
- category, content summary, optional note summary, date, and status in each row;
- edit, mark mastered, and permanent delete actions using the same visual language as listening.

Opening a row shows the complete rich content for editing.

### Manual editor

Fields are:

- category, required;
- knowledge point, required rich text;
- note, optional;
- date, defaulting to today.

Pasting from Word or a web page preserves supported semantic content and table structure while stripping document CSS.

### Category management

Support add, rename, reorder, merge, and delete.

- Empty categories may be deleted directly.
- Deleting a non-empty category requires moving its notes to `未分类` or merging them into another category.
- Deleting a category never deletes its notes.

## 7. Bulk Import

Support `.docx` and PDF files from the `阅读笔记` tab.

The expected document structure is:

```text
日期：xxxx年xx月xx日

分类一：分类名称
1. 知识点：...
备注：...
2. 知识点：...

分类二：分类名称
知识点：...
备注：...
```

A date applies to following content until another date appears. Missing dates default to the import date. Missing notes are valid. A category absent from the system is proposed as a new category.

Use local deterministic parsing first:

- DOCX paragraphs and tables are converted to sanitized semantic rich text;
- PDF text and tables are reconstructed when their structure can be identified reliably;
- no paid API is called during successful local parsing.

If parsing confidence is insufficient, show an explicit `使用 AI 重新解析` action. Only that user action invokes DeepSeek. Development and automated tests use mocks unless a separately approved, cost-capped real call is required.

### Preview and confirmation

Parsing never writes directly to the database. Preview displays:

- total recognized notes;
- existing and proposed new categories;
- duplicate count;
- unrecognized count;
- at most five expanded exception examples.

Confirm import performs category creation and note insertion in one server request and one database transaction. Cancel creates nothing. The result message reports totals rather than listing every imported note.

## 8. Work Mode

Reading review is available in work mode.

- The surrounding layout, controls, headings, metadata, and status messages use the existing English requirements-document presentation.
- The recorded knowledge point and optional note remain in their original language, including Chinese and tables.
- No warning is shown before entering reading review.
- Reading-review controls keep the same behavior in normal and work modes.
- The existing `Study mode` and `Open another document` header actions remain available.

## 9. Performance and Failure Handling

- Fetch listening and reading pending counts in parallel.
- Prefetch the inactive review tab's initial queue.
- Fetch a bounded session queue rather than issuing one request per card.
- Apply decisions optimistically and serialize background writes.
- Batch category creation and note insertion in one transaction.
- Do not reload the full library after every mutation; update the affected item and aggregate count locally, then revalidate in the background.
- A failed decision write restores the prior queue and count and exposes a retry action.
- A failed previous-decision correction restores both the previous result and the current session queue.
- A failed import transaction creates neither categories nor notes.

## 10. Test Coverage

### Unit tests

- SRS known and unknown transitions reuse listening rules.
- Previous-decision correction recomputes from the pre-attempt snapshot.
- Unknown-to-known removes the queued repeat; known-to-unknown appends it.
- Corrected attempts affect correct/incorrect counts only once.
- Duplicate normalization and category scoping.
- Date inheritance and missing-date defaults.
- Word CSS removal and rich-table preservation.
- Category merge and move-to-uncategorized behavior.

### API and database tests

- Reading queue filtering and independent counts.
- Attempt creation and idempotent correction.
- Master, delete, timed undo, and restore.
- Atomic import of new categories and notes.
- Transaction rollback on partial import failure.
- Existing listening endpoints and Part 5 training remain unchanged.

### Browser tests

- Start reading review, choose known, and advance immediately.
- Choose unknown and verify the note returns later in the session.
- Change the previous result in both directions and verify the pending count.
- Correct the final decision after the queue reaches zero.
- Master and delete actions in normal and work modes.
- Timed delete undo.
- Manual rich-text entry and pasted table rendering.
- Import preview, new category creation, duplicates, and exceptions.
- Desktop and mobile layout with long words and wide tables.

## 11. Acceptance Criteria

The feature is complete when:

1. Reading notes can be created manually and bulk imported with categories, rich knowledge points, optional notes, and dates.
2. New categories found during import are created only after confirmation.
3. Today's review clearly separates listening and reading and shows accurate independent counts.
4. Reading review begins from a start action and shows complete knowledge-point content without an answer page.
5. Known and unknown actions advance immediately, while the immediately previous result remains correctable.
6. SRS scheduling and attempt counts reflect only the final corrected decision.
7. Reading notes support mastered, permanent delete, and timed undo in both normal and work modes.
8. Existing listening review and Part 5 question training behavior remains intact.
9. Common database-backed actions feel immediate through prefetching, batching, and optimistic updates.
