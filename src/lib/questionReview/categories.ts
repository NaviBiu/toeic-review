import type { VercelClient } from '@vercel/postgres';
import type { CategoryNode, QuestionCategory } from './types';

type CategoryStatus = 'active' | 'inactive';
type CategoryPart = 5 | 6 | 7;
type CategoryRow = {
  id: number;
  section: 'reading';
  part: CategoryPart;
  parent_id: number | null;
  name: string;
  is_default: boolean;
  status: CategoryStatus;
  sort_order: number;
};

export class CategoryError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'CategoryError';
  }
}

export type CategoryInput = {
  section: 'reading';
  part: CategoryPart;
  parentId?: number | null;
  name: string;
  sortOrder?: number;
};

export type CategoryUpdate = Partial<{
  parentId: number | null;
  name: string;
  sortOrder: number;
  status: CategoryStatus;
}>;

function mapCategory(row: CategoryRow): QuestionCategory {
  return {
    id: row.id,
    section: row.section,
    part: row.part,
    parentId: row.parent_id,
    name: row.name,
    isDefault: row.is_default,
    status: row.status,
    sortOrder: row.sort_order,
  };
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new CategoryError('分类名称不能为空', 'invalid');
  }
  return trimmed;
}

function validateScope(section: string, part: number): asserts section is 'reading' {
  if (section !== 'reading' || ![5, 6, 7].includes(part)) {
    throw new CategoryError('分类范围不正确', 'invalid');
  }
}

async function findCategory(client: VercelClient, id: number): Promise<QuestionCategory> {
  const { rows } = await client.query(
    'SELECT * FROM question_categories WHERE id = $1',
    [id],
  );
  if (!rows[0]) {
    throw new CategoryError('分类不存在', 'not_found');
  }
  return mapCategory(rows[0]);
}

