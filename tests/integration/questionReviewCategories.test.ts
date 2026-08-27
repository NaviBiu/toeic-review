import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createCategory,
  deleteEmptyCategory,
  listCategoryTree,
  mergeCategory,
  updateCategory,
} from '@/lib/questionReview/categories';
import { createReviewSession } from '@/lib/questionReview/sessions';
import { withTestClient } from './setup';

describe('question review categories', () => {
  it('creates roots with one default child and blocks third-level moves', async () => {
    await withTestClient(async (client) => {
      const parent = await createCategory(client, {
        section: 'reading',
        part: 5,
        name: '新建一级分类',
      });
      const child = await createCategory(client, {
        section: 'reading',
        part: 5,
        parentId: parent.id,
        name: '自定义二级分类',
      });

      const tree = await listCategoryTree(client, { section: 'reading', part: 5 });
      const createdParent = tree.find((node) => node.id === parent.id);

      expect(createdParent?.children.map((node) => [node.name, node.isDefault])).toEqual([
        ['未细分', true],
        ['自定义二级分类', false],
      ]);
      await expect(createCategory(client, {
        section: 'reading',
        part: 5,
        parentId: child.id,
        name: '三级分类',
      })).rejects.toThrow('分类最多两级');
      await expect(updateCategory(client, child.id, { parentId: child.id }))
        .rejects.toThrow('分类不能移动到自身');

      await updateCategory(client, parent.id, { status: 'inactive' });
      expect((await listCategoryTree(client, { section: 'reading', part: 5 }))
        .find((node) => node.id === parent.id)).toBeUndefined();
      expect((await listCategoryTree(client, {
        section: 'reading',
        part: 5,
        includeInactive: true,
      })).find((node) => node.id === parent.id)?.children
        .every((node) => node.status === 'active')).toBe(true);

      await updateCategory(client, parent.id, { status: 'active' });
      expect((await listCategoryTree(client, { section: 'reading', part: 5 }))
        .find((node) => node.id === parent.id)?.children.map((node) => node.name)).toEqual([
        '未细分',
        '自定义二级分类',
      ]);
    });
  }, 60_000);

  it('protects default and non-empty categories while removing empty categories', async () => {
    await withTestClient(async (client) => {
      const { rows: [categories] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '删除规则一级分类', 100)
           RETURNING id
         ), default_child AS (
           INSERT INTO question_categories (section, part, parent_id, name, is_default)
           SELECT 'reading', 5, id, '未细分', true FROM parent
           RETURNING id
         ), question_child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '有题目分类' FROM parent
           RETURNING id
         ), empty_child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '空分类' FROM parent
           RETURNING id
         ), question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'Delete rule question',
             'A', 'B', 'C', 'D', 'A', 'test', id
           FROM question_child
         )
         SELECT
           (SELECT id FROM default_child) AS default_child_id,
           (SELECT id FROM question_child) AS question_child_id,
           (SELECT id FROM empty_child) AS empty_child_id`,
      );

      await expect(deleteEmptyCategory(client, categories.default_child_id))
        .rejects.toThrow('未细分类不能删除');
      await expect(deleteEmptyCategory(client, categories.question_child_id))
        .rejects.toThrow('该分类仍有关联题目，请先移动或合并');
      await expect(deleteEmptyCategory(client, categories.empty_child_id)).resolves.toBeUndefined();
      await expect(client.query(
        'SELECT id FROM question_categories WHERE id = $1',
        [categories.empty_child_id],
      )).resolves.toMatchObject({ rows: [] });
    });
  }, 60_000);

  it('deletes an empty root and default child while protecting non-empty roots', async () => {
    await withTestClient(async (client) => {
      const emptyRoot = await createCategory(client, {
        section: 'reading',
        part: 5,
        name: '可删除空一级分类',
      });
      const questionRoot = await createCategory(client, {
        section: 'reading',
        part: 5,
        name: '有题目一级分类',
      });
      const childRoot = await createCategory(client, {
        section: 'reading',
        part: 5,
        name: '有自定义子分类一级分类',
      });
      const nonDefaultChild = await createCategory(client, {
        section: 'reading',
        part: 5,
        parentId: childRoot.id,
        name: '保留自定义子分类',
      });
      const { rows: defaults } = await client.query(
        `SELECT id, parent_id
         FROM question_categories
         WHERE parent_id = ANY($1::int[]) AND is_default = true`,
        [[emptyRoot.id, questionRoot.id, childRoot.id]],
      );
      const defaultByParent = new Map(defaults.map((row) => [row.parent_id, row.id]));
      const emptyDefaultId = defaultByParent.get(emptyRoot.id)!;
      const questionDefaultId = defaultByParent.get(questionRoot.id)!;
      const childDefaultId = defaultByParent.get(childRoot.id)!;

      await client.query(
        `INSERT INTO review_questions
           (section, part, question_format, stem, option_a, option_b, option_c, option_d,
            correct_option, analysis, category_id)
         VALUES ('reading', 5, 'single_choice', 'Protected root question',
           'A', 'B', 'C', 'D', 'A', 'test', $1)`,
        [questionDefaultId],
      );

      await expect(deleteEmptyCategory(client, emptyRoot.id)).resolves.toBeUndefined();
      const { rows: deletedRows } = await client.query(
        'SELECT id FROM question_categories WHERE id = ANY($1::int[])',
        [[emptyRoot.id, emptyDefaultId]],
      );
      expect(deletedRows).toEqual([]);

      await expect(deleteEmptyCategory(client, questionRoot.id))
        .rejects.toThrow('该分类仍有关联题目，请先移动或合并');
      await expect(deleteEmptyCategory(client, childRoot.id))
        .rejects.toThrow('该分类仍有子分类，请先移动或合并');

      const { rows: protectedRows } = await client.query(
        'SELECT id FROM question_categories WHERE id = ANY($1::int[]) ORDER BY id',
        [[
          questionRoot.id,
          questionDefaultId,
          childRoot.id,
          childDefaultId,
          nonDefaultChild.id,
        ]],
      );
      expect(protectedRows.map((row) => row.id)).toEqual([
        questionRoot.id,
        questionDefaultId,
        childRoot.id,
        childDefaultId,
        nonDefaultChild.id,
      ].sort((left, right) => left - right));
    });
  }, 60_000);

  it('hides inactive children and excludes their questions from active parent statistics', async () => {
    await withTestClient(async (client) => {
      const parent = await createCategory(client, {
        section: 'reading',
        part: 5,
        name: '停用子分类统计一级分类',
      });
      const activeChild = await createCategory(client, {
        section: 'reading',
        part: 5,
        parentId: parent.id,
        name: '启用统计子分类',
      });
      const inactiveChild = await createCategory(client, {
        section: 'reading',
        part: 5,
        parentId: parent.id,
        name: '停用统计子分类',
      });
      await updateCategory(client, inactiveChild.id, { status: 'inactive' });

      await client.query(
        `WITH active_learning AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           VALUES ('reading', 5, 'single_choice', 'Active learning question',
             'A', 'B', 'C', 'D', 'A', 'test', $1)
           RETURNING id
         ), active_mastered AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           VALUES ('reading', 5, 'single_choice', 'Active mastered question',
             'A', 'B', 'C', 'D', 'A', 'test', $1, 'mastered')
         ), inactive_learning AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           VALUES ('reading', 5, 'single_choice', 'Inactive learning question',
             'A', 'B', 'C', 'D', 'A', 'test', $2)
           RETURNING id
         ), inactive_mastered AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           VALUES ('reading', 5, 'single_choice', 'Inactive mastered question',
             'A', 'B', 'C', 'D', 'A', 'test', $2, 'mastered')
         ), session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 2)
           RETURNING id
         ), session_items AS (
           INSERT INTO question_review_session_items (session_id, question_id, position)
           SELECT session.id, active_learning.id, 1 FROM session CROSS JOIN active_learning
           UNION ALL
           SELECT session.id, inactive_learning.id, 2 FROM session CROSS JOIN inactive_learning
           RETURNING session_id, question_id, position
         )
         INSERT INTO question_attempts
           (request_id, session_id, question_id, selected_option, is_correct, attempted_at)
         SELECT '34333333-3333-4333-8333-333333333333'::uuid,
           session_id, question_id, 'B', false, '2026-08-21T08:00:00Z'::timestamptz
         FROM session_items WHERE position = 1
         UNION ALL
         SELECT '44444444-4444-4444-8444-444444444444'::uuid,
           session_id, question_id, 'A', true, '2026-08-21T08:00:00Z'::timestamptz
         FROM session_items WHERE position = 2`,
        [activeChild.id, inactiveChild.id],
      );

      const activeTree = await listCategoryTree(client, { section: 'reading', part: 5 });
      const activeParent = activeTree.find((node) => node.id === parent.id)!;
      expect(activeParent.children.some((node) => node.id === inactiveChild.id)).toBe(false);
      expect(activeParent.stats).toEqual({
        total: 2,
        learningCount: 1,
        masteredCount: 1,
        attempted: 1,
        unattempted: 1,
        latestCorrect: 0,
        accuracy: 0,
      });
      const session = await createReviewSession(client, {
        mode: 'weak_first',
        categoryScopeId: parent.id,
        includeMastered: true,
        plannedCount: 10,
      });
      expect(session.actualCount).toBe(activeParent.stats.total);

      const fullTree = await listCategoryTree(client, {
        section: 'reading',
        part: 5,
        includeInactive: true,
      });
      const fullParent = fullTree.find((node) => node.id === parent.id)!;
      const visibleInactiveChild = fullParent.children.find((node) => node.id === inactiveChild.id)!;
      expect(fullParent.stats).toEqual(activeParent.stats);
      expect(visibleInactiveChild.status).toBe('inactive');
      expect(visibleInactiveChild.stats).toEqual({
        total: 2,
        learningCount: 1,
        masteredCount: 1,
        attempted: 1,
        unattempted: 1,
        latestCorrect: 1,
        accuracy: 1,
      });
    });
  }, 60_000);

  it('moves child questions during merge and preserves latest-result statistics', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '合并统计一级分类', 101)
           RETURNING id
         ), source_category AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '来源分类' FROM parent
           RETURNING id
         ), target_category AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '目标分类' FROM parent
           RETURNING id
         ), source_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'Merged source question',
             'A', 'B', 'C', 'D', 'A', 'test', id
           FROM source_category
           RETURNING id
         ), target_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           SELECT 'reading', 5, 'single_choice', 'Merged target question',
             'A', 'B', 'C', 'D', 'A', 'test', id, 'mastered'
           FROM target_category
           RETURNING id
         ), inactive_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           SELECT 'reading', 5, 'single_choice', 'Inactive question',
             'A', 'B', 'C', 'D', 'A', 'test', id, 'inactive'
           FROM target_category
         ), deleted_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           SELECT 'reading', 5, 'single_choice', 'Deleted question',
             'A', 'B', 'C', 'D', 'A', 'test', id, 'deleted'
           FROM target_category
         ), mismatched_scope_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 6, 'single_choice', 'Part 6 question in Part 5 category',
             'A', 'B', 'C', 'D', 'A', 'test', id
           FROM target_category
         ), session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 1)
           RETURNING id
         ), session_item AS (
           INSERT INTO question_review_session_items (session_id, question_id, position)
           SELECT session.id, source_question.id, 1 FROM session CROSS JOIN source_question
           RETURNING session_id, question_id
         ), attempts AS (
           INSERT INTO question_attempts
             (request_id, session_id, question_id, selected_option, is_correct, attempted_at)
           SELECT
             '14111111-1111-4111-8111-111111111111'::uuid,
             session_id,
             question_id,
             'B'::text,
             false,
             '2026-08-20T08:00:00Z'::timestamptz
           FROM session_item
           UNION ALL
           SELECT
             '24222222-2222-4222-8222-222222222222'::uuid,
             session_id,
             question_id,
             'A'::text,
             true,
             '2026-08-20T08:00:00Z'::timestamptz
           FROM session_item
         )
         SELECT
           (SELECT id FROM source_category) AS source_id,
           (SELECT id FROM target_category) AS target_id,
           (SELECT id FROM source_question) AS source_question_id,
           (SELECT id FROM target_question) AS target_question_id`,
      );

      const before = await listCategoryTree(client, { section: 'reading', part: 5 });
      const parentBefore = before.find((node) => node.name === '合并统计一级分类')!;
      expect(parentBefore.stats).toEqual({
        total: 2,
        learningCount: 1,
        masteredCount: 1,
        attempted: 1,
        unattempted: 1,
        latestCorrect: 1,
        accuracy: 1,
      });

      await mergeCategory(client, ids.source_id, ids.target_id);

      const after = await listCategoryTree(client, {
        section: 'reading',
        part: 5,
        includeInactive: true,
      });
      const parentAfter = after.find((node) => node.name === '合并统计一级分类')!;
      const source = parentAfter.children.find((node) => node.id === ids.source_id)!;
      const target = parentAfter.children.find((node) => node.id === ids.target_id)!;
      const { rows: [movedQuestion] } = await client.query(
        'SELECT category_id FROM review_questions WHERE id = $1',
        [ids.source_question_id],
      );

      expect(movedQuestion.category_id).toBe(ids.target_id);
      expect(source.status).toBe('inactive');
      expect(target.stats).toEqual(parentBefore.stats);
      expect(parentAfter.stats).toEqual(parentBefore.stats);
    });
  }, 60_000);

  it('merges parent children by name and enforces merge compatibility', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH source_parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '来源一级分类', 102)
           RETURNING id
         ), target_parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '目标一级分类', 103)
           RETURNING id
         ), source_default AS (
           INSERT INTO question_categories (section, part, parent_id, name, is_default)
           SELECT 'reading', 5, id, '未细分', true FROM source_parent
           RETURNING id
         ), target_default AS (
           INSERT INTO question_categories (section, part, parent_id, name, is_default)
           SELECT 'reading', 5, id, '未细分', true FROM target_parent
           RETURNING id
         ), source_same_name AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '同名子分类' FROM source_parent
           RETURNING id
         ), source_unique_name AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '独有子分类' FROM source_parent
           RETURNING id
         ), target_same_name AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '同名子分类' FROM target_parent
           RETURNING id
         ), inactive_child AS (
           INSERT INTO question_categories (section, part, parent_id, name, status)
           SELECT 'reading', 5, id, '已停用子分类', 'inactive' FROM target_parent
           RETURNING id
         ), part_six_parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 6, 'Part 6 一级分类', 1)
           RETURNING id
         )
         SELECT
           (SELECT id FROM source_parent) AS source_parent_id,
           (SELECT id FROM target_parent) AS target_parent_id,
           (SELECT id FROM source_default) AS source_default_id,
           (SELECT id FROM target_default) AS target_default_id,
           (SELECT id FROM source_same_name) AS source_same_name_id,
           (SELECT id FROM source_unique_name) AS source_unique_name_id,
           (SELECT id FROM target_same_name) AS target_same_name_id,
           (SELECT id FROM inactive_child) AS inactive_child_id,
           (SELECT id FROM part_six_parent) AS part_six_parent_id`,
      );

      await expect(mergeCategory(client, ids.source_same_name_id, ids.target_parent_id))
        .rejects.toThrow('分类层级不一致');
      await expect(mergeCategory(client, ids.source_parent_id, ids.part_six_parent_id))
        .rejects.toThrow('分类范围不一致');
      await expect(mergeCategory(client, ids.source_unique_name_id, ids.inactive_child_id))
        .rejects.toThrow('目标分类已停用');

      await mergeCategory(client, ids.source_parent_id, ids.target_parent_id);

      const { rows } = await client.query(
        `SELECT id, parent_id, name, is_default, status
         FROM question_categories
         WHERE id = ANY($1::int[])
         ORDER BY id`,
        [[
          ids.source_parent_id,
          ids.source_default_id,
          ids.target_default_id,
          ids.source_same_name_id,
          ids.source_unique_name_id,
          ids.target_same_name_id,
        ]],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(byId.get(ids.source_parent_id)?.status).toBe('inactive');
      expect(byId.get(ids.source_same_name_id)?.status).toBe('inactive');
      expect(byId.get(ids.source_unique_name_id)?.parent_id).toBe(ids.target_parent_id);
      expect(byId.get(ids.target_same_name_id)?.status).toBe('active');
      expect(rows.filter((row) => row.parent_id === ids.target_parent_id && row.is_default))
        .toEqual([expect.objectContaining({ id: ids.target_default_id, name: '未细分' })]);
    });
  }, 60_000);

  it('returns 400, 404, and 409 from category routes', async () => {
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn(),
    };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { PATCH, DELETE } = await import('@/app/api/question-categories/[id]/route');

    const malformed = await PATCH(
      new NextRequest('http://localhost/api/question-categories/not-a-number', {
        method: 'PATCH',
        body: '{}',
      }),
      { params: Promise.resolve({ id: 'not-a-number' }) },
    );
    expect(malformed.status).toBe(400);

    client.query.mockResolvedValueOnce({ rows: [] });
    const missing = await PATCH(
      new NextRequest('http://localhost/api/question-categories/404', {
        method: 'PATCH',
        body: JSON.stringify({ name: '不存在' }),
      }),
      { params: Promise.resolve({ id: '404' }) },
    );
    expect(missing.status).toBe(404);

    client.query
      .mockResolvedValueOnce({
        rows: [{
          id: 405,
          section: 'reading',
          part: 5,
          parent_id: 1,
          name: '有题目分类',
          is_default: false,
          status: 'active',
          sort_order: 0,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ has_questions: true, has_children: false }] });
    const conflict = await DELETE(
      new NextRequest('http://localhost/api/question-categories/405', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '405' }) },
    );
    expect(conflict.status).toBe(409);

    vi.doUnmock('@/lib/db');
  });
});
