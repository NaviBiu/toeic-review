import { addDays } from './dateUtils';

export const CURVE_DAYS = [1, 2, 4, 7, 15, 30];

export type SrsState = {
  correctStreak: number;
  wrongCount: number;
  correctCount: number;
  status: 'active' | 'mastered';
  nextReviewDate: string | null;
};

export function applyCorrectAnswer(state: SrsState, today: string): SrsState {
  const k = state.correctStreak + 1;
  const correctCount = state.correctCount + 1;
  if (k >= CURVE_DAYS.length + 1) {
    return { ...state, correctStreak: k, correctCount, status: 'mastered', nextReviewDate: null };
  }
  const days = CURVE_DAYS[k - 1];
  return { ...state, correctStreak: k, correctCount, status: 'active', nextReviewDate: addDays(today, days) };
}

export function applyWrongAnswer(state: SrsState, today: string): SrsState {
  return {
    ...state,
    correctStreak: 0,
    wrongCount: state.wrongCount + 1,
    status: 'active',
    // Stays due today (not tomorrow) so it re-enters today's review queue
    // instead of escaping until the next day -- the user must get it right
    // at least once today before today's session can end on it.
    nextReviewDate: today,
  };
}
