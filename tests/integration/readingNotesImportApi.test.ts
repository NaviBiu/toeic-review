import type { VercelClient } from '@vercel/postgres';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/db';
import { buildReadingImportPreview } from '@/lib/readingNotes/importConfirm';
import type { ReadingImportCandidate } from '@/lib/readingNotes/types';

async function withImportClient(fn: (client: VercelClient) => Promise<void>) {
  const client = createClient();
  await client.connect();
  await client.query('BEGIN');
  try {
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

function asRouteClient(client: VercelClient) {
  let sequence = 0;
  const savepoints: string[] = [];
  return {
    connect: vi.fn(),
    end: vi.fn(),
    query: async (text: string, values?: unknown[]) => {
      if (text === 'BEGIN') {
        const name = `reading_import_route_${++sequence}`;
        savepoints.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (text === 'COMMIT') {
        const name = savepoints.pop();
        if (!name) throw new Error('Missing route savepoint');
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      if (text === 'ROLLBACK') {
        const name = savepoints.pop();
        if (!name) throw new Error('Missing route savepoint');
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(text, values);
    },
  };
}

function candidate(categoryName: string): ReadingImportCandidate {
  return {
    sourceIndex: 0,
    categoryName,
    contentHtml: '<p>API import content</p>',
    contentText: 'api import content',
    notes: null,
    noteDate: '2026-09-03',
    confidence: 'high',
    issue: null,
  };
}

afterEach(() => {
  vi.doUnmock('@/lib/db');
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('reading import API', () => {
  it('rejects non-docx files before opening a database connection', async () => {
    const createClientMock = vi.fn();
    vi.doMock('@/lib/db', () => ({ createClient: createClientMock }));
    const route = await import('@/app/api/reading-notes/import/route');
    const form = new FormData();
    form.append('file', new File(['not a Word file'], 'notes.pdf'));

    const response = await route.POST(new NextRequest(
      'http://localhost/api/reading-notes/import', { method: 'POST', body: form },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '阅读笔记批量导入仅支持 Word(.docx) 文件' });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('confirms a signed preview through one route transaction', async () => {
    await withImportClient(async (client) => {
      const secret = 'reading-import-api-secret';
      const categoryName = `API ${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
      const preview = await buildReadingImportPreview(client, [candidate(categoryName)], secret);
      const routeClient = asRouteClient(client);
      vi.stubEnv('AUTH_SECRET', secret);
      vi.doMock('@/lib/db', () => ({ createClient: () => routeClient }));
      const route = await import('@/app/api/reading-notes/import/confirm/route');

      const response = await route.POST(new NextRequest(
        'http://localhost/api/reading-notes/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: preview.token, acceptedSourceIndexes: [0] }),
        },
      ));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ requested: 1, inserted: 1, duplicates: 0, categoriesCreated: 1 });
      expect(body.message).toBe('本次确认导入 1 条，新增成功 1 条，新增分类 1 个，跳过重复 0 条。');
      expect(routeClient.connect).toHaveBeenCalledOnce();
      expect(routeClient.end).toHaveBeenCalledOnce();
    });
  }, 60_000);
});
