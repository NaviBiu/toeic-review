import { describe, expect, it } from 'vitest';
import { selectQuestionIds } from '@/lib/questionReview/selection';

const candidates = [
  { id: 1, latestCorrect: null },
  { id: 2, latestCorrect: false },
  { id: 3, latestCorrect: true },
];

function randomValues(...values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe('selectQuestionIds', () => {
  it('uses unattempted, latest wrong, and latest correct weights in weak-first mode', () => {
    expect(selectQuestionIds(candidates, 3, 'weak_first', randomValues(0.5, 0.5, 0)))
      .toEqual([2, 1, 3]);
  });

  it('does not return duplicate ids when sampling without replacement', () => {
    const selected = selectQuestionIds(candidates, 3, 'weak_first', randomValues(0, 0, 0));

    expect(new Set(selected).size).toBe(selected.length);
    expect(candidates).toEqual([
      { id: 1, latestCorrect: null },
      { id: 2, latestCorrect: false },
      { id: 3, latestCorrect: true },
    ]);
  });

  it('returns every available candidate when count exceeds availability', () => {
    expect(selectQuestionIds(candidates, 10, 'random', randomValues(0, 0, 0)))
      .toEqual([1, 2, 3]);
  });
});
