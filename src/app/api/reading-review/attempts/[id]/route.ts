import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import { correctReadingAttempt, ReadingReviewError } from '@/lib/readingNotes/review';

const bodySchema = z.object({
  decision: z.enum(['known', 'unknown']),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof ReadingReviewError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

async function parseJson(req: NextRequest) {
  try {
    return await req.json() as unknown;
  } catch {
    return undefined;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const attemptId = Number((await params).id);
  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    return NextResponse.json({ error: '无效的复盘记录 id' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await parseJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await correctReadingAttempt(client, {
      attemptId,
      decision: parsed.data.decision,
      today: todayInShanghai(),
    }));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
