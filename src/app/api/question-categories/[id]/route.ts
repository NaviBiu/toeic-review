import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import {
  CategoryError,
  deleteEmptyCategory,
  updateCategory,
  type CategoryUpdate,
} from '@/lib/questionReview/categories';

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: '无效的分类 id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const fields: CategoryUpdate = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    fields.name = body.name;
  }
  if (body.parentId !== undefined) {
    if (body.parentId !== null && (!Number.isInteger(body.parentId) || (body.parentId as number) <= 0)) {
      return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    }
    fields.parentId = body.parentId as number | null;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    fields.sortOrder = body.sortOrder as number;
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    }
    fields.status = body.status;
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await updateCategory(client, id, fields));
  } catch (error) {
    return categoryErrorResponse(error);
  } finally {
    await client.end();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: '无效的分类 id' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    await deleteEmptyCategory(client, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return categoryErrorResponse(error);
  } finally {
    await client.end();
  }
}
