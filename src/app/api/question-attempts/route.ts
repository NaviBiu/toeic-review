import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { SessionError, submitAttempt, type SubmitAttemptInput } from '@/lib/questionReview/sessions';
import type { QuestionOption } from '@/lib/questionReview/types';

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];

function sessionErrorResponse(error: unknown) {
  if (error instanceof SessionError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

function parseInput(body: unknown): SubmitAttemptInput | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (typeof value.requestId !== 'string'
    || !Number.isInteger(value.sessionId) || (value.sessionId as number) <= 0
    || !Number.isInteger(value.questionId) || (value.questionId as number) <= 0
    || !options.includes(value.selectedOption as QuestionOption)
    || (value.durationMs !== null
      && (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0))) {
    return null;
  }
  return {
    requestId: value.requestId,
    sessionId: value.sessionId as number,
    questionId: value.questionId as number,
    selectedOption: value.selectedOption as QuestionOption,
    durationMs: value.durationMs as number | null,
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
    const attempt = await submitAttempt(client, input);
    await client.query('COMMIT');
    transactionOpen = false;
    return NextResponse.json(attempt, { status: 201 });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original submission error if rollback also fails.
      }
    }
    return sessionErrorResponse(error);
  } finally {
    await client.end();
  }
}
