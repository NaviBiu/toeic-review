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

  it('reflects a new review result as a before/after delta on the part aggregate', async () => {
    // This runs against the real shared database (now holding the user's
    // own real reviewed vocabulary), not an isolated empty one -- asserting
    // an exact aggregate value (e.g. "accuracy is null because nothing else
    // exists") breaks the moment real history exists for this part. Compare
    // before vs. after instead, which holds regardless of pre-existing data.
    // The pure division-by-zero guard itself is covered in
    // tests/unit/stats.test.ts without touching the database at all.
    await withTestClient(async (client) => {
      const before = await getKnowledgePointStats(client);
      const beforePart3 = before.byPart.find((p) => p.part === 3);
      const beforeWrong = beforePart3?.wrongCount ?? 0;
      const beforeCorrect = beforePart3?.correctCount ?? 0;

      const b = await insertKnowledgePoint(client, { ...BASE, term: 'b', part: 3 });
      await applyReviewResult(client, b.id, false, '2026-06-01');

      const after = await getKnowledgePointStats(client);
      const afterPart3 = after.byPart.find((p) => p.part === 3);
      expect(afterPart3?.wrongCount).toBe(beforeWrong + 1);
      expect(afterPart3?.correctCount).toBe(beforeCorrect);
    });
  });
});
