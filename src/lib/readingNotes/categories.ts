import type { VercelClient } from '@vercel/postgres';
import type { ReadingNoteCategory } from './types';

type CategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  is_default: boolean;
  status: 'active' | 'deleted';
  note_count: number | string;
};

export class ReadingCategoryError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'ReadingCategoryError';
  }
}

export function normalizeReadingCategoryName(value: string) {
  const name = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) {
    throw new ReadingCategoryError('分类名称不能为空', 'invalid');
  }
  return { name, normalizedName: name.toLocaleLowerCase('en-US') };
}

export type CategoryDeletionPlan =
  | { kind: 'delete' }
  | { kind: 'move_to_uncategorized' }
  | { kind: 'merge'; targetCategoryId: number };

export function planCategoryDeletion(
  category: Pick<ReadingNoteCategory, 'isDefault' | 'noteCount'>,
  destination: 'uncategorized' | number | null,
): CategoryDeletionPlan {
  if (category.isDefault) {
    throw new ReadingCategoryError('未分类不能删除', 'conflict');
  }
  if (category.noteCount === 0) return { kind: 'delete' };
  if (destination === 'uncategorized') return { kind: 'move_to_uncategorized' };
  if (typeof destination === 'number') return { kind: 'merge', targetCategoryId: destination };
  throw new ReadingCategoryError('请选择合并分类或移到未分类', 'conflict');
}

