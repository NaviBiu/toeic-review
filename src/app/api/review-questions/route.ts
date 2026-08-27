import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import {
  createQuestion,
  listQuestions,
  QuestionError,
  type ListQuestionsInput,
  type ReviewQuestionInput,
} from '@/lib/questionReview/questions';
import type { QuestionOption, QuestionStatus } from '@/lib/questionReview/types';

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];
const statuses: QuestionStatus[] = ['learning', 'mastered', 'inactive', 'deleted'];

function questionErrorResponse(error: unknown) {
  if (error instanceof QuestionError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

function isQuestionInput(body: unknown): body is ReviewQuestionInput {
  if (!body || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  const questionOptions = value.options;
  return typeof value.stem === 'string'
    && questionOptions !== null
    && typeof questionOptions === 'object'
    && options.every((option) => typeof (questionOptions as Record<string, unknown>)[option] === 'string')
    && options.includes(value.correctOption as QuestionOption)
    && typeof value.analysis === 'string'
    && Number.isInteger(value.categoryId)
    && (value.notes === undefined || value.notes === null || typeof value.notes === 'string')
    && (value.source === undefined || value.source === null || typeof value.source === 'string')
    && (value.status === undefined || statuses.includes(value.status as QuestionStatus))
    && (value.confirmDuplicate === undefined || typeof value.confirmDuplicate === 'boolean');
}

function parsePositiveInteger(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseListInput(searchParams: URLSearchParams): ListQuestionsInput | null {
  const categoryId = parsePositiveInteger(searchParams.get('categoryId'));
  const page = parsePositiveInteger(searchParams.get('page'));
  const pageSize = parsePositiveInteger(searchParams.get('pageSize'));
  const status = searchParams.get('status');
  const sort = searchParams.get('sort');
  if (categoryId === null || page === null || pageSize === null
    || (status !== null && !statuses.includes(status as QuestionStatus))
    || (sort !== null && !['updated_desc', 'created_desc', 'accuracy_asc', 'unattempted_first'].includes(sort))) {
    return null;
  }
  return {
    search: searchParams.get('search') ?? undefined,
    categoryId,
    status: status as QuestionStatus | null ?? undefined,
    sort: sort as ListQuestionsInput['sort'] | null ?? undefined,
    page,
    pageSize,
  };
}

export async function GET(req: NextRequest) {
  const filters = parseListInput(new URL(req.url).searchParams);
  if (!filters) return NextResponse.json({ error: '请求参数不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listQuestions(client, filters));
  } catch (error) {
    return questionErrorResponse(error);
  } finally {
    await client.end();
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  if (!isQuestionInput(body)) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await createQuestion(client, body);
    if (result.duplicate) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return NextResponse.json({ error: '检测到相同题干', duplicateId: result.duplicateId }, { status: 409 });
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return NextResponse.json(result.question, { status: 201 });
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
