import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import { ReadingReviewError, recordReadingAttempt } from '@/lib/readingNotes/review';

const bodySchema = z.object({
  requestId: z.string().uuid(),
  noteId: z.number().int().positive(),
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

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await parseJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await recordReadingAttempt(client, {
      ...parsed.data,
      today: todayInShanghai(),
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
