import { NextRequest } from 'next/server';
import type { VercelClient } from '@vercel/postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitAttempt } from '@/lib/questionReview/sessions';

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

describe('attempt idempotency', () => {
  it('returns the existing attempt for the identical payload', async () => {
    await expect(submitAttempt(clientWith(
      [question],
      [],
      [storedAttempt],
      [{ correct_count: 0, wrong_count: 1, latest_correct: false, latest_duration_ms: 9000 }],
    ), input)).resolves.toMatchObject({ attemptId: 40, durationMs: 9000, isCorrect: false });
  });

  it.each([
    ['a different session', { ...storedAttempt, session_id: 21 }],
    ['a different question', { ...storedAttempt, question_id: 31 }],
    ['a different selected option', { ...storedAttempt, selected_option: 'B' }],
    ['a different duration', { ...storedAttempt, duration_ms: 9001 }],
  ])('rejects an idempotency key reused with %s', async (_label, conflictingAttempt) => {
    await expect(submitAttempt(clientWith([question], [], [conflictingAttempt]), input))
      .rejects.toThrow('请求标识已用于其他作答');
  });
});
