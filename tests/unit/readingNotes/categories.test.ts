import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeReadingCategoryName,
  planCategoryDeletion,
  reorderReadingCategories,
  updateReadingCategory,
} from '@/lib/readingNotes/categories';

describe('reading note category validation', () => {
  it('trims and normalizes whitespace in category names', () => {
    expect(normalizeReadingCategoryName('  Business\n  emails  ')).toEqual({
      name: 'Business emails',
      normalizedName: 'business emails',
    });
  });

  it('rejects an empty category name', () => {
    expect(() => normalizeReadingCategoryName(' \n\t ')).toThrow('分类名称不能为空');
  });

  it('plans empty, uncategorized, and merged category deletion', () => {
    expect(planCategoryDeletion({ isDefault: false, noteCount: 0 }, null))
      .toEqual({ kind: 'delete' });
    expect(planCategoryDeletion({ isDefault: false, noteCount: 3 }, 'uncategorized'))
      .toEqual({ kind: 'move_to_uncategorized' });
    expect(planCategoryDeletion({ isDefault: false, noteCount: 3 }, 9))
      .toEqual({ kind: 'merge', targetCategoryId: 9 });
  });

  it('protects the default category', () => {
    expect(() => planCategoryDeletion({ isDefault: true, noteCount: 0 }, null))
      .toThrow('未分类不能删除');
  });

  it('requires a destination for a populated category', () => {
    expect(() => planCategoryDeletion({ isDefault: false, noteCount: 3 }, null))
      .toThrow('请选择合并分类或移到未分类');
  });

  it('reorders every active category in one transaction', async () => {
    const query = vi.fn(async (...args: [string, unknown[]?]) => {
      const sql = args[0];
      if (sql.includes('SELECT id FROM reading_note_categories')) {
        return { rows: [{ id: 2 }, { id: 7 }] };
      }
      if (sql.includes('SELECT category.id')) {
        return { rows: [
          { id: 7, name: 'Second', sort_order: 0, is_default: false, status: 'active', note_count: 0 },
          { id: 2, name: 'First', sort_order: 1, is_default: true, status: 'active', note_count: 1 },
        ] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(reorderReadingCategories(client, [7, 2])).resolves.toMatchObject([
      { id: 7, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
    ]);
    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toEqual([
      'BEGIN', 'SELECT', 'UPDATE', 'SELECT', 'COMMIT',
    ]);
    expect(query.mock.calls[2][1]).toEqual([[7, 2]]);
  });

  it('rolls back reorder when ids are missing or repeated', async () => {
    const query = vi.fn(async (...args: [string, unknown[]?]) => {
      const sql = args[0];
      if (sql.includes('SELECT id FROM reading_note_categories')) {
        return { rows: [{ id: 2 }, { id: 7 }] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(reorderReadingCategories(client, [2, 2])).rejects
      .toThrow('分类顺序必须包含全部有效分类且不能重复');
    expect(query.mock.calls.map(([sql]) => sql.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('SELECT id FROM reading_note_categories'),
      'ROLLBACK',
    ]);
  });

  it('does not update a category deleted after the initial read', async () => {
    const activeCategory = {
      id: 12,
      name: 'Active category',
      sort_order: 2,
      is_default: false,
      status: 'active',
      note_count: 3,
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [activeCategory] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as VercelClient;

    await expect(updateReadingCategory(client, 12, { name: 'Renamed' }))
      .rejects.toMatchObject({ kind: 'conflict' });
    expect(query.mock.calls[1][0]).toContain("status = 'active'");
  });
});
