import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import {
  mergeReadingCategory,
  ReadingCategoryError,
} from '@/lib/readingNotes/categories';

const mergeSchema = z.object({ targetCategoryId: z.number().int().positive() }).strict();

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorResponse(error: unknown) {
  if (error instanceof ReadingCategoryError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sourceId = parseId((await params).id);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  const parsed = mergeSchema.safeParse(body);
  if (!sourceId || !parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    await mergeReadingCategory(client, sourceId, parsed.data.targetCategoryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
