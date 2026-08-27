import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { CategoryError, mergeCategory } from '@/lib/questionReview/categories';

function parseId(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function categoryErrorResponse(error: unknown) {
  if (error instanceof CategoryError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  if ((error as { code?: string })?.code === '23505') {
    return NextResponse.json({ error: '分类名称已存在' }, { status: 409 });
  }
  throw error;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sourceId = parseId((await params).id);
  if (!sourceId) {
    return NextResponse.json({ error: '无效的分类 id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !Number.isInteger(body.targetId) || (body.targetId as number) <= 0) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const mergedInto = await mergeCategory(client, sourceId, body.targetId as number);
    await client.query('COMMIT');
    inTransaction = false;
    return NextResponse.json(mergedInto);
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    return categoryErrorResponse(error);
  } finally {
    await client.end();
  }
}
