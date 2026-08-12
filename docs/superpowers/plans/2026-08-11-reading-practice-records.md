# Reading Practice Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended when suitable) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reading Part 5-7 score entry, filtered history, and image attachment support without changing existing listening records or analysis.

**Architecture:** Extend practice sessions with a `section` discriminator (`listening` or `reading`) and widen part scores from Part 1-4 to Part 1-7. Keep one API and one page, with a top-level section switch that filters records and seeds the correct form defaults.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vercel Postgres, Vitest, Tailwind CSS.

## Global Constraints

- Existing rows and payloads without `section` remain listening records.
- A complete listening record requires Parts 1-4; a complete reading record requires Parts 5-7.
- Reading defaults are Part 5: 30, Part 6: 16, Part 7: 54.
- Reading and listening histories are displayed separately.
- Reading analysis and reading knowledge-point review are outside this phase.
- Do not commit or push until the user has tested the feature.

---

### Task 1: Reading Practice Domain And Migration

**Files:**
- Create: `migrations/0004_reading_practice_sessions.sql`
- Modify: `src/lib/mockExams.ts`
- Test: `tests/integration/mockExams.test.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces `PracticeSection = 'listening' | 'reading'`.
- Extends `PartScore.part` to `1 | 2 | 3 | 4 | 5 | 6 | 7`.
- Adds `section` to practice-session inputs and results.

- [ ] Write integration tests that create reading drills, require Parts 5-7 for complete reading, reject cross-section parts, and preserve legacy listening payloads.
- [ ] Run the focused tests and confirm failures are caused by Part 5-7/schema support being absent.
- [ ] Add the additive database migration and domain validation.
- [ ] Apply the migration once and rerun the focused tests until they pass.

### Task 2: Reading API Contract

**Files:**
- Modify: `tests/integration/mockExamsApi.test.ts`
- Verify: `src/app/api/mock-exams/route.ts`

**Interfaces:**
- `POST /api/mock-exams` accepts `section: 'reading'` plus Part 5-7 scores.
- `GET /api/mock-exams` returns `section` on every record.

- [ ] Add a failing route test for a reading Part 6 drill.
- [ ] Run the route test and confirm the missing reading contract failure.
- [ ] Make only the route/domain changes required by the test.
- [ ] Rerun route and domain tests.

### Task 3: Reading Entry And Filtered History UI

**Files:**
- Modify: `src/app/mock-exams/page.tsx`
- Create: `src/lib/practiceRecordForm.ts`
- Create: `tests/unit/practiceRecordForm.test.ts`

**Interfaces:**
- `partsForSection(section)` returns listening Parts 1-4 or reading Parts 5-7.
- `defaultPracticeParts(section, type)` returns full-section defaults or a sensible drill default.
- The page section switch filters history and opens the form in the active section.

- [ ] Add failing unit tests for reading totals, full-reading defaults, drill defaults, and section filtering.
- [ ] Run the tests and confirm the helper does not exist.
- [ ] Implement the typed form helper.
- [ ] Add the section switch, reading-aware form labels/defaults, and filtered history while leaving listening analysis unchanged.
- [ ] Run unit tests and a production build.

### Task 4: Browser Verification

**Files:**
- Verify: `src/app/mock-exams/page.tsx`

**Interfaces:**
- Desktop and mobile users can record a complete reading set or selected reading Parts.
- Reading records show Part 5-7 scores and support existing image preview/management controls.

- [ ] Start the local development server without making paid API calls.
- [ ] Verify listening records and analysis remain unchanged.
- [ ] Verify reading full and drill form states at desktop and mobile widths.
- [ ] Save a reading record, verify it appears only under Reading, and verify attachment controls remain usable.
- [ ] Report the local URL and leave Git unchanged for user acceptance.
