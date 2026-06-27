import { config } from 'dotenv';
config({ path: '.env.local' });
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '../../src/lib/db';
import { POST as createRoute, GET as listRoute } from '../../src/app/api/knowledge-points/route';
import { PATCH as patchRoute } from '../../src/app/api/knowledge-points/[id]/route';
import { NextRequest } from 'next/server';

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

let createdIds: number[] = [];

afterEach(async () => {
  if (createdIds.length) {
    await sql.query(`DELETE FROM knowledge_points WHERE id = ANY($1)`, [createdIds]);
    createdIds = [];
  }
});

describe('POST /api/knowledge-points (manual add)', () => {
  it('creates a record with required fields and defaults scenario to 未分类/未分类 when omitted', async () => {
    const req = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({ term: 'gantry', meaning: '', example: '', part: 1, dateAdded: '2026-06-26' }),
    });
    const res = await createRoute(req);
    const body = await res.json();
    createdIds.push(body.id);
    expect(res.status).toBe(201);
    expect(body.scenarioMajor).toBe('未分类');
  });

  it('rejects an unrecognized scenario pair instead of silently sanitizing user-supplied input', async () => {
    const req = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({
        term: 'x', meaning: 'm', example: 'e', part: 1, dateAdded: '2026-06-26',
        scenarioMajor: '股票', scenarioMinor: '投资',
      }),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/knowledge-points/:id', () => {
  it('soft-deletes via {status: "deleted"} and restores via {status: "active"}', async () => {
    const createReq = makeRequest('http://localhost/api/knowledge-points', {
      method: 'POST',
      body: JSON.stringify({ term: 'pier', meaning: 'm', example: 'e', part: 1, dateAdded: '2026-06-26' }),
    });
    const created = await (await createRoute(createReq)).json();
    createdIds.push(created.id);

    const delReq = makeRequest(`http://localhost/api/knowledge-points/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'deleted' }),
    });
    const delRes = await patchRoute(delReq, { params: Promise.resolve({ id: String(created.id) }) });
    expect((await delRes.json()).status).toBe('deleted');

    const restoreReq = makeRequest(`http://localhost/api/knowledge-points/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    const restoreRes = await patchRoute(restoreReq, { params: Promise.resolve({ id: String(created.id) }) });
    const restored = await restoreRes.json();
    expect(restored.status).toBe('active');
    expect(restored.correctStreak).toBe(0);
  });
});
