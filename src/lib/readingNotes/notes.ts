import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelClient } from '@vercel/postgres';
import { sanitizeReadingHtmlServer } from './richContent.server';
import type { ReadingNote, ReadingNoteStatus, ReadingSrsSnapshot } from './types';

type NoteRow = {
  id: number;
  category_id: number;
  category_name: string;
  content_html: string;
  content_text: string;
  notes: string | null;
  note_date: string;
  status: ReadingNoteStatus;
  correct_streak: number;
  correct_count: number;
  wrong_count: number;
  next_review_date: string | null;
  last_reviewed_date: string | null;
  total_count?: number | string;
};

export class ReadingNoteError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'ReadingNoteError';
  }
}

export type ListReadingNotesInput = {
  search?: string;
  categoryId?: number;
  status?: ReadingNoteStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type ReadingNotesPage = {
  items: ReadingNote[];
  total: number;
  page: number;
  pageSize: number;
};

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function clampReadingNoteDate(noteDate: string, today: string) {
  if (!isCalendarDate(noteDate) || !isCalendarDate(today)) {
    throw new ReadingNoteError('日期格式不正确', 'invalid');
  }
  return noteDate > today ? today : noteDate;
}

function sanitizeNoteContent(contentHtml: string) {
  try {
    return sanitizeReadingHtmlServer(contentHtml);
  } catch (error) {
    const message = error instanceof Error ? error.message : '知识点格式不正确';
    throw new ReadingNoteError(message, 'invalid');
  }
}

export function prepareReadingNoteContent(input: {
  contentHtml: string;
  noteDate: string;
  today: string;
}) {
  const content = sanitizeNoteContent(input.contentHtml);
  return {
    contentHtml: content.html,
    contentText: content.text,
    contentHash: content.hash,
    noteDate: clampReadingNoteDate(input.noteDate, input.today),
  };
}

function mapNote(row: NoteRow): ReadingNote {
  return {
    id: Number(row.id),
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    contentHtml: row.content_html,
    contentText: row.content_text,
    notes: row.notes,
    noteDate: row.note_date,
    status: row.status,
    correctStreak: Number(row.correct_streak),
    correctCount: Number(row.correct_count),
    wrongCount: Number(row.wrong_count),
    nextReviewDate: row.next_review_date,
    lastReviewedDate: row.last_reviewed_date,
  };
}

function trimNotes(notes: string | null | undefined) {
  if (notes === null || notes === undefined) return null;
  return notes.trim() || null;
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === '23505';
}

async function requireActiveCategory(client: VercelClient, categoryId: number) {
  const { rows } = await client.query(
    `SELECT id FROM reading_note_categories
     WHERE id = $1 AND status = 'active'`,
    [categoryId],
  );
  if (!rows[0]) throw new ReadingNoteError('分类不存在', 'not_found');
}

async function findReadingNote(client: VercelClient, id: number, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT note.*, category.name AS category_name
     FROM reading_notes note
     JOIN reading_note_categories category ON category.id = note.category_id
     WHERE note.id = $1
     ${forUpdate ? 'FOR UPDATE OF note' : ''}`,
    [id],
  );
  if (!rows[0]) throw new ReadingNoteError('阅读知识点不存在', 'not_found');
  return mapNote(rows[0] as NoteRow);
}

async function transaction<T>(client: VercelClient, operation: () => Promise<T>): Promise<T> {
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

export async function listReadingNotes(
  client: VercelClient,
  input: ListReadingNotesInput = {},
): Promise<ReadingNotesPage> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(page) || page <= 0 || !Number.isInteger(pageSize)
    || pageSize <= 0 || pageSize > 100) {
    throw new ReadingNoteError('分页参数不正确', 'invalid');
  }
  if (input.dateFrom && !isCalendarDate(input.dateFrom)
    || input.dateTo && !isCalendarDate(input.dateTo)) {
    throw new ReadingNoteError('日期格式不正确', 'invalid');
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    throw new ReadingNoteError('日期范围不正确', 'invalid');
  }

  const values: unknown[] = [];
  const where: string[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    where.push(clause.replaceAll('?', `$${values.length}`));
  };
  if (input.search?.trim()) add(`(
    note.content_text ILIKE '%' || ? || '%'
    OR COALESCE(note.notes, '') ILIKE '%' || ? || '%'
  )`, input.search.trim());
  if (input.categoryId !== undefined) add('note.category_id = ?', input.categoryId);
  if (input.status !== undefined) add('note.status = ?', input.status);
  else where.push("note.status <> 'deleted'");
  if (input.dateFrom !== undefined) add('note.note_date >= ?', input.dateFrom);
  if (input.dateTo !== undefined) add('note.note_date <= ?', input.dateTo);
  values.push(pageSize, (page - 1) * pageSize);

  const { rows } = await client.query(
    `SELECT note.*, category.name AS category_name, COUNT(*) OVER()::int AS total_count
     FROM reading_notes note
     JOIN reading_note_categories category ON category.id = note.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY note.note_date DESC, note.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    items: rows.map((row) => mapNote(row as NoteRow)),
    total: rows[0] ? Number((rows[0] as NoteRow).total_count) : 0,
    page,
    pageSize,
  };
}

