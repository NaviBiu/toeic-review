import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/readingNotes/review');
  vi.resetModules();
});

describe('reading review routes', () => {
  it('validates attempt payloads before connecting', async () => {
    const createClient = vi.fn();
    vi.doMock('@/lib/db', () => ({ createClient }));
    const { POST } = await import('@/app/api/reading-review/attempts/route');

    const response = await POST(new NextRequest(
      'http://localhost/api/reading-review/attempts',
      {
        method: 'POST',
        body: JSON.stringify({ requestId: 'bad-id', noteId: 1, decision: 'maybe' }),
      },
    ));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('clamps queue limits to 1 through 50', async () => {
    const getReadingQueuePage = vi.fn().mockResolvedValue({
      items: [], totalPending: 0, hasMore: false,
    });
    const client = { connect: vi.fn(), end: vi.fn() };
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    vi.doMock('@/lib/readingNotes/review', () => ({
      getReadingQueuePage,
      ReadingReviewError: class ReadingReviewError extends Error {},
    }));
    const { GET } = await import('@/app/api/reading-review/queue/route');

    const high = await GET(new NextRequest(
      'http://localhost/api/reading-review/queue?limit=500',
    ));
    const low = await GET(new NextRequest(
      'http://localhost/api/reading-review/queue?limit=0',
    ));

    expect(high.status).toBe(200);
    expect(low.status).toBe(200);
    expect(getReadingQueuePage).toHaveBeenNthCalledWith(1, client, expect.any(String), {
      limit: 50,
    });
    expect(getReadingQueuePage).toHaveBeenNthCalledWith(2, client, expect.any(String), {
      limit: 1,
    });
  });

  it('maps missing attempts to 404 and stale corrections to 409', async () => {
    class ReadingReviewError extends Error {
      constructor(message: string, public readonly kind: string) {
        super(message);
      }
    }
    const correctReadingAttempt = vi.fn()
      .mockRejectedValueOnce(new ReadingReviewError('复盘记录不存在', 'not_found'))
      .mockRejectedValueOnce(new ReadingReviewError(
        '只能修改该知识点最近一次复盘结果',
        'conflict',
      ));
    const client = { connect: vi.fn(), end: vi.fn() };
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    vi.doMock('@/lib/readingNotes/review', () => ({
      correctReadingAttempt,
      ReadingReviewError,
    }));
    const { PATCH } = await import('@/app/api/reading-review/attempts/[id]/route');
    const request = () => new NextRequest(
      'http://localhost/api/reading-review/attempts/31',
      { method: 'PATCH', body: JSON.stringify({ decision: 'known' }) },
    );
    const context = { params: Promise.resolve({ id: '31' }) };

    const missing = await PATCH(request(), context);
    const stale = await PATCH(request(), context);

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
  });
});
