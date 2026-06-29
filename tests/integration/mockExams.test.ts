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
    // This runs against the real shared database (which now holds the
    // user's own real mock exam records, possibly dated more recently than
    // either fixture date below) -- assert this test's own two rows sort
    // relative to each other correctly, not that they land at absolute
    // positions [0] and [1] of the full unscoped list (flagged as a latent
    // risk during Task 16's review, deprioritized then as "self-resolving"
    // since the table was still empty; no longer true now that it isn't).
    await withTestClient(async (client) => {
      await createMockExam(client, { ...VALID, testDate: '2026-06-01', scenarios: [] });
      await createMockExam(client, { ...VALID, testDate: '2026-06-20', scenarios: [] });
      const all = await listMockExams(client);
      const index0601 = all.findIndex((r) => r.testDate === '2026-06-01');
      const index0620 = all.findIndex((r) => r.testDate === '2026-06-20');
      expect(index0601).toBeGreaterThan(-1);
      expect(index0620).toBeGreaterThan(-1);
      expect(index0620).toBeLessThan(index0601); // 2026-06-20 sorts before 2026-06-01 (descending)
    });
  });
});
