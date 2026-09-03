import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import { getReadingQueuePage, ReadingReviewError } from '@/lib/readingNotes/review';

const querySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().optional(),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof ReadingReviewError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 });
  }
  const limit = Math.min(50, Math.max(1, parsed.data.limit ?? 50));

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await getReadingQueuePage(client, todayInShanghai(), {
      categoryId: parsed.data.categoryId,
      limit,
    }));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
