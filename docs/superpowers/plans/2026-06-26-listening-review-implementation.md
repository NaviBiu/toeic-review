# TOEIC 听力错题知识点 + 间隔复盘系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a private web app where the user imports daily TOEIC listening error notes (PDF/Word), reviews them on a spaced-repetition schedule from any device, logs mock-exam scores, and can delete items or export all data.

**Architecture:** Next.js (App Router, TypeScript) single project, deployed on Vercel, backed by Vercel Postgres. All business logic that doesn't need I/O (date math, term normalization, scenario validation, the SRS algorithm, the import dedup decision) lives in pure, unit-tested functions under `src/lib/`. Data access goes through thin per-table modules. API routes wire pure logic + data access together. A Next.js proxy (this project is on Next.js 16, where `middleware.ts` is deprecated in favor of `proxy.ts`) enforces a single shared-password cookie on every route.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Tailwind CSS, `@vercel/postgres`, `@anthropic-ai/sdk` (Claude), `pdf-parse` + `mammoth` for document text extraction, Vitest for tests, GitHub + Vercel for hosting.

Spec reference: `docs/superpowers/specs/2026-06-26-listening-review-design.md` (referred to below as "the spec").

## Global Constraints

- Timezone: all "today"/due-date logic uses Asia/Shanghai (UTC+8), not server local time or UTC (spec §11).
- SRS curve: `[1, 2, 4, 7, 15, 30]` days; graduate to `mastered` on the 7th consecutive correct answer (spec §7).
- Term dedup normalization: lowercase, strip whitespace, hyphens (`-`), and apostrophes (`'`) (spec §4.1, §11).
- Unique key: `(term, part, scenario_major, scenario_minor, skill)`, enforced only among non-`deleted` rows via a partial unique index (spec §4.1).
- Scenario taxonomy: exactly the 13 ETS categories + `未分类`, each with a fixed minor list + universal `未分类` minor fallback (spec §12).
- Mock exam validation: every `*_total` ≥ 1 and `*_correct` ≤ `*_total` (spec §8).
- Cookie session: 30-day expiry, plain-text password comparison (no hashing) (spec §3, §11).
- File upload limit: 5MB, text-based PDF/Word only, no OCR (spec §5.4).
- No feature beyond what's in the spec's "本次做的" list — anything in "明确不做" stays out (spec §2).
- This project runs Next.js 16 (confirmed via `package.json` after scaffolding in Task 1), which has two breaking changes versus older App Router conventions that every later task must follow: (1) dynamic route handler `params` is a `Promise` — write `{ params }: { params: Promise<{ id: string }> }` and `const { id } = await params;`, never the old synchronous `{ params: { id: string } }`; (2) `middleware.ts` is renamed to `proxy.ts` with the exported function named `proxy`, not `middleware` (Task 8 creates this; later tasks just rely on it existing, no action needed). `next.config.ts` (not `.js`) is what Task 1's scaffold actually produces — keep it as `.ts`.
- Any script or test that needs `POSTGRES_URL`/`ANTHROPIC_API_KEY`/`APP_PASSWORD` must load them with `import { config } from 'dotenv'; config({ path: '.env.local' });` — never the bare `import 'dotenv/config'`, which only loads a file literally named `.env` and silently leaves every var undefined against the `.env.local` that `vercel env pull` actually writes (confirmed by hitting this in Task 1).
- `.env.local` in this worktree already has real values for `POSTGRES_URL`, `ANTHROPIC_API_KEY`, and `APP_PASSWORD` (set up during Task 1) — no later task needs to fetch or re-pull these. If a task's manual-verification step ever finds one missing/empty after running `vercel env pull`, that's because Vercel's "Sensitive" environment variable type returns empty on CLI pull by design; re-add the var with `vercel env add NAME preview --value=... --no-sensitive --yes` rather than assuming the credential itself is wrong.
- `@vercel/postgres` prints a deprecation warning on install ("choose an alternate storage solution... migrated to Neon as a native Vercel integration") — this is expected and not a bug to fix. It was verified working end-to-end in Task 1 against the actual Neon-backed database this project provisioned through Vercel's Storage tab; keep using `sql`/`createClient` from `@vercel/postgres` exactly as every task already specifies. Do not switch to `@neondatabase/serverless` or any other client.
- The Vercel project (`navibius-projects/toeic-review`) currently deploys from the `worktree-toeic-review-impl` git branch, not `main`/`master` — Preview deployments build from this branch automatically on push. This is intentional during implementation; Task 18 / the eventual merge to the main branch is what's expected to produce the real Production deployment.

---

## File Structure

```
toeic-review/
  migrations/
    0001_init.sql
  scripts/
    migrate.ts
  src/
    proxy.ts               -- Next.js 16 renamed middleware.ts -> proxy.ts; export name is `proxy`, not `middleware`
    lib/
      dateUtils.ts          -- Asia/Shanghai "today", addDays, isFutureDate
      termNormalize.ts       -- normalizeTerm()
      scenarios.ts            -- SCENARIOS taxonomy, isValidScenario, sanitizeScenario
      srs.ts                   -- applyCorrectAnswer, applyWrongAnswer, CURVE_DAYS
      importDedup.ts            -- decideDedup()
      auth.ts                    -- isAuthedCookie()
      db.ts                        -- re-exports @vercel/postgres sql, createClient
      knowledgePoints.ts             -- data access for knowledge_points
      mockExams.ts                     -- data access for mock_exam_results / _scores
      fileExtract.ts                     -- extractText(file): PDF/.docx -> plain text
      importParser.ts                     -- Claude prompt + response parsing into candidates
    app/
      layout.tsx, page.tsx                   -- shell + home nav
      login/page.tsx                           -- passcode form
      api/
        auth/route.ts                            -- POST login
        knowledge-points/
          route.ts                                  -- GET list, POST manual add
          [id]/route.ts                               -- PATCH edit/delete/restore
          import/route.ts                              -- POST upload+parse+dedup-check
          import/confirm/route.ts                        -- POST write confirmed candidates
        review/
          queue/route.ts                                  -- GET today's queue
          [id]/answer/route.ts                              -- POST record an answer
        mock-exams/route.ts                                  -- GET list, POST create
        stats/route.ts                                        -- GET aggregates
        export/route.ts                                        -- GET full JSON dump
      knowledge-points/page.tsx                                -- browse/add/edit/delete UI
      knowledge-points/import/page.tsx                          -- upload + confirm list UI
      review/page.tsx                                            -- today's review UI
      mastered/page.tsx                                           -- mastered list + restore
      mock-exams/page.tsx                                          -- record + history UI
      stats/page.tsx                                                -- stats + export button
  tests/
    unit/
      dateUtils.test.ts, termNormalize.test.ts, scenarios.test.ts,
      srs.test.ts, importDedup.test.ts, auth.test.ts
    integration/
      setup.ts                  -- withTestClient() transaction-rollback helper
      schema.test.ts
      knowledgePoints.test.ts
      mockExams.test.ts
      reviewFlow.test.ts
      importFlow.test.ts
  .env.example
  package.json, tsconfig.json, next.config.js, vitest.config.ts, .gitignore
```

---

## Task 1: Project scaffold, accounts, and hosted Postgres

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `vitest.config.ts`
- Create: `scripts/check-db.ts`

**Interfaces:**
- Produces: a running local Next.js dev server, a `POSTGRES_URL` env var pointing at a real hosted dev database, an `ANTHROPIC_API_KEY` env var, an `APP_PASSWORD` env var, and a GitHub repo with this code pushed. All later tasks depend on these existing.

- [ ] **Step 1: Install Node.js**

Run: `winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements`

Then open a new shell and verify:

Run: `node --version`
Expected: prints a `v20.x.x` or `v22.x.x` line (any current LTS).

- [ ] **Step 2: Scaffold the Next.js app**

Run (from `d:/AI/my-first-ai-prj/toeic-review`):

```
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint
```

When prompted, accept defaults. This creates `app/`, not `src/app/` — move it:

Run:
```
mkdir src
git mv app src/app
git mv next.config.js next.config.js.bak 2>nul
```

Edit `tsconfig.json`'s `"paths"` so `"@/*"` maps to `["./src/*"]` instead of `["./*"]`.

- [ ] **Step 3: Verify the dev server runs**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: default Next.js starter page loads with no console errors. Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 4: Add project dependencies**

Run:
```
npm install @vercel/postgres @anthropic-ai/sdk pdf-parse mammoth
npm install -D vitest dotenv @types/pdf-parse tsx
```

- [ ] **Step 5: Add `.env.example` and `.gitignore` entries**

Write `.env.example`:
```
POSTGRES_URL=
ANTHROPIC_API_KEY=
APP_PASSWORD=
```

Confirm `.gitignore` (created by `create-next-app`) already contains `.env*.local` — if not, append it.

- [ ] **Step 6: ⚠️ HUMAN ACTION — create the GitHub repo and push**

Ask the user to confirm they want a new GitHub repo (private) named `toeic-review`. Then run:
```
git add -A
git commit -m "Scaffold Next.js project"
gh repo create toeic-review --private --source=. --remote=origin --push
```
If `gh` isn't authenticated, it will prompt a browser login — hand that off to the user.

- [ ] **Step 7: ⚠️ HUMAN ACTION — create Vercel project + Postgres database**

Tell the user exactly:
1. Go to vercel.com, sign in with the GitHub account used above.
2. Click "Add New… → Project", import the `toeic-review` repo, click Deploy (it will build successfully even without env vars yet — that's fine, the login-gated pages just won't have DB access until later tasks).
3. In the new project's dashboard, go to the "Storage" tab → "Create Database" → choose Postgres → pick the cheapest/free region → create.
4. Once created, the integration auto-adds `POSTGRES_URL` (and related `POSTGRES_*`) env vars to the Vercel project for all environments.

- [ ] **Step 8: ⚠️ HUMAN ACTION — get an Anthropic API key**

Tell the user: go to console.anthropic.com → "API Keys" → "Create Key", copy it. In the Vercel project → "Settings" → "Environment Variables", add `ANTHROPIC_API_KEY` with that value (all environments). Also add `APP_PASSWORD` with a password of their choosing.

- [ ] **Step 9: Pull env vars locally**

Run:
```
npm install -g vercel
vercel login
vercel link
vercel env pull .env.local
```
Expected: `.env.local` now contains `POSTGRES_URL` (and siblings), `ANTHROPIC_API_KEY`, `APP_PASSWORD`.

- [ ] **Step 10: Verify the DB connection**

Write `scripts/check-db.ts`. Note: plain `dotenv/config` only loads a file literally named `.env`, not `.env.local` — and `vercel env pull` always writes to `.env.local`. Point dotenv at it explicitly:
```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });
import { sql } from '@vercel/postgres';

async function main() {
  const { rows } = await sql`SELECT 1 as ok`;
  console.log('DB connection OK:', rows[0]);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('DB connection FAILED:', err);
  process.exit(1);
});
```

Run: `npx tsx scripts/check-db.ts`
Expected: `DB connection OK: { ok: 1 }`

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add DB connection check script and project dependencies"
git push
```

---

## Task 2: Database schema and migrations

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `scripts/migrate.ts`
- Create: `tests/integration/setup.ts`
- Create: `tests/integration/schema.test.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `knowledge_points`, `mock_exam_results`, `mock_exam_scenario_scores` tables matching spec §4.1–4.3, including the partial unique index (excludes `deleted` rows) and the mock-exam `CHECK` constraints from spec §8. Produces `withTestClient()`, used by every later integration test.

- [ ] **Step 1: Write the migration SQL**

Create `migrations/0001_init.sql`:

```sql
CREATE TABLE knowledge_points (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example TEXT NOT NULL,
  notes TEXT,
  part SMALLINT NOT NULL CHECK (part IN (1,2,3,4)),
  scenario_major TEXT NOT NULL,
  scenario_minor TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT 'listening',
  date_added DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','deleted')),
  correct_streak INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  next_review_date DATE,
  last_reviewed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches src/lib/termNormalize.ts's normalizeTerm() exactly (lowercase, strip
-- whitespace/hyphen/apostrophe) so "check-in"/"check in"/"checkin" collide here too,
-- not just in the application-level findMatch() check.
CREATE UNIQUE INDEX knowledge_points_unique_key
  ON knowledge_points (
    lower(regexp_replace(term, '[\s''-]', '', 'g')),
    part, scenario_major, scenario_minor, skill
  )
  WHERE status != 'deleted';

CREATE INDEX knowledge_points_queue_idx
  ON knowledge_points (status, next_review_date);

CREATE TABLE mock_exam_results (
  id SERIAL PRIMARY KEY,
  test_date DATE NOT NULL,
  part1_correct INTEGER NOT NULL CHECK (part1_correct >= 0),
  part1_total INTEGER NOT NULL CHECK (part1_total >= 1 AND part1_correct <= part1_total),
  part2_correct INTEGER NOT NULL CHECK (part2_correct >= 0),
  part2_total INTEGER NOT NULL CHECK (part2_total >= 1 AND part2_correct <= part2_total),
  part3_correct INTEGER NOT NULL CHECK (part3_correct >= 0),
  part3_total INTEGER NOT NULL CHECK (part3_total >= 1 AND part3_correct <= part3_total),
  part4_correct INTEGER NOT NULL CHECK (part4_correct >= 0),
  part4_total INTEGER NOT NULL CHECK (part4_total >= 1 AND part4_correct <= part4_total),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mock_exam_scenario_scores (
  id SERIAL PRIMARY KEY,
  mock_exam_result_id INTEGER NOT NULL REFERENCES mock_exam_results(id) ON DELETE CASCADE,
  scenario_major TEXT NOT NULL,
  scenario_minor TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct >= 0),
  total INTEGER NOT NULL CHECK (total >= 1 AND correct <= total)
);
```

- [ ] **Step 2: Write the migration runner**

Create `scripts/migrate.ts`. As in Task 1's `check-db.ts`, point dotenv at `.env.local` explicitly — the bare `'dotenv/config'` import only loads a file named `.env`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@vercel/postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

