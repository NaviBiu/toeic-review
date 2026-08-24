import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import {
  SessionError,
  updateAttemptTiming,
  type UpdateAttemptTimingInput,
} from '@/lib/questionReview/sessions';

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sessionErrorResponse(error: unknown) {
  if (error instanceof SessionError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

function parseInput(body: unknown): UpdateAttemptTimingInput | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if ((value.durationMs !== null
      && (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0))
    || typeof value.durationExcluded !== 'boolean') {
    return null;
  }
  return {
    durationMs: value.durationMs as number | null,
    durationExcluded: value.durationExcluded,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '无效的作答记录 id' }, { status: 400 });

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
  try {
    return NextResponse.json(await updateAttemptTiming(client, id, input));
  } catch (error) {
    return sessionErrorResponse(error);
  } finally {
    await client.end();
  }
}
