import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it, vi } from 'vitest';
import type { ReadingSrsSnapshot } from '@/lib/readingNotes/types';
import {
  listReadingNotes,
  restoreReadingNoteSnapshot,
} from '@/lib/readingNotes/notes';

function deletedNoteRow() {
  return {
    id: 8,
    category_id: 2,
    category_name: 'Grammar',
    content_html: '<p>Deleted note</p>',
    content_text: 'deleted note',
    notes: null,
    note_date: '2026-09-02',
    status: 'deleted',
    correct_streak: 4,
    correct_count: 7,
    wrong_count: 2,
    next_review_date: null,
    last_reviewed_date: '2026-09-02',
  };
}

describe('reading note repository hardening', () => {
  it('uses a parameterized fallback count when an out-of-range page is empty', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_count: 37 }] });
    const client = { query } as unknown as VercelClient;

    const result = await listReadingNotes(client, {
      search: 'approval',
      categoryId: 4,
      status: 'active',
      dateFrom: '2026-08-01',
      dateTo: '2026-09-02',
      page: 9,
      pageSize: 20,
    });

    expect(result).toEqual({ items: [], total: 37, page: 9, pageSize: 20 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('COUNT(*)::int AS total_count');
    expect(query.mock.calls[1][0]).not.toContain('LIMIT');
    expect(query.mock.calls[1][1]).toEqual([
      'approval', 4, 'active', '2026-08-01', '2026-09-02',
    ]);
  });

  it('rejects a restore token from an earlier deletion cycle', async () => {
    const deletedAt = '2026-09-03 09:10:11.123456+00';
    const snapshot: ReadingSrsSnapshot = {
      status: 'active',
      correctStreak: 1,
      correctCount: 3,
      wrongCount: 2,
      nextReviewDate: '2026-09-03',
      lastReviewedDate: '2026-09-02',
    };
    const query = vi.fn(async (...args: [string, unknown[]?]) => {
      const sql = args[0];
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT note.*')) return { rows: [deletedNoteRow()] };
      if (sql.includes("updated_at = $8::timestamptz")) return { rows: [] };
      return { rows: [{ ...deletedNoteRow(), status: 'active' }] };
    });
    const client = { query } as unknown as VercelClient;
    const restoreWithCycle = restoreReadingNoteSnapshot as unknown as (
      client: VercelClient,
      id: number,
      state: ReadingSrsSnapshot,
      deletedAt: string,
    ) => Promise<unknown>;

    await expect(restoreWithCycle(client, 8, snapshot, deletedAt))
      .rejects.toMatchObject({ kind: 'conflict' });
    const restoreCall = query.mock.calls.find(([sql]) => sql.includes('UPDATE reading_notes'));
    expect(restoreCall?.[0]).toContain("status = 'deleted'");
    expect(restoreCall?.[0]).toContain('updated_at = $8::timestamptz');
    expect(restoreCall?.[1]?.[7]).toBe(deletedAt);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
