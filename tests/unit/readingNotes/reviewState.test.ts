import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCorrectedDecision,
  applyOptimisticDecision,
  correctReadingAttempt,
  getReadingPendingCount,
  getReadingQueuePage,
  recordReadingAttempt,
  rollbackOptimisticDecision,
  type ReadingSessionState,
} from '@/lib/readingNotes/review';

const today = '2026-09-03';

function baseState(): ReadingSessionState {
  return {
    queue: [7, 8],
    cursor: 0,
    pending: 2,
    previous: null,
  };
}

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    category_id: 2,
    category_name: 'Grammar',
    content_html: '<p>Subject to approval</p>',
    content_text: 'subject to approval',
    notes: null,
    note_date: '2026-09-02',
    status: 'active',
    correct_streak: 0,
    correct_count: 0,
    wrong_count: 0,
    next_review_date: today,
    last_reviewed_date: null,
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    request_id: '7e0cc797-0694-4ca4-83ec-b6476543ac5c',
    note_id: 7,
    decision: 'unknown',
    review_date: today,
    before_state: {
      status: 'active',
      correctStreak: 0,
      correctCount: 0,
      wrongCount: 0,
      nextReviewDate: today,
      lastReviewedDate: null,
    },
    after_state: {
      status: 'active',
      correctStreak: 0,
      correctCount: 0,
      wrongCount: 1,
      nextReviewDate: today,
      lastReviewedDate: today,
    },
    ...overrides,
  };
}

function correctionRow(overrides: Record<string, unknown> = {}) {
  const attempt = attemptRow();
  return {
    ...noteRow(),
    attempt_id: attempt.id,
    request_id: attempt.request_id,
    note_id: attempt.note_id,
    decision: attempt.decision,
    review_date: attempt.review_date,
    before_state: attempt.before_state,
    after_state: attempt.after_state,
    is_latest: true,
    ...overrides,
  };
}

describe('reading review session state', () => {
  it('requeues an unknown note at the end of the session', () => {
    expect(applyOptimisticDecision(baseState(), 7, 'unknown')).toMatchObject({
      queue: [7, 8, 7],
      cursor: 1,
      pending: 2,
    });
  });

  it('does not repeat a known note', () => {
    expect(applyOptimisticDecision(baseState(), 7, 'known')).toMatchObject({
      queue: [7, 8],
      cursor: 1,
      pending: 1,
    });
  });

  it('removes the queued repeat when unknown is corrected to known', () => {
    const unknownState: ReadingSessionState = {
      ...applyOptimisticDecision(baseState(), 7, 'unknown'),
      previous: { attemptId: 31, noteId: 7, decision: 'unknown' },
    };

    expect(applyCorrectedDecision(unknownState, 'known')).toMatchObject({
      queue: [7, 8],
      pending: 1,
      previous: { attemptId: 31, noteId: 7, decision: 'known' },
    });
  });

  it('adds a repeat when known is corrected to unknown', () => {
    const knownState: ReadingSessionState = {
      ...applyOptimisticDecision(baseState(), 7, 'known'),
      previous: { attemptId: 31, noteId: 7, decision: 'known' },
    };

    expect(applyCorrectedDecision(knownState, 'unknown')).toMatchObject({
      queue: [7, 8, 7],
      pending: 2,
      previous: { attemptId: 31, noteId: 7, decision: 'unknown' },
    });
  });

  it('reopens a completed session when its final answer becomes unknown', () => {
    const completedState: ReadingSessionState = {
      queue: [7],
      cursor: 1,
      pending: 0,
      previous: { attemptId: 31, noteId: 7, decision: 'known' },
    };

    const corrected = applyCorrectedDecision(completedState, 'unknown');

    expect(corrected.queue.at(-1)).toBe(7);
    expect(corrected.pending).toBe(1);
  });

  it('rolls back to the exact snapshot captured before an optimistic decision', () => {
    const snapshot = baseState();
    const optimistic = applyOptimisticDecision(snapshot, 7, 'unknown');

    expect(rollbackOptimisticDecision(optimistic, snapshot)).toBe(snapshot);
    expect(snapshot).toEqual(baseState());
  });
});

