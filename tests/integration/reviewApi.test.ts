import { describe, it, expect, afterEach } from 'vitest';
import { sql } from '../../src/lib/db';
import { GET as queueRoute } from '../../src/app/api/review/queue/route';
import { POST as answerRoute } from '../../src/app/api/review/[id]/answer/route';
import { NextRequest } from 'next/server';

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM knowledge_points WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

async function seed(dateAdded = '2026-06-01') {
  const { rows } = await sql.query(
    `INSERT INTO knowledge_points (term, meaning, example, part, scenario_major, scenario_minor, date_added, next_review_date)
     VALUES ($1, 'm', 'e', 1, '未分类', '未分类', $2, $2) RETURNING *`,
    ['term-' + Math.random(), dateAdded]
  );
  createdIds.push(rows[0].id);
  return rows[0];
}

describe('GET /api/review/queue', () => {
  it('returns rows due today or earlier', async () => {
    const kp = await seed('2026-06-01');
    const req = new NextRequest(new Request('http://localhost/api/review/queue'));
    const res = await queueRoute(req);
    const body = await res.json();
    expect(body.some((r: any) => r.id === kp.id)).toBe(true);
  });
});

describe('POST /api/review/:id/answer', () => {
  it('applies a correct answer and advances correctStreak', async () => {
    const kp = await seed();
    const req = new NextRequest(new Request(`http://localhost/api/review/${kp.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ correct: true }),
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: String(kp.id) }) });
    const body = await res.json();
    expect(body.correctStreak).toBe(1);
  });

  it('applies a wrong answer and resets correctStreak', async () => {
    const kp = await seed();
    const req = new NextRequest(new Request(`http://localhost/api/review/${kp.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ correct: false }),
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: String(kp.id) }) });
    const body = await res.json();
    expect(body.correctStreak).toBe(0);
    expect(body.wrongCount).toBe(1);
  });

  it('returns 400 for a non-numeric id instead of crashing', async () => {
    const req = new NextRequest(new Request('http://localhost/api/review/abc/answer', {
      method: 'POST',
      body: JSON.stringify({ correct: true }),
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed JSON body instead of crashing', async () => {
    const kp = await seed();
    const req = new NextRequest(new Request(`http://localhost/api/review/${kp.id}/answer`, {
      method: 'POST',
      body: 'not json',
    }));
    const res = await answerRoute(req, { params: Promise.resolve({ id: String(kp.id) }) });
    expect(res.status).toBe(400);
  });
});
