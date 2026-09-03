import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelClient } from '@vercel/postgres';
import { clampReadingNoteDate, isCalendarDate } from './notes';
import { normalizeReadingCategoryName } from './categories';
import { sanitizeReadingHtmlServer } from './richContent.server';
import type {
  ReadingImportCandidate,
  ReadingImportPreview,
} from './types';

const PREVIEW_TTL_MS = 30 * 60 * 1000;

type PreviewTokenPayload = {
  candidates: ReadingImportCandidate[];
  expiresAt: number;
};

export class ReadingImportError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'conflict') {
    super(message);
    this.name = 'ReadingImportError';
  }
}

function signPayload(payload: PreviewTokenPayload, secret: string) {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyReadingImportToken(
  token: string,
  secret: string,
  now = Date.now(),
): PreviewTokenPayload {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new ReadingImportError('导入预览凭证不正确，请重新上传', 'invalid');
  }
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ReadingImportError('导入预览凭证不正确，请重新上传', 'invalid');
  }
  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PreviewTokenPayload;
    if (!Array.isArray(payload.candidates) || !Number.isFinite(payload.expiresAt)) {
      throw new Error('invalid payload');
    }
  } catch {
    throw new ReadingImportError('导入预览凭证不正确，请重新上传', 'invalid');
  }
  if (payload.expiresAt < now) {
    throw new ReadingImportError('导入预览已过期，请重新上传', 'invalid');
  }
  return payload;
}

function sanitizeCandidate(candidate: ReadingImportCandidate): ReadingImportCandidate {
  const category = normalizeReadingCategoryName(candidate.categoryName);
  const content = sanitizeReadingHtmlServer(candidate.contentHtml);
  if (!isCalendarDate(candidate.noteDate)) {
    throw new ReadingImportError('阅读笔记日期格式不正确', 'invalid');
  }
  return {
    ...candidate,
    categoryName: category.name,
    contentHtml: content.html,
    contentText: content.text,
    notes: candidate.notes?.trim() || null,
  };
}

function identity(normalizedCategory: string, hash: string) {
  return `${normalizedCategory}\u0000${hash}`;
}

export async function buildReadingImportPreview(
  client: VercelClient,
  rawCandidates: ReadingImportCandidate[],
  secret: string,
  now = Date.now(),
): Promise<ReadingImportPreview> {
  const candidates = rawCandidates.map(sanitizeCandidate);
  const [{ rows: categoryRows }, { rows: duplicateRows }] = await Promise.all([
    client.query(
      `SELECT id, name, normalized_name
       FROM reading_note_categories
       WHERE status = 'active'
       ORDER BY sort_order, id`,
    ),
    client.query(
      `SELECT category.normalized_name, note.content_hash
       FROM reading_notes note
       JOIN reading_note_categories category ON category.id = note.category_id
       WHERE note.status <> 'deleted' AND category.status = 'active'`,
    ),
  ]);
  const categoryNames = new Map<string, string>(categoryRows.map((row) => (
    [String(row.normalized_name), String(row.name)]
  )));
  const existingIdentities = new Set(duplicateRows.map((row) => (
    identity(String(row.normalized_name), String(row.content_hash))
  )));
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const candidate of candidates) {
    const normalizedCategory = normalizeReadingCategoryName(candidate.categoryName).normalizedName;
    const hash = sanitizeReadingHtmlServer(candidate.contentHtml).hash;
    const key = identity(normalizedCategory, hash);
    if (existingIdentities.has(key) || seen.has(key)) duplicates.add(candidate.sourceIndex);
    else seen.add(key);
  }

  const existingCategories: string[] = [];
  const proposedCategories: string[] = [];
  const seenExisting = new Set<string>();
  const seenProposed = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeReadingCategoryName(candidate.categoryName).normalizedName;
    const existingName = categoryNames.get(normalized);
    if (existingName && !seenExisting.has(normalized)) {
      seenExisting.add(normalized);
      existingCategories.push(existingName);
    } else if (!existingName && !seenProposed.has(normalized)) {
      seenProposed.add(normalized);
      proposedCategories.push(candidate.categoryName);
    }
  }

  const recognized = candidates.filter((candidate) => (
    candidate.confidence === 'high' && !duplicates.has(candidate.sourceIndex)
  ));
  const unrecognized = candidates.filter((candidate) => candidate.confidence === 'low');
  return {
    token: signPayload({ candidates, expiresAt: now + PREVIEW_TTL_MS }, secret),
    recognizedCount: recognized.length,
    duplicateCount: duplicates.size,
    unrecognizedCount: unrecognized.length,
    existingCategories,
    proposedCategories,
    candidates: recognized,
    exceptions: unrecognized.slice(0, 5),
    aiFallbackAvailable: unrecognized.length > 0,
  };
}

type PreparedCandidate = ReadingImportCandidate & {
  normalizedCategory: string;
  contentHash: string;
  noteDate: string;
};

