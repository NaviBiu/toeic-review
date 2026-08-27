import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import {
  CategoryError,
  createCategory,
  listCategoryTree,
} from '@/lib/questionReview/categories';

function parseScope(searchParams: URLSearchParams) {
  const section = searchParams.get('section');
  const part = Number(searchParams.get('part'));
  if (section !== 'reading' || ![5, 6, 7].includes(part)) {
    return null;
  }
  const includeInactive = searchParams.get('includeInactive');
  if (includeInactive !== null && includeInactive !== 'true' && includeInactive !== 'false') {
    return null;
  }
  return { section: 'reading' as const, part: part as 5 | 6 | 7, includeInactive: includeInactive === 'true' };
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

export async function GET(req: NextRequest) {
  const scope = parseScope(new URL(req.url).searchParams);
  if (!scope) {
    return NextResponse.json({ error: '分类范围不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listCategoryTree(client, scope));
  } catch (error) {
    return categoryErrorResponse(error);
  } finally {
    await client.end();
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  if (!body || typeof body !== 'object'
    || body.section !== 'reading'
    || ![5, 6, 7].includes(body.part as number)
    || typeof body.name !== 'string'
    || (body.parentId !== undefined && body.parentId !== null
      && (!Number.isInteger(body.parentId) || (body.parentId as number) <= 0))
    || (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder))) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    const category = await createCategory(client, {
      section: body.section,
      part: body.part as 5 | 6 | 7,
      parentId: body.parentId as number | null | undefined,
      name: body.name,
      sortOrder: body.sortOrder as number | undefined,
    });
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return categoryErrorResponse(error);
  } finally {
    await client.end();
  }
}
