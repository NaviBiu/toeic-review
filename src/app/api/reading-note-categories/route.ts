import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import {
  createReadingCategory,
  listReadingCategories,
  ReadingCategoryError,
  reorderReadingCategories,
} from '@/lib/readingNotes/categories';

const createSchema = z.object({ name: z.string().trim().min(1) }).strict();
const reorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()),
}).strict();
const listSchema = z.object({
  includeDeleted: z.enum(['true', 'false']).optional(),
}).strict();

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

async function parseJson(req: NextRequest) {
  try {
    return await req.json() as unknown;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const parsed = listSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listReadingCategories(
      client,
      parsed.data.includeDeleted === 'true',
    ));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await parseJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await createReadingCategory(client, parsed.data.name), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}

export async function PATCH(req: NextRequest) {
  const parsed = reorderSchema.safeParse(await parseJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await reorderReadingCategories(client, parsed.data.orderedIds));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
