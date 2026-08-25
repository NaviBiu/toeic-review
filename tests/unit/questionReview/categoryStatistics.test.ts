import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it, vi } from 'vitest';
import { listCategoryTree } from '@/lib/questionReview/categories';

describe('category statistics', () => {
  it('limits parent rollups to active child categories', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as VercelClient;

    await listCategoryTree(client, { section: 'reading', part: 5, includeInactive: true });

    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(
      /JOIN scoped_categories child ON child\.parent_id = parent\.id AND child\.status = 'active'/,
    );
  });
});
