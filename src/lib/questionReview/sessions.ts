import type { VercelClient } from '@vercel/postgres';
import { selectQuestionIds, type SelectionCandidate } from './selection';
import type {
  AttemptResult,
  CreateSessionInput,
  QuestionOption,
  QuestionStats,
  SessionQuestion,
} from './types';

type SessionCandidateRow = SelectionCandidate & {
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  source: string | null;
  parent_name: string;
  category_name: string;
  correct_count: number | string;
  wrong_count: number | string;
  latest_duration_ms: number | string | null;
};

type SessionCandidateDbRow = Omit<SessionCandidateRow, 'latestCorrect'> & {
  latest_correct: boolean | null;
};

type SessionScopeRow = {
  id: number;
  section: string;
  part: number;
  parent_id: number | null;
  status: string;
  parent_status: string | null;
  parent_section: string | null;
  parent_part: number | null;
  parent_parent_id: number | null;
};

type AttemptRow = {
  id: number | string;
  is_correct: boolean;
  correct_option: QuestionOption;
  analysis: string;
  notes: string | null;
  duration_ms: number | string | null;
  duration_excluded: boolean;
  question_id: number | string;
};

export type SubmitAttemptInput = {
  requestId: string;
  sessionId: number;
  questionId: number;
  selectedOption: QuestionOption;
  durationMs: number | null;
};

export type UpdateAttemptTimingInput = {
  durationMs: number | null;
  durationExcluded: boolean;
};

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];
const modes = ['weak_first', 'random'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asPositiveInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new SessionError(message, 'invalid');
  return value;
}

function validateDuration(durationMs: number | null): void {
  if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs < 0)) {
    throw new SessionError('用时不正确', 'invalid');
  }
}

function mapStats(row: {
  correct_count: number | string;
  wrong_count: number | string;
  latest_correct: boolean | null;
  latest_duration_ms: number | string | null;
}): QuestionStats {
  return {
    correctCount: Number(row.correct_count),
    wrongCount: Number(row.wrong_count),
    latestCorrect: row.latest_correct === null || row.latest_correct === undefined
      ? null
      : Boolean(row.latest_correct),
    latestDurationMs: row.latest_duration_ms === null || row.latest_duration_ms === undefined
      ? null
      : Number(row.latest_duration_ms),
  };
}

function mapSessionQuestion(row: SessionCandidateRow, position: number): SessionQuestion {
  return {
    id: Number(row.id),
    position,
    stem: row.stem,
    options: {
      A: row.option_a,
      B: row.option_b,
      C: row.option_c,
      D: row.option_d,
    },
    source: row.source,
    categoryPath: [row.parent_name, row.category_name],
    stats: mapStats({ ...row, latest_correct: row.latestCorrect }),
  };
}

async function validateCategoryScope(client: VercelClient, categoryScopeId: number | null): Promise<void> {
  if (categoryScopeId === null) return;
  asPositiveInteger(categoryScopeId, '分类不存在');
  const { rows } = await client.query(
    `SELECT category.*, parent.status AS parent_status,
       parent.section AS parent_section, parent.part AS parent_part,
       parent.parent_id AS parent_parent_id
     FROM question_categories category
     LEFT JOIN question_categories parent ON parent.id = category.parent_id
     WHERE category.id = $1`,
    [categoryScopeId],
  );
  const scope = rows[0] as SessionScopeRow | undefined;
  if (!scope) throw new SessionError('分类不存在', 'not_found');
  if (scope.section !== 'reading' || scope.part !== 5
    || (scope.parent_id !== null && scope.parent_parent_id !== null)
    || (scope.parent_id !== null && (scope.parent_section !== 'reading' || scope.parent_part !== 5))) {
    throw new SessionError('分类范围不一致', 'conflict');
  }
  if (scope.status !== 'active' || (scope.parent_id !== null && scope.parent_status !== 'active')) {
    throw new SessionError('分类已停用', 'conflict');
  }
}

