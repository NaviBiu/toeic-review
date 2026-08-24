import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as createSession } from '@/app/api/question-review-sessions/route';
import { POST as submitAttempt } from '@/app/api/question-attempts/route';
import { PATCH as updateAttempt } from '@/app/api/question-attempts/[id]/route';

describe('question review API validation', () => {
  it('rejects malformed session and attempt requests before connecting to the database', async () => {
    const malformedSession = await createSession(new NextRequest(
      'http://localhost/api/question-review-sessions', { method: 'POST', body: JSON.stringify({ plannedCount: 2 }) },
    ));
    const malformedAttempt = await submitAttempt(new NextRequest(
      'http://localhost/api/question-attempts', { method: 'POST', body: JSON.stringify({}) },
    ));

    expect(malformedSession.status).toBe(400);
    expect(malformedAttempt.status).toBe(400);
  });

  it('rejects a negative timing edit and an invalid attempt id', async () => {
    const invalidId = await updateAttempt(new NextRequest(
      'http://localhost/api/question-attempts/nope', { method: 'PATCH', body: '{}' },
    ), { params: Promise.resolve({ id: 'nope' }) });
    const negativeDuration = await updateAttempt(new NextRequest(
      'http://localhost/api/question-attempts/1', { method: 'PATCH', body: JSON.stringify({ durationMs: -1, durationExcluded: false }) },
    ), { params: Promise.resolve({ id: '1' }) });

    expect(invalidId.status).toBe(400);
    expect(negativeDuration.status).toBe(400);
  });
});
