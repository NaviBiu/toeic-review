import type { VercelClient } from '@vercel/postgres';
import type {
  QuestionListItem,
  QuestionOption,
  QuestionStatus,
  ReviewQuestion,
} from './types';

const questionOptions: QuestionOption[] = ['A', 'B', 'C', 'D'];
const questionStatuses: QuestionStatus[] = ['learning', 'mastered', 'inactive', 'deleted'];

type QuestionRow = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  question_format: 'single_choice';
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: QuestionOption;
  analysis: string;
  notes: string | null;
  source: string | null;
  category_id: number;
  status: QuestionStatus;
};

type CategoryRow = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  parent_id: number | null;
  status: 'active' | 'inactive';
  parent_status: 'active' | 'inactive' | null;
  parent_section: 'reading' | null;
  parent_part: 5 | 6 | 7 | null;
  parent_parent_id: number | null;
};

export class QuestionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'QuestionError';
  }
}

export type ReviewQuestionInput = {
  stem: string;
  options: Record<QuestionOption, string>;
  correctOption: QuestionOption;
  analysis: string;
  notes?: string | null;
  source?: string | null;
  categoryId: number;
  status?: QuestionStatus;
  confirmDuplicate?: boolean;
};

export type ReviewQuestionUpdate = Partial<ReviewQuestionInput>;

export type ListQuestionsInput = {
  search?: string;
  categoryId?: number;
  status?: QuestionStatus;
  sort?: 'updated_desc' | 'created_desc' | 'accuracy_asc' | 'unattempted_first';
  page?: number;
  pageSize?: number;
};

export type QuestionSaveResult =
  | { duplicate: true; duplicateId: number }
  | { duplicate: false; question: ReviewQuestion };

function mapQuestion(row: QuestionRow): ReviewQuestion {
  return {
    id: row.id,
    section: row.section,
    part: row.part,
    questionFormat: row.question_format,
    stem: row.stem,
    options: {
      A: row.option_a,
      B: row.option_b,
      C: row.option_c,
      D: row.option_d,
    },
    correctOption: row.correct_option,
    analysis: row.analysis,
    notes: row.notes,
    source: row.source,
    categoryId: row.category_id,
    status: row.status,
  };
}

function validateStatus(status: unknown): QuestionStatus {
  if (!questionStatuses.includes(status as QuestionStatus)) {
    throw new QuestionError('题目状态不正确', 'invalid');
  }
  return status as QuestionStatus;
}

function trimOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() || null;
}

function validateInput(input: ReviewQuestionInput): Required<Omit<ReviewQuestionInput, 'confirmDuplicate'>> {
  const stem = input.stem.trim();
  if (!stem) throw new QuestionError('题干不能为空', 'invalid');
  const analysis = input.analysis.trim();
  if (!analysis) throw new QuestionError('考点分析不能为空', 'invalid');

  const options = {} as Record<QuestionOption, string>;
  for (const option of questionOptions) {
    const value = input.options?.[option];
    if (typeof value !== 'string' || !value.trim()) {
      throw new QuestionError('A/B/C/D 选项不能为空', 'invalid');
    }
    options[option] = value.trim();
  }
  if (!questionOptions.includes(input.correctOption)) {
    throw new QuestionError('正确答案不正确', 'invalid');
  }
  if (!Number.isInteger(input.categoryId) || input.categoryId <= 0) {
    throw new QuestionError('分类不存在', 'invalid');
  }

  return {
    stem,
    options,
    correctOption: input.correctOption,
    analysis,
    notes: trimOptional(input.notes),
    source: trimOptional(input.source),
    categoryId: input.categoryId,
    status: input.status === undefined ? 'learning' : validateStatus(input.status),
  };
}

async function validateCategory(client: VercelClient, categoryId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT category.*, parent.status AS parent_status,
       parent.section AS parent_section, parent.part AS parent_part,
       parent.parent_id AS parent_parent_id
     FROM question_categories category
     LEFT JOIN question_categories parent ON parent.id = category.parent_id
     WHERE category.id = $1`,
    [categoryId],
  );
  const category = rows[0] as CategoryRow | undefined;
  if (!category) throw new QuestionError('分类不存在', 'not_found');
  if (category.parent_id === null) throw new QuestionError('题目必须归属二级分类', 'conflict');
  if (category.section !== 'reading' || category.part !== 5) {
    throw new QuestionError('分类范围不一致', 'conflict');
  }
  if (category.parent_parent_id !== null) {
    throw new QuestionError('题目必须归属二级分类', 'conflict');
  }
  if (category.parent_section !== category.section || category.parent_part !== category.part) {
    throw new QuestionError('分类范围不一致', 'conflict');
  }
  if (category.status !== 'active' || category.parent_status !== 'active') {
    throw new QuestionError('分类已停用', 'conflict');
  }
}

async function lockDuplicateStem(client: VercelClient, stem: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtext(lower(regexp_replace(trim($1), '\\s+', ' ', 'g')))
     )`,
    [stem],
  );
}

