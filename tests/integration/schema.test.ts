import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';

describe('schema constraints', () => {
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