async function migrate() {
  const client = createClient();
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const dir = join(process.cwd(), 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }
      const text = readFileSync(join(dir, file), 'utf-8');
      await client.query(text);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 3: Run the migration against the dev database**

Run: `npx tsx scripts/migrate.ts`
Expected: `Applied 0001_init.sql`

- [ ] **Step 4: Write the test transaction helper**

Create `tests/integration/setup.ts`. Same dotenv note as the scripts above — load `.env.local` explicitly:

```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient, type VercelClient } from '@vercel/postgres';

export async function withTestClient(fn: (client: VercelClient) => Promise<void>) {
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
```

Create `vitest.config.ts`. The `resolve.alias` here must mirror `tsconfig.json`'s `@/* -> ./src/*` mapping — every API route file created from Task 8 onward imports via `@/lib/...`, and integration tests import those route files directly, so without this alias every such test fails to resolve its imports:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [],
    testTimeout: 15000,
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 5: Write the failing schema test**

Create `tests/integration/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';

describe('schema constraints', () => {
  it('allows an active row and a deleted row with the same unique key, but not two active rows', async () => {
    await withTestClient(async (client) => {
      const insert = `INSERT INTO knowledge_points
        (term, meaning, example, part, scenario_major, scenario_minor, date_added, status)
        VALUES ('workshop', 'a meeting', 'ex', 2, '一般商务', '会议', '2026-06-20', $1)`;
      await client.query(insert, ['deleted']);
      await expect(client.query(insert, ['active'])).resolves.toBeDefined();
      await expect(client.query(insert, ['active'])).rejects.toThrow();
    });
  });

  it('rejects mock exam rows where a total is 0 or correct exceeds total', async () => {
    await withTestClient(async (client) => {
      const base = `INSERT INTO mock_exam_results
        (test_date, part1_correct, part1_total, part2_correct, part2_total, part3_correct, part3_total, part4_correct, part4_total)
        VALUES ('2026-06-26', $1, $2, 5, 25, 10, 39, 10, 30)`;
      await expect(client.query(base, [0, 0])).rejects.toThrow();
      await expect(client.query(base, [10, 6])).rejects.toThrow();
      await expect(client.query(base, [5, 6])).resolves.toBeDefined();
    });
  });

  it('treats check-in, check in, and checkin as colliding at the DB level too', async () => {
    await withTestClient(async (client) => {
      const insert = `INSERT INTO knowledge_points
        (term, meaning, example, part, scenario_major, scenario_minor, date_added)
        VALUES ($1, 'm', 'e', 1, '旅游', '机场广播', '2026-06-20')`;
      await client.query(insert, ['check-in']);
      await expect(client.query(insert, ['check in'])).rejects.toThrow();
      await expect(client.query(insert, ['CheckIn'])).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it passes against the real migrated schema**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: all 3 tests PASS (the schema was already applied in Step 3; if you see "relation does not exist", re-run the migration).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add database schema, migration runner, and schema constraint tests"
git push
```

---

## Task 3: Core domain logic — dates, term normalization, scenario taxonomy

**Files:**
- Create: `src/lib/dateUtils.ts`, `tests/unit/dateUtils.test.ts`
- Create: `src/lib/termNormalize.ts`, `tests/unit/termNormalize.test.ts`
- Create: `src/lib/scenarios.ts`, `tests/unit/scenarios.test.ts`

**Interfaces:**
- Produces: `todayInShanghai(now?): string`, `addDays(dateStr, days): string`, `isFutureDate(dateStr, todayStr): boolean`, `normalizeTerm(term): string`, `SCENARIOS: Record<string,string[]>`, `isValidScenario(major, minor): boolean`, `sanitizeScenario(major, minor): {major, minor}`. Every later task that touches dates, term matching, or scenario tags imports from these three files — no duplicate date/term/scenario logic anywhere else.

- [ ] **Step 1: Write the failing date tests**

Create `tests/unit/dateUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { todayInShanghai, addDays, isFutureDate } from '../../src/lib/dateUtils';

describe('todayInShanghai', () => {
  it('formats a given UTC instant as YYYY-MM-DD in Asia/Shanghai', () => {
    // 2026-06-26T20:00:00Z is 2026-06-27 04:00 in Shanghai (UTC+8)
    expect(todayInShanghai(new Date('2026-06-26T20:00:00Z'))).toBe('2026-06-27');
  });
});

describe('addDays', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-06-28', 4)).toBe('2026-07-02');
  });
  it('adds zero days unchanged', () => {
    expect(addDays('2026-06-26', 0)).toBe('2026-06-26');
  });
});

describe('isFutureDate', () => {
  it('returns true when the date is after today', () => {
    expect(isFutureDate('2026-07-01', '2026-06-26')).toBe(true);
  });
  it('returns false when the date equals today', () => {
    expect(isFutureDate('2026-06-26', '2026-06-26')).toBe(false);
  });
  it('returns false when the date is before today', () => {
    expect(isFutureDate('2026-06-01', '2026-06-26')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/dateUtils.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/dateUtils'"

- [ ] **Step 3: Implement `dateUtils.ts`**

Create `src/lib/dateUtils.ts`:

```typescript
export function todayInShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function isFutureDate(dateStr: string, todayStr: string): boolean {
  return dateStr > todayStr;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/dateUtils.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing term normalization tests**

Create `tests/unit/termNormalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeTerm } from '../../src/lib/termNormalize';

describe('normalizeTerm', () => {
  it('treats check-in, check in, and checkin as the same term', () => {
    const normalized = new Set(['check-in', 'check in', 'checkin'].map(normalizeTerm));
    expect(normalized.size).toBe(1);
  });
  it('is case-insensitive', () => {
    expect(normalizeTerm('Workshop')).toBe(normalizeTerm('workshop'));
  });
  it("strips apostrophes", () => {
    expect(normalizeTerm("don't")).toBe('dont');
  });
});
```

- [ ] **Step 6: Run it, verify it fails, implement, verify it passes**

Run: `npx vitest run tests/unit/termNormalize.test.ts` → FAIL (module not found).

Create `src/lib/termNormalize.ts`:

```typescript
export function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/[\s\-']/g, '');
}
```

Run: `npx vitest run tests/unit/termNormalize.test.ts` → Expected: PASS (3 tests)

- [ ] **Step 7: Write the failing scenario taxonomy tests**

Create `tests/unit/scenarios.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidScenario, sanitizeScenario, SCENARIOS } from '../../src/lib/scenarios';

describe('SCENARIOS', () => {
  it('has exactly 14 majors (13 ETS categories + 未分类)', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(14);
    expect(SCENARIOS['未分类']).toEqual([]);
  });
});

describe('isValidScenario', () => {
  it('accepts a real major+minor pair from the whitelist', () => {
    expect(isValidScenario('金融/预算', '投资')).toBe(true);
  });
  it('accepts the universal 未分类 minor under any valid major', () => {
    expect(isValidScenario('金融/预算', '未分类')).toBe(true);
  });
  it('rejects a minor that does not belong to the given major', () => {
    expect(isValidScenario('金融/预算', '股票交易')).toBe(false);
  });
  it('rejects a major that is not in the whitelist at all', () => {
    expect(isValidScenario('股票', '投资')).toBe(false);
  });
  it('only accepts 未分类 as the minor for the 未分类 major', () => {
    expect(isValidScenario('未分类', '未分类')).toBe(true);
    expect(isValidScenario('未分类', '投资')).toBe(false);
  });
});

describe('sanitizeScenario', () => {
  it('passes through an already-valid pair unchanged', () => {
    expect(sanitizeScenario('金融/预算', '投资')).toEqual({ major: '金融/预算', minor: '投资' });
  });
  it('downgrades only the minor to 未分类 when the major is valid but the minor is hallucinated', () => {
    expect(sanitizeScenario('金融/预算', '股票交易')).toEqual({ major: '金融/预算', minor: '未分类' });
  });
  it('downgrades both major and minor to 未分类 when the major itself is invalid', () => {
    expect(sanitizeScenario('股票', '投资')).toEqual({ major: '未分类', minor: '未分类' });
  });
});
```

- [ ] **Step 8: Run it, verify it fails, implement, verify it passes**

Run: `npx vitest run tests/unit/scenarios.test.ts` → FAIL (module not found).

Create `src/lib/scenarios.ts`:

```typescript
export const SCENARIOS: Record<string, string[]> = {
  '企业发展': ['研究', '产品研发'],
  '外食': ['商务/非正式午餐', '宴会', '招待会', '餐厅订位'],
  '娱乐': ['电影', '剧场', '音乐', '艺术', '展览', '博物馆', '媒体'],
  '金融/预算': ['银行业务', '投资', '税务', '会计', '账单'],
  '一般商务': ['契约', '谈判', '并购', '行销', '销售', '保证', '商业企划', '会议', '劳动关系'],
  '保健': ['医疗保险', '看医生', '牙医', '诊所', '医院'],
  '房屋/公司地产': ['建筑', '规格', '购买租赁', '电力瓦斯服务'],
  '制造业': ['工厂管理', '生产线', '品管'],
  '办公室': ['董事会', '委员会', '信件', '备忘录', '电话', '传真', '电子邮件', '办公室器材与家具', '办公室流程'],
  '人事': ['招考', '雇用', '退休', '薪资', '升迁', '应征与广告', '津贴', '奖励'],
  '采购': ['购物', '订购物资', '送货', '发票'],
  '技术层面': ['电子', '科技', '电脑', '实验室与相关器材', '技术规格'],
  '旅游': ['火车', '飞机', '计程车', '巴士', '船只', '渡轮', '票务', '时刻表', '车站', '机场广播', '租车', '饭店', '预订', '脱班与取消'],
  '未分类': [],
};

const FALLBACK_MINOR = '未分类';

export function isValidScenario(major: string, minor: string): boolean {
  const minors = SCENARIOS[major];
  if (!minors) return false;
  if (major === FALLBACK_MINOR) return minor === FALLBACK_MINOR;
  return minors.includes(minor) || minor === FALLBACK_MINOR;
}

export function sanitizeScenario(major: string, minor: string): { major: string; minor: string } {
  if (!SCENARIOS[major]) {
    return { major: FALLBACK_MINOR, minor: FALLBACK_MINOR };
  }
  if (isValidScenario(major, minor)) {
    return { major, minor };
  }
  return { major, minor: FALLBACK_MINOR };
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run tests/unit/scenarios.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add date, term normalization, and scenario taxonomy domain logic"
git push
```

---

## Task 4: Core domain logic — spaced-repetition algorithm

**Files:**
- Create: `src/lib/srs.ts`, `tests/unit/srs.test.ts`

**Interfaces:**
- Consumes: `addDays` from `src/lib/dateUtils.ts` (Task 3).
- Produces: `CURVE_DAYS: number[]`, `SrsState` type, `applyCorrectAnswer(state, today): SrsState`, `applyWrongAnswer(state, today): SrsState`. Task 6 (knowledge_points data access) and Task 13 (review answer API) call these two functions and nothing else for scheduling math.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/srs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyCorrectAnswer, applyWrongAnswer, CURVE_DAYS } from '../../src/lib/srs';

const TODAY = '2026-06-26';

function freshState() {
  return { correctStreak: 0, wrongCount: 0, correctCount: 0, status: 'active' as const, nextReviewDate: TODAY };
}

describe('CURVE_DAYS', () => {
  it('is the 6-stage classic Ebbinghaus curve', () => {
    expect(CURVE_DAYS).toEqual([1, 2, 4, 7, 15, 30]);
  });
});

describe('applyCorrectAnswer', () => {
  it('schedules 1 day after the first correct answer', () => {
    const result = applyCorrectAnswer(freshState(), TODAY);
    expect(result.correctStreak).toBe(1);
    expect(result.nextReviewDate).toBe('2026-06-27');
    expect(result.status).toBe('active');
  });

  it('stays active through all 6 curve stages', () => {
    let state = freshState();
    for (let i = 0; i < 6; i++) {
      state = applyCorrectAnswer(state, TODAY);
      expect(state.correctStreak).toBe(i + 1);
      expect(state.status).toBe('active');
    }
  });

  it('graduates to mastered on the 7th consecutive correct answer', () => {
    let state = freshState();
    for (let i = 0; i < 6; i++) state = applyCorrectAnswer(state, TODAY);
    expect(state.status).toBe('active');

    state = applyCorrectAnswer(state, TODAY);
    expect(state.status).toBe('mastered');
    expect(state.correctStreak).toBe(7);
    expect(state.nextReviewDate).toBeNull();
  });

  it('increments correctCount on every correct answer', () => {
    let state = freshState();
    state = applyCorrectAnswer(state, TODAY);
    state = applyCorrectAnswer(state, TODAY);
    expect(state.correctCount).toBe(2);
  });
});

describe('applyWrongAnswer', () => {
  it('resets correctStreak to 0 and schedules tomorrow', () => {
    let state = freshState();
    state = applyCorrectAnswer(state, TODAY);
    state = applyCorrectAnswer(state, TODAY);
    state = applyWrongAnswer(state, TODAY);
    expect(state.correctStreak).toBe(0);
    expect(state.nextReviewDate).toBe('2026-06-27');
    expect(state.status).toBe('active');
  });

  it('increments wrongCount', () => {
    const state = applyWrongAnswer(freshState(), TODAY);
    expect(state.wrongCount).toBe(1);
  });

  it('never sets status to mastered', () => {
    expect(applyWrongAnswer(freshState(), TODAY).status).toBe('active');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/srs.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/srs'"

- [ ] **Step 3: Implement `srs.ts`**

Create `src/lib/srs.ts`:

```typescript
import { addDays } from './dateUtils';

export const CURVE_DAYS = [1, 2, 4, 7, 15, 30];

export type SrsState = {
  correctStreak: number;
  wrongCount: number;
  correctCount: number;
  status: 'active' | 'mastered';
  nextReviewDate: string | null;
};

export function applyCorrectAnswer(state: SrsState, today: string): SrsState {
  const k = state.correctStreak + 1;
  const correctCount = state.correctCount + 1;
  if (k >= CURVE_DAYS.length + 1) {
    return { ...state, correctStreak: k, correctCount, status: 'mastered', nextReviewDate: null };
  }
  const days = CURVE_DAYS[k - 1];
  return { ...state, correctStreak: k, correctCount, status: 'active', nextReviewDate: addDays(today, days) };
}

export function applyWrongAnswer(state: SrsState, today: string): SrsState {
  return {
    ...state,
    correctStreak: 0,
    wrongCount: state.wrongCount + 1,
    status: 'active',
    nextReviewDate: addDays(today, 1),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/srs.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add spaced-repetition algorithm (full Ebbinghaus curve, graduate at streak 7)"
git push
```

---

## Task 5: Core domain logic — import dedup decision

**Files:**
- Create: `src/lib/importDedup.ts`, `tests/unit/importDedup.test.ts`

**Interfaces:**
- Produces: `CandidateRecord`, `ExistingMatch`, `DedupDecision` types and `decideDedup(candidate, existing): DedupDecision`. Task 11 (import confirm API) is the only caller — it uses the returned `action` (`'skip_duplicate' | 'insert_new' | 'wrong_again'`) to decide what to write.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/importDedup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { decideDedup } from '../../src/lib/importDedup';

const candidate = { dateAdded: '2026-06-26', meaning: 'm', example: 'e', notes: null };

describe('decideDedup', () => {
  it('inserts as new when there is no existing match', () => {
    expect(decideDedup(candidate, null)).toEqual({ action: 'insert_new' });
  });

  it('inserts as new when the only match is deleted', () => {
    const existing = { status: 'deleted' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'insert_new' });
  });

  it('skips as a duplicate upload when date_added matches an active record', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-26', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'skip_duplicate' });
  });

  it('treats a different date_added on an active record as wrong-again, even with identical text', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: false, textConflict: false });
  });

  it('flags a text conflict when descriptive fields differ, independent of the wrong-again decision', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-20', meaning: 'old', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: false, textConflict: true });
  });

  it('signals revival when the matched record is mastered', () => {
    const existing = { status: 'mastered' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: true, textConflict: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/importDedup.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/importDedup'"

- [ ] **Step 3: Implement `importDedup.ts`**

Create `src/lib/importDedup.ts`:

```typescript
export type ExistingMatch = {
  status: 'active' | 'mastered' | 'deleted';
  dateAdded: string;
  meaning: string;
  example: string;
  notes: string | null;
} | null;

export type CandidateRecord = {
  dateAdded: string;
  meaning: string;
  example: string;
  notes: string | null;
};

export type DedupDecision =
  | { action: 'skip_duplicate' }
  | { action: 'insert_new' }
  | { action: 'wrong_again'; reviveFromMastered: boolean; textConflict: boolean };

export function decideDedup(candidate: CandidateRecord, existing: ExistingMatch): DedupDecision {
  if (existing === null || existing.status === 'deleted') {
    return { action: 'insert_new' };
  }
  if (existing.dateAdded === candidate.dateAdded) {
    return { action: 'skip_duplicate' };
  }
  const textConflict =
    existing.meaning !== candidate.meaning ||
    existing.example !== candidate.example ||
    existing.notes !== candidate.notes;
  return {
    action: 'wrong_again',
    reviveFromMastered: existing.status === 'mastered',
    textConflict,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/importDedup.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add import dedup decision logic (date_added drives wrong-again, text choice is cosmetic)"
git push
```

---

## Task 6: Data access layer — knowledge_points

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/knowledgePoints.ts`
- Create: `tests/integration/knowledgePoints.test.ts`

**Interfaces:**
- Consumes: `normalizeTerm` (Task 3), `isValidScenario` (Task 3), `withTestClient` (Task 2, tests only).
- Produces: `KnowledgePoint` type and `findMatch`, `insertKnowledgePoint`, `applyReviewResult`, `softDeleteKnowledgePoint`, `restoreKnowledgePoint`, `updateKnowledgePointFields`, `listKnowledgePoints`, `getTodayQueue`. Task 9 (manual add/edit/delete API), Task 11 (import confirm API), and Task 13 (review answer API) call these — no task issues raw SQL against `knowledge_points` outside this file.

- [ ] **Step 1: Add the `db.ts` re-export**

Create `src/lib/db.ts`:

```typescript
export { sql, createClient } from '@vercel/postgres';
```

(Single import point so a future swap of the Postgres client only touches this file.)

- [ ] **Step 2: Write the failing tests for insert + findMatch**

Create `tests/integration/knowledgePoints.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import {
  insertKnowledgePoint,
  findMatch,
  applyReviewResult,
  softDeleteKnowledgePoint,
  restoreKnowledgePoint,
  updateKnowledgePointFields,
  listKnowledgePoints,
  getTodayQueue,
} from '../../src/lib/knowledgePoints';

const BASE = {
  term: 'workshop',
  meaning: '研讨会',
  example: "supervisors' workshop",
  notes: null,
  part: 2,
  scenarioMajor: '一般商务',
  scenarioMinor: '会议',
  skill: 'listening',
  dateAdded: '2026-06-20',
};

describe('insertKnowledgePoint + findMatch', () => {
  it('inserts a new row as active with streak 0 and next_review_date = dateAdded', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      expect(kp.status).toBe('active');
      expect(kp.correctStreak).toBe(0);
      expect(kp.nextReviewDate).toBe('2026-06-20');
    });
  });

  it('finds a match using normalized term comparison, ignoring hyphens/spaces/case', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, { ...BASE, term: 'check-in' });
      const match = await findMatch(client, 'Check In', BASE.part, BASE.scenarioMajor, BASE.scenarioMinor, BASE.skill);
      expect(match).not.toBeNull();
      expect(match!.term).toBe('check-in');
    });
  });

  it('does not match a deleted record, so the same key can be inserted again', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await softDeleteKnowledgePoint(client, kp.id);
      const match = await findMatch(client, BASE.term, BASE.part, BASE.scenarioMajor, BASE.scenarioMinor, BASE.skill);
      expect(match).toBeNull();
      const kp2 = await insertKnowledgePoint(client, BASE);
      expect(kp2.id).not.toBe(kp.id);
    });
  });

  it('does not match across a different scenario_minor (same term, different sense)', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, { ...BASE, term: 'check', scenarioMajor: '金融/预算', scenarioMinor: '账单' });
      const match = await findMatch(client, 'check', BASE.part, '办公室', '办公室流程', BASE.skill);
      expect(match).toBeNull();
    });
  });
});

