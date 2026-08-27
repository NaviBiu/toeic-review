import { NextRequest } from 'next/server';
import type { VercelClient } from '@vercel/postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewSession, submitAttempt } from '@/lib/questionReview/sessions';

const requestId = '4f21de2e-e7a5-4b72-9425-c3086fa00111';
const input = {
  requestId,
  sessionId: 20,
  questionId: 30,
  selectedOption: 'A' as const,
  durationMs: 9000,
};

const question = { correct_option: 'B', analysis: 'test', notes: null };
const storedAttempt = {
  id: 40,
  session_id: input.sessionId,
  question_id: input.questionId,
  selected_option: input.selectedOption,
  is_correct: false,
  correct_option: 'B',
  analysis: 'test',
  notes: null,
  duration_ms: input.durationMs,
  submitted_duration_ms: input.durationMs,
  duration_excluded: false,
};

function clientWith(...rows: unknown[][]): VercelClient {
  return {
    query: vi.fn().mockImplementation(async () => ({ rows: rows.shift() ?? [] })),
  } as unknown as VercelClient;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/questionReview/sessions');
});

describe('session route input', () => {
  it('defaults an omitted includeMastered flag to false', async () => {
    const client = { connect: vi.fn(), end: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) };
    const createReviewSession = vi.fn().mockResolvedValue({
      id: 1, plannedCount: 1, actualCount: 0, questions: [],
    });
    class SessionError extends Error {}
    vi.doMock('@/lib/db', () => ({ createClient: () => client }));
    vi.doMock('@/lib/questionReview/sessions', () => ({ createReviewSession, SessionError }));
    const { POST } = await import('@/app/api/question-review-sessions/route');

    const response = await POST(new NextRequest('http://localhost/api/question-review-sessions', {
      method: 'POST',
      body: JSON.stringify({ mode: 'random', categoryScopeId: null, plannedCount: 1 }),
    }));

    expect(response.status).toBe(201);
    expect(createReviewSession).toHaveBeenCalledWith(client, expect.objectContaining({ includeMastered: false }));
  });

  it('rejects a supplied non-boolean includeMastered value', async () => {
    const { POST } = await import('@/app/api/question-review-sessions/route');
    const response = await POST(new NextRequest('http://localhost/api/question-review-sessions', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'random', categoryScopeId: null, includeMastered: 'false', plannedCount: 1,
      }),
    }));

    expect(response.status).toBe(400);
  });
});

describe('session creation', () => {
  it('rejects an empty candidate list without creating an empty session', async () => {
    const client = clientWith([]);

    await expect(createReviewSession(client, {
      mode: 'weak_first',
      categoryScopeId: null,
      includeMastered: false,
      plannedCount: 20,
    })).rejects.toThrow('当前范围没有可练习题目');

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.query).mock.calls[0][0]).toContain('FROM review_questions');
    expect(vi.mocked(client.query).mock.calls.some(([sql]) => String(sql).includes('INSERT INTO question_review_sessions'))).toBe(false);
  });

  it('stores grading fields on each selected session item without revealing them', async () => {
    const candidate = {
      id: 30,
      stem: 'The report is ___ complete.',
      option_a: 'near',
      option_b: 'nearly',
      option_c: 'nearest',
      option_d: 'nearness',
      correct_option: 'B',
      analysis: 'An adverb modifies the adjective.',
      notes: 'Review adverb forms.',
      source: null,
      parent_name: 'Word forms',
      category_name: 'Adverbs',
      correct_count: 0,
      wrong_count: 0,
      latest_correct: null,
      latest_duration_ms: null,
    };
    const client = clientWith([candidate], [{ id: 20 }], []);

    const session = await createReviewSession(client, {
      mode: 'weak_first',
      categoryScopeId: null,
      includeMastered: false,
      plannedCount: 1,
    });

    const [insertSql, insertValues] = vi.mocked(client.query).mock.calls[2];
    expect(insertSql).toContain('correct_option_snapshot');
    expect(insertSql).toContain('analysis_snapshot');
    expect(insertSql).toContain('notes_snapshot');
    expect(insertValues).toEqual([
      20, 30, 1, 'B', 'An adverb modifies the adjective.', 'Review adverb forms.',
    ]);
    expect(session.questions[0]).not.toHaveProperty('correctOption');
    expect(session.questions[0]).not.toHaveProperty('analysis');
    expect(session.questions[0]).not.toHaveProperty('notes');
  });
});

