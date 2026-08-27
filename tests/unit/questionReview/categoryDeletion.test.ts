import { describe, expect, it, vi } from 'vitest';
import type { VercelClient } from '@vercel/postgres';
import { deleteEmptyCategory } from '@/lib/questionReview/categories';

describe('category deletion', () => {
  it('deletes an empty root together with its generated default child', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 91,
          section: 'reading',
          part: 5,
          parent_id: null,
          name: '临时分类',
          is_default: false,
          status: 'active',
          sort_order: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          has_questions: false,
          has_children: true,
          has_non_default_children: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 91 }, { id: 92 }] });
    const client = { query } as unknown as VercelClient;

    await expect(deleteEmptyCategory(client, 91)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain('parent_id = $1 AND is_default = true');
    expect(query.mock.calls[2][1]).toEqual([91]);
  });
});