describe('applyReviewResult', () => {
  it('advances correctStreak and next_review_date on a correct answer', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      const updated = await applyReviewResult(client, kp.id, true, '2026-06-20');
      expect(updated.correctStreak).toBe(1);
      expect(updated.nextReviewDate).toBe('2026-06-21');
      expect(updated.lastReviewedDate).toBe('2026-06-20');
    });
  });

  it('graduates to mastered after 7 consecutive correct answers', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      let id = kp.id;
      let result;
      for (let i = 0; i < 7; i++) {
        result = await applyReviewResult(client, id, true, '2026-06-20');
      }
      expect(result!.status).toBe('mastered');
      expect(result!.nextReviewDate).toBeNull();
    });
  });

  it('resets correctStreak to 0 on a wrong answer', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await applyReviewResult(client, kp.id, true, '2026-06-20');
      const result = await applyReviewResult(client, kp.id, false, '2026-06-20');
      expect(result.correctStreak).toBe(0);
      expect(result.wrongCount).toBe(1);
      expect(result.nextReviewDate).toBe('2026-06-21');
    });
  });
});

describe('softDeleteKnowledgePoint / restoreKnowledgePoint', () => {
  it('marks status deleted without touching streak/counts', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      const deleted = await softDeleteKnowledgePoint(client, kp.id);
      expect(deleted.status).toBe('deleted');
      expect(deleted.correctStreak).toBe(0);
    });
  });

  it('restore sets status active, streak 0, next_review_date today', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await applyReviewResult(client, kp.id, true, '2026-06-20'); // streak -> 1
      await softDeleteKnowledgePoint(client, kp.id);
      const restored = await restoreKnowledgePoint(client, kp.id, '2026-06-26');
      expect(restored.status).toBe('active');
      expect(restored.correctStreak).toBe(0);
      expect(restored.nextReviewDate).toBe('2026-06-26');
    });
  });
});

describe('updateKnowledgePointFields', () => {
  it('updating meaning/example/notes does not touch status or next_review_date', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await applyReviewResult(client, kp.id, true, '2026-06-20');
      for (let i = 0; i < 6; i++) await applyReviewResult(client, kp.id, true, '2026-06-20');
      const updated = await updateKnowledgePointFields(client, kp.id, { meaning: '新释义' });
      expect(updated.status).toBe('mastered');
      expect(updated.meaning).toBe('新释义');
    });
  });

  it('updating part/scenario rejects a change that collides with another existing record', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, BASE);
      const other = await insertKnowledgePoint(client, { ...BASE, term: 'meeting' });
      await expect(
        updateKnowledgePointFields(client, other.id, { term: BASE.term })
      ).rejects.toThrow();
    });
  });
});

describe('listKnowledgePoints / getTodayQueue', () => {
  it('listKnowledgePoints filters by part and scenarioMajor', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, BASE);
      await insertKnowledgePoint(client, { ...BASE, term: 'invoice', part: 3, scenarioMajor: '采购', scenarioMinor: '发票' });
      const results = await listKnowledgePoints(client, { part: 3 });
      expect(results.map((r) => r.term)).toEqual(['invoice']);
    });
  });

  it('getTodayQueue returns only active rows due today or earlier, ordered by wrongCount desc', async () => {
    await withTestClient(async (client) => {
      const a = await insertKnowledgePoint(client, { ...BASE, term: 'a', dateAdded: '2026-06-26' });
      const b = await insertKnowledgePoint(client, { ...BASE, term: 'b', dateAdded: '2026-06-20' });
      await applyReviewResult(client, b.id, false, '2026-06-20'); // due tomorrow relative to 6/20, but let's push due date back
      const futureItem = await insertKnowledgePoint(client, { ...BASE, term: 'c', dateAdded: '2026-07-01' });
      const queue = await getTodayQueue(client, '2026-06-26');
      const terms = queue.map((r) => r.term);
      expect(terms).toContain('a');
      expect(terms).not.toContain('c');
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/integration/knowledgePoints.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/knowledgePoints'"

- [ ] **Step 4: Implement `knowledgePoints.ts`**

Create `src/lib/knowledgePoints.ts`:

```typescript
import type { VercelClient } from '@vercel/postgres';
import { normalizeTerm } from './termNormalize';
import { applyCorrectAnswer, applyWrongAnswer, type SrsState } from './srs';

export type KnowledgePoint = {
  id: number;
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  scenarioMajor: string;
  scenarioMinor: string;
  skill: string;
  dateAdded: string;
  status: 'active' | 'mastered' | 'deleted';
  correctStreak: number;
  correctCount: number;
  wrongCount: number;
  nextReviewDate: string | null;
  lastReviewedDate: string | null;
};

function mapRow(row: any): KnowledgePoint {
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    example: row.example,
    notes: row.notes,
    part: row.part,
    scenarioMajor: row.scenario_major,
    scenarioMinor: row.scenario_minor,
    skill: row.skill,
    dateAdded: row.date_added,
    status: row.status,
    correctStreak: row.correct_streak,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    nextReviewDate: row.next_review_date,
    lastReviewedDate: row.last_reviewed_date,
  };
}

export async function findMatch(
  client: VercelClient,
  term: string,
  part: number,
  scenarioMajor: string,
  scenarioMinor: string,
  skill: string
): Promise<KnowledgePoint | null> {
  const target = normalizeTerm(term);
  const { rows } = await client.query(
    `SELECT * FROM knowledge_points
     WHERE part = $1 AND scenario_major = $2 AND scenario_minor = $3 AND skill = $4 AND status != 'deleted'`,
    [part, scenarioMajor, scenarioMinor, skill]
  );
  const match = rows.find((row: any) => normalizeTerm(row.term) === target);
  return match ? mapRow(match) : null;
}

export async function insertKnowledgePoint(
  client: VercelClient,
  data: {
    term: string;
    meaning: string;
    example: string;
    notes: string | null;
    part: number;
    scenarioMajor: string;
    scenarioMinor: string;
    skill: string;
    dateAdded: string;
  }
): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `INSERT INTO knowledge_points
       (term, meaning, example, notes, part, scenario_major, scenario_minor, skill, date_added, status, correct_streak, next_review_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 0, $9)
     RETURNING *`,
    [data.term, data.meaning, data.example, data.notes, data.part, data.scenarioMajor, data.scenarioMinor, data.skill, data.dateAdded]
  );
  return mapRow(rows[0]);
}

export async function applyReviewResult(
  client: VercelClient,
  id: number,
  wasCorrect: boolean,
  today: string
): Promise<KnowledgePoint> {
  const { rows } = await client.query('SELECT * FROM knowledge_points WHERE id = $1', [id]);
  const current = mapRow(rows[0]);
  const state: SrsState = {
    correctStreak: current.correctStreak,
    wrongCount: current.wrongCount,
    correctCount: current.correctCount,
    status: current.status === 'mastered' ? 'mastered' : 'active',
    nextReviewDate: current.nextReviewDate,
  };
  const next = wasCorrect ? applyCorrectAnswer(state, today) : applyWrongAnswer(state, today);
  const { rows: updated } = await client.query(
    `UPDATE knowledge_points
     SET correct_streak = $1, correct_count = $2, wrong_count = $3, status = $4,
         next_review_date = $5, last_reviewed_date = $6, updated_at = now()
     WHERE id = $7
     RETURNING *`,
    [next.correctStreak, next.correctCount, next.wrongCount, next.status, next.nextReviewDate, today, id]
  );
  return mapRow(updated[0]);
}

export async function reviveFromImport(
  client: VercelClient,
  id: number,
  today: string
): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points
     SET status = 'active', correct_streak = 0, wrong_count = wrong_count + 1,
         next_review_date = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [today, id]
  );
  return mapRow(rows[0]);
}

export async function softDeleteKnowledgePoint(client: VercelClient, id: number): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points SET status = 'deleted', next_review_date = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return mapRow(rows[0]);
}

export async function restoreKnowledgePoint(client: VercelClient, id: number, today: string): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points
     SET status = 'active', correct_streak = 0, next_review_date = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [today, id]
  );
  return mapRow(rows[0]);
}

export async function updateKnowledgePointFields(
  client: VercelClient,
  id: number,
  fields: Partial<{
    term: string;
    meaning: string;
    example: string;
    notes: string | null;
    part: number;
    scenarioMajor: string;
    scenarioMinor: string;
    dateAdded: string;
  }>
): Promise<KnowledgePoint> {
  const identityChanged = ['term', 'part', 'scenarioMajor', 'scenarioMinor'].some((k) => k in fields);
  if (identityChanged) {
    const { rows: currentRows } = await client.query('SELECT * FROM knowledge_points WHERE id = $1', [id]);
    const current = mapRow(currentRows[0]);
    const candidateTerm = fields.term ?? current.term;
    const candidatePart = fields.part ?? current.part;
    const candidateMajor = fields.scenarioMajor ?? current.scenarioMajor;
    const candidateMinor = fields.scenarioMinor ?? current.scenarioMinor;
    const { rows: candidateRows } = await client.query(
      `SELECT term FROM knowledge_points
       WHERE id != $1 AND part = $2 AND scenario_major = $3 AND scenario_minor = $4 AND skill = $5 AND status != 'deleted'`,
      [id, candidatePart, candidateMajor, candidateMinor, current.skill]
    );
    const conflict = candidateRows.some((row: any) => normalizeTerm(row.term) === normalizeTerm(candidateTerm));
    if (conflict) {
      throw new Error('这个组合已经存在,请检查是否要合并');
    }
  }

  const setClauses: string[] = [];
  const values: any[] = [];
  let i = 1;
  const columnMap: Record<string, string> = {
    term: 'term',
    meaning: 'meaning',
    example: 'example',
    notes: 'notes',
    part: 'part',
    scenarioMajor: 'scenario_major',
    scenarioMinor: 'scenario_minor',
    dateAdded: 'date_added',
  };
  for (const [key, value] of Object.entries(fields)) {
    setClauses.push(`${columnMap[key]} = $${i}`);
    values.push(value);
    i++;
  }
  setClauses.push(`updated_at = now()`);
  values.push(id);
  const { rows } = await client.query(
    `UPDATE knowledge_points SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return mapRow(rows[0]);
}

export async function listKnowledgePoints(
  client: VercelClient,
  filters: { part?: number; scenarioMajor?: string; scenarioMinor?: string; status?: string } = {}
): Promise<KnowledgePoint[]> {
  const clauses: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (filters.part !== undefined) {
    clauses.push(`part = $${i++}`);
    values.push(filters.part);
  }
  if (filters.scenarioMajor !== undefined) {
    clauses.push(`scenario_major = $${i++}`);
    values.push(filters.scenarioMajor);
  }
  if (filters.scenarioMinor !== undefined) {
    clauses.push(`scenario_minor = $${i++}`);
    values.push(filters.scenarioMinor);
  }
  clauses.push(`status = $${i++}`);
  values.push(filters.status ?? 'active');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await client.query(`SELECT * FROM knowledge_points ${where} ORDER BY date_added DESC`, values);
  return rows.map(mapRow);
}

export async function getTodayQueue(
  client: VercelClient,
  today: string,
  filters: { scenarioMajor?: string; scenarioMinor?: string } = {}
): Promise<KnowledgePoint[]> {
  const clauses = [`status = 'active'`, `next_review_date <= $1`];
  const values: any[] = [today];
  let i = 2;
  if (filters.scenarioMajor !== undefined) {
    clauses.push(`scenario_major = $${i++}`);
    values.push(filters.scenarioMajor);
  }
  if (filters.scenarioMinor !== undefined) {
    clauses.push(`scenario_minor = $${i++}`);
    values.push(filters.scenarioMinor);
  }
  const { rows } = await client.query(
    `SELECT * FROM knowledge_points WHERE ${clauses.join(' AND ')} ORDER BY wrong_count DESC, next_review_date ASC`,
    values
  );
  return rows.map(mapRow);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/integration/knowledgePoints.test.ts`
Expected: PASS (12 tests). If the uniqueness-collision test fails because the partial unique index didn't fire before your manual check runs, that's fine — the manual JS-level check in `updateKnowledgePointFields` is the one being tested here; the DB index is the backstop tested in Task 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add knowledge_points data access layer with SRS, dedup, and identity-edit validation"
git push
```

---

## Task 7: Data access layer — mock exams

**Files:**
- Create: `src/lib/mockExams.ts`
- Create: `tests/integration/mockExams.test.ts`

**Interfaces:**
- Produces: `MockExamResult` type, `createMockExam(client, data): MockExamResult`, `listMockExams(client): MockExamResult[]`. Task 16 (mock exam API) is the only caller. Validation (total ≥ 1, correct ≤ total) is enforced twice: by the DB `CHECK` constraints from Task 2 (backstop) and by a JS-level check here that produces a friendly per-field error message instead of a raw Postgres error.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/mockExams.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import { createMockExam, listMockExams } from '../../src/lib/mockExams';

const VALID = {
  testDate: '2026-06-26',
  part1: { correct: 5, total: 6 },
  part2: { correct: 20, total: 25 },
  part3: { correct: 30, total: 39 },
  part4: { correct: 25, total: 30 },
  scenarios: [{ scenarioMajor: '一般商务', scenarioMinor: '会议', correct: 3, total: 5 }],
};

describe('createMockExam', () => {
  it('creates a result row plus its scenario breakdown rows', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, VALID);
      expect(result.id).toBeGreaterThan(0);
      const all = await listMockExams(client);
      expect(all.find((r) => r.id === result.id)?.scenarios).toHaveLength(1);
    });
  });

  it('rejects a part with total 0 before hitting the database', async () => {
    await withTestClient(async (client) => {
      const bad = { ...VALID, part1: { correct: 0, total: 0 } };
      await expect(createMockExam(client, bad)).rejects.toThrow(/part1/i);
    });
  });

  it('rejects a part where correct exceeds total', async () => {
    await withTestClient(async (client) => {
      const bad = { ...VALID, part2: { correct: 30, total: 25 } };
      await expect(createMockExam(client, bad)).rejects.toThrow(/part2/i);
    });
  });

  it('allows zero scenario breakdown rows', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, { ...VALID, scenarios: [] });
      const all = await listMockExams(client);
      expect(all.find((r) => r.id === result.id)?.scenarios).toEqual([]);
    });
  });
});

