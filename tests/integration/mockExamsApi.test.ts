import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '../../src/lib/db';
import { POST as createRoute, GET as listRoute } from '../../src/app/api/mock-exams/route';
import { NextRequest } from 'next/server';

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM mock_exam_results WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

const VALID = {
  testDate: '2026-06-26',
  part1: { correct: 5, total: 6 }, part2: { correct: 20, total: 25 },
  part3: { correct: 30, total: 39 }, part4: { correct: 25, total: 30 },
  scenarios: [],
};

describe('POST /api/mock-exams', () => {
  it('creates a record and returns 201', async () => {
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const res = await createRoute(req);
    const body = await res.json();
    createdIds.push(body.id);
    expect(res.status).toBe(201);
  });

  it('returns 400 with a friendly message when a total is 0', async () => {
    const bad = { ...VALID, part1: { correct: 0, total: 0 } };
    const req = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(bad) }));
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/mock-exams', () => {
  it('lists created exams', async () => {
    const req1 = new NextRequest(new Request('http://localhost/api/mock-exams', { method: 'POST', body: JSON.stringify(VALID) }));
    const created = await (await createRoute(req1)).json();
    createdIds.push(created.id);
    const res = await listRoute();
    const body = await res.json();
    expect(body.some((r: any) => r.id === created.id)).toBe(true);
  });
});
