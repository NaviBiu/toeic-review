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
