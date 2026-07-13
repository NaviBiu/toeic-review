import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '../../src/lib/db';
import { POST as createRoute, GET as listRoute } from '../../src/app/api/mock-exams/route';
import { NextRequest } from 'next/server';

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM practice_sessions WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

const VALID = {
  practiceDate: '2026-06-26',
  type: 'part_drill',
  title: 'Part 3专项',
  parts: [{ part: 3, correct: 18, total: 25 }],
  scenarios: [],
};

describe('POST /api/mock-exams', () => {
  it('creates a practice record and returns 201', async () => {
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const res = await createRoute(req);
    const body = await res.json();
    createdIds.push(body.id);
    expect(res.status).toBe(201);
    expect(body.parts).toEqual([{ part: 3, correct: 18, total: 25 }]);
  });

  it('returns 400 with a friendly message when a total is 0', async () => {
    const bad = { ...VALID, parts: [{ part: 3, correct: 0, total: 0 }] };
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(bad) }));
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/mock-exams', () => {
  it('lists created practice records', async () => {
    const req1 = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const created = await (await createRoute(req1)).json();
    createdIds.push(created.id);
    const res = await listRoute();
    const body = await res.json();
    expect(body.some((r: any) => r.id === created.id)).toBe(true);
  });
});
