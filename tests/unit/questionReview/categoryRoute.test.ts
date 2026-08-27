import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parentRow = {
  id: 7,
  section: 'reading',
  part: 5,
  parent_id: null,
  name: '固定搭配',
  is_default: false,
  status: 'active',
  sort_order: 0,
};

const defaultChildRow = {
  ...parentRow,
  id: 8,
  parent_id: 7,
  name: '未细分',
  is_default: true,
};

describe('question category route', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/db');
  });

  it('returns the refreshed category tree from the create request', async () => {
    const withStats = (row: typeof parentRow) => ({
      ...row,
      total: 0,
      learning_count: 0,
      mastered_count: 0,
      attempted: 0,
      unattempted: 0,
      latest_correct: 0,
    });
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [parentRow] })
        .mockResolvedValueOnce({ rows: [withStats(parentRow), withStats(defaultChildRow)] }),
    };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { POST } = await import('@/app/api/question-categories/route');

    const response = await POST(new NextRequest('http://localhost/api/question-categories', {
      method: 'POST',
      body: JSON.stringify({
        section: 'reading',
        part: 5,
        parentId: null,
        name: '固定搭配',
        includeInactive: false,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(body.category).toMatchObject({ id: 7, name: '固定搭配' });
    expect(body.categories).toMatchObject([{
      id: 7,
      children: [{ id: 8, name: '未细分' }],
    }]);
  });

  it('creates a second-level category and refreshes the tree in two queries', async () => {
    const childRow = {
      ...defaultChildRow,
      id: 9,
      name: '动词搭配',
      is_default: false,
    };
    const withStats = (row: Record<string, unknown>) => ({
      ...row,
      total: 0,
      learning_count: 0,
      mastered_count: 0,
      attempted: 0,
      unattempted: 0,
      latest_correct: 0,
    });
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [childRow] })
        .mockResolvedValueOnce({ rows: [
          withStats(parentRow),
          withStats(defaultChildRow),
          withStats(childRow),
        ] }),
    };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { POST } = await import('@/app/api/question-categories/route');

    const response = await POST(new NextRequest('http://localhost/api/question-categories', {
      method: 'POST',
      body: JSON.stringify({
        section: 'reading',
        part: 5,
        parentId: 7,
        name: '动词搭配',
        includeInactive: false,
      }),
    }));

    expect(response.status).toBe(201);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[0][0])).toContain('INSERT INTO question_categories');
    expect((await response.json()).categories[0].children).toHaveLength(2);
  });
});
