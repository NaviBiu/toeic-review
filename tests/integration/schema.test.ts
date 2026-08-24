import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';

describe('schema constraints', () => {
  it('seeds six active Part 5 category trees with default children', async () => {
    await withTestClient(async (client) => {
      const { rows } = await client.query(
        `SELECT parent.id, parent.name, child.id AS default_child_id
         FROM question_categories parent
         JOIN question_categories child ON child.parent_id = parent.id
         WHERE parent.section = 'reading'
           AND parent.part = 5
           AND parent.status = 'active'
           AND parent.parent_id IS NULL
           AND child.name = '未细分'
           AND child.is_default = true
           AND child.status = 'active'
         ORDER BY parent.sort_order, parent.id`,
      );

      expect(rows.map((row) => row.name)).toEqual([
        '词性判断',
        '固定搭配',
        '连接词',
        '介词搭配',
        '语法（时态、语态、从句）',
        '词汇辨析',
      ]);
      expect(rows.every((row) => typeof row.default_child_id === 'number')).toBe(true);
    });
  });

  it('accepts a valid Part 5 question and rejects invalid options', async () => {
    await withTestClient(async (client) => {
      const { rows: [category] } = await client.query(
        `SELECT id FROM question_categories
         WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
         ORDER BY id LIMIT 1`,
      );
      const { rows: [question] } = await client.query(
        `INSERT INTO review_questions
         (section, part, question_format, stem, option_a, option_b, option_c, option_d,
          correct_option, analysis, category_id)
         VALUES ('reading', 5, 'single_choice', 'The report is ___ complete.',
          'near', 'nearly', 'nearest', 'nearness', 'B', '副词修饰形容词。', $1)
         RETURNING id`,
        [category.id],
      );
      expect(question.id).toBeTypeOf('number');

      await expect(client.query(
        `INSERT INTO review_questions
         (section, part, question_format, stem, option_a, option_b, option_c, option_d,
          correct_option, analysis, category_id)
         VALUES ('reading', 5, 'multiple_choice', 'Invalid format.',
          'A', 'B', 'C', 'D', 'A', 'Invalid.', $1)`,
        [category.id],
      )).rejects.toThrow();
      await expect(client.query(
        `INSERT INTO review_questions
         (section, part, question_format, stem, option_a, option_b, option_c, option_d,
          correct_option, analysis, category_id)
         VALUES ('reading', 5, 'single_choice', 'Invalid answer.',
          'A', 'B', 'C', 'D', 'E', 'Invalid.', $1)`,
        [category.id],
      )).rejects.toThrow();
    });
  });

  it('rejects duplicate session questions and attempt request ids', async () => {
    await withTestClient(async (client) => {
      const { rows: [category] } = await client.query(
        `SELECT id FROM question_categories
         WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
         ORDER BY id LIMIT 1`,
      );
      const { rows: [question] } = await client.query(
        `INSERT INTO review_questions
         (section, part, question_format, stem, option_a, option_b, option_c, option_d,
          correct_option, analysis, category_id)
         VALUES ('reading', 5, 'single_choice', 'The report is ___ complete.',
          'near', 'nearly', 'nearest', 'nearness', 'B', '副词修饰形容词。', $1)
         RETURNING id`,
        [category.id],
      );
      const { rows: [session] } = await client.query(
        `INSERT INTO question_review_sessions
         (section, part, mode, planned_count)
         VALUES ('reading', 5, 'weak_first', 1)
         RETURNING id`,
      );
      const insertSessionItem = `INSERT INTO question_review_session_items
        (session_id, question_id, position)
        VALUES ($1, $2, 1)`;
      await expect(client.query(insertSessionItem, [session.id, question.id])).resolves.toBeDefined();
      await expect(client.query(insertSessionItem, [session.id, question.id])).rejects.toThrow();

      const requestId = '85ed0afc-2f4a-4405-8818-91418e2e15c';
      const insertAttempt = `INSERT INTO question_attempts
        (request_id, session_id, question_id, selected_option, is_correct)
        VALUES ($1, $2, $3, 'B', true)`;
      await expect(client.query(insertAttempt, [requestId, session.id, question.id])).resolves.toBeDefined();
      await expect(client.query(insertAttempt, [requestId, session.id, question.id])).rejects.toThrow();
    });
  });

  it('stores reading practice sessions and Part 5-7 scores', async () => {
    await withTestClient(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO practice_sessions (practice_date, section, type, title)
         VALUES ('2026-08-11', 'reading', 'part_drill', 'Part 7专项')
         RETURNING id, section`,
      );
      await expect(client.query(
        `INSERT INTO practice_part_scores (practice_session_id, part, correct, total)
         VALUES ($1, 7, 45, 54)`,
        [rows[0].id],
      )).resolves.toBeDefined();
      expect(rows[0].section).toBe('reading');
    });
  });

  it('allows an active row and a deleted row with the same unique key, but not two active rows', async () => {
    await withTestClient(async (client) => {
      const insert = `INSERT INTO knowledge_points
        (term, meaning, example, part, scenario_major, scenario_minor, date_added, status)
        VALUES ('workshop', 'a meeting', 'ex', 2, '一般商务', '会议', '2026-06-20', $1)`;
      await client.query(insert, ['deleted']);
      await expect(client.query(insert, ['active'])).resolves.toBeDefined();
      await expect(client.query(insert, ['active'])).rejects.toThrow();
    });
  });

  it('rejects mock exam rows where a total is 0 or correct exceeds total', async () => {
    await withTestClient(async (client) => {
      const base = `INSERT INTO mock_exam_results
        (test_date, part1_correct, part1_total, part2_correct, part2_total, part3_correct, part3_total, part4_correct, part4_total)
        VALUES ('2026-06-26', $1, $2, 5, 25, 10, 39, 10, 30)`;
      await expect(client.query(base, [0, 0])).rejects.toThrow();
      await expect(client.query(base, [10, 6])).rejects.toThrow();
      await expect(client.query(base, [5, 6])).resolves.toBeDefined();
    });
  });

  it('treats check-in, check in, and checkin as colliding at the DB level too', async () => {
    await withTestClient(async (client) => {
      const insert = `INSERT INTO knowledge_points
        (term, meaning, example, part, scenario_major, scenario_minor, date_added)
        VALUES ($1, 'm', 'e', 1, '旅游', '机场广播', '2026-06-20')`;
      await client.query(insert, ['check-in']);
      await expect(client.query(insert, ['check in'])).rejects.toThrow();
      await expect(client.query(insert, ['CheckIn'])).rejects.toThrow();
    });
  });
});
