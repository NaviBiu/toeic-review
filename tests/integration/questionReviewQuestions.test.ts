import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuestion,
  listQuestions,
  softDeleteQuestion,
  updateQuestion,
  type ReviewQuestionInput,
} from '@/lib/questionReview/questions';
import { withTestClient } from './setup';

const input = (categoryId: number): ReviewQuestionInput => ({
  stem: 'The budget will be ___ next quarter.',
  options: { A: 'review', B: 'reviewed', C: 'reviewing', D: 'reviews' },
  correctOption: 'B',
  analysis: '被动语态',
  categoryId,
});

describe('question review questions', () => {
  it('creates, edits, detects normalized duplicates, and soft-deletes Part 5 questions', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '题目 CRUD 分类', 900)
           RETURNING id
         ), child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '题目 CRUD 子分类' FROM parent
           RETURNING id
         )
         SELECT (SELECT id FROM child) AS child_id`,
      );
      const created = await createQuestion(client, input(ids.child_id));
      expect(created).toMatchObject({ duplicate: false, question: { status: 'learning' } });
      if (created.duplicate) throw new Error('expected a saved question');

      await expect(createQuestion(client, {
        ...input(ids.child_id),
        stem: ' The   budget will be ___ next quarter. ',
      })).resolves.toEqual({ duplicate: true, duplicateId: created.question.id });

      const updated = await updateQuestion(client, created.question.id, {
        notes: '复习笔记',
        status: 'mastered',
      });
      expect(updated).toMatchObject({ duplicate: false, question: { notes: '复习笔记', status: 'mastered' } });
      await expect(softDeleteQuestion(client, created.question.id))
        .resolves.toEqual({ id: created.question.id, status: 'deleted' });
      await expect(updateQuestion(client, created.question.id, { status: 'learning' }))
        .resolves.toMatchObject({ duplicate: false, question: { status: 'learning' } });
    });
  }, 60_000);

  it('paginates visible questions and computes aggregates from all attempts', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '题目列表分类', 901)
           RETURNING id
         ), child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '题目列表子分类' FROM parent
           RETURNING id
         ), question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'List aggregation question',
             'A', 'B', 'C', 'D', 'A', 'test', id
           FROM child
           RETURNING id
         ), deleted_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           SELECT 'reading', 5, 'single_choice', 'Deleted list question',
             'A', 'B', 'C', 'D', 'A', 'test', id, 'deleted'
           FROM child
           RETURNING id
         ), session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 1)
           RETURNING id
         ), item AS (
           INSERT INTO question_review_session_items (session_id, question_id, position)
           SELECT session.id, question.id, 1 FROM session CROSS JOIN question
           RETURNING session_id, question_id
         ), attempts AS (
           INSERT INTO question_attempts
             (request_id, session_id, question_id, selected_option, is_correct, duration_ms,
              duration_excluded, attempted_at)
           SELECT '31111111-1111-4111-8111-111111111111'::uuid, session_id, question_id,
             'B', false, 800, false, '2026-08-20T08:00:00Z'::timestamptz
           FROM item
           UNION ALL
           SELECT '32222222-2222-4222-8222-222222222222'::uuid, session_id, question_id,
             'A', true, 1200, true, '2026-08-20T08:00:00Z'::timestamptz
           FROM item
         )
         SELECT (SELECT id FROM question) AS question_id,
           (SELECT id FROM deleted_question) AS deleted_question_id`,
      );

      const visible = await listQuestions(client, { search: 'aggregation', page: 1, pageSize: 1 });
      expect(visible).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 1,
        items: [{
          id: ids.question_id,
          stats: { correctCount: 1, wrongCount: 1, latestCorrect: true, latestDurationMs: 800 },
        }],
      });
      await expect(listQuestions(client, { status: 'deleted', page: 1, pageSize: 20 }))
        .resolves.toMatchObject({ total: 1, items: [{ id: ids.deleted_question_id, status: 'deleted' }] });
    });
  }, 60_000);

  it('returns duplicate conflicts and soft-delete responses from question routes', async () => {
    const client = { connect: vi.fn(), end: vi.fn(), query: vi.fn() };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    const { POST } = await import('@/app/api/review-questions/route');
    const { PATCH } = await import('@/app/api/review-questions/[id]/route');
    const { DELETE } = await import('@/app/api/review-questions/[id]/route');

    client.query
      .mockResolvedValueOnce({ rows: [{
        id: 12, section: 'reading', part: 5, parent_id: 4, name: '未细分',
        is_default: true, status: 'active', sort_order: 0, parent_status: 'active',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 33 }] });
    const duplicate = await POST(new NextRequest('http://localhost/api/review-questions', {
      method: 'POST',
      body: JSON.stringify(input(12)),
    }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: '检测到相同题干', duplicateId: 33 });

    client.query.mockReset().mockResolvedValueOnce({ rows: [{ id: 33, status: 'deleted' }] });
    const deleted = await DELETE(
      new NextRequest('http://localhost/api/review-questions/33', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '33' }) },
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ id: 33, status: 'deleted' });

    client.query.mockReset()
      .mockResolvedValueOnce({ rows: [{
        id: 33, section: 'reading', part: 5, question_format: 'single_choice', stem: input(12).stem,
        option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A',
        analysis: 'test', notes: null, source: null, category_id: 12, status: 'deleted',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 12, section: 'reading', part: 5, parent_id: 4, name: '未细分',
        is_default: true, status: 'active', sort_order: 0, parent_status: 'active',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 33, section: 'reading', part: 5, question_format: 'single_choice', stem: input(12).stem,
        option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A',
        analysis: 'test', notes: null, source: null, category_id: 12, status: 'learning',
      }] });
    const restored = await PATCH(
      new NextRequest('http://localhost/api/review-questions/33', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'learning' }),
      }),
      { params: Promise.resolve({ id: '33' }) },
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ id: 33, status: 'learning' });
    vi.doUnmock('@/lib/db');
  });
});