export async function confirmReadingImport(
  client: VercelClient,
  input: {
    candidates: ReadingImportCandidate[];
    acceptedSourceIndexes: number[];
    today: string;
  },
): Promise<{ requested: number; inserted: number; duplicates: number; categoriesCreated: number }> {
  if (!isCalendarDate(input.today)) {
    throw new ReadingImportError('导入日期格式不正确', 'invalid');
  }
  const accepted = new Set(input.acceptedSourceIndexes);
  if (accepted.size !== input.acceptedSourceIndexes.length
    || input.acceptedSourceIndexes.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new ReadingImportError('请选择有效的导入条目', 'invalid');
  }
  const selected = input.candidates
    .filter((candidate) => accepted.has(candidate.sourceIndex))
    .map(sanitizeCandidate)
    .map((candidate): PreparedCandidate => {
      const category = normalizeReadingCategoryName(candidate.categoryName);
      return {
        ...candidate,
        normalizedCategory: category.normalizedName,
        contentHash: sanitizeReadingHtmlServer(candidate.contentHtml).hash,
        noteDate: clampReadingNoteDate(candidate.noteDate, input.today),
      };
    });
  if (selected.length !== accepted.size) {
    throw new ReadingImportError('导入条目与预览不一致，请重新上传', 'invalid');
  }

  await client.query('BEGIN');
  try {
    const { rows: lockedRows } = await client.query(
      `SELECT id, name, normalized_name
       FROM reading_note_categories
       WHERE status = 'active'
       ORDER BY id
       FOR UPDATE`,
    );
    const existingNames = new Set(lockedRows.map((row) => String(row.normalized_name)));
    const missing = Array.from(new Map(selected
      .filter((candidate) => !existingNames.has(candidate.normalizedCategory))
      .map((candidate) => [candidate.normalizedCategory, candidate.categoryName])).entries())
      .map(([normalizedName, name], position) => ({ normalizedName, name, position }));

    let categoriesCreated = 0;
    if (missing.length > 0) {
      const { rows } = await client.query(
        `WITH input AS (
           SELECT name, normalized_name, position
           FROM jsonb_to_recordset($1::jsonb)
             AS item(name text, normalized_name text, position int)
         ), base AS (
           SELECT COALESCE(MAX(sort_order) + 1, 0) AS first_order
           FROM reading_note_categories WHERE status = 'active'
         )
         INSERT INTO reading_note_categories (name, normalized_name, sort_order)
         SELECT input.name, input.normalized_name, base.first_order + input.position
         FROM input CROSS JOIN base
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [JSON.stringify(missing.map((item) => ({
          name: item.name,
          normalized_name: item.normalizedName,
          position: item.position,
        })))],
      );
      categoriesCreated = rows.length;
    }

    const { rows: categoryRows } = await client.query(
      `SELECT id, normalized_name
       FROM reading_note_categories
       WHERE status = 'active'`,
    );
    const categoryIds = new Map(categoryRows.map((row) => (
      [String(row.normalized_name), Number(row.id)]
    )));
    if (selected.some((candidate) => !categoryIds.has(candidate.normalizedCategory))) {
      throw new ReadingImportError('分类创建失败，请重试', 'conflict');
    }

    const { rows: duplicateRows } = await client.query(
      `SELECT category_id, content_hash
       FROM reading_notes
       WHERE status <> 'deleted'`,
    );
    const identities = new Set(duplicateRows.map((row) => (
      identity(String(row.category_id), String(row.content_hash))
    )));
    const insertable: Array<PreparedCandidate & { categoryId: number }> = [];
    let duplicates = 0;
    for (const candidate of selected) {
      const categoryId = categoryIds.get(candidate.normalizedCategory) as number;
      const key = identity(String(categoryId), candidate.contentHash);
      if (identities.has(key)) {
        duplicates += 1;
        continue;
      }
      identities.add(key);
      insertable.push({ ...candidate, categoryId });
    }

    let inserted = 0;
    if (insertable.length > 0) {
      const { rows } = await client.query(
        `INSERT INTO reading_notes
           (category_id, content_html, content_text, content_hash, notes, note_date,
            next_review_date)
         SELECT category_id, content_html, content_text, content_hash, notes,
           note_date::date, $2::date
         FROM jsonb_to_recordset($1::jsonb) AS item(
           category_id int, content_html text, content_text text, content_hash text,
           notes text, note_date text
         )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [JSON.stringify(insertable.map((candidate) => ({
          category_id: candidate.categoryId,
          content_html: candidate.contentHtml,
          content_text: candidate.contentText,
          content_hash: candidate.contentHash,
          notes: candidate.notes,
          note_date: candidate.noteDate,
        }))), input.today],
      );
      inserted = rows.length;
      duplicates += insertable.length - inserted;
    }
    await client.query('COMMIT');
    return { requested: selected.length, inserted, duplicates, categoriesCreated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