async function findDuplicate(
  client: VercelClient,
  stem: string,
  exceptId?: number,
): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT id FROM review_questions
     WHERE lower(regexp_replace(trim(stem), '\\s+', ' ', 'g'))
         = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
       AND ($2::int IS NULL OR id <> $2)
     ORDER BY id
     LIMIT 1`,
    [stem, exceptId ?? null],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function findQuestion(client: VercelClient, id: number): Promise<ReviewQuestion> {
  const { rows } = await client.query('SELECT * FROM review_questions WHERE id = $1', [id]);
  if (!rows[0]) throw new QuestionError('题目不存在', 'not_found');
  return mapQuestion(rows[0] as QuestionRow);
}

export async function createQuestion(
  client: VercelClient,
  input: ReviewQuestionInput,
): Promise<QuestionSaveResult> {
  const values = validateInput(input);
  await validateCategory(client, values.categoryId);
  await lockDuplicateStem(client, values.stem);
  const duplicateId = await findDuplicate(client, values.stem);
  if (duplicateId !== null && !input.confirmDuplicate) {
    return { duplicate: true, duplicateId };
  }

  const { rows } = await client.query(
    `INSERT INTO review_questions
       (section, part, question_format, stem, option_a, option_b, option_c, option_d,
        correct_option, analysis, notes, source, category_id, status)
     VALUES
       ('reading', 5, 'single_choice', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      values.stem,
      values.options.A,
      values.options.B,
      values.options.C,
      values.options.D,
      values.correctOption,
      values.analysis,
      values.notes,
      values.source,
      values.categoryId,
      values.status,
    ],
  );
  return { duplicate: false, question: mapQuestion(rows[0] as QuestionRow) };
}