describe('reading review repository', () => {
  it('counts due active notes within an optional category', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ pending: 12 }] });
    const client = { query } as unknown as VercelClient;

    await expect(getReadingPendingCount(client, today, 4)).resolves.toBe(12);
    expect(query.mock.calls[0][0]).toContain("note.status = 'active'");
    expect(query.mock.calls[0][0]).toContain('note.next_review_date <= $1');
    expect(query.mock.calls[0][1]).toEqual([today, 4]);
  });

  it('reads one extra queue row and caps repository pages at 50', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => noteRow({ id: index + 1 }));
    const query = vi.fn()
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [{ pending: 3 }] });
    const client = { query } as unknown as VercelClient;

    await expect(getReadingQueuePage(client, today, { limit: 2 })).resolves.toMatchObject({
      items: [{ id: 1 }, { id: 2 }],
      totalPending: 3,
      hasMore: true,
    });
    expect(query.mock.calls[0][0]).toContain(
      'ORDER BY note.wrong_count DESC, note.next_review_date ASC, note.id ASC',
    );
    expect(query.mock.calls[0][1]).toEqual([today, 3]);
    await expect(getReadingQueuePage(client, today, { limit: 51 }))
      .rejects.toMatchObject({ kind: 'invalid' });
  });

  it('records an unknown attempt and updates its locked note once', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE OF note')) return { rows: [noteRow()] };
      if (sql.includes('WITH existing AS MATERIALIZED')) {
        return { rows: [attemptRow({ inserted: true, updated_note_id: 7 })] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    const result = await recordReadingAttempt(client, {
      requestId: '7e0cc797-0694-4ca4-83ec-b6476543ac5c',
      noteId: 7,
      decision: 'unknown',
      today,
    });

    expect(result).toMatchObject({
      attempt: { id: 31, decision: 'unknown' },
      note: { id: 7, wrongCount: 1, lastReviewedDate: today },
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE OF note'),
      expect.stringContaining('WITH existing AS MATERIALIZED'),
      'COMMIT',
    ]);
    expect(query.mock.calls[2][0]).toContain('UPDATE reading_notes');
  });

  it('returns a UUID-conflicting attempt without incrementing the note again', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE OF note')) {
        return { rows: [noteRow({ wrong_count: 1, last_reviewed_date: today })] };
      }
      if (sql.includes('WITH existing AS MATERIALIZED')) {
        return { rows: [attemptRow({ inserted: false, updated_note_id: null })] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(recordReadingAttempt(client, {
      requestId: '7e0cc797-0694-4ca4-83ec-b6476543ac5c',
      noteId: 7,
      decision: 'unknown',
      today,
    })).resolves.toMatchObject({ attempt: { id: 31 }, note: { wrongCount: 1 } });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('returns the original UUID attempt when a retry arrives on a later day', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE OF note')) {
        return { rows: [noteRow({ wrong_count: 1, last_reviewed_date: today })] };
      }
      if (sql.includes('WITH existing AS MATERIALIZED')) {
        return { rows: [attemptRow({ inserted: false, updated_note_id: null })] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(recordReadingAttempt(client, {
      requestId: '7e0cc797-0694-4ca4-83ec-b6476543ac5c',
      noteId: 7,
      decision: 'unknown',
      today: '2026-09-04',
    })).resolves.toMatchObject({
      attempt: { id: 31, reviewDate: today },
      note: { wrongCount: 1 },
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('corrects the same latest attempt exclusively from before_state', async () => {
    const stored = attemptRow({
      before_state: {
        status: 'active',
        correctStreak: 2,
        correctCount: 4,
        wrongCount: 1,
        nextReviewDate: today,
        lastReviewedDate: '2026-09-02',
      },
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE OF note') && !sql.includes('ORDER BY id DESC')) {
        return { rows: [correctionRow({
          before_state: stored.before_state,
          correct_streak: 99,
          correct_count: 99,
          wrong_count: 99,
        })] };
      }
      if (sql.includes('WITH latest AS MATERIALIZED')) {
        return { rows: [correctionRow({
          decision: 'known',
          correct_streak: 3,
          correct_count: 5,
          wrong_count: 1,
          next_review_date: '2026-09-07',
          last_reviewed_date: today,
        })] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(correctReadingAttempt(client, {
      attemptId: 31,
      decision: 'known',
      today,
    })).resolves.toMatchObject({ attempt: { id: 31, decision: 'known' } });

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).not.toContain('ORDER BY id DESC');
    expect(query.mock.calls[2][0]).toContain('ORDER BY id DESC');
    expect(query.mock.calls[2][0]).toContain('UPDATE reading_note_review_attempts');
    expect(query.mock.calls[2][0]).toContain('UPDATE reading_notes');
    expect(query.mock.calls[2][1]).toEqual([
      31, 'known', expect.any(String), 3, 5, 1, 'active', '2026-09-07', today, 7,
    ]);
  });

  it('rolls back when correction is no longer the note latest attempt', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE OF note') && !sql.includes('ORDER BY id DESC')) {
        return { rows: [correctionRow()] };
      }
      if (sql.includes('WITH latest AS MATERIALIZED')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as VercelClient;

    await expect(correctReadingAttempt(client, {
      attemptId: 31,
      decision: 'known',
      today,
    })).rejects.toMatchObject({
      kind: 'conflict',
      message: '只能修改该知识点最近一次复盘结果',
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
