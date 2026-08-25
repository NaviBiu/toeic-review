import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withTestClient } from './setup';

describe('schema constraints', () => {
  it('defines a safely backfilled grading snapshot migration', () => {
    const migrationPath = resolve(
      process.cwd(),
      'migrations/0007_question_review_session_item_snapshots.sql',
    );
    const migrationExists = existsSync(migrationPath);
    expect(migrationExists).toBe(true);
    if (!migrationExists) return;

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS correct_option_snapshot TEXT/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS analysis_snapshot TEXT/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS notes_snapshot TEXT/);
    expect(sql).toMatch(
      /UPDATE question_review_session_items AS item[\s\S]*FROM review_questions AS question/,
    );
    expect(sql).toMatch(/CHECK \(correct_option_snapshot IN \('A', 'B', 'C', 'D'\)\) NOT VALID/);
    expect(sql).toContain('VALIDATE CONSTRAINT question_review_session_items_correct_option_snapshot_check');
    expect(sql).toContain('ALTER COLUMN correct_option_snapshot SET NOT NULL');
    expect(sql).toContain('ALTER COLUMN analysis_snapshot SET NOT NULL');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION set_question_review_session_item_snapshots()');
    expect(sql).toContain('CREATE TRIGGER question_review_session_items_set_snapshots');
    expect(sql).toMatch(
      /BEFORE INSERT ON question_review_session_items[\s\S]*set_question_review_session_item_snapshots\(\)/,
    );

    const transactions = sql.match(/BEGIN;[\s\S]*?COMMIT;/g) ?? [];
    expect(transactions).toHaveLength(5);
    expect(transactions[0]).toContain('ADD COLUMN IF NOT EXISTS correct_option_snapshot');
    expect(transactions[0]).toContain('CREATE TRIGGER question_review_session_items_set_snapshots');
    expect(transactions[0]).not.toContain('UPDATE question_review_session_items AS item');
    expect(transactions[1]).toContain('UPDATE question_review_session_items AS item');
    expect(transactions[1]).not.toContain('SET NOT NULL');
    expect(transactions[2]).toContain('ADD CONSTRAINT');
    expect(transactions[2]).not.toContain('VALIDATE CONSTRAINT');
    expect(transactions[3]).toContain('VALIDATE CONSTRAINT');
    expect(transactions[3]).not.toContain('SET NOT NULL');
    expect(transactions[4]).toContain('ALTER COLUMN correct_option_snapshot SET NOT NULL');
    expect(sql.indexOf(transactions[0])).toBeLessThan(sql.indexOf(transactions[1]));
    expect(sql.indexOf(transactions[1])).toBeLessThan(sql.indexOf(transactions[2]));
    expect(sql.indexOf(transactions[2])).toBeLessThan(sql.indexOf(transactions[3]));
    expect(sql.indexOf(transactions[3])).toBeLessThan(sql.indexOf(transactions[4]));
    expect(sql).toContain('DROP TRIGGER IF EXISTS question_review_session_items_set_snapshots');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS question_review_session_items_correct_option_snapshot_not_null');
  });

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

  it('rejects duplicate questions in a review session', async () => {
    await withTestClient(async (client) => {
      const { rows: [sessionItem] } = await client.query(
        `WITH category AS (
           SELECT id FROM question_categories
           WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
           ORDER BY id LIMIT 1
         ), question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'The report is ___ complete.',
             'near', 'nearly', 'nearest', 'nearness', 'B', '副词修饰形容词。', id
           FROM category
           RETURNING id
         ), review_session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 1)
           RETURNING id
         ), session_item AS (
           INSERT INTO question_review_session_items
             (session_id, question_id, position, correct_option_snapshot, analysis_snapshot,
              notes_snapshot)
           SELECT review_session.id, question.id, 1, question.correct_option,
             question.analysis, question.notes
           FROM review_session CROSS JOIN question
           RETURNING session_id, question_id
         )
         SELECT session_id, question_id FROM session_item`,
      );

      await expect(client.query(
        `INSERT INTO question_review_session_items
           (session_id, question_id, position, correct_option_snapshot, analysis_snapshot)
         VALUES ($1, $2, 2, 'B', '副词修饰形容词。')`,
        [sessionItem.session_id, sessionItem.question_id],
      )).rejects.toThrow();
    });
  });

  it('rejects duplicate question attempt request ids', async () => {
    await withTestClient(async (client) => {
      const requestId = '85ed0afc-2f4a-4405-8818-91418e2e15cd';
      const { rows: [attempt] } = await client.query(
        `WITH category AS (
           SELECT id FROM question_categories
           WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
           ORDER BY id LIMIT 1
         ), question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'The report is ___ complete.',
             'near', 'nearly', 'nearest', 'nearness', 'B', '副词修饰形容词。', id
           FROM category
           RETURNING id
         ), review_session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 1)
           RETURNING id
         ), session_item AS (
           INSERT INTO question_review_session_items
             (session_id, question_id, position, correct_option_snapshot, analysis_snapshot,
              notes_snapshot)
           SELECT review_session.id, question.id, 1, question.correct_option,
             question.analysis, question.notes
           FROM review_session CROSS JOIN question
           RETURNING session_id, question_id
         ), first_attempt AS (
           INSERT INTO question_attempts
             (request_id, session_id, question_id, selected_option, is_correct)
           SELECT $1, session_id, question_id, 'B', true FROM session_item
           RETURNING session_id, question_id
         )
         SELECT session_id, question_id FROM first_attempt`,
        [requestId],
      );

      await expect(client.query(
        `INSERT INTO question_attempts
         (request_id, session_id, question_id, selected_option, is_correct)
         VALUES ($1, $2, $3, 'B', true)`,
        [requestId, attempt.session_id, attempt.question_id],
      )).rejects.toThrow();
    });
  });

  it('stores submitted duration separately from editable timing and rejects negatives', async () => {
    await withTestClient(async (client) => {
      const { rows: [attempt] } = await client.query(
        `WITH category AS (
           SELECT id FROM question_categories
           WHERE section = 'reading' AND part = 5 AND name = '未细分' AND is_default = true
           ORDER BY id LIMIT 1
         ), question AS (
           INSERT INTO review_questions
             (section, part, question_format, stem, option_a, option_b, option_c, option_d,
              correct_option, analysis, category_id)
           SELECT 'reading', 5, 'single_choice', 'Submitted duration question',
             'A', 'B', 'C', 'D', 'B', 'test', id FROM category RETURNING id
         ), review_session AS (
           INSERT INTO question_review_sessions (section, part, mode, planned_count)
           VALUES ('reading', 5, 'weak_first', 1) RETURNING id
         ), item AS (
           INSERT INTO question_review_session_items
             (session_id, question_id, position, correct_option_snapshot, analysis_snapshot,
              notes_snapshot)
           SELECT review_session.id, question.id, 1, question.correct_option,
             question.analysis, question.notes
           FROM review_session CROSS JOIN question
           RETURNING session_id, question_id
         )
         INSERT INTO question_attempts
           (request_id, session_id, question_id, selected_option, is_correct, duration_ms,
            submitted_duration_ms)
         SELECT '85ed0afc-2f4a-4405-8818-91418e2e15ce', session_id, question_id,
           'B', true, 9000, 9000 FROM item
         RETURNING id`,
      );

      await client.query('UPDATE question_attempts SET duration_ms = 12500 WHERE id = $1', [attempt.id]);
      const { rows: [timing] } = await client.query(
        'SELECT duration_ms, submitted_duration_ms FROM question_attempts WHERE id = $1',
        [attempt.id],
      );
      expect(timing).toEqual({ duration_ms: 12500, submitted_duration_ms: 9000 });
      await expect(client.query(
        'UPDATE question_attempts SET submitted_duration_ms = -1 WHERE id = $1',
        [attempt.id],
      )).rejects.toThrow();
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
