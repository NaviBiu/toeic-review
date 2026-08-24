import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { createReviewSession, SessionError } from '@/lib/questionReview/sessions';
import type { CreateSessionInput, TrainingMode } from '@/lib/questionReview/types';

function sessionErrorResponse(error: unknown) {
  if (error instanceof SessionError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

function parseInput(body: unknown): CreateSessionInput | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const includeMastered = value.includeMastered === undefined ? false : value.includeMastered;
  if (!['weak_first', 'random'].includes(value.mode as TrainingMode)
    || (value.categoryScopeId !== null
      && (!Number.isInteger(value.categoryScopeId) || (value.categoryScopeId as number) <= 0))
    || typeof includeMastered !== 'boolean'
    || !Number.isInteger(value.plannedCount)) {
    return null;
  }
  return {
    mode: value.mode as TrainingMode,
    categoryScopeId: value.categoryScopeId as number | null,
    includeMastered,
    plannedCount: Math.min(100, Math.max(1, value.plannedCount as number)),
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const input = parseInput(body);
  if (!input) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const session = await createReviewSession(client, input);
    await client.query('COMMIT');
    transactionOpen = false;
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original creation error if rollback also fails.
      }
    }
    return sessionErrorResponse(error);
  } finally {
    await client.end();
  }
}