describe('session grading snapshots', () => {
  it('grades submission from the session item snapshot', async () => {
    const client = clientWith(
      [question],
      [],
      [storedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 9000 }],
    );

    await submitAttempt(client, input);

    const membershipSql = String(vi.mocked(client.query).mock.calls[0][0]);
    expect(membershipSql).toContain('item.correct_option_snapshot AS correct_option');
    expect(membershipSql).toContain('item.analysis_snapshot AS analysis');
    expect(membershipSql).toContain('item.notes_snapshot AS notes');
    expect(membershipSql).not.toContain('JOIN review_questions');
  });

  it('returns the session item snapshot for an idempotent retry', async () => {
    const client = clientWith(
      [question],
      [],
      [storedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 9000 }],
    );

    await submitAttempt(client, input);

    const retryLookupSql = String(vi.mocked(client.query).mock.calls[2][0]);
    expect(retryLookupSql).toContain('item.correct_option_snapshot AS correct_option');
    expect(retryLookupSql).toContain('item.analysis_snapshot AS analysis');
    expect(retryLookupSql).toContain('item.notes_snapshot AS notes');
    expect(retryLookupSql).not.toContain('JOIN review_questions');
  });

  it('returns the session item snapshot after a timing update', async () => {
    const client = clientWith(
      [{ id: storedAttempt.id }],
      [{ ...storedAttempt, duration_ms: 12500 }],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 12500 }],
    );
    const { updateAttemptTiming } = await import('@/lib/questionReview/sessions');

    const result = await updateAttemptTiming(client, storedAttempt.id, {
      durationMs: 12500,
      durationExcluded: false,
    });

    const timingLookupSql = String(vi.mocked(client.query).mock.calls[1][0]);
    expect(timingLookupSql).toContain('item.correct_option_snapshot AS correct_option');
    expect(timingLookupSql).toContain('item.analysis_snapshot AS analysis');
    expect(timingLookupSql).toContain('item.notes_snapshot AS notes');
    expect(timingLookupSql).not.toContain('JOIN review_questions');
    expect(result).toMatchObject({
      correctOption: 'B', analysis: 'test', notes: null, durationMs: 12500,
    });
  });
});

describe('attempt idempotency', () => {
  it('returns the existing attempt for the identical payload', async () => {
    const client = clientWith(
      [question],
      [],
      [storedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 9000 }],
    );

    await expect(submitAttempt(client, input)).resolves.toMatchObject({
      attemptId: 40, durationMs: 9000, isCorrect: false,
    });
    expect(vi.mocked(client.query).mock.calls[1][0]).toContain('submitted_duration_ms');
    expect(vi.mocked(client.query).mock.calls[1][1]).toEqual([
      input.requestId, input.sessionId, input.questionId, input.selectedOption, false, input.durationMs,
    ]);
  });

  it('uses the original submitted duration after a timing edit', async () => {
    const editedAttempt = { ...storedAttempt, duration_ms: 12500 };
    const client = clientWith(
      [question],
      [],
      [storedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 9000 }],
      [{ id: storedAttempt.id }],
      [editedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 12500 }],
      [question],
      [],
      [editedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 12500 }],
    );

    const created = await submitAttempt(client, input);
    const { updateAttemptTiming } = await import('@/lib/questionReview/sessions');
    await updateAttemptTiming(client, created.attemptId, { durationMs: 12500, durationExcluded: false });

    await expect(submitAttempt(client, input)).resolves.toMatchObject({ attemptId: created.attemptId });
  });

  it.each([
    ['a different session', { ...storedAttempt, session_id: 21 }],
    ['a different question', { ...storedAttempt, question_id: 31 }],
    ['a different selected option', { ...storedAttempt, selected_option: 'B' }],
    ['a different duration', { ...storedAttempt, submitted_duration_ms: 9001 }],
  ])('rejects an idempotency key reused with %s', async (_label, conflictingAttempt) => {
    await expect(submitAttempt(clientWith([question], [], [conflictingAttempt]), input))
      .rejects.toThrow('请求标识已用于其他作答');
  });
});