export async function createReadingNote(
  client: VercelClient,
  input: {
    categoryId: number;
    contentHtml: string;
    notes: string | null;
    noteDate: string;
    today: string;
  },
): Promise<ReadingNote> {
  if (!Number.isInteger(input.categoryId) || input.categoryId <= 0) {
    throw new ReadingNoteError('分类不存在', 'invalid');
  }
  const content = prepareReadingNoteContent(input);
  await requireActiveCategory(client, input.categoryId);
  try {
    const { rows } = await client.query(
      `WITH active_category AS (
         SELECT id FROM reading_note_categories
         WHERE id = $1 AND status = 'active'
         FOR UPDATE
       ), inserted AS (
         INSERT INTO reading_notes
           (category_id, content_html, content_text, content_hash, notes, note_date,
            next_review_date)
         SELECT active_category.id, $2, $3, $4, $5, $6, $7
         FROM active_category
         RETURNING *
       )
       SELECT inserted.*, category.name AS category_name
       FROM inserted
       JOIN reading_note_categories category ON category.id = inserted.category_id`,
      [input.categoryId, content.contentHtml, content.contentText, content.contentHash,
        trimNotes(input.notes), content.noteDate, input.today],
    );
    if (!rows[0]) throw new ReadingNoteError('分类状态已变化，请重试', 'conflict');
    return mapNote(rows[0] as NoteRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingNoteError('该分类中已存在相同知识点', 'conflict');
    }
    throw error;
  }
}

export async function updateReadingNote(
  client: VercelClient,
  id: number,
  input: {
    categoryId?: number;
    contentHtml?: string;
    notes?: string | null;
    noteDate?: string;
  },
): Promise<ReadingNote> {
  const current = await findReadingNote(client, id);
  if (current.status === 'deleted') {
    throw new ReadingNoteError('已删除的知识点不能编辑', 'conflict');
  }
  const categoryId = input.categoryId ?? current.categoryId;
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new ReadingNoteError('分类不存在', 'invalid');
  }
  if (input.noteDate !== undefined && !isCalendarDate(input.noteDate)) {
    throw new ReadingNoteError('日期格式不正确', 'invalid');
  }
  const content = sanitizeNoteContent(input.contentHtml ?? current.contentHtml);
  await requireActiveCategory(client, categoryId);

  try {
    const { rows } = await client.query(
      `WITH active_category AS (
         SELECT id FROM reading_note_categories
         WHERE id = $1 AND status = 'active'
         FOR UPDATE
       ), updated AS (
         UPDATE reading_notes note
         SET category_id = active_category.id,
           content_html = $2, content_text = $3, content_hash = $4,
           notes = $5, note_date = $6, updated_at = now()
         FROM active_category
         WHERE note.id = $7 AND note.status <> 'deleted'
         RETURNING note.*
       )
       SELECT updated.*, category.name AS category_name
       FROM updated
       JOIN reading_note_categories category ON category.id = updated.category_id`,
      [categoryId, content.html, content.text, content.hash,
        input.notes === undefined ? current.notes : trimNotes(input.notes),
        input.noteDate ?? current.noteDate, id],
    );
    if (!rows[0]) throw new ReadingNoteError('知识点状态已变化，请重试', 'conflict');
    return mapNote(rows[0] as NoteRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingNoteError('该分类中已存在相同知识点', 'conflict');
    }
    throw error;
  }
}

