import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTestClient } from './setup';

type TestClient = Parameters<Parameters<typeof withTestClient>[0]>[0];

function asRouteClient(client: TestClient) {
  let sequence = 0;
  const savepoints: string[] = [];
  const transactionalClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return async (text: string, values?: unknown[]) => {
        if (text === 'BEGIN') {
          const name = `reading_api_operation_${++sequence}`;
          savepoints.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading API operation savepoint');
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading API operation savepoint');
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        return client.query(text, values);
      };
    },
  });

  return new Proxy(transactionalClient, {
    get(target, property, receiver) {
      if (property === 'connect' || property === 'end') return async () => undefined;
      return Reflect.get(target, property, receiver);
    },
  });
}

async function loadRoutes(client: TestClient) {
  const routeClient = asRouteClient(client);
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ createClient: () => routeClient }));
  const [categoryRoute, noteRoute, noteIdRoute] = await Promise.all([
    import('@/app/api/reading-note-categories/route'),
    import('@/app/api/reading-notes/route'),
    import('@/app/api/reading-notes/[id]/route'),
  ]);
  return { categoryRoute, noteRoute, noteIdRoute };
}

afterEach(() => {
  vi.doUnmock('@/lib/db');
  vi.resetModules();
  vi.unstubAllEnvs();
});

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
  });

  it('rejects a tampered delete undo token', async () => {
    vi.stubEnv('AUTH_SECRET', 'reading-notes-api-test-secret');
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
  });
});

describe('reading note API with PostgreSQL', () => {
  it('creates categories and notes and lists the persisted note', async () => {
    await withTestClient(async (client) => {
      const { categoryRoute, noteRoute } = await loadRoutes(client);
      const categoryResponse = await categoryRoute.POST(new NextRequest(
        'http://localhost/api/reading-note-categories',
        {
          method: 'POST',
          body: JSON.stringify({ name: `API success ${Date.now()}` }),
        },
      ));
      const category = await categoryResponse.json();
      const noteResponse = await noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        {
          method: 'POST',
          body: JSON.stringify({
            categoryId: category.id,
            contentHtml: '<p>API persisted note</p>',
            notes: 'route success',
            noteDate: '2026-09-03',
          }),
        },
      ));
      const note = await noteResponse.json();
      const listResponse = await noteRoute.GET(new NextRequest(
        `http://localhost/api/reading-notes?categoryId=${category.id}&status=active`,
      ));
      const list = await listResponse.json();

      expect(categoryResponse.status).toBe(201);
      expect(noteResponse.status).toBe(201);
      expect(listResponse.status).toBe(200);
      expect(list).toMatchObject({
        total: 1,
        items: [{ id: note.id, categoryId: category.id }],
      });
    });
  }, 60_000);

  it('returns 404 for a missing note and 409 for scoped duplicate content', async () => {
    await withTestClient(async (client) => {
      const { categoryRoute, noteRoute, noteIdRoute } = await loadRoutes(client);
      const missing = await noteIdRoute.PATCH(new NextRequest(
        'http://localhost/api/reading-notes/2147483647',
        { method: 'PATCH', body: JSON.stringify({ status: 'mastered' }) },
      ), { params: Promise.resolve({ id: '2147483647' }) });

      const categoryResponse = await categoryRoute.POST(new NextRequest(
        'http://localhost/api/reading-note-categories',
        {
          method: 'POST',
          body: JSON.stringify({ name: `API conflict ${Date.now()}` }),
        },
      ));
      const category = await categoryResponse.json();
      const createBody = {
        categoryId: category.id,
        contentHtml: '<p>Same API content</p>',
        notes: null,
        noteDate: '2026-09-03',
      };
      const first = await noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        { method: 'POST', body: JSON.stringify(createBody) },
      ));
      const duplicate = await noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        {
          method: 'POST',
          body: JSON.stringify({ ...createBody, contentHtml: '<p>same api content</p>' }),
        },
      ));

      expect(missing.status).toBe(404);
      expect(first.status).toBe(201);
      expect(duplicate.status).toBe(409);
    });
  }, 60_000);

  it('rejects a stale token after a second delete without overwriting state', async () => {
    await withTestClient(async (client) => {
      vi.stubEnv('AUTH_SECRET', 'reading-notes-api-cycle-secret');
      const { categoryRoute, noteRoute, noteIdRoute } = await loadRoutes(client);
      const categoryResponse = await categoryRoute.POST(new NextRequest(
        'http://localhost/api/reading-note-categories',
        {
          method: 'POST',
          body: JSON.stringify({ name: `API cycle ${Date.now()}` }),
        },
      ));
      const category = await categoryResponse.json();
      const createResponse = await noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        {
          method: 'POST',
          body: JSON.stringify({
            categoryId: category.id,
            contentHtml: '<p>Deletion cycle note</p>',
            notes: null,
            noteDate: '2026-09-03',
          }),
        },
      ));
      const note = await createResponse.json();
      const routeContext = { params: Promise.resolve({ id: String(note.id) }) };

      const firstDelete = await noteIdRoute.DELETE(new NextRequest(
        `http://localhost/api/reading-notes/${note.id}`, { method: 'DELETE' },
      ), routeContext);
      const firstToken = (await firstDelete.json()).undoToken as string;
      const firstRestore = await noteIdRoute.PATCH(new NextRequest(
        `http://localhost/api/reading-notes/${note.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'restore', undoToken: firstToken }) },
      ), routeContext);
      await noteIdRoute.PATCH(new NextRequest(
        `http://localhost/api/reading-notes/${note.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'mastered' }) },
      ), routeContext);
      const secondDelete = await noteIdRoute.DELETE(new NextRequest(
        `http://localhost/api/reading-notes/${note.id}`, { method: 'DELETE' },
      ), routeContext);
      const secondDeletedNote = (await secondDelete.json()).note;
      const staleRestore = await noteIdRoute.PATCH(new NextRequest(
        `http://localhost/api/reading-notes/${note.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'restore', undoToken: firstToken }) },
      ), routeContext);
      const { rows } = await client.query(
        `SELECT status, correct_streak, correct_count, wrong_count,
           next_review_date, last_reviewed_date
         FROM reading_notes WHERE id = $1`,
        [note.id],
      );

      expect(firstRestore.status).toBe(200);
      expect(staleRestore.status).toBe(409);
      expect(rows[0]).toEqual({
        status: 'deleted',
        correct_streak: secondDeletedNote.correctStreak,
        correct_count: secondDeletedNote.correctCount,
        wrong_count: secondDeletedNote.wrongCount,
        next_review_date: null,
        last_reviewed_date: secondDeletedNote.lastReviewedDate,
      });
    });
  }, 60_000);
});