describe('listMockExams', () => {
  it('orders results by test_date descending', async () => {
    await withTestClient(async (client) => {
      await createMockExam(client, { ...VALID, testDate: '2026-06-01', scenarios: [] });
      await createMockExam(client, { ...VALID, testDate: '2026-06-20', scenarios: [] });
      const all = await listMockExams(client);
      expect(all[0].testDate).toBe('2026-06-20');
      expect(all[1].testDate).toBe('2026-06-01');
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/mockExams.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/mockExams'"

- [ ] **Step 3: Implement `mockExams.ts`**

Create `src/lib/mockExams.ts`:

```typescript
import type { VercelClient } from '@vercel/postgres';

type PartScore = { correct: number; total: number };
type ScenarioScore = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };

export type MockExamInput = {
  testDate: string;
  part1: PartScore;
  part2: PartScore;
  part3: PartScore;
  part4: PartScore;
  scenarios: ScenarioScore[];
};

export type MockExamResult = {
  id: number;
  testDate: string;
  part1: PartScore;
  part2: PartScore;
  part3: PartScore;
  part4: PartScore;
  scenarios: ScenarioScore[];
};

function validatePart(label: string, score: PartScore) {
  if (score.total < 1) throw new Error(`${label}: 总题数必须至少为 1`);
  if (score.correct < 0 || score.correct > score.total) throw new Error(`${label}: 对题数必须在 0 到总题数之间`);
}

export async function createMockExam(client: VercelClient, input: MockExamInput): Promise<MockExamResult> {
  validatePart('part1', input.part1);
  validatePart('part2', input.part2);
  validatePart('part3', input.part3);
  validatePart('part4', input.part4);
  input.scenarios.forEach((s, i) => validatePart(`scenario[${i}]`, s));

  const { rows } = await client.query(
    `INSERT INTO mock_exam_results
       (test_date, part1_correct, part1_total, part2_correct, part2_total,
        part3_correct, part3_total, part4_correct, part4_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.testDate,
      input.part1.correct, input.part1.total,
      input.part2.correct, input.part2.total,
      input.part3.correct, input.part3.total,
      input.part4.correct, input.part4.total,
    ]
  );
  const id = rows[0].id;

  for (const s of input.scenarios) {
    await client.query(
      `INSERT INTO mock_exam_scenario_scores (mock_exam_result_id, scenario_major, scenario_minor, correct, total)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, s.scenarioMajor, s.scenarioMinor, s.correct, s.total]
    );
  }

  return { id, testDate: input.testDate, part1: input.part1, part2: input.part2, part3: input.part3, part4: input.part4, scenarios: input.scenarios };
}

export async function listMockExams(client: VercelClient): Promise<MockExamResult[]> {
  const { rows } = await client.query('SELECT * FROM mock_exam_results ORDER BY test_date DESC');
  const results: MockExamResult[] = [];
  for (const row of rows) {
    const { rows: scenarioRows } = await client.query(
      'SELECT scenario_major, scenario_minor, correct, total FROM mock_exam_scenario_scores WHERE mock_exam_result_id = $1',
      [row.id]
    );
    results.push({
      id: row.id,
      testDate: row.test_date,
      part1: { correct: row.part1_correct, total: row.part1_total },
      part2: { correct: row.part2_correct, total: row.part2_total },
      part3: { correct: row.part3_correct, total: row.part3_total },
      part4: { correct: row.part4_correct, total: row.part4_total },
      scenarios: scenarioRows.map((s: any) => ({
        scenarioMajor: s.scenario_major,
        scenarioMinor: s.scenario_minor,
        correct: s.correct,
        total: s.total,
      })),
    });
  }
  return results;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/mockExams.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add mock exam data access layer with friendly validation errors"
git push
```

---

## Task 8: Auth — passcode gate

This project is on Next.js 16, where the `middleware.ts` convention is deprecated and renamed to `proxy.ts` (function name `proxy`, not `middleware`; defaults to the Node.js runtime). Use `proxy.ts` directly — do not write a deprecated `middleware.ts`.

**Files:**
- Create: `src/lib/auth.ts`, `tests/unit/auth.test.ts`
- Create: `src/proxy.ts`
- Create: `src/app/api/auth/route.ts`
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Produces: `isAuthedCookie(cookieValue, expectedPassword): boolean`, a `POST /api/auth` route, and a proxy that redirects unauthenticated requests to `/login`. Every other route created in later tasks is implicitly protected once this proxy exists — no later task needs to add its own auth check.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isAuthedCookie } from '../../src/lib/auth';

describe('isAuthedCookie', () => {
  it('returns true when the cookie matches the password', () => {
    expect(isAuthedCookie('secret123', 'secret123')).toBe(true);
  });
  it('returns false when the cookie is missing', () => {
    expect(isAuthedCookie(undefined, 'secret123')).toBe(false);
  });
  it('returns false when the cookie does not match', () => {
    expect(isAuthedCookie('wrong', 'secret123')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/auth'"

- [ ] **Step 3: Implement `auth.ts`**

Create `src/lib/auth.ts`:

```typescript
export function isAuthedCookie(cookieValue: string | undefined, expectedPassword: string): boolean {
  return !!cookieValue && cookieValue === expectedPassword;
}

export const AUTH_COOKIE_NAME = 'toeic_auth';
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement the login API route**

Create `src/app/api/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: '密码不正确' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, password, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
```

- [ ] **Step 6: Implement the proxy**

Create `src/proxy.ts` (named `proxy.ts` per Next.js 16's renamed convention — a file named `middleware.ts` with a `middleware` export still works but is deprecated; write the current convention directly):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { isAuthedCookie, AUTH_COOKIE_NAME } from '@/lib/auth';

export function proxy(req: NextRequest) {
  const isPublic = req.nextUrl.pathname === '/login' || req.nextUrl.pathname === '/api/auth';
  if (isPublic) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!isAuthedCookie(cookie, process.env.APP_PASSWORD ?? '')) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 7: Implement the login page**

Create `src/app/login/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('密码不正确');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-72">
        <h1 className="text-lg font-semibold">输入密码</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded px-3 py-2"
          autoFocus
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2">
          进入
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Manual verification**

Run: `npm run dev`. Open `http://localhost:3000/` in a browser.
Expected: redirected to `/login`. Enter the wrong password → see "密码不正确". Enter the correct `APP_PASSWORD` value (from `.env.local`) → redirected to `/`, and reloading any page no longer redirects to `/login` (cookie persisted).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add passcode auth: cookie check, login page, and proxy gate"
git push
```

---

## Task 9: Manual add / edit / delete API and browse list UI

**Files:**
- Create: `src/app/api/knowledge-points/route.ts`
- Create: `src/app/api/knowledge-points/[id]/route.ts`
- Create: `src/app/knowledge-points/page.tsx`
- Create: `tests/integration/knowledgePointsApi.test.ts`

**Interfaces:**
- Consumes: everything from Task 6 (`insertKnowledgePoint`, `listKnowledgePoints`, `updateKnowledgePointFields`, `softDeleteKnowledgePoint`, `restoreKnowledgePoint`), `sanitizeScenario` (Task 3).
- Produces: `GET/POST /api/knowledge-points`, `PATCH /api/knowledge-points/:id` (handles field edits, delete via `{status: 'deleted'}`, restore via `{status: 'active'}` — this is the one PATCH endpoint Task 14's mastered-list UI and Task 13's review UI both call for delete/restore). The browse page at `/knowledge-points`.

- [ ] **Step 1: Write the failing API tests**

Create `tests/integration/knowledgePointsApi.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from '@vercel/postgres';
import { POST as createRoute, GET as listRoute } from '../../src/app/api/knowledge-points/route';
import { PATCH as patchRoute } from '../../src/app/api/knowledge-points/[id]/route';
import { NextRequest } from 'next/server';

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

let createdIds: number[] = [];

afterEach(async () => {
  if (createdIds.length) {
    await sql.query(`DELETE FROM knowledge_points WHERE id = ANY($1)`, [createdIds]);
    createdIds = [];
  }
});

describe('POST /api/knowledge-points (manual add)', () => {
  it('creates a record with required fields and defaults scenario to 未分类/未分类 when omitted', async () => {
    const req = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({ term: 'gantry', meaning: '', example: '', part: 1, dateAdded: '2026-06-26' }),
    });
    const res = await createRoute(req);
    const body = await res.json();
    createdIds.push(body.id);
    expect(res.status).toBe(201);
    expect(body.scenarioMajor).toBe('未分类');
  });

  it('rejects an unrecognized scenario pair instead of silently sanitizing user-supplied input', async () => {
    const req = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({
        term: 'x', meaning: 'm', example: 'e', part: 1, dateAdded: '2026-06-26',
        scenarioMajor: '股票', scenarioMinor: '投资',
      }),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/knowledge-points/:id', () => {
  it('soft-deletes via {status: "deleted"} and restores via {status: "active"}', async () => {
    const createReq = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({ term: 'pier', meaning: 'm', example: 'e', part: 1, dateAdded: '2026-06-26' }),
    });
    const created = await (await createRoute(createReq)).json();
    createdIds.push(created.id);

    const delReq = makeRequest(`http://localhost/api/knowledge-points/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'deleted' }),
    });
    const delRes = await patchRoute(delReq, { params: Promise.resolve({ id: String(created.id) }) });
    expect((await delRes.json()).status).toBe('deleted');

    const restoreReq = makeRequest(`http://localhost/api/knowledge-points/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    const restoreRes = await patchRoute(restoreReq, { params: Promise.resolve({ id: String(created.id) }) });
    const restored = await restoreRes.json();
    expect(restored.status).toBe('active');
    expect(restored.correctStreak).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/knowledgePointsApi.test.ts`
Expected: FAIL with "Cannot find module '../../src/app/api/knowledge-points/route'"

- [ ] **Step 3: Implement `src/app/api/knowledge-points/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { insertKnowledgePoint, listKnowledgePoints } from '@/lib/knowledgePoints';
import { sanitizeScenario, isValidScenario } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const scenarioMajor = body.scenarioMajor ?? '未分类';
  const scenarioMinor = body.scenarioMinor ?? '未分类';
  if (!isValidScenario(scenarioMajor, scenarioMinor)) {
    return NextResponse.json({ error: '场景分类不在允许的列表内' }, { status: 400 });
  }
  const today = todayInShanghai();
  const dateAdded = body.dateAdded && !isFutureDate(body.dateAdded, today) ? body.dateAdded : today;

  const client = createClient();
  await client.connect();
  try {
    const kp = await insertKnowledgePoint(client, {
      term: body.term,
      meaning: body.meaning ?? '',
      example: body.example ?? '',
      notes: body.notes ?? null,
      part: body.part,
      scenarioMajor,
      scenarioMinor,
      skill: 'listening',
      dateAdded,
    });
    return NextResponse.json(kp, { status: 201 });
  } finally {
    await client.end();
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const client = createClient();
  await client.connect();
  try {
    const results = await listKnowledgePoints(client, {
      part: searchParams.get('part') ? Number(searchParams.get('part')) : undefined,
      scenarioMajor: searchParams.get('scenarioMajor') ?? undefined,
      scenarioMinor: searchParams.get('scenarioMinor') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    return NextResponse.json(results);
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Implement `src/app/api/knowledge-points/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { updateKnowledgePointFields, softDeleteKnowledgePoint, restoreKnowledgePoint } from '@/lib/knowledgePoints';
import { isValidScenario } from '@/lib/scenarios';
import { todayInShanghai } from '@/lib/dateUtils';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  const body = await req.json();
  const client = createClient();
  await client.connect();
  try {
    if (body.status === 'deleted') {
      return NextResponse.json(await softDeleteKnowledgePoint(client, id));
    }
    if (body.status === 'active') {
      return NextResponse.json(await restoreKnowledgePoint(client, id, todayInShanghai()));
    }
    if (body.scenarioMajor && body.scenarioMinor && !isValidScenario(body.scenarioMajor, body.scenarioMinor)) {
      return NextResponse.json({ error: '场景分类不在允许的列表内' }, { status: 400 });
    }
    const { status, ...fields } = body;
    const updated = await updateKnowledgePointFields(client, id, fields);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/integration/knowledgePointsApi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Implement the browse list page**

Create `src/app/knowledge-points/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

type KP = {
  id: number; term: string; meaning: string; example: string; part: number;
  scenarioMajor: string; scenarioMinor: string; status: string;
};

export default function KnowledgePointsPage() {
  const [items, setItems] = useState<KP[]>([]);
  const [partFilter, setPartFilter] = useState('');
  const [majorFilter, setMajorFilter] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newPart, setNewPart] = useState('1');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (partFilter) params.set('part', partFilter);
    if (majorFilter) params.set('scenarioMajor', majorFilter);
    const res = await fetch(`/api/knowledge-points?${params}`);
    setItems(await res.json());
  }

  useEffect(() => { load(); }, [partFilter, majorFilter]);

  async function handleDelete(id: number) {
    await fetch(`/api/knowledge-points/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    load();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/knowledge-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm, part: Number(newPart), meaning: newMeaning, example: newExample }),
    });
    setNewTerm(''); setNewMeaning(''); setNewExample('');
    load();
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">错题库</h1>

      <form onSubmit={handleAdd} className="border rounded p-3 mb-4 flex flex-col gap-2 max-w-md">
        <p className="text-sm text-gray-600">手动添加一条知识点(释义/例句留空也可以保存,场景默认未分类)</p>
        <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="词/短语" required className="border rounded px-2 py-1" />
        <select value={newPart} onChange={(e) => setNewPart(e.target.value)} className="border rounded px-2 py-1">
          {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
        </select>
        <input value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} placeholder="释义(可留空)" className="border rounded px-2 py-1" />
        <input value={newExample} onChange={(e) => setNewExample(e.target.value)} placeholder="例句(可留空)" className="border rounded px-2 py-1" />
        <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1 self-start">添加</button>
      </form>

      <div className="flex gap-3 mb-4">
        <select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部 Part</option>
          {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
        </select>
        <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部场景</option>
          {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((kp) => (
          <li key={kp.id} className="border rounded p-3 flex justify-between items-start">
            <div>
              <div className="font-medium">{kp.term}</div>
              <div className="text-sm text-gray-600">{kp.meaning}</div>
              <div className="text-xs text-gray-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
            </div>
            <button onClick={() => handleDelete(kp.id)} className="text-red-600 text-sm">删除</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Note: this form does not yet have the "AI 自动补全" button described in spec §5.4 — Task 10 adds `suggestForTerm` (it needs `parseImportDocument`, built in that same task) and wires the button into this page once that function exists. Building the basic form now, with the AI assist as an additive step later, keeps each task's dependencies in the right order.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, log in, open `/knowledge-points`. Confirm the add form creates a row with default scenario 未分类/未分类 when meaning/example/scenario are left blank, filters narrow the list, and "删除" removes an item from view (it now has `status = 'deleted'` — confirm via `npx tsx scripts/check-db.ts`-style ad hoc query if in doubt).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add manual add/edit/delete API and browse list page for knowledge points"
git push
```

---

## Task 10: File extraction and AI import parsing

**Files:**
- Create: `src/lib/fileExtract.ts`, `tests/unit/fileExtract.test.ts`
- Create: `src/lib/importParser.ts`, `tests/unit/importParser.test.ts`

**Interfaces:**
- Consumes: `sanitizeScenario` (Task 3), `SCENARIOS` (Task 3).
- Produces: `extractText(filename, buffer): Promise<string>`, `validateUpload(filename, byteLength)`, `UnsupportedFileTypeError`, `FileTooLargeError`, `ParsedCandidate` type, `parseImportDocument(client, rawText, fallbackDate, scenarioTaxonomy): Promise<ParsedCandidate[]>`. Task 11 (import API) is the only caller of both.

- [ ] **Step 1: Write the failing file-validation tests**

Create `tests/unit/fileExtract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateUpload, UnsupportedFileTypeError, FileTooLargeError } from '../../src/lib/fileExtract';

describe('validateUpload', () => {
  it('accepts a .pdf filename within the size limit', () => {
    expect(validateUpload('notes.pdf', 1000)).toBe('pdf');
  });
  it('accepts a .docx filename within the size limit', () => {
    expect(validateUpload('notes.docx', 1000)).toBe('docx');
  });
  it('rejects an unsupported extension', () => {
    expect(() => validateUpload('notes.txt', 1000)).toThrow(UnsupportedFileTypeError);
  });
  it('rejects a file over the 5MB limit', () => {
    expect(() => validateUpload('notes.pdf', 6 * 1024 * 1024)).toThrow(FileTooLargeError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/fileExtract.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/fileExtract'"

- [ ] **Step 3: Implement `fileExtract.ts`**

Create `src/lib/fileExtract.ts`:

```typescript
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}

const MAX_BYTES = 5 * 1024 * 1024;

export function validateUpload(filename: string, byteLength: number): 'pdf' | 'docx' {
  if (byteLength > MAX_BYTES) {
    throw new FileTooLargeError('文件超过 5MB 上限');
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  throw new UnsupportedFileTypeError('不支持此文件格式,请上传文字版 PDF 或 Word');
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const kind = validateUpload(filename, buffer.byteLength);
  if (kind === 'pdf') {
    const result = await pdfParse(buffer);
    return result.text;
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/fileExtract.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Manual verification of real extraction**

Save any small PDF and a small `.docx` with a couple of lines of recognizable text into a scratch folder (not committed). Run a one-off script or the Node REPL:

```
node -e "require('tsx/cjs'); const { extractText } = require('./src/lib/fileExtract'); const fs = require('fs'); extractText('test.pdf', fs.readFileSync('C:/path/to/test.pdf')).then(console.log)"
```

Expected: the recognizable text from the source file is printed. Repeat for the `.docx` file. This confirms the third-party parsing libraries work end-to-end; it does not need to be a permanent automated test.

- [ ] **Step 6: Write the failing import-parser tests**

Create `tests/unit/importParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseImportDocument } from '../../src/lib/importParser';
import { SCENARIOS } from '../../src/lib/scenarios';

describe('buildSystemPrompt', () => {
  it('includes every scenario major in the prompt', () => {
    const prompt = buildSystemPrompt(SCENARIOS, '2026-06-26');
    for (const major of Object.keys(SCENARIOS)) {
      expect(prompt).toContain(major);
    }
  });
});

describe('parseImportDocument', () => {
  function fakeClient(items: any[]) {
    return {
      messages: { create: async () => ({ content: [{ type: 'tool_use', input: { items } }] }) },
    } as any;
  }

  it('maps a well-formed tool response into ParsedCandidate objects', async () => {
    const client = fakeClient([{
      term: 'workshop', meaning: '研讨会', example: "supervisors' workshop", notes: null,
      part: 2, dateAdded: '2026-06-23', scenarioMajor: '一般商务', scenarioMinor: '会议',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('workshop');
    expect(result[0].scenarioWasSanitized).toBe(false);
  });

  it('sanitizes a hallucinated scenario minor and flags it', async () => {
    const client = fakeClient([{
      term: 'invest', meaning: '投资', example: 'ex', notes: null,
      part: 3, dateAdded: '2026-06-23', scenarioMajor: '金融/预算', scenarioMinor: '股票交易',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result[0].scenarioMinor).toBe('未分类');
    expect(result[0].scenarioWasSanitized).toBe(true);
  });

  it('throws a friendly error when the AI does not return a tool_use block', async () => {
    const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'oops' }] }) } } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/unit/importParser.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/importParser'"

- [ ] **Step 8: Implement `importParser.ts`**

Create `src/lib/importParser.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { sanitizeScenario } from './scenarios';

export type ParsedCandidate = {
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  dateAdded: string;
  scenarioMajor: string;
  scenarioMinor: string;
  scenarioWasSanitized: boolean;
  meaningWasAiGenerated: boolean;
  exampleWasAiGenerated: boolean;
};

const EXTRACT_TOOL = {
  name: 'record_knowledge_points',
  description: '记录从笔记中解析出的 TOEIC 听力知识点',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            meaning: { type: 'string' },
            example: { type: 'string' },
            notes: { type: ['string', 'null'] },
            part: { type: 'integer', enum: [1, 2, 3, 4] },
            dateAdded: { type: 'string' },
            scenarioMajor: { type: 'string' },
            scenarioMinor: { type: 'string' },
            meaningWasAiGenerated: { type: 'boolean' },
            exampleWasAiGenerated: { type: 'boolean' },
          },
          required: [
            'term', 'meaning', 'example', 'notes', 'part', 'dateAdded',
            'scenarioMajor', 'scenarioMinor', 'meaningWasAiGenerated', 'exampleWasAiGenerated',
          ],
        },
      },
    },
    required: ['items'],
  },
};

export function buildSystemPrompt(scenarioTaxonomy: Record<string, string[]>, fallbackDate: string): string {
  const taxonomyText = Object.entries(scenarioTaxonomy)
    .map(([major, minors]) => `${major}: ${minors.join('、') || '(无细类,仅用于无法归类时)'}`)
    .join('\n');
  return `你是一个帮用户整理 TOEIC 听力错题笔记的助手。把用户提供的原始笔记文本解析成结构化的知识点列表。
每条笔记通常按"Part几"标题分组,组内有一行"时间:YYYY.MM.DD",之后是编号的条目,每条是一个单词/短语,后面跟释义和补充说明。
规则:
- term 用笔记里写的原文。
- meaning/example 如果笔记里已经写了就照抄整理,如果没写就你自己生成,并把对应的 *WasAiGenerated 标成 true。
- notes 只在笔记原文里有额外的"高频提示/用法说明"这类内容时才填,没有就填 null,不要自己编。
- dateAdded 用该条目所在的"时间:"标注日期,转成 YYYY-MM-DD;如果整篇笔记完全没有日期,用 ${fallbackDate}。
- scenarioMajor 必须是以下列表中的大类之一,scenarioMinor 必须是该大类下列出的细类之一,如果都拿不准就用"未分类":
${taxonomyText}
调用 record_knowledge_points 工具返回结果,不要输出额外文字。`;
}

export async function parseImportDocument(
  client: Pick<Anthropic, 'messages'>,
  rawText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: buildSystemPrompt(scenarioTaxonomy, fallbackDate),
    messages: [{ role: 'user', content: rawText }],
    tools: [EXTRACT_TOOL as any],
    tool_choice: { type: 'tool', name: 'record_knowledge_points' },
  } as any);

  const toolUse: any = (response as any).content.find((block: any) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI 解析失败,请重试');
  }
  const items = toolUse.input.items as any[];

  return items.map((item) => {
    const sanitized = sanitizeScenario(item.scenarioMajor, item.scenarioMinor);
    return {
      term: item.term,
      meaning: item.meaning,
      example: item.example,
      notes: item.notes ?? null,
      part: item.part,
      dateAdded: item.dateAdded,
      scenarioMajor: sanitized.major,
      scenarioMinor: sanitized.minor,
      scenarioWasSanitized: sanitized.major !== item.scenarioMajor || sanitized.minor !== item.scenarioMinor,
      meaningWasAiGenerated: !!item.meaningWasAiGenerated,
      exampleWasAiGenerated: !!item.exampleWasAiGenerated,
    };
  });
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run tests/unit/importParser.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Manual smoke test against the real Claude API**

Write a throwaway script (don't commit it, or commit under `scripts/smoke-import.ts` and delete after): call `parseImportDocument` with a real `new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY})` client and a short excerpt of real notes text (e.g., the first 10 lines from the user's sample `Listen.pdf` from the spec). Confirm the returned items have sensible `term`/`meaning`/`scenarioMajor` values and that `scenarioMajor` is always one of the 14 valid values.

- [ ] **Step 11: Write the failing test for single-term AI assist**

Per spec §5.4, the manual-add form (Task 9) needs an optional "AI 自动补全" button that fills meaning/example/scenario from just a term + part. Reusing `parseImportDocument` by feeding it a one-line fake note keeps this on the exact same tested parsing+whitelist path instead of a second prompt to maintain.

Add to `tests/unit/importParser.test.ts`:

```typescript
describe('suggestForTerm', () => {
  it('wraps the term in a single-item note and returns the parsed suggestion', async () => {
    const client = {
      messages: {
        create: async (params: any) => {
          expect(params.messages[0].content).toContain('workshop');
          return {
            content: [{ type: 'tool_use', input: { items: [{
              term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
              dateAdded: '2026-01-01', scenarioMajor: '一般商务', scenarioMinor: '会议',
              meaningWasAiGenerated: true, exampleWasAiGenerated: true,
            }] } }],
          };
        },
      },
    } as any;
    const result = await suggestForTerm(client, 'workshop', 2, SCENARIOS);
    expect(result).toEqual({ meaning: '研讨会', example: 'ex', scenarioMajor: '一般商务', scenarioMinor: '会议' });
  });
});
```

Add the import: `import { buildSystemPrompt, parseImportDocument, suggestForTerm } from '../../src/lib/importParser';`

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run tests/unit/importParser.test.ts`
Expected: FAIL with "suggestForTerm is not a function"

- [ ] **Step 13: Implement `suggestForTerm`**

Append to `src/lib/importParser.ts`:

```typescript
export async function suggestForTerm(
  client: Pick<Anthropic, 'messages'>,
  term: string,
  part: number,
  scenarioTaxonomy: Record<string, string[]>
): Promise<{ meaning: string; example: string; scenarioMajor: string; scenarioMinor: string }> {
  const fakeNote = `Part${part}\n时间:2026-01-01\n1. ${term}`;
  const [first] = await parseImportDocument(client, fakeNote, '2026-01-01', scenarioTaxonomy);
  return {
    meaning: first.meaning,
    example: first.example,
    scenarioMajor: first.scenarioMajor,
    scenarioMinor: first.scenarioMinor,
  };
}
```

- [ ] **Step 14: Run it to verify it passes**

Run: `npx vitest run tests/unit/importParser.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 15: Add the suggest API route**

Create `src/app/api/knowledge-points/suggest/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { suggestForTerm } from '@/lib/importParser';
import { SCENARIOS } from '@/lib/scenarios';

export async function POST(req: NextRequest) {
  const { term, part } = await req.json();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const suggestion = await suggestForTerm(anthropic, term, part, SCENARIOS);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'AI 补全失败,请重试' }, { status: 502 });
  }
}
```

- [ ] **Step 16: Wire the "AI 自动补全" button into the manual-add form**

Modify `src/app/knowledge-points/page.tsx` (created in Task 9): add a button next to the term/part inputs that, on click, calls `POST /api/knowledge-points/suggest` with the current `newTerm`/`newPart` and fills `newMeaning`/`newExample` from the response (and stores the suggested scenario in new `newScenarioMajor`/`newScenarioMinor` state, sent along in `handleAdd`'s request body instead of leaving scenario undefined). Add state and a handler:

```tsx
const [newScenarioMajor, setNewScenarioMajor] = useState<string | null>(null);
const [newScenarioMinor, setNewScenarioMinor] = useState<string | null>(null);

async function handleAiAssist() {
  const res = await fetch('/api/knowledge-points/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: newTerm, part: Number(newPart) }),
  });
  if (!res.ok) return;
  const suggestion = await res.json();
  setNewMeaning(suggestion.meaning);
  setNewExample(suggestion.example);
  setNewScenarioMajor(suggestion.scenarioMajor);
  setNewScenarioMinor(suggestion.scenarioMinor);
}
```

Add the button right after the term input: `<button type="button" onClick={handleAiAssist} disabled={!newTerm} className="text-blue-600 text-sm self-start">AI 自动补全</button>`. Update `handleAdd`'s fetch body to `JSON.stringify({ term: newTerm, part: Number(newPart), meaning: newMeaning, example: newExample, scenarioMajor: newScenarioMajor ?? undefined, scenarioMinor: newScenarioMinor ?? undefined })`, and reset both scenario fields to `null` alongside the existing field resets after a successful add.

- [ ] **Step 17: Manual verification**

Run: `npm run dev`, log in, open `/knowledge-points`. Type a term, leave meaning/example blank, click "AI 自动补全" — confirm the fields populate from the real Claude API and the eventual saved row has a sensible (non-未分类, unless genuinely ambiguous) scenario.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "Add PDF/Word text extraction, Claude-based import parsing, and single-term AI assist for manual add"
git push
```

---

## Task 11: Import API — upload → candidates → confirm

**Files:**
- Create: `src/lib/importConfirm.ts`, `tests/integration/importConfirm.test.ts`
- Create: `src/app/api/knowledge-points/import/route.ts`
- Create: `src/app/api/knowledge-points/import/confirm/route.ts`
- Create: `tests/integration/importApi.test.ts`

**Interfaces:**
- Consumes: `extractText` (Task 10), `parseImportDocument` (Task 10), `findMatch`/`insertKnowledgePoint`/`applyReviewResult`/`reviveFromImport`/`updateKnowledgePointFields` (Task 6), `decideDedup` (Task 5), `SCENARIOS` (Task 3), `todayInShanghai`/`isFutureDate` (Task 3).
- Produces: `applyConfirmedImportItem(client, item, today)`, `POST /api/knowledge-points/import` (returns annotated candidates, writes nothing), `POST /api/knowledge-points/import/confirm` (writes, one item at a time, never rolls back on a single item's failure). Task 12 (import UI) calls both routes.

- [ ] **Step 1: Write the failing tests for the confirm-time write logic**

Create `tests/integration/importConfirm.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import { applyConfirmedImportItem } from '../../src/lib/importConfirm';
import { insertKnowledgePoint, applyReviewResult } from '../../src/lib/knowledgePoints';

const BASE = {
  term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
  scenarioMajor: '一般商务', scenarioMinor: '会议', dateAdded: '2026-06-26',
};

describe('applyConfirmedImportItem', () => {
  it('inserts a new record for action insert_new', async () => {
    await withTestClient(async (client) => {
      const result = await applyConfirmedImportItem(
        client, { ...BASE, decision: { action: 'insert_new' }, existingId: null }, '2026-06-26'
      );
      expect(result.action).toBe('inserted');
      expect(result.id).toBeGreaterThan(0);
    });
  });

  it('skips for action skip_duplicate without writing anything', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      const result = await applyConfirmedImportItem(
        client, { ...BASE, decision: { action: 'skip_duplicate' }, existingId: kp.id }, '2026-06-26'
      );
      expect(result.action).toBe('skipped');
    });
  });

  it('applies a wrong-again update to an active record and keeps existing text when keepVersion is existing', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await applyReviewResult(client, kp.id, true, '2026-06-20');
      const result = await applyConfirmedImportItem(
        client,
        { ...BASE, meaning: '新释义', decision: { action: 'wrong_again', reviveFromMastered: false, textConflict: true }, existingId: kp.id, keepVersion: 'existing' },
        '2026-06-26'
      );
      expect(result.action).toBe('wrong_again');
    });
  });

  it('revives a mastered record to active and applies new text when keepVersion is new', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      let state = kp;
      for (let i = 0; i < 7; i++) state = await applyReviewResult(client, kp.id, true, '2026-06-20');
      expect(state.status).toBe('mastered');
      const result = await applyConfirmedImportItem(
        client,
        { ...BASE, meaning: '新释义', decision: { action: 'wrong_again', reviveFromMastered: true, textConflict: true }, existingId: kp.id, keepVersion: 'new' },
        '2026-06-26'
      );
      expect(result.action).toBe('wrong_again');
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/importConfirm.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/importConfirm'"

- [ ] **Step 3: Implement `importConfirm.ts`**

Create `src/lib/importConfirm.ts`:

```typescript
import type { VercelClient } from '@vercel/postgres';
import { insertKnowledgePoint, applyReviewResult, reviveFromImport, updateKnowledgePointFields } from './knowledgePoints';
import type { DedupDecision } from './importDedup';

export type ConfirmItem = {
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  dateAdded: string;
  scenarioMajor: string;
  scenarioMinor: string;
  decision: DedupDecision;
  existingId: number | null;
  keepVersion?: 'new' | 'existing';
};

export async function applyConfirmedImportItem(
  client: VercelClient,
  item: ConfirmItem,
  today: string
): Promise<{ action: string; id: number | null }> {
  if (item.decision.action === 'skip_duplicate') {
    return { action: 'skipped', id: item.existingId };
  }
  if (item.decision.action === 'insert_new') {
    const kp = await insertKnowledgePoint(client, {
      term: item.term, meaning: item.meaning, example: item.example, notes: item.notes,
      part: item.part, scenarioMajor: item.scenarioMajor, scenarioMinor: item.scenarioMinor,
      skill: 'listening', dateAdded: item.dateAdded,
    });
    return { action: 'inserted', id: kp.id };
  }
  if (!item.existingId) {
    throw new Error('缺少要更新的现有记录 id');
  }
  if (item.decision.reviveFromMastered) {
    await reviveFromImport(client, item.existingId, today);
  } else {
    await applyReviewResult(client, item.existingId, false, today);
  }
  if (item.decision.textConflict && item.keepVersion === 'new') {
    await updateKnowledgePointFields(client, item.existingId, {
      meaning: item.meaning, example: item.example, notes: item.notes,
    });
  }
  return { action: 'wrong_again', id: item.existingId };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/importConfirm.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing API tests**

Create `tests/integration/importApi.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sql } from '@vercel/postgres';

vi.mock('@/lib/importParser', () => ({
  parseImportDocument: vi.fn(async () => [{
    term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
    dateAdded: '2026-06-23', scenarioMajor: '一般商务', scenarioMinor: '会议',
    scenarioWasSanitized: false, meaningWasAiGenerated: false, exampleWasAiGenerated: false,
  }]),
}));

// Keep the real validateUpload (extension/size guard) but fake the actual binary
// parsing, since a real .pdf/.docx can't be embedded inline in this test file.
vi.mock('@/lib/fileExtract', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/fileExtract')>('../../src/lib/fileExtract');
  return {
    ...actual,
    extractText: vi.fn(async (filename: string, buffer: Buffer) => {
      actual.validateUpload(filename, buffer.byteLength);
      return 'fake raw text';
    }),
  };
});

const { POST: importRoute } = await import('../../src/app/api/knowledge-points/import/route');
const { POST: confirmRoute } = await import('../../src/app/api/knowledge-points/import/confirm/route');
const { NextRequest } = await import('next/server');

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM knowledge_points WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

describe('POST /api/knowledge-points/import', () => {
  it('rejects an unsupported file extension before the parser ever runs', async () => {
    const form = new FormData();
    form.append('file', new File(['hello'], 'notes.txt'));
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import', { method: 'POST', body: form }));
    const res = await importRoute(req);
    expect(res.status).toBe(400);
  });

  it('returns candidates annotated with an insert_new decision when nothing matches yet', async () => {
    const form = new FormData();
    form.append('file', new File(['Part2 短问答\n时间:2026.06.23\n1. workshop 研讨会'], 'notes.docx'));
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import', { method: 'POST', body: form }));
    const res = await importRoute(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.candidates[0].decision).toEqual({ action: 'insert_new' });
    expect(body.candidates[0].existingId).toBeNull();
  });
});

describe('POST /api/knowledge-points/import/confirm', () => {
  it('writes successful items and reports a per-item error without rolling back the others', async () => {
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import/confirm', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { term: 'a', meaning: 'm', example: 'e', notes: null, part: 1, dateAdded: '2026-06-26', scenarioMajor: '未分类', scenarioMinor: '未分类', decision: { action: 'insert_new' }, existingId: null },
          { term: 'b', meaning: 'm', example: 'e', notes: null, part: 1, dateAdded: '2026-06-26', scenarioMajor: '未分类', scenarioMinor: '未分类', decision: { action: 'wrong_again', reviveFromMastered: false, textConflict: false }, existingId: null },
        ],
      }),
    }));
    const res = await confirmRoute(req);
    const body = await res.json();
    expect(body.results[0].action).toBe('inserted');
    createdIds.push(body.results[0].id);
    expect(body.results[1].action).toBe('error'); // existingId null + wrong_again is invalid input, should error not throw
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/integration/importApi.test.ts`
Expected: FAIL with "Cannot find module '../../src/app/api/knowledge-points/import/route'"

- [ ] **Step 7: Implement the import (upload) route**

Create `src/app/api/knowledge-points/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import Anthropic from '@anthropic-ai/sdk';
import { extractText, UnsupportedFileTypeError, FileTooLargeError } from '@/lib/fileExtract';
import { parseImportDocument } from '@/lib/importParser';
import { findMatch } from '@/lib/knowledgePoints';
import { decideDedup } from '@/lib/importDedup';
import { SCENARIOS } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const today = todayInShanghai();

  let rawText: string;
  try {
    rawText = await extractText(file.name, buffer);
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError || err instanceof FileTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let candidates;
  try {
    candidates = await parseImportDocument(anthropic, rawText, today, SCENARIOS);
  } catch {
    return NextResponse.json({ error: '解析失败,请重试' }, { status: 502 });
  }

  const client = createClient();
  await client.connect();
  try {
    const withDecisions = [];
    for (const candidate of candidates) {
      const safeDate = isFutureDate(candidate.dateAdded, today) ? today : candidate.dateAdded;
      const existing = await findMatch(client, candidate.term, candidate.part, candidate.scenarioMajor, candidate.scenarioMinor, 'listening');
      const decision = decideDedup(
        { dateAdded: safeDate, meaning: candidate.meaning, example: candidate.example, notes: candidate.notes },
        existing ? { status: existing.status, dateAdded: existing.dateAdded, meaning: existing.meaning, example: existing.example, notes: existing.notes } : null
      );
      withDecisions.push({
        ...candidate,
        dateAdded: safeDate,
        dateWasClampedToToday: safeDate !== candidate.dateAdded,
        decision,
        existingId: existing?.id ?? null,
      });
    }
    return NextResponse.json({ candidates: withDecisions });
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 8: Implement the confirm route**

Create `src/app/api/knowledge-points/import/confirm/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { applyConfirmedImportItem } from '@/lib/importConfirm';
import { todayInShanghai } from '@/lib/dateUtils';

export async function POST(req: NextRequest) {
  const { items } = await req.json();
  const today = todayInShanghai();
  const client = createClient();
  await client.connect();
  try {
    const results = [];
    for (const item of items) {
      try {
        const result = await applyConfirmedImportItem(client, item, today);
        results.push({ term: item.term, ...result });
      } catch (err: any) {
        results.push({ term: item.term, action: 'error', error: err.message });
      }
    }
    return NextResponse.json({ results });
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run tests/integration/importApi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add import upload and confirm API routes with row-level partial success"
git push
```

---

## Task 12: Import UI

**Files:**
- Create: `src/app/knowledge-points/import/page.tsx`

**Interfaces:**
- Consumes: `POST /api/knowledge-points/import`, `POST /api/knowledge-points/import/confirm` (Task 11).
- Produces: the `/knowledge-points/import` page — no other task depends on this file.

- [ ] **Step 1: Implement the import page**

Create `src/app/knowledge-points/import/page.tsx`:

```tsx
'use client';
import { useState } from 'react';

type Candidate = {
  term: string; meaning: string; example: string; notes: string | null; part: number;
  dateAdded: string; scenarioMajor: string; scenarioMinor: string;
  scenarioWasSanitized: boolean; meaningWasAiGenerated: boolean; exampleWasAiGenerated: boolean;
  decision: { action: string; reviveFromMastered?: boolean; textConflict?: boolean };
  existingId: number | null;
  confirmed: boolean;
  keepVersion: 'new' | 'existing';
};

export default function ImportPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<any[]>([]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/knowledge-points/import', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? '解析失败,请重试');
      return;
    }
    setCandidates(body.candidates.map((c: any) => ({ ...c, confirmed: c.decision.action !== 'skip_duplicate', keepVersion: 'new' })));
  }

  function updateCandidate(i: number, patch: Partial<Candidate>) {
    setCandidates((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  async function handleConfirm() {
    const res = await fetch('/api/knowledge-points/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: candidates.filter((c) => c.confirmed) }),
    });
    const body = await res.json();
    setResults(body.results);
    setCandidates([]);
  }

  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold mb-4">导入错题笔记</h1>
      <input type="file" accept=".pdf,.docx,.doc" onChange={handleUpload} className="mb-4" />
      {error && <p className="text-red-600">{error}</p>}

      {candidates.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 mb-4">
            {candidates.map((c, i) => (
              <li key={i} className="border rounded p-3">
                <div className="flex justify-between items-center mb-2">
                  <input
                    type="checkbox"
                    checked={c.confirmed}
                    onChange={(e) => updateCandidate(i, { confirmed: e.target.checked })}
                  />
                  <span className="font-medium">{c.term}</span>
                  <span className="text-xs text-gray-400">Part {c.part} · {c.scenarioMajor}/{c.scenarioMinor}</span>
                </div>
                {c.decision.action === 'skip_duplicate' && (
                  <p className="text-sm text-gray-500">与现有记录完全相同,已跳过</p>
                )}
                {c.scenarioWasSanitized && (
                  <p className="text-sm text-yellow-700 bg-yellow-50 p-1 rounded">AI 分类未命中,已自动归为未分类,请手动校正</p>
                )}
                {(c.meaningWasAiGenerated || c.exampleWasAiGenerated) && (
                  <p className="text-sm text-blue-700">释义/例句由 AI 补充,请检查</p>
                )}
                <textarea
                  value={c.meaning}
                  onChange={(e) => updateCandidate(i, { meaning: e.target.value })}
                  className="border rounded w-full p-1 mt-1 text-sm"
                />
                {c.decision.action === 'wrong_again' && c.decision.textConflict && (
                  <div className="flex gap-3 mt-1 text-sm">
                    <label>
                      <input type="radio" checked={c.keepVersion === 'new'} onChange={() => updateCandidate(i, { keepVersion: 'new' })} /> 保留新版本
                    </label>
                    <label>
                      <input type="radio" checked={c.keepVersion === 'existing'} onChange={() => updateCandidate(i, { keepVersion: 'existing' })} /> 保留现有版本
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button onClick={handleConfirm} className="bg-blue-600 text-white rounded px-4 py-2">
            确认导入
          </button>
        </>
      )}

      {results.length > 0 && (
        <ul className="mt-4 text-sm">
          {results.map((r, i) => (
            <li key={i}>{r.term}: {r.action === 'error' ? `失败 — ${r.error}` : r.action}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, log in, open `/knowledge-points/import`. Upload a real `.docx`/`.pdf` excerpt of the user's notes. Confirm: candidates list renders, AI-generated fields are flagged, a hallucinated scenario shows the yellow warning, unchecking a row excludes it, "确认导入" reports a result line per row. Then open `/knowledge-points` and confirm the new rows are there.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add import upload and confirm-list UI"
git push
```

---

## Task 13: Review queue + answer API

**Files:**
- Create: `src/app/api/review/queue/route.ts`
- Create: `src/app/api/review/[id]/answer/route.ts`
- Create: `tests/integration/reviewApi.test.ts`

**Interfaces:**
- Consumes: `getTodayQueue`, `applyReviewResult` (Task 6), `todayInShanghai` (Task 3).
- Produces: `GET /api/review/queue?scenarioMajor=&scenarioMinor=`, `POST /api/review/:id/answer` with body `{correct: boolean}`. Task 14 (review UI) is the only caller of both.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/reviewApi.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '@vercel/postgres';
import { GET as queueRoute } from '../../src/app/api/review/queue/route';
import { POST as answerRoute } from '../../src/app/api/review/[id]/answer/route';
import { NextRequest } from 'next/server';

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM knowledge_points WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

async function seed(dateAdded = '2026-06-01') {
  const { rows } = await sql.query(
    `INSERT INTO knowledge_points (term, meaning, example, part, scenario_major, scenario_minor, date_added, next_review_date)
     VALUES ($1, 'm', 'e', 1, '未分类', '未分类', $2, $2) RETURNING *`,
    ['term-' + Math.random(), dateAdded]
  );
  createdIds.push(rows[0].id);
  return rows[0];
}

describe('GET /api/review/queue', () => {
  it('returns rows due today or earlier', async () => {
    const kp = await seed('2026-06-01');
    const req = new NextRequest(new Request('http://localhost/api/review/queue'));
    const res = await queueRoute(req);
    const body = await res.json();
    expect(body.some((r: any) => r.id === kp.id)).toBe(true);
  });
});

describe('POST /api/review/:id/answer', () => {
  it('applies a correct answer and advances correctStreak', async () => {
    const kp = await seed();
    const req = new NextRequest(new Request(`http://localhost/api/review/${kp.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ correct: true }),
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: String(kp.id) }) });
    const body = await res.json();
    expect(body.correctStreak).toBe(1);
  });

  it('applies a wrong answer and resets correctStreak', async () => {
    const kp = await seed();
    const req = new NextRequest(new Request(`http://localhost/api/review/${kp.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ correct: false }),
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: String(kp.id) }) });
    const body = await res.json();
    expect(body.correctStreak).toBe(0);
    expect(body.wrongCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/reviewApi.test.ts`
Expected: FAIL with "Cannot find module '../../src/app/api/review/queue/route'"

- [ ] **Step 3: Implement the queue route**

Create `src/app/api/review/queue/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { getTodayQueue } from '@/lib/knowledgePoints';
import { todayInShanghai } from '@/lib/dateUtils';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const client = createClient();
  await client.connect();
  try {
    const queue = await getTodayQueue(client, todayInShanghai(), {
      scenarioMajor: searchParams.get('scenarioMajor') ?? undefined,
      scenarioMinor: searchParams.get('scenarioMinor') ?? undefined,
    });
    return NextResponse.json(queue);
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Implement the answer route**

Create `src/app/api/review/[id]/answer/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { applyReviewResult } from '@/lib/knowledgePoints';
import { todayInShanghai } from '@/lib/dateUtils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { correct } = await req.json();
  const client = createClient();
  await client.connect();
  try {
    const updated = await applyReviewResult(client, Number(id), !!correct, todayInShanghai());
    return NextResponse.json(updated);
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/integration/reviewApi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add review queue and answer API routes"
git push
```

---

## Task 14: Review UI

**Files:**
- Create: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `GET /api/review/queue`, `POST /api/review/:id/answer` (Task 13), `PATCH /api/knowledge-points/:id` for delete/undo (Task 9).
- Produces: the `/review` page. No other task depends on this file.

- [ ] **Step 1: Implement the review page**

Create `src/app/review/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

type KP = { id: number; term: string; meaning: string; example: string; notes: string | null };

export default function ReviewPage() {
  const [queue, setQueue] = useState<KP[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'guessing' | 'revealed'>('guessing');
  const [guess, setGuess] = useState<'remember' | 'forgot' | null>(null);
  const [undo, setUndo] = useState<{ id: number; term: string } | null>(null);
  const [majorFilter, setMajorFilter] = useState('');

  async function loadQueue() {
    const params = new URLSearchParams();
    if (majorFilter) params.set('scenarioMajor', majorFilter);
    const res = await fetch(`/api/review/queue?${params}`);
    setQueue(await res.json());
    setIndex(0);
    setPhase('guessing');
    setGuess(null);
  }

  useEffect(() => { loadQueue(); }, [majorFilter]);

  const current = queue[index];

  function pickGuess(value: 'remember' | 'forgot') {
    setGuess(value);
    setPhase('revealed');
  }

  function revoke() {
    setGuess(null);
    setPhase('guessing');
  }

  async function next() {
    if (current && guess) {
      await fetch(`/api/review/${current.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct: guess === 'remember' }),
      });
    }
    setIndex((i) => i + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleDelete() {
    if (!current) return;
    const deletedId = current.id;
    const deletedTerm = current.term;
    await fetch(`/api/knowledge-points/${deletedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    setUndo({ id: deletedId, term: deletedTerm });
    setTimeout(() => setUndo((u) => (u?.id === deletedId ? null : u)), 5000);
    setIndex((i) => i + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleUndo() {
    if (!undo) return;
    await fetch(`/api/knowledge-points/${undo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    setUndo(null);
  }

  return (
    <main className="p-6 max-w-xl">
      <div className="mb-4">
        <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部场景</option>
          {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {!current ? (
        <p>今天没有需要复盘的内容</p>
      ) : (
        <>
          <div className="border rounded p-6 mb-4">
            <p className="text-2xl font-semibold mb-4">{current.term}</p>
            {phase === 'guessing' && (
              <div className="flex gap-3">
                <button onClick={() => pickGuess('remember')} className="bg-green-600 text-white rounded px-4 py-2">记得</button>
                <button onClick={() => pickGuess('forgot')} className="bg-gray-400 text-white rounded px-4 py-2">不记得</button>
              </div>
            )}
            {phase === 'revealed' && (
              <>
                <p className="text-gray-700">{current.meaning}</p>
                <p className="text-gray-500 text-sm mt-1">{current.example}</p>
                {current.notes && <p className="text-gray-400 text-sm mt-1">{current.notes}</p>}
                <div className="flex gap-3 mt-4">
                  <button onClick={revoke} className="text-sm text-gray-500 underline">撤回</button>
                  <button onClick={next} className="bg-blue-600 text-white rounded px-4 py-2">下一个</button>
                </div>
              </>
            )}
          </div>
          <button onClick={handleDelete} className="text-red-600 text-sm">删除(不需要再复习)</button>
        </>
      )}

      {undo && (
        <div className="fixed bottom-4 left-4 bg-gray-800 text-white rounded px-4 py-2 flex gap-3 items-center">
          已删除「{undo.term}」
          <button onClick={handleUndo} className="underline">撤销</button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, log in, seed a few `active` rows with `next_review_date` today or earlier (via `/knowledge-points/import` or directly with `scripts/check-db.ts`-style queries), open `/review`. Confirm: term shows alone first; clicking 记得/不记得 reveals meaning/example/notes; 撤回 flips the guess and re-hides nothing (still revealed, just lets you re-pick); 下一个 commits and advances; 删除 immediately advances and shows the undo toast; clicking 撤销 within 5 seconds restores it (verify by reloading `/review` with the same filter — it stays gone from *this* loaded queue per spec, but reappears once requeried since `status` is back to `active`); the scenario filter narrows the queue.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add review page: guess/reveal/revoke/next flow, delete with undo toast, scenario filter"
git push
```

---

## Task 15: Mastered list + restore UI

**Files:**
- Create: `src/app/mastered/page.tsx`

**Interfaces:**
- Consumes: `GET /api/knowledge-points?status=mastered` and `PATCH /api/knowledge-points/:id` with `{status: 'active'}` — both already exist from Task 9. No new API routes in this task.

- [ ] **Step 1: Implement the mastered list page**

Create `src/app/mastered/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

type KP = { id: number; term: string; meaning: string; part: number; scenarioMajor: string; scenarioMinor: string };

export default function MasteredPage() {
  const [items, setItems] = useState<KP[]>([]);

  async function load() {
    const res = await fetch('/api/knowledge-points?status=mastered');
    setItems(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function restore(id: number) {
    await fetch(`/api/knowledge-points/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    load();
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">已掌握</h1>
      <ul className="flex flex-col gap-2">
        {items.map((kp) => (
          <li key={kp.id} className="border rounded p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{kp.term}</div>
              <div className="text-sm text-gray-600">{kp.meaning}</div>
              <div className="text-xs text-gray-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
            </div>
            <button onClick={() => restore(kp.id)} className="text-blue-600 text-sm">移回错题库</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, log in, open `/mastered`. If empty, drive a knowledge point through 7 consecutive correct answers via `/review` first (or directly via repeated `POST /api/review/:id/answer`), then reload `/mastered` and confirm it appears. Click "移回错题库", confirm it disappears from `/mastered` and reappears in `/review` (its `next_review_date` is now today).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add mastered list page with restore-to-active action"
git push
```

---

## Task 16: Mock exam API + UI

**Files:**
- Create: `src/app/api/mock-exams/route.ts`
- Create: `tests/integration/mockExamsApi.test.ts`
- Create: `src/app/mock-exams/page.tsx`

**Interfaces:**
- Consumes: `createMockExam`, `listMockExams` (Task 7).
- Produces: `GET/POST /api/mock-exams`, the `/mock-exams` page.

- [ ] **Step 1: Write the failing API tests**

Create `tests/integration/mockExamsApi.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '@vercel/postgres';
import { POST as createRoute, GET as listRoute } from '../../src/app/api/mock-exams/route';
import { NextRequest } from 'next/server';

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM mock_exam_results WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

const VALID = {
  testDate: '2026-06-26',
  part1: { correct: 5, total: 6 }, part2: { correct: 20, total: 25 },
  part3: { correct: 30, total: 39 }, part4: { correct: 25, total: 30 },
  scenarios: [],
};

describe('POST /api/mock-exams', () => {
  it('creates a record and returns 201', async () => {
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const res = await createRoute(req);
    const body = await res.json();
    createdIds.push(body.id);
    expect(res.status).toBe(201);
  });

  it('returns 400 with a friendly message when a total is 0', async () => {
    const bad = { ...VALID, part1: { correct: 0, total: 0 } };
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(bad) }));
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/mock-exams', () => {
  it('lists created exams', async () => {
    const req1 = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const created = await (await createRoute(req1)).json();
    createdIds.push(created.id);
    const res = await listRoute();
    const body = await res.json();
    expect(body.some((r: any) => r.id === created.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/mockExamsApi.test.ts`
Expected: FAIL with "Cannot find module '../../src/app/api/mock-exams/route'"

- [ ] **Step 3: Implement the route**

Create `src/app/api/mock-exams/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { createMockExam, listMockExams } from '@/lib/mockExams';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const client = createClient();
  await client.connect();
  try {
    const result = await createMockExam(client, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  } finally {
    await client.end();
  }
}

export async function GET() {
  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listMockExams(client));
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/mockExamsApi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement the mock exam page**

Create `src/app/mock-exams/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

type PartScore = { correct: number; total: number };
type ScenarioRow = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };

const PART_DEFAULTS: Record<string, PartScore> = {
  part1: { correct: 0, total: 6 },
  part2: { correct: 0, total: 25 },
  part3: { correct: 0, total: 39 },
  part4: { correct: 0, total: 30 },
};

export default function MockExamsPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [testDate, setTestDate] = useState('');
  const [parts, setParts] = useState<Record<string, PartScore>>(PART_DEFAULTS);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch('/api/mock-exams');
    setHistory(await res.json());
  }
  useEffect(() => { load(); }, []);

  function updatePart(key: string, field: 'correct' | 'total', value: number) {
    setParts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function addScenarioRow() {
    setScenarios((prev) => [...prev, { scenarioMajor: Object.keys(SCENARIOS)[0], scenarioMinor: '未分类', correct: 0, total: 1 }]);
  }
  function updateScenarioRow(i: number, patch: Partial<ScenarioRow>) {
    setScenarios((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeScenarioRow(i: number) {
    setScenarios((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/mock-exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testDate, ...parts, scenarios }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setTestDate('');
    setParts(PART_DEFAULTS);
    setScenarios([]);
    load();
  }

  return (
    <main className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold mb-4">记录一次模考</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 mb-6">
        <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required className="border rounded px-2 py-1" />
        {(['part1', 'part2', 'part3', 'part4'] as const).map((key, i) => (
          <div key={key} className="flex gap-2 items-center">
            <span className="w-16">Part {i + 1}</span>
            <input type="number" value={parts[key].correct} onChange={(e) => updatePart(key, 'correct', Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
            <span>/</span>
            <input type="number" value={parts[key].total} onChange={(e) => updatePart(key, 'total', Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
          </div>
        ))}

        <div>
          <p className="text-sm text-gray-600 mb-1">场景细分(选填)</p>
          {scenarios.map((s, i) => (
            <div key={i} className="flex gap-2 items-center mb-1">
              <select value={s.scenarioMajor} onChange={(e) => updateScenarioRow(i, { scenarioMajor: e.target.value, scenarioMinor: '未分类' })} className="border rounded px-1">
                {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={s.scenarioMinor} onChange={(e) => updateScenarioRow(i, { scenarioMinor: e.target.value })} className="border rounded px-1">
                {[...SCENARIOS[s.scenarioMajor], '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input type="number" value={s.correct} onChange={(e) => updateScenarioRow(i, { correct: Number(e.target.value) })} className="border rounded px-1 w-16" />
              <span>/</span>
              <input type="number" value={s.total} onChange={(e) => updateScenarioRow(i, { total: Number(e.target.value) })} className="border rounded px-1 w-16" />
              <button type="button" onClick={() => removeScenarioRow(i)} className="text-red-600 text-sm">删除</button>
            </div>
          ))}
          <button type="button" onClick={addScenarioRow} className="text-blue-600 text-sm">+ 添加场景</button>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2">保存</button>
      </form>

      <h2 className="text-lg font-semibold mb-2">模考历史</h2>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">日期</th><th>P1</th><th>P2</th><th>P3</th><th>P4</th></tr></thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.id}>
              <td>{r.testDate}</td>
              <td>{r.part1.correct}/{r.part1.total}</td>
              <td>{r.part2.correct}/{r.part2.total}</td>
              <td>{r.part3.correct}/{r.part3.total}</td>
              <td>{r.part4.correct}/{r.part4.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in, open `/mock-exams`. Submit a valid score, confirm it appears in history. Try `0` total for a part, confirm the friendly error shows and nothing is saved.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add mock exam recording API and form/history page"
git push
```

---

## Task 17: Stats API/UI and JSON export

**Files:**
- Create: `src/lib/stats.ts`, `tests/integration/stats.test.ts`
- Create: `src/app/api/stats/route.ts`
- Create: `src/app/api/export/route.ts`
- Create: `src/app/stats/page.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks beyond raw SQL against `knowledge_points`/`mock_exam_*` tables already created in Task 2.
- Produces: `getKnowledgePointStats(client): KnowledgePointStats`, `GET /api/stats`, `GET /api/export`, the `/stats` page.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import { getKnowledgePointStats } from '../../src/lib/stats';
import { insertKnowledgePoint, applyReviewResult } from '../../src/lib/knowledgePoints';

const BASE = { meaning: 'm', example: 'e', notes: null, scenarioMajor: '未分类', scenarioMinor: '未分类', skill: 'listening', dateAdded: '2026-06-01' };

describe('getKnowledgePointStats', () => {
  it('counts active rows', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, { ...BASE, term: 'a', part: 1 });
      const stats = await getKnowledgePointStats(client);
      expect(stats.activeCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('computes accuracy per part from correct_count/wrong_count', async () => {
    await withTestClient(async (client) => {
      const a = await insertKnowledgePoint(client, { ...BASE, term: 'a', part: 2 });
      await applyReviewResult(client, a.id, true, '2026-06-01');
      await applyReviewResult(client, a.id, false, '2026-06-01');
      const stats = await getKnowledgePointStats(client);
      const part2 = stats.byPart.find((p) => p.part === 2);
      expect(part2?.accuracy).toBeCloseTo(0.5);
    });
  });

  it('returns null accuracy when there is no review history yet (no division by zero)', async () => {
    await withTestClient(async (client) => {
      await insertKnowledgePoint(client, { ...BASE, term: 'b', part: 3 });
      const stats = await getKnowledgePointStats(client);
      const part3 = stats.byPart.find((p) => p.part === 3);
      expect(part3?.accuracy).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/stats.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/stats'"

- [ ] **Step 3: Implement `stats.ts`**

Create `src/lib/stats.ts`:

```typescript
import type { VercelClient } from '@vercel/postgres';

export type PartAccuracy = { part: number; correctCount: number; wrongCount: number; accuracy: number | null };
export type ScenarioAccuracy = { scenarioMajor: string; correctCount: number; wrongCount: number; accuracy: number | null };

export type KnowledgePointStats = {
  activeCount: number;
  masteredCount: number;
  byPart: PartAccuracy[];
  byScenarioMajor: ScenarioAccuracy[];
};

function accuracyOf(correct: number, wrong: number): number | null {
  const total = correct + wrong;
  return total === 0 ? null : correct / total;
}

export async function getKnowledgePointStats(client: VercelClient): Promise<KnowledgePointStats> {
  const { rows: countRows } = await client.query(
    `SELECT status, count(*)::int as count FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY status`
  );
  const activeCount = countRows.find((r: any) => r.status === 'active')?.count ?? 0;
  const masteredCount = countRows.find((r: any) => r.status === 'mastered')?.count ?? 0;

  const { rows: partRows } = await client.query(
    `SELECT part, sum(correct_count)::int as correct, sum(wrong_count)::int as wrong
     FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY part ORDER BY part`
  );
  const byPart = partRows.map((r: any) => ({
    part: r.part, correctCount: r.correct, wrongCount: r.wrong, accuracy: accuracyOf(r.correct, r.wrong),
  }));

  const { rows: scenarioRows } = await client.query(
    `SELECT scenario_major, sum(correct_count)::int as correct, sum(wrong_count)::int as wrong
     FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY scenario_major`
  );
  const byScenarioMajor = scenarioRows.map((r: any) => ({
    scenarioMajor: r.scenario_major, correctCount: r.correct, wrongCount: r.wrong, accuracy: accuracyOf(r.correct, r.wrong),
  }));

  return { activeCount, masteredCount, byPart, byScenarioMajor };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/stats.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement the stats and export routes**

Create `src/app/api/stats/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@vercel/postgres';
import { getKnowledgePointStats } from '@/lib/stats';

export async function GET() {
  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await getKnowledgePointStats(client));
  } finally {
    await client.end();
  }
}
```

Create `src/app/api/export/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
  const [kp, mockResults, mockScores] = await Promise.all([
    sql`SELECT * FROM knowledge_points`,
    sql`SELECT * FROM mock_exam_results`,
    sql`SELECT * FROM mock_exam_scenario_scores`,
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    knowledgePoints: kp.rows,
    mockExamResults: mockResults.rows,
    mockExamScenarioScores: mockScores.rows,
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="toeic-review-export.json"',
    },
  });
}
```

Note: neither query filters on `status`, so `deleted` rows are included in the export, matching spec §10.

- [ ] **Step 6: Implement the stats page**

Create `src/app/stats/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

export default function StatsPage() {
  const [stats, setStats] = useState<any>(null);
  const [exams, setExams] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setStats);
    fetch('/api/mock-exams').then((r) => r.json()).then(setExams);
  }, []);

  if (!stats) return <main className="p-6">加载中…</main>;

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">统计</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">错题库统计</h2>
        <p>活跃: {stats.activeCount} · 已掌握: {stats.masteredCount}</p>
        <table className="w-full text-sm mt-2">
          <thead><tr><th className="text-left">Part</th><th>正确率</th></tr></thead>
          <tbody>
            {stats.byPart.map((p: any) => (
              <tr key={p.part}><td>Part {p.part}</td><td>{p.accuracy === null ? '—' : `${Math.round(p.accuracy * 100)}%`}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="w-full text-sm mt-2">
          <thead><tr><th className="text-left">场景</th><th>正确率</th></tr></thead>
          <tbody>
            {stats.byScenarioMajor.map((s: any) => (
              <tr key={s.scenarioMajor}><td>{s.scenarioMajor}</td><td>{s.accuracy === null ? '—' : `${Math.round(s.accuracy * 100)}%`}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">模考历史</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">日期</th><th>P1</th><th>P2</th><th>P3</th><th>P4</th></tr></thead>
          <tbody>
            {exams.map((r) => (
              <tr key={r.id}>
                <td>{r.testDate}</td>
                <td>{r.part1.correct}/{r.part1.total}</td>
                <td>{r.part2.correct}/{r.part2.total}</td>
                <td>{r.part3.correct}/{r.part3.total}</td>
                <td>{r.part4.correct}/{r.part4.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <a href="/api/export" className="bg-gray-700 text-white rounded px-4 py-2 inline-block">导出全部数据 (JSON)</a>
    </main>
  );
}
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, log in, open `/stats`. Confirm counts/accuracy reflect data created in earlier tasks' manual tests, and clicking "导出全部数据" downloads a `toeic-review-export.json` containing all three tables.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add stats aggregation, stats page, and full JSON export"
git push
```

---

## Task 18: Home navigation and production deployment

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: a navigable home page linking every page built in Tasks 9, 12, 14, 15, 16, 17, and a live Vercel production URL serving the deployed app.

- [ ] **Step 1: Implement the home page**

Replace `src/app/page.tsx`:

```tsx
import Link from 'next/link';

const LINKS = [
  { href: '/review', label: '今日复盘' },
  { href: '/knowledge-points', label: '错题库' },
  { href: '/knowledge-points/import', label: '导入笔记' },
  { href: '/mastered', label: '已掌握' },
  { href: '/mock-exams', label: '模考记录' },
  { href: '/stats', label: '统计' },
];

export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-6">TOEIC 听力错题复盘</h1>
      <ul className="flex flex-col gap-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-blue-600 underline text-lg">{l.label}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification of the full local flow**

Run: `npm run dev`. Walk through, in order: log in → home page shows all 6 links → import a real notes file → confirm it lands in 错题库 → do a review pass on `/review` → check `/stats` reflects it → record a mock exam → export JSON and open the downloaded file to confirm all three tables are present with real data.

- [ ] **Step 3: ⚠️ HUMAN ACTION — confirm production env vars are set**

In the Vercel project dashboard → Settings → Environment Variables, confirm `POSTGRES_URL` (and siblings), `ANTHROPIC_API_KEY`, and `APP_PASSWORD` are all present for the **Production** environment specifically (Task 1 set them, but double-check the environment checkbox — it's easy to add a var only to Preview/Development by mistake).

- [ ] **Step 4: Deploy**

Run:
```
git push
vercel --prod
```
Or simply push to the `main`/`master` branch — Vercel's GitHub integration auto-deploys on push if that's how the project was connected in Task 1.

- [ ] **Step 5: Production smoke test**

Open the production URL Vercel prints (or shown in the dashboard) on a phone or another browser. Confirm: `/login` gate works, logging in works, `/review` loads (even if empty), `/knowledge-points/import` can upload a real file and write to the **production** database (the same one used in dev, since Task 1 set up one shared dev/prod Postgres — confirm this is the intended setup; if the user wants prod data kept separate from whatever test rows accumulated during development, manually clean up test rows now via a one-off `DELETE FROM knowledge_points WHERE term IN (...)` for anything created during Tasks 1–17's manual verification steps).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add home navigation page"
git push
```