function mapCategory(row: CategoryRow): ReadingNoteCategory {
  return {
    id: Number(row.id),
    name: row.name,
    sortOrder: Number(row.sort_order),
    isDefault: row.is_default,
    status: row.status,
    noteCount: Number(row.note_count),
  };
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === '23505';
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

export async function listReadingCategories(
  client: VercelClient,
  includeDeleted = false,
): Promise<ReadingNoteCategory[]> {
  const { rows } = await client.query(
    `SELECT category.id, category.name, category.sort_order, category.is_default,
       category.status,
       COUNT(note.id) FILTER (WHERE note.status <> 'deleted')::int AS note_count
     FROM reading_note_categories category
     LEFT JOIN reading_notes note ON note.category_id = category.id
     WHERE ($1::boolean OR category.status = 'active')
     GROUP BY category.id
     ORDER BY category.sort_order, category.id`,
    [includeDeleted],
  );
  return rows.map((row) => mapCategory(row as CategoryRow));
}

export async function createReadingCategory(
  client: VercelClient,
  value: string,
): Promise<ReadingNoteCategory> {
  const { name, normalizedName } = normalizeReadingCategoryName(value);
  try {
    const { rows } = await client.query(
      `INSERT INTO reading_note_categories (name, normalized_name, sort_order)
       VALUES (
         $1,
         $2,
         COALESCE((SELECT MAX(sort_order) + 1 FROM reading_note_categories WHERE status = 'active'), 0)
       )
       RETURNING id, name, sort_order, is_default, status, 0::int AS note_count`,
      [name, normalizedName],
    );
    return mapCategory(rows[0] as CategoryRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingCategoryError('分类名称已存在', 'conflict');
    }
    throw error;
  }
}

export async function updateReadingCategory(
  client: VercelClient,
  id: number,
  fields: { name?: string; sortOrder?: number },
): Promise<ReadingNoteCategory> {
  const { rows: currentRows } = await client.query(
    `SELECT category.*,
       COUNT(note.id) FILTER (WHERE note.status <> 'deleted')::int AS note_count
     FROM reading_note_categories category
     LEFT JOIN reading_notes note ON note.category_id = category.id
     WHERE category.id = $1
     GROUP BY category.id`,
    [id],
  );
  const current = currentRows[0] as CategoryRow | undefined;
  if (!current) throw new ReadingCategoryError('分类不存在', 'not_found');
  if (current.status !== 'active') throw new ReadingCategoryError('分类已删除', 'conflict');

  let normalized: ReturnType<typeof normalizeReadingCategoryName> | undefined;
  if (fields.name !== undefined) {
    normalized = normalizeReadingCategoryName(fields.name);
    if (current.is_default && normalized.name !== current.name) {
      throw new ReadingCategoryError('未分类不能重命名', 'conflict');
    }
  }
  if (fields.sortOrder !== undefined && !Number.isInteger(fields.sortOrder)) {
    throw new ReadingCategoryError('分类顺序不正确', 'invalid');
  }

  try {
    const { rows } = await client.query(
      `UPDATE reading_note_categories
       SET name = COALESCE($1, name),
         normalized_name = COALESCE($2, normalized_name),
         sort_order = COALESCE($3, sort_order),
         updated_at = now()
       WHERE id = $4 AND status = 'active'
       RETURNING id, name, sort_order, is_default, status,
         $5::int AS note_count`,
      [normalized?.name ?? null, normalized?.normalizedName ?? null,
        fields.sortOrder ?? null, id, Number(current.note_count)],
    );
    if (!rows[0]) {
      throw new ReadingCategoryError('分类状态已变化，请重试', 'conflict');
    }
    return mapCategory(rows[0] as CategoryRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingCategoryError('分类名称已存在', 'conflict');
    }
    throw error;
  }
}

export async function reorderReadingCategories(
  client: VercelClient,
  orderedIds: number[],
): Promise<ReadingNoteCategory[]> {
  return transaction(client, async () => {
    const { rows } = await client.query(
      `SELECT id FROM reading_note_categories
       WHERE status = 'active'
       ORDER BY id
       FOR UPDATE`,
    );
    const activeIds = rows.map((row) => Number(row.id));
    const uniqueIds = new Set(orderedIds);
    const hasExactIds = orderedIds.length === activeIds.length
      && uniqueIds.size === orderedIds.length
      && activeIds.every((id) => uniqueIds.has(id));
    if (!hasExactIds) {
      throw new ReadingCategoryError('分类顺序必须包含全部有效分类且不能重复', 'conflict');
    }

    await client.query(
      `UPDATE reading_note_categories category
       SET sort_order = ordered.sort_order, updated_at = now()
       FROM (
         SELECT id, (ordinality - 1)::int AS sort_order
         FROM unnest($1::int[]) WITH ORDINALITY AS item(id, ordinality)
       ) ordered
       WHERE category.id = ordered.id`,
      [orderedIds],
    );
    return listReadingCategories(client);
  });
}

type LockedCategory = {
  id: number;
  is_default: boolean;
  status: 'active' | 'deleted';
};

function requireActiveCategory(
  categories: Map<number, LockedCategory>,
  id: number,
  role: 'source' | 'target',
) {
  const category = categories.get(id);
  if (!category) throw new ReadingCategoryError('分类不存在', 'not_found');
  if (category.status !== 'active') {
    throw new ReadingCategoryError(role === 'target' ? '目标分类已删除' : '分类已删除', 'conflict');
  }
  return category;
}

async function lockCategories(client: VercelClient, ids: number[]) {
  const { rows } = await client.query(
    `SELECT id, is_default, status
     FROM reading_note_categories
     WHERE id = ANY($1::int[])
     ORDER BY id
     FOR UPDATE`,
    [ids],
  );
  return new Map(rows.map((row) => [Number(row.id), row as LockedCategory]));
}

async function mergeLockedCategory(
  client: VercelClient,
  sourceId: number,
  targetId: number,
) {
  if (sourceId === targetId) {
    throw new ReadingCategoryError('分类不能合并到自身', 'conflict');
  }
  const categories = await lockCategories(client, [sourceId, targetId]);
  const source = requireActiveCategory(categories, sourceId, 'source');
  requireActiveCategory(categories, targetId, 'target');
  if (source.is_default) throw new ReadingCategoryError('未分类不能删除', 'conflict');

  await client.query(
    `UPDATE reading_notes SET category_id = $1, updated_at = now()
     WHERE category_id = $2`,
    [targetId, sourceId],
  );
  await client.query(
    `UPDATE reading_note_categories
     SET status = 'deleted', updated_at = now()
     WHERE id = $1`,
    [sourceId],
  );
}

export async function mergeReadingCategory(
  client: VercelClient,
  sourceId: number,
  targetId: number,
): Promise<void> {
  try {
    await transaction(client, () => mergeLockedCategory(client, sourceId, targetId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingCategoryError('目标分类中存在相同知识点', 'conflict');
    }
    throw error;
  }
}

export async function deleteReadingCategory(
  client: VercelClient,
  id: number,
  destination: 'uncategorized' | number | null,
): Promise<void> {
  try {
    await transaction(client, async () => {
      const categories = await lockCategories(client, [id]);
      const source = requireActiveCategory(categories, id, 'source');
      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS note_count FROM reading_notes WHERE category_id = $1',
        [id],
      );
      const plan = planCategoryDeletion({
        isDefault: source.is_default,
        noteCount: Number(countRows[0].note_count),
      }, destination);

      let targetId: number | null = null;
      if (plan.kind === 'move_to_uncategorized') {
        const { rows } = await client.query(
          `SELECT id, is_default, status
           FROM reading_note_categories
           WHERE is_default = true AND status = 'active'
           FOR UPDATE`,
        );
        if (!rows[0]) throw new ReadingCategoryError('未分类不存在', 'not_found');
        targetId = Number(rows[0].id);
      } else if (plan.kind === 'merge') {
        const targets = await lockCategories(client, [plan.targetCategoryId]);
        requireActiveCategory(targets, plan.targetCategoryId, 'target');
        if (plan.targetCategoryId === id) {
          throw new ReadingCategoryError('分类不能合并到自身', 'conflict');
        }
        targetId = plan.targetCategoryId;
      }

      if (targetId !== null) {
        await client.query(
          `UPDATE reading_notes SET category_id = $1, updated_at = now()
           WHERE category_id = $2`,
          [targetId, id],
        );
      }
      await client.query(
        `UPDATE reading_note_categories
         SET status = 'deleted', updated_at = now()
         WHERE id = $1`,
        [id],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReadingCategoryError('目标分类中存在相同知识点', 'conflict');
    }
    throw error;
  }
}
