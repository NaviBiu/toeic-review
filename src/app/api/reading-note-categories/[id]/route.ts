import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import {
  deleteReadingCategory,
  ReadingCategoryError,
  updateReadingCategory,
} from '@/lib/readingNotes/categories';

const updateSchema = z.object({
  name: z.string().optional(),
  sortOrder: z.number().int().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const deleteSchema = z.object({
  destination: z.union([z.literal('uncategorized'), z.number().int().positive(), z.null()]),
}).strict();

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function parseJson(req: NextRequest) {
  try {
    return await req.json() as unknown;
  } catch {
    return undefined;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof ReadingCategoryError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  if ((error as { code?: string })?.code === '23505') {
    return NextResponse.json({ error: '分类名称已存在' }, { status: 409 });
  }
  throw error;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  const parsed = updateSchema.safeParse(await parseJson(req));
  if (!id || !parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await updateReadingCategory(client, id, parsed.data));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  const parsed = deleteSchema.safeParse(await parseJson(req));
  if (!id || !parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    await deleteReadingCategory(client, id, parsed.data.destination);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
