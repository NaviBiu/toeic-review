import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

describe('reading note API validation', () => {
  it('rejects malformed category and note requests before connecting', async () => {
    const createClient = vi.fn();
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient }));
    const categoryRoute = await import('@/app/api/reading-note-categories/route');
    const noteRoute = await import('@/app/api/reading-notes/route');

    const category = await categoryRoute.POST(new NextRequest(
      'http://localhost/api/reading-note-categories',
      { method: 'POST', body: JSON.stringify({ name: '' }) },
    ));
    const note = await noteRoute.POST(new NextRequest(
      'http://localhost/api/reading-notes',
      { method: 'POST', body: JSON.stringify({ contentHtml: '<p>x</p>' }) },
    ));

    expect(category.status).toBe(400);
    expect(note.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/db');
  });

  it('rejects a tampered delete undo token', async () => {
    process.env.AUTH_SECRET = 'reading-notes-api-test-secret';
    const client = { connect: vi.fn(), end: vi.fn(), query: vi.fn() };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { PATCH } = await import('@/app/api/reading-notes/[id]/route');

    const response = await PATCH(new NextRequest(
      'http://localhost/api/reading-notes/3',
      { method: 'PATCH', body: JSON.stringify({ status: 'restore', undoToken: 'tampered' }) },
    ), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(400);
    expect(client.connect).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/db');
  });
});