export async function createCategory(
  client: VercelClient,
  input: CategoryInput,
): Promise<QuestionCategory> {
  validateScope(input.section, input.part);
  const name = validateName(input.name);
  const sortOrder = input.sortOrder ?? 0;

  if (input.parentId === undefined || input.parentId === null) {
    const { rows } = await client.query(
      `WITH parent AS (
         INSERT INTO question_categories (section, part, name, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *
       ), default_child AS (
         INSERT INTO question_categories (section, part, parent_id, name, is_default)
         SELECT section, part, id, '未细分', true FROM parent
       )
       SELECT * FROM parent`,
      [input.section, input.part, name, sortOrder],
    );
    return mapCategory(rows[0]);
  }

  const parent = await findCategory(client, input.parentId);
  if (parent.parentId !== null) {
    throw new CategoryError('分类最多两级', 'conflict');
  }
  if (parent.section !== input.section || parent.part !== input.part) {
    throw new CategoryError('分类范围不一致', 'conflict');
  }
  if (parent.status !== 'active') {
    throw new CategoryError('父分类已停用', 'conflict');
  }

  const { rows } = await client.query(
    `INSERT INTO question_categories (section, part, parent_id, name, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.section, input.part, parent.id, name, sortOrder],
  );
  return mapCategory(rows[0]);
}

export async function updateCategory(
  client: VercelClient,
  id: number,
  fields: CategoryUpdate,
): Promise<QuestionCategory> {
  const current = await findCategory(client, id);

  if (fields.parentId !== undefined) {
    if (fields.parentId === id) {
      throw new CategoryError('分类不能移动到自身', 'conflict');
    }
    if (current.isDefault) {
      throw new CategoryError('未细分类不能移动', 'conflict');
    }
    if (fields.parentId === null) {
      if (current.parentId !== null) {
        throw new CategoryError('二级分类必须归属一级分类', 'conflict');
      }
    } else {
      if (current.parentId === null) {
        throw new CategoryError('一级分类不能移动到二级分类', 'conflict');
      }
      const parent = await findCategory(client, fields.parentId);
      if (parent.parentId !== null) {
        throw new CategoryError('分类最多两级', 'conflict');
      }
      if (parent.section !== current.section || parent.part !== current.part) {
        throw new CategoryError('分类范围不一致', 'conflict');
      }
      if (parent.status !== 'active') {
        throw new CategoryError('父分类已停用', 'conflict');
      }
    }
  }

  if (fields.name !== undefined && current.isDefault && fields.name.trim() !== current.name) {
    throw new CategoryError('未细分类不能重命名', 'conflict');
  }
  if (fields.status !== undefined && current.isDefault && fields.status !== 'active') {
    throw new CategoryError('未细分类不能停用', 'conflict');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (fields.name !== undefined) add('name', validateName(fields.name));
  if (fields.parentId !== undefined) add('parent_id', fields.parentId);
  if (fields.sortOrder !== undefined) add('sort_order', fields.sortOrder);
  if (fields.status !== undefined) add('status', fields.status);

  if (sets.length === 0) {
    return current;
  }

  sets.push('updated_at = now()');
  values.push(id);
  const { rows } = await client.query(
    `UPDATE question_categories
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING *`,
    values,
  );
  return mapCategory(rows[0]);
}

export async function deleteEmptyCategory(client: VercelClient, id: number): Promise<void> {
  const category = await findCategory(client, id);
  if (category.isDefault) {
    throw new CategoryError('未细分类不能删除', 'conflict');
  }

  const { rows: [relations] } = await client.query(
    `SELECT
       EXISTS(
         SELECT 1
         FROM review_questions question
         JOIN question_categories question_category ON question_category.id = question.category_id
         WHERE question_category.id = $1 OR question_category.parent_id = $1
       ) AS has_questions,
       EXISTS(SELECT 1 FROM question_categories WHERE parent_id = $1) AS has_children,
       EXISTS(
         SELECT 1 FROM question_categories
         WHERE parent_id = $1 AND is_default = false
       ) AS has_non_default_children`,
    [id],
  );
  if (relations.has_questions) {
    throw new CategoryError('该分类仍有关联题目，请先移动或合并', 'conflict');
  }
  if (relations.has_non_default_children) {
    throw new CategoryError('该分类仍有子分类，请先移动或合并', 'conflict');
  }

  const { rows: deleted } = await client.query(
    `DELETE FROM question_categories
     WHERE (id = $1 OR (parent_id = $1 AND is_default = true))
       AND NOT EXISTS (
         SELECT 1
         FROM review_questions question
         JOIN question_categories question_category ON question_category.id = question.category_id
         WHERE question_category.id = $1 OR question_category.parent_id = $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM question_categories child
         WHERE child.parent_id = $1 AND child.is_default = false
       )
     RETURNING id`,
    [id],
  );
  if (deleted.length === 0) {
    throw new CategoryError('分类状态已变化，请刷新后重试', 'conflict');
  }
}

export async function mergeCategory(
  client: VercelClient,
  sourceId: number,
  targetId: number,
): Promise<QuestionCategory> {
  if (sourceId === targetId) {
    throw new CategoryError('分类不能合并到自身', 'conflict');
  }

  const { rows } = await client.query(
    `SELECT * FROM question_categories
     WHERE id = ANY($1::int[])
     ORDER BY id
     FOR UPDATE`,
    [[sourceId, targetId]],
  );
  const byId = new Map(rows.map((row) => [row.id, mapCategory(row)]));
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (!source || !target) {
    throw new CategoryError('分类不存在', 'not_found');
  }
  if ((source.parentId === null) !== (target.parentId === null)) {
    throw new CategoryError('分类层级不一致', 'conflict');
  }
  if (source.section !== target.section || source.part !== target.part) {
    throw new CategoryError('分类范围不一致', 'conflict');
  }
  if (target.status !== 'active') {
    throw new CategoryError('目标分类已停用', 'conflict');
  }

  if (source.parentId !== null) {
    await client.query(
      `WITH moved_questions AS (
         UPDATE review_questions SET category_id = $1, updated_at = now()
         WHERE category_id = $2
       )
       UPDATE question_categories
       SET status = 'inactive', updated_at = now()
       WHERE id = $2`,
      [target.id, source.id],
    );
    return target;
  }

  await client.query(
    `WITH source_children AS (
       SELECT source_child.id, target_child.id AS target_child_id
       FROM question_categories source_child
       LEFT JOIN question_categories target_child
         ON target_child.parent_id = $2
        AND target_child.status = 'active'
        AND lower(target_child.name) = lower(source_child.name)
       WHERE source_child.parent_id = $1
     ), moved_questions AS (
       UPDATE review_questions question
       SET category_id = source_children.target_child_id, updated_at = now()
       FROM source_children
       WHERE question.category_id = source_children.id
         AND source_children.target_child_id IS NOT NULL
     ), deactivated_children AS (
       UPDATE question_categories source_child
       SET status = 'inactive', updated_at = now()
       FROM source_children
       WHERE source_child.id = source_children.id
         AND source_children.target_child_id IS NOT NULL
     ), reparented_children AS (
       UPDATE question_categories source_child
       SET parent_id = $2, is_default = false, updated_at = now()
       FROM source_children
       WHERE source_child.id = source_children.id
         AND source_children.target_child_id IS NULL
     )
     UPDATE question_categories source_parent
     SET status = 'inactive', updated_at = now()
     WHERE source_parent.id = $1`,
    [source.id, target.id],
  );
  return target;
}

export async function listCategoryTree(
  client: VercelClient,
  filters: { section: 'reading'; part: CategoryPart; includeInactive?: boolean },
): Promise<CategoryNode[]> {
  validateScope(filters.section, filters.part);
  const { rows } = await client.query(
    `WITH scoped_categories AS (
       SELECT *
       FROM question_categories
       WHERE section = $1 AND part = $2
     ), scoped_questions AS (
       SELECT question.id, question.category_id, question.status
       FROM review_questions question
       JOIN scoped_categories category ON category.id = question.category_id
       WHERE question.section = $1 AND question.part = $2
     ), latest_attempt AS (
       SELECT DISTINCT ON (question_attempts.question_id)
         question_attempts.question_id,
         question_attempts.is_correct
       FROM question_attempts
       JOIN scoped_questions question ON question.id = question_attempts.question_id
       ORDER BY
         question_attempts.question_id,
         question_attempts.attempted_at DESC,
         question_attempts.id DESC
     ), category_question_links AS (
       SELECT category.id AS category_id, question.id AS question_id,
         question.status AS question_status, latest_attempt.is_correct
       FROM scoped_categories category
       JOIN scoped_questions question
         ON question.category_id = category.id
        AND question.status IN ('learning', 'mastered')
       LEFT JOIN latest_attempt ON latest_attempt.question_id = question.id
       UNION ALL
       SELECT parent.id AS category_id, question.id AS question_id,
         question.status AS question_status, latest_attempt.is_correct
       FROM scoped_categories parent
       JOIN scoped_categories child ON child.parent_id = parent.id
       JOIN scoped_questions question
         ON question.category_id = child.id
        AND question.status IN ('learning', 'mastered')
       LEFT JOIN latest_attempt ON latest_attempt.question_id = question.id
     ), category_stats AS (
       SELECT
         category_id,
         COUNT(question_id)::int AS total,
         COUNT(question_id) FILTER (WHERE question_status = 'learning')::int AS learning_count,
         COUNT(question_id) FILTER (WHERE question_status = 'mastered')::int AS mastered_count,
         COUNT(question_id) FILTER (WHERE is_correct IS NOT NULL)::int AS attempted,
         COUNT(question_id) FILTER (WHERE is_correct IS NULL)::int AS unattempted,
         COUNT(question_id) FILTER (WHERE is_correct = true)::int AS latest_correct
       FROM category_question_links
       GROUP BY category_id
     )
     SELECT
       category.*,
       COALESCE(category_stats.total, 0) AS total,
       COALESCE(category_stats.learning_count, 0) AS learning_count,
       COALESCE(category_stats.mastered_count, 0) AS mastered_count,
       COALESCE(category_stats.attempted, 0) AS attempted,
       COALESCE(category_stats.unattempted, 0) AS unattempted,
       COALESCE(category_stats.latest_correct, 0) AS latest_correct
     FROM scoped_categories category
     LEFT JOIN scoped_categories parent ON parent.id = category.parent_id
     LEFT JOIN category_stats ON category_stats.category_id = category.id
     WHERE (
         $3::boolean
         OR (
           category.status = 'active'
           AND (category.parent_id IS NULL OR parent.status = 'active')
         )
       )
     ORDER BY
       CASE WHEN category.parent_id IS NULL THEN category.sort_order END NULLS FIRST,
       CASE WHEN category.parent_id IS NULL THEN category.id END NULLS FIRST,
       category.parent_id NULLS FIRST,
       CASE WHEN category.parent_id IS NOT NULL THEN category.sort_order END NULLS LAST,
       category.id`,
    [filters.section, filters.part, filters.includeInactive ?? false],
  );

  const nodes = new Map<number, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const category = mapCategory(row);
    const stats = {
      total: Number(row.total),
      learningCount: Number(row.learning_count),
      masteredCount: Number(row.mastered_count),
      attempted: Number(row.attempted),
      unattempted: Number(row.unattempted),
      latestCorrect: Number(row.latest_correct),
      accuracy: Number(row.attempted) === 0
        ? null
        : Number(row.latest_correct) / Number(row.attempted),
    };
    nodes.set(category.id, { ...category, stats, children: [] });
  }
  for (const node of nodes.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      nodes.get(node.parentId)?.children.push(node);
    }
  }
  return roots;
}