export async function setReadingNoteStatus(
  client: VercelClient,
  id: number,
  status: 'active' | 'mastered',
  today: string,
): Promise<ReadingNote> {
  if (!isCalendarDate(today)) throw new ReadingNoteError('日期格式不正确', 'invalid');
  const current = await findReadingNote(client, id);
  if (current.status === 'deleted') {
    throw new ReadingNoteError('请使用撤销操作恢复已删除知识点', 'conflict');
  }
  try {
    const { rows } = await client.query(
      `WITH updated AS (
         UPDATE reading_notes
         SET status = $1,
           next_review_date = CASE WHEN $1 = 'active' THEN $2::date ELSE NULL END,
           updated_at = now()
         WHERE id = $3 AND status <> 'deleted'
         RETURNING *
       )
       SELECT updated.*, category.name AS category_name
       FROM updated
       JOIN reading_note_categories category ON category.id = updated.category_id`,
      [status, today, id],
    );
    if (!rows[0]) throw new ReadingNoteError('知识点状态已变化，请重试', 'conflict');
    return mapNote(rows[0] as NoteRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingNoteError('该分类中已存在相同知识点', 'conflict');
    }
    throw error;
  }
}

function snapshotOf(note: ReadingNote): ReadingSrsSnapshot {
  if (note.status === 'deleted') {
    throw new ReadingNoteError('知识点已删除', 'conflict');
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

export async function softDeleteReadingNote(
  client: VercelClient,
  id: number,
): Promise<{ note: ReadingNote; snapshot: ReadingSrsSnapshot }> {
  return transaction(client, async () => {
    const current = await findReadingNote(client, id, true);
    const snapshot = snapshotOf(current);
    const { rows } = await client.query(
      `WITH updated AS (
         UPDATE reading_notes
         SET status = 'deleted', next_review_date = NULL, updated_at = now()
         WHERE id = $1
         RETURNING *
       )
       SELECT updated.*, category.name AS category_name
       FROM updated
       JOIN reading_note_categories category ON category.id = updated.category_id`,
      [id],
    );
    return { note: mapNote(rows[0] as NoteRow), snapshot };
  });
}

function validateSnapshot(snapshot: ReadingSrsSnapshot) {
  if (!['active', 'mastered'].includes(snapshot.status)
    || !Number.isInteger(snapshot.correctStreak) || snapshot.correctStreak < 0
    || !Number.isInteger(snapshot.correctCount) || snapshot.correctCount < 0
    || !Number.isInteger(snapshot.wrongCount) || snapshot.wrongCount < 0
    || snapshot.nextReviewDate !== null && !isCalendarDate(snapshot.nextReviewDate)
    || snapshot.lastReviewedDate !== null && !isCalendarDate(snapshot.lastReviewedDate)) {
    throw new ReadingNoteError('撤销数据不正确', 'invalid');
  }
}

export async function restoreReadingNoteSnapshot(
  client: VercelClient,
  id: number,
  snapshot: ReadingSrsSnapshot,
): Promise<ReadingNote> {
  validateSnapshot(snapshot);
  try {
    return await transaction(client, async () => {
      const current = await findReadingNote(client, id, true);
      if (current.status !== 'deleted') {
        throw new ReadingNoteError('知识点未处于删除状态', 'conflict');
      }
      const { rows } = await client.query(
        `WITH updated AS (
           UPDATE reading_notes
           SET status = $1, correct_streak = $2, correct_count = $3, wrong_count = $4,
             next_review_date = $5, last_reviewed_date = $6, updated_at = now()
           WHERE id = $7
           RETURNING *
         )
         SELECT updated.*, category.name AS category_name
         FROM updated
         JOIN reading_note_categories category ON category.id = updated.category_id`,
        [snapshot.status, snapshot.correctStreak, snapshot.correctCount, snapshot.wrongCount,
          snapshot.nextReviewDate, snapshot.lastReviewedDate, id],
      );
      return mapNote(rows[0] as NoteRow);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingNoteError('该分类中已存在相同知识点', 'conflict');
    }
    throw error;
  }
}

type UndoTokenPayload = {
  noteId: number;
  snapshot: ReadingSrsSnapshot;
  expiresAt: number;
};

export function signReadingNoteUndoToken(payload: UndoTokenPayload, secret: string) {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyReadingNoteUndoToken(
  token: string,
  secret: string,
  now = Date.now(),
): UndoTokenPayload {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new ReadingNoteError('撤销凭证不正确', 'invalid');
  }
  const expected = createHmac('sha256', secret).update(body).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    throw new ReadingNoteError('撤销凭证不正确', 'invalid');
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ReadingNoteError('撤销凭证不正确', 'invalid');
  }

  let payload: UndoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UndoTokenPayload;
    if (!Number.isInteger(payload.noteId) || payload.noteId <= 0
      || !Number.isFinite(payload.expiresAt)) throw new Error('invalid payload');
    validateSnapshot(payload.snapshot);
  } catch {
    throw new ReadingNoteError('撤销凭证不正确', 'invalid');
  }
  if (payload.expiresAt < now) {
    throw new ReadingNoteError('撤销凭证已过期', 'invalid');
  }
  return payload;
}
