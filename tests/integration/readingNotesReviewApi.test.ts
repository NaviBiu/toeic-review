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
          const name = `reading_review_api_${++sequence}`;
          savepoints.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading review API savepoint');
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading review API savepoint');
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
  const [categoryRoute, noteRoute, countRoute, queueRoute, attemptRoute, attemptIdRoute] =
    await Promise.all([
      import('@/app/api/reading-note-categories/route'),
      import('@/app/api/reading-notes/route'),
      import('@/app/api/reading-review/count/route'),
      import('@/app/api/reading-review/queue/route'),
      import('@/app/api/reading-review/attempts/route'),
      import('@/app/api/reading-review/attempts/[id]/route'),
    ]);
  return { categoryRoute, noteRoute, countRoute, queueRoute, attemptRoute, attemptIdRoute };
}

afterEach(() => {
  vi.doUnmock('@/lib/db');
  vi.resetModules();
});

describe('reading review API', () => {
  it('rejects malformed UUIDs and decisions before opening a connection', async () => {
    const createClient = vi.fn();
    vi.doMock('@/lib/db', () => ({ createClient }));
    const attemptRoute = await import('@/app/api/reading-review/attempts/route');

    const response = await attemptRoute.POST(new NextRequest(
      'http://localhost/api/reading-review/attempts',
      {
        method: 'POST',
        body: JSON.stringify({ requestId: 'not-a-uuid', noteId: 7, decision: 'maybe' }),
      },
    ));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('clamps queue limits and exposes count, attempt, and correction contracts', async () => {
    await withTestClient(async (client) => {
      const routes = await loadRoutes(client);
      const categoryResponse = await routes.categoryRoute.POST(new NextRequest(
        'http://localhost/api/reading-note-categories',
        { method: 'POST', body: JSON.stringify({ name: `Review API ${Date.now()}` }) },
      ));
      const category = await categoryResponse.json();
      const noteResponse = await routes.noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        {
          method: 'POST',
          body: JSON.stringify({
            categoryId: category.id,
            contentHtml: '<p>Review API note</p>',
            notes: null,
            noteDate: '2026-09-03',
          }),
        },
      ));
      const note = await noteResponse.json();

      const count = await routes.countRoute.GET(new NextRequest(
        `http://localhost/api/reading-review/count?categoryId=${category.id}`,
      ));
      const queue = await routes.queueRoute.GET(new NextRequest(
        `http://localhost/api/reading-review/queue?categoryId=${category.id}&limit=500`,
      ));
      const created = await routes.attemptRoute.POST(new NextRequest(
        'http://localhost/api/reading-review/attempts',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: 'ba76be42-8ba9-4319-b142-b363f829b606',
            noteId: note.id,
            decision: 'unknown',
          }),
        },
      ));
      const createdBody = await created.json();
      const corrected = await routes.attemptIdRoute.PATCH(new NextRequest(
        `http://localhost/api/reading-review/attempts/${createdBody.attempt.id}`,
        { method: 'PATCH', body: JSON.stringify({ decision: 'known' }) },
      ), { params: Promise.resolve({ id: String(createdBody.attempt.id) }) });

      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ count: 1 });
      expect(queue.status).toBe(200);
      expect((await queue.json()).items).toHaveLength(1);
      expect(created.status).toBe(201);
      expect(corrected.status).toBe(200);
      expect(await corrected.json()).toMatchObject({
        attempt: { id: createdBody.attempt.id, decision: 'known' },
        note: { correctCount: 1, wrongCount: 0 },
      });
    });
  }, 60_000);

  it('returns 404 for a deleted note and 409 for a stale correction', async () => {
    await withTestClient(async (client) => {
      const routes = await loadRoutes(client);
      const categoryResponse = await routes.categoryRoute.POST(new NextRequest(
        'http://localhost/api/reading-note-categories',
        { method: 'POST', body: JSON.stringify({ name: `Review errors ${Date.now()}` }) },
      ));
      const category = await categoryResponse.json();
      const noteResponse = await routes.noteRoute.POST(new NextRequest(
        'http://localhost/api/reading-notes',
        {
          method: 'POST',
          body: JSON.stringify({
            categoryId: category.id,
            contentHtml: '<p>Review API error note</p>',
            notes: null,
            noteDate: '2026-09-03',
          }),
        },
      ));
      const note = await noteResponse.json();
      const createAttempt = async (requestId: string) => {
        const response = await routes.attemptRoute.POST(new NextRequest(
          'http://localhost/api/reading-review/attempts',
          {
            method: 'POST',
            body: JSON.stringify({ requestId, noteId: note.id, decision: 'unknown' }),
          },
        ));
        return { response, body: await response.json() };
      };
      const first = await createAttempt('0b50d47b-a470-45e3-9122-98aa128066e5');
      await createAttempt('aa216990-cafd-493e-bb86-77cdcc8a1400');
      const stale = await routes.attemptIdRoute.PATCH(new NextRequest(
        `http://localhost/api/reading-review/attempts/${first.body.attempt.id}`,
        { method: 'PATCH', body: JSON.stringify({ decision: 'known' }) },
      ), { params: Promise.resolve({ id: String(first.body.attempt.id) }) });

      await client.query(
        "UPDATE reading_notes SET status = 'deleted', next_review_date = NULL WHERE id = $1",
        [note.id],
      );
      const deleted = await routes.attemptRoute.POST(new NextRequest(
        'http://localhost/api/reading-review/attempts',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: '93b95c6e-6695-4e55-a4e2-e5729abcf38f',
            noteId: note.id,
            decision: 'known',
          }),
        },
      ));

      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ error: '只能修改该知识点最近一次复盘结果' });
      expect(deleted.status).toBe(404);
    });
  }, 60_000);
});
