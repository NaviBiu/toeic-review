import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import {
  QuestionError,
  softDeleteQuestion,
  updateQuestion,
  type ReviewQuestionUpdate,
} from '@/lib/questionReview/questions';
import type { QuestionOption, QuestionStatus } from '@/lib/questionReview/types';

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];
const statuses: QuestionStatus[] = ['learning', 'mastered', 'inactive', 'deleted'];

function parseId(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function questionErrorResponse(error: unknown) {
  if (error instanceof QuestionError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

function parseUpdate(body: unknown): ReviewQuestionUpdate | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const fields: ReviewQuestionUpdate = {};
  if (value.stem !== undefined) {
    if (typeof value.stem !== 'string') return null;
    fields.stem = value.stem;
  }
  if (value.options !== undefined) {
    if (!value.options || typeof value.options !== 'object'
      || !options.every((option) => typeof (value.options as Record<string, unknown>)[option] === 'string')) {
      return null;
    }
    fields.options = value.options as Record<QuestionOption, string>;
  }
  if (value.correctOption !== undefined) {
    if (!options.includes(value.correctOption as QuestionOption)) return null;
    fields.correctOption = value.correctOption as QuestionOption;
  }
  if (value.analysis !== undefined) {
    if (typeof value.analysis !== 'string') return null;
    fields.analysis = value.analysis;
  }
  if (value.notes !== undefined) {
    if (value.notes !== null && typeof value.notes !== 'string') return null;
    fields.notes = value.notes as string | null;
  }
  if (value.source !== undefined) {
    if (value.source !== null && typeof value.source !== 'string') return null;
    fields.source = value.source as string | null;
  }
  if (value.categoryId !== undefined) {
    if (!Number.isInteger(value.categoryId) || (value.categoryId as number) <= 0) return null;
    fields.categoryId = value.categoryId as number;
  }
  if (value.status !== undefined) {
    if (!statuses.includes(value.status as QuestionStatus)) return null;
    fields.status = value.status as QuestionStatus;
  }
  if (value.confirmDuplicate !== undefined) {
    if (typeof value.confirmDuplicate !== 'boolean') return null;
    fields.confirmDuplicate = value.confirmDuplicate;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '无效的题目 id' }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const fields = parseUpdate(body);
  if (!fields) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  const needsTransaction = fields.stem !== undefined;
  let transactionOpen = false;
  try {
    if (needsTransaction) {
      await client.query('BEGIN');
      transactionOpen = true;
    }
    const result = await updateQuestion(client, id, fields);
    if (result.duplicate) {
      if (transactionOpen) {
        await client.query('ROLLBACK');
        transactionOpen = false;
      }
      return NextResponse.json({ error: '检测到相同题干', duplicateId: result.duplicateId }, { status: 409 });
    }
    if (transactionOpen) {
      await client.query('COMMIT');
      transactionOpen = false;
    }
    return NextResponse.json(result.question);
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original mutation error if rollback also fails.
      }
    }
    return questionErrorResponse(error);
  } finally {
    await client.end();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '无效的题目 id' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await softDeleteQuestion(client, id));
  } catch (error) {
    return questionErrorResponse(error);
  } finally {
    await client.end();
  }
}