export async function updateQuestion(
  client: VercelClient,
  id: number,
  fields: ReviewQuestionUpdate,
): Promise<QuestionSaveResult> {
  const current = await findQuestion(client, id);
  const changedInput = fields.stem !== undefined
    || fields.options !== undefined
    || fields.correctOption !== undefined
    || fields.analysis !== undefined
    || fields.notes !== undefined
    || fields.source !== undefined
    || fields.categoryId !== undefined;
  const values = changedInput
    ? validateInput({
      stem: fields.stem ?? current.stem,
      options: fields.options ?? current.options,
      correctOption: fields.correctOption ?? current.correctOption,
      analysis: fields.analysis ?? current.analysis,
      notes: fields.notes === undefined ? current.notes : fields.notes,
      source: fields.source === undefined ? current.source : fields.source,
      categoryId: fields.categoryId ?? current.categoryId,
      status: fields.status ?? current.status,
    })
    : null;
  const status = fields.status === undefined ? current.status : validateStatus(fields.status);

  await validateCategory(client, values?.categoryId ?? current.categoryId);
  if (fields.stem !== undefined) {
    const duplicateId = await findDuplicate(client, values!.stem, id);
    if (duplicateId !== null && !fields.confirmDuplicate) {
      return { duplicate: true, duplicateId };
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (values) {
    if (fields.stem !== undefined) add('stem', values.stem);
    if (fields.options !== undefined) {
      add('option_a', values.options.A);
      add('option_b', values.options.B);
      add('option_c', values.options.C);
      add('option_d', values.options.D);
    }
    if (fields.correctOption !== undefined) add('correct_option', values.correctOption);
    if (fields.analysis !== undefined) add('analysis', values.analysis);
    if (fields.notes !== undefined) add('notes', values.notes);
    if (fields.source !== undefined) add('source', values.source);
    if (fields.categoryId !== undefined) add('category_id', values.categoryId);
  }
  if (fields.status !== undefined) add('status', status);
  if (sets.length === 0) return { duplicate: false, question: current };

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await client.query(
    `UPDATE review_questions
     SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING *`,
    params,
  );
  return { duplicate: false, question: mapQuestion(rows[0] as QuestionRow) };
}

export async function softDeleteQuestion(
  client: VercelClient,
  id: number,
): Promise<{ id: number; status: 'deleted' }> {
  const { rows } = await client.query(
    `UPDATE review_questions
     SET status = 'deleted', updated_at = now()
     WHERE id = $1
     RETURNING id, status`,
    [id],
  );
  if (!rows[0]) throw new QuestionError('题目不存在', 'not_found');
  return { id: Number(rows[0].id), status: 'deleted' };
}

function normalizeListInput(input: ListQuestionsInput) {
  const page = Number.isInteger(input.page) && input.page! > 0 ? input.page! : 1;
  const pageSize = Number.isInteger(input.pageSize) && input.pageSize! > 0
    ? Math.min(input.pageSize!, 100)
    : 20;
  const sort = input.sort ?? 'updated_desc';
  const sortSql = {
    updated_desc: 'question.updated_at DESC, question.id DESC',
    created_desc: 'question.created_at DESC, question.id DESC',
    accuracy_asc: `
      (attempt_stats.correct_count::float
        / NULLIF(attempt_stats.correct_count + attempt_stats.wrong_count, 0)) ASC NULLS FIRST,
      question.updated_at DESC, question.id DESC`,
    unattempted_first: `
      CASE WHEN latest_attempt.is_correct IS NULL THEN 0 ELSE 1 END,
      question.updated_at DESC, question.id DESC`,
  }[sort];
  if (!sortSql) throw new QuestionError('排序方式不正确', 'invalid');
  if (input.status !== undefined) validateStatus(input.status);
  if (input.categoryId !== undefined && (!Number.isInteger(input.categoryId) || input.categoryId <= 0)) {
    throw new QuestionError('分类不存在', 'invalid');
  }
  return { page, pageSize, sortSql, search: input.search?.trim() || null };
}

export async function listQuestions(
  client: VercelClient,
  input: ListQuestionsInput = {},
): Promise<{ items: QuestionListItem[]; total: number; page: number; pageSize: number }> {
  const normalized = normalizeListInput(input);
  const where = ["question.section = 'reading'", 'question.part = 5'];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (input.status) {
    where.push(`question.status = ${add(input.status)}`);
  } else {
    where.push("question.status <> 'deleted'");
  }
  if (normalized.search) where.push(`question.stem ILIKE '%' || ${add(normalized.search)} || '%'`);
  if (input.categoryId) {
    const category = add(input.categoryId);
    where.push(`(question.category_id = ${category} OR category.parent_id = ${category})`);
  }
  const whereSql = where.join('\n       AND ');

  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM review_questions question
     JOIN question_categories category ON category.id = question.category_id
     WHERE ${whereSql}`,
    params,
  );
  const pageParam = params.length + 1;
  const pageSizeParam = params.length + 2;
  const { rows } = await client.query(
    `WITH attempt_stats AS (
       SELECT question_id,
         COUNT(*) FILTER (WHERE is_correct = true)::int AS correct_count,
         COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong_count
       FROM question_attempts
       GROUP BY question_id
     ), latest_attempt AS (
       SELECT DISTINCT ON (question_id) question_id, is_correct
       FROM question_attempts
       ORDER BY question_id, attempted_at DESC, id DESC
     ), latest_duration AS (
       SELECT DISTINCT ON (question_id) question_id, duration_ms
       FROM question_attempts
       WHERE duration_excluded = false AND duration_ms IS NOT NULL
       ORDER BY question_id, attempted_at DESC, id DESC
     )
     SELECT question.*, parent.name AS parent_name, category.name AS category_name,
       COALESCE(attempt_stats.correct_count, 0)::int AS correct_count,
       COALESCE(attempt_stats.wrong_count, 0)::int AS wrong_count,
       latest_attempt.is_correct AS latest_correct,
       latest_duration.duration_ms AS latest_duration_ms
     FROM review_questions question
     JOIN question_categories category ON category.id = question.category_id
     JOIN question_categories parent ON parent.id = category.parent_id
     LEFT JOIN attempt_stats ON attempt_stats.question_id = question.id
     LEFT JOIN latest_attempt ON latest_attempt.question_id = question.id
     LEFT JOIN latest_duration ON latest_duration.question_id = question.id
     WHERE ${whereSql}
     ORDER BY ${normalized.sortSql}
     LIMIT $${pageSizeParam} OFFSET $${pageParam}`,
    [...params, normalized.pageSize, (normalized.page - 1) * normalized.pageSize],
  );

  const items = rows.map((row) => ({
    ...mapQuestion(row as QuestionRow),
    categoryPath: [row.parent_name, row.category_name] as [string, string],
    stats: {
      correctCount: Number(row.correct_count),
      wrongCount: Number(row.wrong_count),
      latestCorrect: row.latest_correct === null || row.latest_correct === undefined
        ? null
        : Boolean(row.latest_correct),
      latestDurationMs: row.latest_duration_ms === null || row.latest_duration_ms === undefined
        ? null
        : Number(row.latest_duration_ms),
    },
  }));
  return {
    items,
    total: Number(countRows[0]?.total ?? 0),
    page: normalized.page,
    pageSize: normalized.pageSize,
  };
}
