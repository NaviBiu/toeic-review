import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareReadingNoteContent,
  setReadingNoteStatus,
  signReadingNoteUndoToken,
  verifyReadingNoteUndoToken,
} from '@/lib/readingNotes/notes';

describe('reading note validation', () => {
  it('rejects content without readable text', () => {
    try {
      prepareReadingNoteContent({
        contentHtml: '<p><br></p>',
        noteDate: '2026-09-01',
        today: '2026-09-02',
      });
      throw new Error('Expected empty content to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ message: '知识点不能为空', kind: 'invalid' });
    }
  });

  it('clamps future note dates to today', () => {
    expect(prepareReadingNoteContent({
      contentHtml: '<p>Subject <strong>to approval</strong></p>',
      noteDate: '2026-09-09',
      today: '2026-09-02',
    })).toMatchObject({
      contentText: 'subject to approval',
      noteDate: '2026-09-02',
    });
  });

  it('preserves valid historical note dates', () => {
    expect(prepareReadingNoteContent({
      contentHtml: '<p>Past note</p>',
      noteDate: '2026-08-31',
      today: '2026-09-02',
    }).noteDate).toBe('2026-08-31');
  });

  it('rejects malformed calendar dates', () => {
    expect(() => prepareReadingNoteContent({
      contentHtml: '<p>Bad date</p>',
      noteDate: '2026-02-30',
      today: '2026-09-02',
    })).toThrow('日期格式不正确');
  });

  it('round-trips the exact signed SRS snapshot', () => {
    const payload = {
      noteId: 42,
      snapshot: {
        status: 'mastered' as const,
        correctStreak: 7,
        correctCount: 11,
        wrongCount: 3,
        nextReviewDate: null,
        lastReviewedDate: '2026-09-01',
      },
      expiresAt: 10_000,
    };
    const token = signReadingNoteUndoToken(payload, 'unit-test-secret');

    expect(verifyReadingNoteUndoToken(token, 'unit-test-secret', 9_999)).toEqual(payload);
  });

  it('rejects tampered and expired undo tokens', () => {
    const token = signReadingNoteUndoToken({
      noteId: 42,
      snapshot: {
        status: 'active',
        correctStreak: 2,
        correctCount: 4,
        wrongCount: 1,
        nextReviewDate: '2026-09-03',
        lastReviewedDate: '2026-09-02',
      },
      expiresAt: 10_000,
    }, 'unit-test-secret');

    expect(() => verifyReadingNoteUndoToken(`${token}x`, 'unit-test-secret', 9_999))
      .toThrow('撤销凭证不正确');
    expect(() => verifyReadingNoteUndoToken(token, 'unit-test-secret', 10_001))
      .toThrow('撤销凭证已过期');
  });

  it('does not revive a note deleted between status read and write', async () => {
    const activeRow = {
      id: 8,
      category_id: 2,
      category_name: 'Grammar',
      content_html: '<p>Still active</p>',
      content_text: 'still active',
      notes: null,
      note_date: '2026-09-02',
      status: 'active',
      correct_streak: 0,
      correct_count: 0,
      wrong_count: 0,
      next_review_date: '2026-09-02',
      last_reviewed_date: null,
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [activeRow] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as VercelClient;

    await expect(setReadingNoteStatus(client, 8, 'mastered', '2026-09-02'))
      .rejects.toMatchObject({ kind: 'conflict' });
    expect(query.mock.calls[1][0]).toContain("status <> 'deleted'");
  });
});
