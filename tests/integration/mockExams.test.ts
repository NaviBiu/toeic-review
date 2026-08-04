import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import { createMockExam, listMockExams, replacePracticeAttachments } from '../../src/lib/mockExams';

const VALID = {
  practiceDate: '2026-06-26',
  type: 'full_mock' as const,
  parts: [
    { part: 1 as const, correct: 5, total: 6 },
    { part: 2 as const, correct: 20, total: 25 },
    { part: 3 as const, correct: 30, total: 39 },
    { part: 4 as const, correct: 25, total: 30 },
  ],
  scenarios: [{ scenarioMajor: '一般商务', scenarioMinor: '会议', correct: 3, total: 5 }],
};

describe('createMockExam', () => {
  it('creates a practice-session row plus scenario breakdown rows', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, VALID);
      expect(result.id).toBeGreaterThan(0);
      const all = await listMockExams(client);
      expect(all.find((r) => r.id === result.id)?.scenarios).toHaveLength(1);
    });
  });

  it('creates a part-drill record with only the practiced part', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, {
        practiceDate: '2026-06-27',
        type: 'part_drill',
        title: 'Part 3专项',
        parts: [{ part: 3, correct: 18, total: 25 }],
        scenarios: [],
      });
      expect(result.type).toBe('part_drill');
      expect(result.parts).toEqual([{ part: 3, correct: 18, total: 25 }]);
      expect(result.part1).toBeNull();
      expect(result.part3).toEqual({ correct: 18, total: 25 });
    });
  });

  it('keeps accepting the old full-mock payload shape', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, {
        testDate: '2026-06-28',
        part1: { correct: 5, total: 6 },
        part2: { correct: 20, total: 25 },
        part3: { correct: 30, total: 39 },
        part4: { correct: 25, total: 30 },
        scenarios: [],
      });
      expect(result.type).toBe('full_mock');
      expect(result.parts).toHaveLength(4);
    });
  });

  it('rejects a part with total 0 before hitting the database', async () => {
    await withTestClient(async (client) => {
      const bad = { ...VALID, parts: [{ part: 1 as const, correct: 0, total: 0 }] };
      await expect(createMockExam(client, bad)).rejects.toThrow(/part1/i);
    });
  });

  it('rejects a part where correct exceeds total', async () => {
    await withTestClient(async (client) => {
      const bad = { ...VALID, parts: [{ part: 2 as const, correct: 30, total: 25 }] };
      await expect(createMockExam(client, bad)).rejects.toThrow(/part2/i);
    });
  });

  it('rejects a full mock unless all four parts are present', async () => {
    await withTestClient(async (client) => {
      const bad = { ...VALID, parts: [{ part: 2 as const, correct: 20, total: 25 }] };
      await expect(createMockExam(client, bad)).rejects.toThrow(/Part 1-4/);
    });
  });

  it('allows zero scenario breakdown rows', async () => {
    await withTestClient(async (client) => {
      const result = await createMockExam(client, { ...VALID, scenarios: [] });
      const all = await listMockExams(client);
      expect(all.find((r) => r.id === result.id)?.scenarios).toEqual([]);
    });
  });
});

describe('listMockExams', () => {
  it('orders results by practice_date descending', async () => {
    await withTestClient(async (client) => {
      await createMockExam(client, { ...VALID, practiceDate: '2026-06-01', scenarios: [] });
      await createMockExam(client, { ...VALID, practiceDate: '2026-06-20', scenarios: [] });
      const all = await listMockExams(client);
      const index0601 = all.findIndex((r) => r.practiceDate === '2026-06-01');
      const index0620 = all.findIndex((r) => r.practiceDate === '2026-06-20');
      expect(index0601).toBeGreaterThan(-1);
      expect(index0620).toBeGreaterThan(-1);
      expect(index0620).toBeLessThan(index0601);
    });
  }, 30000);
});

describe('replacePracticeAttachments', () => {
  it('replaces attachments on an existing practice record without changing its scores', async () => {
    await withTestClient(async (client) => {
      const created = await createMockExam(client, { ...VALID, scenarios: [] });
      await replacePracticeAttachments(client, created.id, [{
        name: 'wrong-questions.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,dGVzdA==',
      }]);

      const { rows: attachments } = await client.query(
        'SELECT name, mime_type FROM practice_session_attachments WHERE practice_session_id = $1',
        [created.id],
      );
      const { rows: scores } = await client.query(
        'SELECT count(*)::int AS count FROM practice_part_scores WHERE practice_session_id = $1',
        [created.id],
      );

      expect(attachments).toEqual([{ name: 'wrong-questions.png', mime_type: 'image/png' }]);
      expect(scores[0].count).toBe(4);
    });
  }, 30000);
});
