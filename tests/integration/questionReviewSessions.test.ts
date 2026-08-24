import { describe, expect, it } from 'vitest';
import {
  createReviewSession,
  submitAttempt,
  updateAttemptTiming,
} from '@/lib/questionReview/sessions';
import { withTestClient } from './setup';

describe('question review sessions', () => {
  it('freezes a non-repeating question list without revealing answers', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '训练会话分类', 950)
           RETURNING id
         ), child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '训练会话子分类' FROM parent
           RETURNING id
         ), first_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, notes, source, category_id)
           SELECT 'reading', 5, 'single_choice', 'Session question one',
             'A', 'B', 'C', 'D', 'B', '副词修饰形容词。', 'note', 'ETS Test 3', id
           FROM child
           RETURNING id
         ), second_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'Session question two',
             'A', 'B', 'C', 'D', 'B', '副词修饰形容词。', id
           FROM child
           RETURNING id
         )
         SELECT (SELECT id FROM parent) AS parent_id,
           (SELECT id FROM first_question) AS first_question_id`,
      );

      const session = await createReviewSession(client, {
        mode: 'weak_first', categoryScopeId: ids.parent_id, includeMastered: false, plannedCount: 10,
      });

      expect(session.plannedCount).toBe(10);
      expect(session.actualCount).toBe(2);
      expect(session.questions).toHaveLength(2);
      expect(new Set(session.questions.map((item) => item.id)).size).toBe(2);
      expect(session.questions[0]).not.toHaveProperty('correctOption');
      expect(session.questions[0]).not.toHaveProperty('analysis');

      const attempt = await submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: session.id,
        questionId: ids.first_question_id,
        selectedOption: 'A',
        durationMs: 9000,
      });
      expect(attempt.correctOption).toBe('B');
      expect(attempt.analysis).toBe('副词修饰形容词。');
      expect(attempt.isCorrect).toBe(false);

      const retry = await submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: session.id,
        questionId: ids.first_question_id,
        selectedOption: 'A',
        durationMs: 9000,
      });
      expect(retry.attemptId).toBe(attempt.attemptId);
      const { rows: [count] } = await client.query(
        'SELECT COUNT(*)::int AS count FROM question_attempts WHERE request_id = $1',
        ['4f21de2e-e7a5-4b72-9425-c3086fa00101'],
      );
      expect(count.count).toBe(1);

      const otherQuestionId = session.questions.find((item) => item.id !== ids.first_question_id)!.id;
      await expect(submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: session.id,
        questionId: ids.first_question_id,
        selectedOption: 'B',
        durationMs: 9000,
      })).rejects.toThrow('请求标识已用于其他作答');
      await expect(submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: session.id,
        questionId: ids.first_question_id,
        selectedOption: 'A',
        durationMs: 9001,
      })).rejects.toThrow('请求标识已用于其他作答');
      await expect(submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: session.id,
        questionId: otherQuestionId,
        selectedOption: 'A',
        durationMs: 9000,
      })).rejects.toThrow('请求标识已用于其他作答');
      const secondSession = await createReviewSession(client, {
        mode: 'random', categoryScopeId: ids.parent_id, includeMastered: false, plannedCount: 10,
      });
      await expect(submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00101',
        sessionId: secondSession.id,
        questionId: ids.first_question_id,
        selectedOption: 'A',
        durationMs: 9000,
      })).rejects.toThrow('请求标识已用于其他作答');

      const concurrent = await Promise.allSettled([
        submitAttempt(client, {
          requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00103',
          sessionId: session.id,
          questionId: ids.first_question_id,
          selectedOption: 'A',
          durationMs: 1000,
        }),
        submitAttempt(client, {
          requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00103',
          sessionId: session.id,
          questionId: ids.first_question_id,
          selectedOption: 'B',
          durationMs: 1000,
        }),
      ]);
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const { rows: [concurrentCount] } = await client.query(
        'SELECT COUNT(*)::int AS count FROM question_attempts WHERE request_id = $1',
        ['4f21de2e-e7a5-4b72-9425-c3086fa00103'],
      );
      expect(concurrentCount.count).toBe(1);

      const changedDuration = await updateAttemptTiming(client, attempt.attemptId, {
        durationMs: 12500,
        durationExcluded: false,
      });
      expect(changedDuration).toMatchObject({ durationMs: 12500, durationExcluded: false, isCorrect: false });
      const excludedDuration = await updateAttemptTiming(client, attempt.attemptId, {
        durationMs: 12500,
        durationExcluded: true,
      });
      expect(excludedDuration).toMatchObject({ durationMs: 12500, durationExcluded: true, isCorrect: false });
    });
  }, 60_000);

  it('rejects an attempt for a question outside the session', async () => {
    await withTestClient(async (client) => {
      const { rows: [ids] } = await client.query(
        `WITH parent AS (
           INSERT INTO question_categories (section, part, name, sort_order)
           VALUES ('reading', 5, '会话归属分类', 951)
           RETURNING id
         ), child AS (
           INSERT INTO question_categories (section, part, parent_id, name)
           SELECT 'reading', 5, id, '会话归属子分类' FROM parent
           RETURNING id
         ), first_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'In session question',
             'A', 'B', 'C', 'D', 'B', 'test', id FROM child RETURNING id
         ), outside_question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id, status)
           SELECT 'reading', 5, 'single_choice', 'Outside session question',
             'A', 'B', 'C', 'D', 'B', 'test', id, 'inactive' FROM child RETURNING id
         )
         SELECT (SELECT id FROM parent) AS parent_id,
           (SELECT id FROM outside_question) AS outside_question_id`,
      );
      const session = await createReviewSession(client, {
        mode: 'random', categoryScopeId: ids.parent_id, includeMastered: false, plannedCount: 1,
      });

      await expect(submitAttempt(client, {
        requestId: '4f21de2e-e7a5-4b72-9425-c3086fa00102',
        sessionId: session.id,
        questionId: ids.outside_question_id,
        selectedOption: 'A',
        durationMs: 1000,
      })).rejects.toThrow('题目不属于本次训练');
    });
  }, 60_000);
});
