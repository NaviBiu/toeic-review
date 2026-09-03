import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyReadingNoteUndoToken } from '@/lib/readingNotes/notes';

function noteRow(status: 'active' | 'deleted') {
  return {
    id: 5,
    category_id: 2,
    category_name: 'Grammar',
    content_html: '<p>Token note</p>',
    content_text: 'token note',
    notes: null,
    note_date: '2026-09-02',
    status,
    correct_streak: 2,
    correct_count: 4,
    wrong_count: 1,
    next_review_date: status === 'active' ? '2026-09-03' : null,
    last_reviewed_date: '2026-09-02',
  };
}

afterEach(() => {
  vi.doUnmock('@/lib/db');
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('reading note list route validation', () => {
  it('rejects unknown query parameters before opening a database connection', async () => {
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const createClient = vi.fn(() => client);
    vi.doMock('@/lib/db', () => ({ createClient }));
    const categoryRoute = await import('@/app/api/reading-note-categories/route');
    const noteRoute = await import('@/app/api/reading-notes/route');

    const category = await categoryRoute.GET(new NextRequest(
      'http://localhost/api/reading-note-categories?unexpected=true',
    ));
    const note = await noteRoute.GET(new NextRequest(
      'http://localhost/api/reading-notes?unexpected=true',
    ));

    expect(category.status).toBe(400);
    expect(note.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('reading note delete tokens', () => {
  it('signs the exact post-delete updated_at timestamp', async () => {
    const deletedAt = '2026-09-03 09:10:11.123456+00';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT note.*')) return { rows: [noteRow('active')] };
      if (sql.includes("SET status = 'deleted'")) {
        return { rows: [{ ...noteRow('deleted'), deleted_at: deletedAt }] };
      }
      return { rows: [] };
    });
    const client = { connect: vi.fn(), end: vi.fn(), query };
    vi.stubEnv('AUTH_SECRET', 'route-cycle-secret');
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { DELETE } = await import('@/app/api/reading-notes/[id]/route');

    const response = await DELETE(new NextRequest(
      'http://localhost/api/reading-notes/5', { method: 'DELETE' },
    ), { params: Promise.resolve({ id: '5' }) });
    const body = await response.json();
    const payload = verifyReadingNoteUndoToken(
      body.undoToken,
      'route-cycle-secret',
      Date.now(),
    ) as ReturnType<typeof verifyReadingNoteUndoToken> & { deletedAt?: string };

    expect(response.status).toBe(200);
    expect(payload.deletedAt).toBe(deletedAt);
  });
});
