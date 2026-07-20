# Work Mode Document View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn work mode into an interactive English document disguise with five local document skins while retaining real review actions.

**Architecture:** A small client hook synchronizes work-mode state from local storage and a browser event. `Header` owns the mode, menu, and skin controls. The review page consumes the mode for English copy while a root-level overlay supplies route-specific English documents for all non-review routes.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Tailwind CSS, Vitest.

## Global Constraints

- Use only five local fixed skins; no API calls, remote assets, or generated content.
- In work mode, no Chinese user-interface text is visible.
- Keep the normal study UI and review persistence behavior unchanged.
- Work-mode navigation is initially collapsed and must not create horizontal page overflow.

---

### Task 1: Work-mode state and skin model

**Files:**
- Modify: `src/lib/disguiseMode.ts`
- Create: `src/hooks/useWorkMode.ts`
- Modify: `tests/unit/disguiseMode.test.ts`

**Interfaces:**
- Produces `WORK_MODE_STORAGE_KEY`, `workSkins`, `getNextWorkSkin(current: string): WorkSkin`, and `workReviewCopy`.
- Produces `useWorkMode(): { enabled: boolean; skin: WorkSkin; setEnabled(enabled: boolean): void; rotateSkin(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
expect(workSkins).toHaveLength(5);
expect(getNextWorkSkin('requirements', () => 0).id).not.toBe('requirements');
expect(workReviewCopy.confirmed).toBe('Confirmed');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: FAIL because the skin model and English review copy are not exported.

- [ ] **Step 3: Implement the model and hook**

```ts
export const workSkins = [{ id: 'requirements', title: 'Requirements Review' } /* four more */] as const;
export function getNextWorkSkin(current: string, random = Math.random) {
  const remaining = workSkins.filter((skin) => skin.id !== current);
  return remaining[Math.floor(random() * remaining.length)];
}
```

The hook reads and writes `toeic-work-mode` and `toeic-work-skin`, applies both values to `document.documentElement.dataset`, and dispatches/listens for `toeic-work-mode-change`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: PASS.

### Task 2: Header, document skin CSS, and non-review overlay

**Files:**
- Modify: `src/components/Header.tsx`
- Create: `src/components/WorkModeDocumentOverlay.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes `useWorkMode`, `workModeNav`, `getDisguiseTitle`, and `workSkins` from Task 1.
- Produces a fixed-width work header with a collapsed vertical document index and a route-aware opaque overlay for non-review routes.

- [ ] **Step 1: Add a unit-level failing test for the route copy model**

```ts
expect(getDisguiseTitle('/stats')).toBe('Reporting Requirements');
expect(getDisguiseTitle('/unknown')).toBe('Requirements Review Brief');
```

- [ ] **Step 2: Run the focused test to verify it fails if the model is absent**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: FAIL until the route document metadata is exported from the model.

- [ ] **Step 3: Implement the header and overlay**

Use `aria-expanded` on the menu button. Render the index only when `menuOpen` is true. Use an `Open another document` button to call `rotateSkin`. `WorkModeDocumentOverlay` returns `null` for `/review`, otherwise renders an English title, metadata, document purpose, and non-interactive acceptance/change sections.

- [ ] **Step 4: Implement neutral responsive skins**

Define five `[data-work-skin]` CSS variants using white, grey, and slate. Vary grid/sidebar/meeting-note/release/checklist layout rules while keeping page width bounded with `max-width` and `overflow-x: clip`.

- [ ] **Step 5: Run focused unit tests**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: PASS.

### Task 3: Interactive English review view

**Files:**
- Modify: `src/app/review/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes `useWorkMode` and `workReviewCopy` from Task 1.
- Preserves existing `pickGuess`, `revoke`, `next`, deletion, undo, API calls, and queue semantics.

- [ ] **Step 1: Write a failing test for review copy**

```ts
expect(workReviewCopy.pending(14)).toBe('14 items pending');
expect(workReviewCopy.followUp).toBe('Needs follow-up');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: FAIL until dynamic work-mode review copy is defined.

- [ ] **Step 3: Render English work-mode labels without changing review behavior**

Use `enabled ? workReviewCopy.* : existingChineseCopy` for headings, filter label, result states, errors, action buttons, badges, tooltips, delete, and undo. Add a work-mode document frame around the existing card. Preserve the original Chinese labels and controls when disabled.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/unit/disguiseMode.test.ts`
Expected: PASS.

### Task 4: Verify and commit

**Files:**
- Modify: all files from Tasks 1-3

- [ ] **Step 1: Run all tests**

Run: `npm.cmd test`
Expected: all unit and integration tests pass.

- [ ] **Step 2: Run production build**

Run: `npm.cmd run build`
Expected: Next.js production build succeeds.

- [ ] **Step 3: Visually verify work mode**

Check `/review` in normal and work mode at desktop and mobile width. Verify collapsed/expanded menu, all five skin rotations, English-only work-mode review content, click results for both choices, and a non-review route overlay.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Header.tsx src/components/WorkModeDocumentOverlay.tsx src/hooks/useWorkMode.ts src/lib/disguiseMode.ts src/app/review/page.tsx src/app/layout.tsx src/app/globals.css tests/unit/disguiseMode.test.ts docs/superpowers
git commit -m "Build work mode document skins"
```
