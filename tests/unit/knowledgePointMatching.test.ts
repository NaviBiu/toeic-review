import { describe, expect, it, vi } from 'vitest';
import { findMatch } from '../../src/lib/knowledgePoints';

describe('findMatch for import', () => {
  it('matches a same-day re-import even when AI changes the scenario classification', async () => {
    const row = {
      id: 3465,
      term: 'place an order，',
      meaning: '下单',
      example: 'We placed an order.',
      notes: null,
      part: 3,
      scenario_major: '采购',
      scenario_minor: '订购物资',
      skill: 'listening',
      date_added: '2026-08-16',
      status: 'active',
      correct_streak: 2,
      correct_count: 4,
      wrong_count: 1,
      next_review_date: '2026-08-22',
      last_reviewed_date: '2026-08-19',
    };
    const client = { query: vi.fn().mockResolvedValue({ rows: [row] }) };

    const match = await findMatch(
      client as never,
      'place an order',
      3,
      '采购',
      '购物',
      'listening',
      '2026-08-16',
    );

    expect(match?.id).toBe(3465);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('part = $1 AND skill = $2'),
      [3, 'listening'],
    );
  });
});
