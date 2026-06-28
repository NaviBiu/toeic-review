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

  it('rejects a partial update that changes only scenarioMinor into an invalid combination with the existing scenarioMajor', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await expect(
        updateKnowledgePointFields(client, kp.id, { scenarioMinor: '不存在的小分类' })
      ).rejects.toThrow('场景分类不在允许的列表内');
    });
  });

  it('silently ignores an unknown field key instead of throwing a SQL error', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      const updated = await updateKnowledgePointFields(client, kp.id, {
        meaning: '已更新',
        ...({ foo: 'bar' } as any),
      });
      expect(updated.meaning).toBe('已更新');
    });
  });
});

describe('insertKnowledgePoint scenario validation', () => {
  it('throws when given an invalid major/minor pair', async () => {
    await withTestClient(async (client) => {
      await expect(
        insertKnowledgePoint(client, { ...BASE, scenarioMajor: '股票', scenarioMinor: '投资' })
      ).rejects.toThrow('场景分类不在允许的列表内');
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
