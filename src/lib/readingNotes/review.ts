import type { VercelClient } from '@vercel/postgres';
import { applyCorrectAnswer, applyWrongAnswer } from '@/lib/srs';
import {
  isCalendarDate,
  mapReadingNoteRow,
  type ReadingNoteRow,
} from './notes';
import type {
  ReadingDecision,
  ReadingNote,
  ReadingQueuePage,
  ReadingReviewAttempt,
  ReadingSrsSnapshot,
} from './types';

type AttemptRow = {
  id: number;
  request_id: string;
  note_id: number;
  decision: ReadingDecision;
  review_date: string;
  before_state: unknown;
  after_state: unknown;
};

type AttemptWriteRow = AttemptRow & {
  inserted: boolean;
  updated_note_id: number | null;
};

type CorrectionRow = ReadingNoteRow & {
  attempt_id: number;
  request_id: string;
  note_id: number;
  decision: ReadingDecision;
  review_date: string;
  before_state: unknown;
  after_state: unknown;
};

export type ReadingSessionState = {
  queue: number[];
  cursor: number;
  pending: number;
  previous: { attemptId: number; noteId: number; decision: ReadingDecision } | null;
};

export class ReadingReviewError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'ReadingReviewError';
  }
}

export function applyOptimisticDecision(
  state: ReadingSessionState,
  noteId: number,
  decision: ReadingDecision,
): ReadingSessionState {
  const queue = [...state.queue];
  if (decision === 'unknown') queue.push(noteId);
  return {
    ...state,
    queue,
    cursor: state.cursor + 1,
    pending: Math.max(0, state.pending - 1) + (decision === 'unknown' ? 1 : 0),
  };
}

export function applyCorrectedDecision(
  state: ReadingSessionState,
  decision: ReadingDecision,
): ReadingSessionState {
  const previous = state.previous;
  if (!previous || previous.decision === decision) return state;

  const queue = [...state.queue];
  let pending = state.pending;
  if (previous.decision === 'unknown') {
    const repeatIndex = queue.findLastIndex((noteId, index) => (
      index >= state.cursor && noteId === previous.noteId
    ));
    if (repeatIndex >= 0) {
      queue.splice(repeatIndex, 1);
      pending = Math.max(0, pending - 1);
    }
  } else {
    queue.push(previous.noteId);
    pending += 1;
  }

  return {
    ...state,
    queue,
    pending,
    previous: { ...previous, decision },
  };
}

export function rollbackOptimisticDecision(
  _optimistic: ReadingSessionState,
  snapshot: ReadingSessionState,
): ReadingSessionState {
  return snapshot;
}

function asPositiveInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ReadingReviewError(message, 'invalid');
  }
}

function validateToday(today: string) {
  if (!isCalendarDate(today)) throw new ReadingReviewError('日期格式不正确', 'invalid');
}

function validateDecision(decision: ReadingDecision) {
  if (!['known', 'unknown'].includes(decision)) {
    throw new ReadingReviewError('复盘结果不正确', 'invalid');
  }
}

function snapshotFrom(value: unknown): ReadingSrsSnapshot {
  if (!value || typeof value !== 'object') {
    throw new ReadingReviewError('复盘快照不正确', 'conflict');
  }
  const state = value as Record<string, unknown>;
  if (!['active', 'mastered'].includes(state.status as string)
    || !Number.isInteger(state.correctStreak) || (state.correctStreak as number) < 0
    || !Number.isInteger(state.correctCount) || (state.correctCount as number) < 0
    || !Number.isInteger(state.wrongCount) || (state.wrongCount as number) < 0
    || state.nextReviewDate !== null && (typeof state.nextReviewDate !== 'string'
      || !isCalendarDate(state.nextReviewDate))
    || state.lastReviewedDate !== null && (typeof state.lastReviewedDate !== 'string'
      || !isCalendarDate(state.lastReviewedDate))) {
    throw new ReadingReviewError('复盘快照不正确', 'conflict');
  }
  return {
    status: state.status as ReadingSrsSnapshot['status'],
    correctStreak: state.correctStreak as number,
    correctCount: state.correctCount as number,
    wrongCount: state.wrongCount as number,
    nextReviewDate: state.nextReviewDate as string | null,
    lastReviewedDate: state.lastReviewedDate as string | null,
  };
}

function snapshotNote(note: ReadingNote): ReadingSrsSnapshot {
  if (note.status === 'deleted') {
    throw new ReadingReviewError('阅读知识点不存在', 'not_found');
  }
  return {
    status: note.status,
    correctStreak: note.correctStreak,
    correctCount: note.correctCount,
    wrongCount: note.wrongCount,
    nextReviewDate: note.nextReviewDate,
    lastReviewedDate: note.lastReviewedDate,
  };
}

function applyDecision(
  before: ReadingSrsSnapshot,
  decision: ReadingDecision,
  today: string,
): ReadingSrsSnapshot {
  const after = decision === 'known'
    ? applyCorrectAnswer(before, today)
    : applyWrongAnswer(before, today);
  return { ...after, lastReviewedDate: today };
}

