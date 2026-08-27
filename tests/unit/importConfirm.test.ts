import { describe, expect, it, vi } from 'vitest';
import { applyConfirmedImportItem } from '../../src/lib/importConfirm';

describe('applyConfirmedImportItem enrichment', () => {
  it('fills notes without recording another wrong answer', async () => {
    const row = {
      id: 42,
      term: 'site office',
      meaning: '现场办公室',
      example: 'ex',
      notes: '考点分析：建筑场景高频地点表达。',
      part: 3,
      scenario_major: '未分类',
      scenario_minor: '未分类',
      skill: 'listening',
      date_added: '2026-08-16',
      status: 'active',
      correct_streak: 0,
      correct_count: 0,
      wrong_count: 0,
      next_review_date: '2026-08-16',
      last_reviewed_date: null,
    };
    const query = vi.fn(async () => ({ rows: [row] }));
    const client = { query } as any;

    const result = await applyConfirmedImportItem(client, {
      term: row.term,
      meaning: row.meaning,
      example: row.example,
      notes: row.notes,
      part: row.part,
      scenarioMajor: row.scenario_major,
      scenarioMinor: row.scenario_minor,
      dateAdded: row.date_added,
      decision: { action: 'enrich_existing' } as any,
      existingId: row.id,
    }, '2026-08-20');

    expect(result).toEqual({ action: 'enriched', id: 42 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('UPDATE knowledge_points SET notes = $1');
    expect(query.mock.calls[0][0]).not.toContain('wrong_count');
  });
});