async function loadCandidates(
  client: VercelClient,
  input: CreateSessionInput,
): Promise<SessionCandidateRow[]> {
  const statuses = input.includeMastered ? ['learning', 'mastered'] : ['learning'];
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
     SELECT question.id, question.stem, question.option_a, question.option_b,
       question.option_c, question.option_d, question.source,
       parent.name AS parent_name, category.name AS category_name,
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
     WHERE question.section = 'reading'
       AND question.part = 5
       AND question.status = ANY($2::text[])
       AND category.status = 'active'
       AND parent.status = 'active'
       AND ($1::int IS NULL OR question.category_id = $1 OR category.parent_id = $1)
     ORDER BY question.id`,
    [input.categoryScopeId, statuses],
  );
  return (rows as SessionCandidateDbRow[]).map((row) => ({
    ...row,
    id: Number(row.id),
    latestCorrect: row.latest_correct === null || row.latest_correct === undefined
      ? null
      : Boolean(row.latest_correct),
  }));
}

export async function createReviewSession(
  client: VercelClient,
  input: CreateSessionInput,
): Promise<{ id: number; plannedCount: number; actualCount: number; questions: SessionQuestion[] }> {
  if (!modes.includes(input.mode)) throw new SessionError('训练模式不正确', 'invalid');
  if (typeof input.includeMastered !== 'boolean') throw new SessionError('包含已掌握设置不正确', 'invalid');
  if (input.categoryScopeId !== null && !Number.isInteger(input.categoryScopeId)) {
    throw new SessionError('分类不存在', 'invalid');
  }
  const plannedCount = Math.min(100, Math.max(1, asPositiveInteger(input.plannedCount, '计划题数不正确')));
  await validateCategoryScope(client, input.categoryScopeId);
  const candidates = await loadCandidates(client, input);
  const selectedIds = selectQuestionIds(candidates, plannedCount, input.mode);
  const byId = new Map(candidates.map((candidate) => [Number(candidate.id), candidate]));

  const { rows } = await client.query(
    `INSERT INTO question_review_sessions
       (section, part, mode, category_scope_id, include_mastered, planned_count)
     VALUES ('reading', 5, $1, $2, $3, $4)
     RETURNING id`,
    [input.mode, input.categoryScopeId, input.includeMastered, plannedCount],
  );
  const sessionId = Number(rows[0].id);
  for (const [index, questionId] of selectedIds.entries()) {
    await client.query(
      `INSERT INTO question_review_session_items (session_id, question_id, position)
       VALUES ($1, $2, $3)`,
      [sessionId, questionId, index + 1],
    );
  }

  return {
    id: sessionId,
    plannedCount,
    actualCount: selectedIds.length,
    questions: selectedIds.map((questionId, index) => mapSessionQuestion(byId.get(questionId)!, index + 1)),
  };
}

async function findSessionQuestion(
  client: VercelClient,
  sessionId: number,
  questionId: number,
): Promise<{ correctOption: QuestionOption; analysis: string; notes: string | null }> {
  const { rows } = await client.query(
    `SELECT question.correct_option, question.analysis, question.notes
     FROM question_review_session_items item
     JOIN review_questions question ON question.id = item.question_id
     WHERE item.session_id = $1 AND item.question_id = $2`,
    [sessionId, questionId],
  );
  const question = rows[0] as {
    correct_option: QuestionOption;
    analysis: string;
    notes: string | null;
  } | undefined;
  if (!question) throw new SessionError('题目不属于本次训练', 'conflict');
  return { correctOption: question.correct_option, analysis: question.analysis, notes: question.notes };
}

async function findAttempt(client: VercelClient, attemptId: number): Promise<AttemptRow> {
  const { rows } = await client.query(
    `SELECT attempt.id, attempt.is_correct, attempt.duration_ms, attempt.duration_excluded,
       attempt.question_id, question.correct_option, question.analysis, question.notes
     FROM question_attempts attempt
     JOIN review_questions question ON question.id = attempt.question_id
     WHERE attempt.id = $1`,
    [attemptId],
  );
  const attempt = rows[0] as AttemptRow | undefined;
  if (!attempt) throw new SessionError('作答记录不存在', 'not_found');
  return attempt;
}

async function findAttemptByRequestId(client: VercelClient, requestId: string): Promise<AttemptRow> {
  const { rows } = await client.query(
    `SELECT attempt.id, attempt.is_correct, attempt.duration_ms, attempt.duration_excluded,
       attempt.question_id, question.correct_option, question.analysis, question.notes
     FROM question_attempts attempt
     JOIN review_questions question ON question.id = attempt.question_id
     WHERE attempt.request_id = $1`,
    [requestId],
  );
  const attempt = rows[0] as AttemptRow | undefined;
  if (!attempt) throw new SessionError('作答记录不存在', 'not_found');
  return attempt;
}

async function findStats(client: VercelClient, questionId: number): Promise<QuestionStats> {
  const { rows } = await client.query(
    `WITH attempt_stats AS (
       SELECT COUNT(*) FILTER (WHERE is_correct = true)::int AS correct_count,
         COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong_count
       FROM question_attempts
       WHERE question_id = $1
     ), latest_attempt AS (
       SELECT is_correct AS latest_correct
       FROM question_attempts
       WHERE question_id = $1
       ORDER BY attempted_at DESC, id DESC
       LIMIT 1
     ), latest_duration AS (
       SELECT duration_ms AS latest_duration_ms
       FROM question_attempts
       WHERE question_id = $1 AND duration_excluded = false AND duration_ms IS NOT NULL
       ORDER BY attempted_at DESC, id DESC
       LIMIT 1
     )
     SELECT attempt_stats.correct_count, attempt_stats.wrong_count,
       latest_attempt.latest_correct, latest_duration.latest_duration_ms
     FROM attempt_stats
     LEFT JOIN latest_attempt ON true
     LEFT JOIN latest_duration ON true`,
    [questionId],
  );
  return mapStats(rows[0]);
}

async function toAttemptResult(client: VercelClient, attempt: AttemptRow): Promise<AttemptResult> {
  return {
    attemptId: Number(attempt.id),
    isCorrect: Boolean(attempt.is_correct),
    correctOption: attempt.correct_option,
    analysis: attempt.analysis,
    notes: attempt.notes,
    durationMs: attempt.duration_ms === null ? null : Number(attempt.duration_ms),
    durationExcluded: Boolean(attempt.duration_excluded),
    stats: await findStats(client, Number(attempt.question_id)),
  };
}

export async function submitAttempt(client: VercelClient, input: SubmitAttemptInput): Promise<AttemptResult> {
  if (!uuidPattern.test(input.requestId)) throw new SessionError('请求标识不正确', 'invalid');
  asPositiveInteger(input.sessionId, '训练会话不存在');
  asPositiveInteger(input.questionId, '题目不存在');
  if (!options.includes(input.selectedOption)) throw new SessionError('答案不正确', 'invalid');
  validateDuration(input.durationMs);

  const question = await findSessionQuestion(client, input.sessionId, input.questionId);
  await client.query(
    `INSERT INTO question_attempts
       (request_id, session_id, question_id, selected_option, is_correct, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (request_id) DO NOTHING`,
    [input.requestId, input.sessionId, input.questionId, input.selectedOption,
      input.selectedOption === question.correctOption, input.durationMs],
  );
  return toAttemptResult(client, await findAttemptByRequestId(client, input.requestId));
}

export async function updateAttemptTiming(
  client: VercelClient,
  attemptId: number,
  input: UpdateAttemptTimingInput,
): Promise<AttemptResult> {
  asPositiveInteger(attemptId, '作答记录不存在');
  validateDuration(input.durationMs);
  if (typeof input.durationExcluded !== 'boolean') throw new SessionError('用时设置不正确', 'invalid');
  const { rows } = await client.query(
    `UPDATE question_attempts
     SET duration_ms = $2, duration_excluded = $3
     WHERE id = $1
     RETURNING id`,
    [attemptId, input.durationMs, input.durationExcluded],
  );
  if (!rows[0]) throw new SessionError('作答记录不存在', 'not_found');
  return toAttemptResult(client, await findAttempt(client, attemptId));
}