function mapAttempt(row: AttemptRow): ReadingReviewAttempt {
  return {
    id: Number(row.id),
    requestId: row.request_id,
    noteId: Number(row.note_id),
    decision: row.decision,
    reviewDate: row.review_date,
    beforeState: snapshotFrom(row.before_state),
    afterState: snapshotFrom(row.after_state),
  };
}

function mapCorrectionAttempt(row: CorrectionRow) {
  return mapAttempt({
    id: row.attempt_id,
    request_id: row.request_id,
    note_id: row.note_id,
    decision: row.decision,
    review_date: row.review_date,
    before_state: row.before_state,
    after_state: row.after_state,
  });
}

function matchesAttemptInput(
  attempt: AttemptRow,
  input: { noteId: number; decision: ReadingDecision },
) {
  return Number(attempt.note_id) === input.noteId
    && attempt.decision === input.decision;
}

async function transaction<T>(client: VercelClient, operation: () => Promise<T>) {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function findLockedNote(client: VercelClient, noteId: number): Promise<ReadingNote> {
  const { rows } = await client.query(
    `SELECT note.*, category.name AS category_name
     FROM reading_notes note
     JOIN reading_note_categories category ON category.id = note.category_id
     WHERE note.id = $1 AND note.status <> 'deleted'
     FOR UPDATE OF note`,
    [noteId],
  );
  if (!rows[0]) throw new ReadingReviewError('阅读知识点不存在', 'not_found');
  return mapReadingNoteRow(rows[0] as ReadingNoteRow);
}

async function findAttemptByRequestId(
  client: VercelClient,
  requestId: string,
): Promise<AttemptRow | undefined> {
  const { rows } = await client.query(
    `SELECT attempt.id, attempt.request_id, attempt.note_id, attempt.decision,
       attempt.review_date, attempt.before_state, attempt.after_state
     FROM reading_note_review_attempts attempt
     WHERE attempt.request_id = $1`,
    [requestId],
  );
  return rows[0] as AttemptRow | undefined;
}

export async function getReadingPendingCount(
  client: VercelClient,
  today: string,
  categoryId?: number,
): Promise<number> {
  validateToday(today);
  if (categoryId !== undefined) asPositiveInteger(categoryId, '分类不存在');
  const values: unknown[] = [today];
  const categoryClause = categoryId === undefined ? '' : 'AND note.category_id = $2';
  if (categoryId !== undefined) values.push(categoryId);
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS pending
     FROM reading_notes note
     WHERE note.status = 'active' AND note.next_review_date <= $1
       ${categoryClause}`,
    values,
  );
  return Number(rows[0]?.pending ?? 0);
}

export async function getReadingQueuePage(
  client: VercelClient,
  today: string,
  input: { categoryId?: number; limit: number },
): Promise<ReadingQueuePage> {
  validateToday(today);
  if (input.categoryId !== undefined) asPositiveInteger(input.categoryId, '分类不存在');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new ReadingReviewError('复盘数量不正确', 'invalid');
  }

  const values: unknown[] = [today];
  const categoryClause = input.categoryId === undefined
    ? ''
    : `AND note.category_id = $${values.push(input.categoryId)}`;
  const limitPlaceholder = `$${values.push(input.limit + 1)}`;
  const { rows } = await client.query(
    `SELECT note.*, category.name AS category_name
     FROM reading_notes note
     JOIN reading_note_categories category ON category.id = note.category_id
     WHERE note.status = 'active' AND note.next_review_date <= $1
       ${categoryClause}
     ORDER BY note.wrong_count DESC, note.next_review_date ASC, note.id ASC
     LIMIT ${limitPlaceholder}`,
    values,
  );
  return {
    items: rows.slice(0, input.limit).map((row) => (
      mapReadingNoteRow(row as ReadingNoteRow)
    )),
    totalPending: await getReadingPendingCount(client, today, input.categoryId),
    hasMore: rows.length > input.limit,
  };
}

export async function recordReadingAttempt(
  client: VercelClient,
  input: {
    requestId: string;
    noteId: number;
    decision: ReadingDecision;
    today: string;
  },
): Promise<{ attempt: ReadingReviewAttempt; note: ReadingNote }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(input.requestId)) {
    throw new ReadingReviewError('请求标识不正确', 'invalid');
  }
  asPositiveInteger(input.noteId, '阅读知识点不存在');
  validateDecision(input.decision);
  validateToday(input.today);

  return transaction(client, async () => {
    const note = await findLockedNote(client, input.noteId);
    const beforeState = snapshotNote(note);
    const afterState = applyDecision(beforeState, input.decision, input.today);
    const { rows } = await client.query(
      `WITH existing AS MATERIALIZED (
         SELECT id, request_id, note_id, decision, review_date, before_state, after_state
         FROM reading_note_review_attempts
         WHERE request_id = $1
       ), inserted AS (
         INSERT INTO reading_note_review_attempts
           (request_id, note_id, decision, review_date, before_state, after_state)
         SELECT $1, $2, $3, $4, $5::jsonb, $6::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT (request_id) DO NOTHING
         RETURNING id, request_id, note_id, decision, review_date, before_state, after_state
       ), updated_note AS (
         UPDATE reading_notes
         SET correct_streak = $7, correct_count = $8, wrong_count = $9,
           status = $10, next_review_date = $11, last_reviewed_date = $12,
           updated_at = now()
         WHERE id = $2 AND EXISTS (SELECT 1 FROM inserted)
         RETURNING id
       ), chosen AS (
         SELECT existing.*, false AS inserted FROM existing
         UNION ALL
         SELECT inserted.*, true AS inserted FROM inserted
       )
       SELECT chosen.*, (SELECT id FROM updated_note) AS updated_note_id
       FROM chosen`,
      [input.requestId, input.noteId, input.decision, input.today,
        JSON.stringify(beforeState), JSON.stringify(afterState), afterState.correctStreak,
        afterState.correctCount, afterState.wrongCount, afterState.status,
        afterState.nextReviewDate, afterState.lastReviewedDate],
    );

    if (!rows[0]) {
      const attemptRow = await findAttemptByRequestId(client, input.requestId);
      if (!attemptRow) throw new ReadingReviewError('复盘请求冲突，请重试', 'conflict');
      if (!matchesAttemptInput(attemptRow, input)) {
        throw new ReadingReviewError('请求标识已用于其他复盘', 'conflict');
      }
      return { attempt: mapAttempt(attemptRow), note };
    }
    const stored = rows[0] as AttemptWriteRow;
    if (!matchesAttemptInput(stored, input)) {
      throw new ReadingReviewError('请求标识已用于其他复盘', 'conflict');
    }
    if (stored.inserted && Number(stored.updated_note_id) !== input.noteId) {
      throw new ReadingReviewError('阅读知识点状态已变化，请重试', 'conflict');
    }
    return {
      attempt: mapAttempt(stored),
      note: stored.inserted ? { ...note, ...afterState } : note,
    };
  });
}

export async function correctReadingAttempt(
  client: VercelClient,
  input: { attemptId: number; decision: ReadingDecision; today: string },
): Promise<{ attempt: ReadingReviewAttempt; note: ReadingNote }> {
  asPositiveInteger(input.attemptId, '复盘记录不存在');
  validateDecision(input.decision);
  validateToday(input.today);

  return transaction(client, async () => {
    const { rows } = await client.query(
      `SELECT attempt.id AS attempt_id, attempt.request_id, attempt.note_id,
         attempt.decision, attempt.review_date, attempt.before_state, attempt.after_state,
         note.*, category.name AS category_name
       FROM reading_note_review_attempts attempt
       JOIN reading_notes note ON note.id = attempt.note_id
       JOIN reading_note_categories category ON category.id = note.category_id
       WHERE attempt.id = $1 AND note.status <> 'deleted'
       FOR UPDATE OF note`,
      [input.attemptId],
    );
    const current = rows[0] as CorrectionRow | undefined;
    if (!current) throw new ReadingReviewError('复盘记录不存在', 'not_found');

    const afterState = applyDecision(snapshotFrom(current.before_state), input.decision, input.today);
    const updated = await client.query(
      `WITH latest AS MATERIALIZED (
         SELECT id
         FROM reading_note_review_attempts
         WHERE note_id = $10
         ORDER BY id DESC
         LIMIT 1
       ), updated_attempt AS (
         UPDATE reading_note_review_attempts
         SET decision = $2, after_state = $3::jsonb,
           corrected_at = now(), updated_at = now()
         WHERE id = $1 AND id = (SELECT id FROM latest)
         RETURNING id, request_id, note_id, decision, review_date, before_state, after_state
       ), updated_note AS (
         UPDATE reading_notes
         SET correct_streak = $4, correct_count = $5, wrong_count = $6,
           status = $7, next_review_date = $8, last_reviewed_date = $9,
           updated_at = now()
         WHERE id = $10 AND status <> 'deleted'
         RETURNING *
       )
       SELECT attempt.id AS attempt_id, attempt.request_id, attempt.note_id,
         attempt.decision, attempt.review_date, attempt.before_state, attempt.after_state,
         note.*, category.name AS category_name
       FROM updated_attempt attempt
       JOIN updated_note note ON note.id = attempt.note_id
       JOIN reading_note_categories category ON category.id = note.category_id`,
      [input.attemptId, input.decision, JSON.stringify(afterState), afterState.correctStreak,
        afterState.correctCount, afterState.wrongCount, afterState.status,
        afterState.nextReviewDate, afterState.lastReviewedDate, current.note_id],
    );
    const result = updated.rows[0] as CorrectionRow | undefined;
    if (!result) {
      throw new ReadingReviewError('只能修改该知识点最近一次复盘结果', 'conflict');
    }
    return {
      attempt: mapCorrectionAttempt(result),
      note: mapReadingNoteRow(result),
    };
  });
}
