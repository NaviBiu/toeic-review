import { describe, it, expect } from 'vitest';
import { applyCorrectAnswer, applyWrongAnswer, CURVE_DAYS } from '../../src/lib/srs';

const TODAY = '2026-06-26';

function freshState() {
  return { correctStreak: 0, wrongCount: 0, correctCount: 0, status: 'active' as const, nextReviewDate: TODAY };
}

describe('CURVE_DAYS', () => {
  it('is the 6-stage classic Ebbinghaus curve', () => {
    expect(CURVE_DAYS).toEqual([1, 2, 4, 7, 15, 30]);
  });
});

describe('applyCorrectAnswer', () => {
  it('schedules 1 day after the first correct answer', () => {
    const result = applyCorrectAnswer(freshState(), TODAY);
    expect(result.correctStreak).toBe(1);
    expect(result.nextReviewDate).toBe('2026-06-27');
    expect(result.status).toBe('active');
  });

  it('stays active through all 6 curve stages', () => {
    let state = freshState();
    for (let i = 0; i < 6; i++) {
      state = applyCorrectAnswer(state, TODAY);
      expect(state.correctStreak).toBe(i + 1);
      expect(state.status).toBe('active');
    }
  });

  it('graduates to mastered on the 7th consecutive correct answer', () => {
    let state = freshState();
    for (let i = 0; i < 6; i++) state = applyCorrectAnswer(state, TODAY);
    expect(state.status).toBe('active');

    state = applyCorrectAnswer(state, TODAY);
    expect(state.status).toBe('mastered');
    expect(state.correctStreak).toBe(7);
    expect(state.nextReviewDate).toBeNull();
  });

  it('increments correctCount on every correct answer', () => {
    let state = freshState();
    state = applyCorrectAnswer(state, TODAY);
    state = applyCorrectAnswer(state, TODAY);
    expect(state.correctCount).toBe(2);
  });
});

describe('applyWrongAnswer', () => {
  it('resets correctStreak to 0 and stays due today (not tomorrow)', () => {
    let state = freshState();
    state = applyCorrectAnswer(state, TODAY);
    state = applyCorrectAnswer(state, TODAY);
    state = applyWrongAnswer(state, TODAY);
    expect(state.correctStreak).toBe(0);
    expect(state.nextReviewDate).toBe(TODAY);
    expect(state.status).toBe('active');
  });

  it('a same-day correction afterwards still schedules from day 1, like any first correct answer', () => {
    let state = freshState();
    state = applyWrongAnswer(state, TODAY);
    state = applyCorrectAnswer(state, TODAY);
    expect(state.correctStreak).toBe(1);
    expect(state.nextReviewDate).toBe('2026-06-27');
  });

  it('increments wrongCount', () => {
    const state = applyWrongAnswer(freshState(), TODAY);
    expect(state.wrongCount).toBe(1);
  });

  it('never sets status to mastered', () => {
    expect(applyWrongAnswer(freshState(), TODAY).status).toBe('active');
  });
});
