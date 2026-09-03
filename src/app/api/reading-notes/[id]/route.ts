import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import {
  clampReadingNoteDate,
  isCalendarDate,
  ReadingNoteError,
  restoreReadingNoteSnapshot,
  setReadingNoteStatus,
  signReadingNoteUndoToken,
  softDeleteReadingNote,
  updateReadingNote,
  verifyReadingNoteUndoToken,
} from '@/lib/readingNotes/notes';

const updateSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  contentHtml: z.string().optional(),
  notes: z.string().nullable().optional(),
  noteDate: z.string().refine(isCalendarDate).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const statusSchema = z.object({ status: z.enum(['active', 'mastered']) }).strict();
const restoreSchema = z.object({
  status: z.literal('restore'),
  undoToken: z.string().min(1),
}).strict();

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  const body = await parseJson(req);
  if (!id) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });

  const restore = restoreSchema.safeParse(body);
  let restorePayload: ReturnType<typeof verifyReadingNoteUndoToken> | null = null;
  if (restore.success) {
    try {
      restorePayload = verifyReadingNoteUndoToken(
        restore.data.undoToken,
        process.env.AUTH_SECRET ?? '',
      );
      if (restorePayload.noteId !== id) {
        throw new ReadingNoteError('撤销凭证与知识点不匹配', 'invalid');
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  const status = statusSchema.safeParse(body);
  const update = updateSchema.safeParse(body);
  if (!restorePayload && !status.success && !update.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    if (restorePayload) {
      return NextResponse.json(await restoreReadingNoteSnapshot(
        client,
        id,
        restorePayload.snapshot,
        restorePayload.deletedAt,
      ));
    }
    if (status.success) {
      return NextResponse.json(await setReadingNoteStatus(
        client,
        id,
        status.data.status,
        todayInShanghai(),
      ));
    }
    if (!update.success) {
      return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    }
    const fields = update.data;
    if (fields.noteDate !== undefined) {
      fields.noteDate = clampReadingNoteDate(fields.noteDate, todayInShanghai());
    }
    return NextResponse.json(await updateReadingNote(client, id, fields));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });

  const secret = process.env.AUTH_SECRET ?? '';
  if (!secret) {
    return NextResponse.json({ error: '服务器未配置撤销签名密钥' }, { status: 500 });
  }
  const client = createClient();
  await client.connect();
  try {
    const deleted = await softDeleteReadingNote(client, id);
    const undoToken = signReadingNoteUndoToken({
      noteId: id,
      snapshot: deleted.snapshot,
      deletedAt: deleted.deletedAt,
      expiresAt: Date.now() + 5 * 60 * 1000,
    }, secret);
    return NextResponse.json({ note: deleted.note, undoToken });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await client.end();
  }
}
