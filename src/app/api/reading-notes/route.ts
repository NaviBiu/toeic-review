import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import {
  createReadingNote,
  isCalendarDate,
  listReadingNotes,
  ReadingNoteError,
} from '@/lib/readingNotes/notes';

const optionalDate = z.string().refine(isCalendarDate).optional();
const listSchema = z.object({
  search: z.string().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'mastered', 'deleted']).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
}).strict();

const createSchema = z.object({
  categoryId: z.number().int().positive(),
  contentHtml: z.string(),
  notes: z.string().nullable().optional(),
  noteDate: z.string().refine(isCalendarDate),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof ReadingNoteError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  if ((error as { code?: string })?.code === '23505') {
    return NextResponse.json({ error: '该分类中已存在相同知识点' }, { status: 409 });
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
  if (!parsed.success || parsed.data.dateFrom && parsed.data.dateTo
    && parsed.data.dateFrom > parsed.data.dateTo) {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listReadingNotes(client, parsed.data));
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
    return NextResponse.json(await createReadingNote(client, {
      ...parsed.data,
      notes: parsed.data.notes ?? null,
      today: todayInShanghai(),
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
